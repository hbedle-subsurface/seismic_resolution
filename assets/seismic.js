/* ===========================================================================
   seismic.js — shared math + plotting core
   "What Can You REALLY See in Seismic?"
   Heather Bedle / AASPI / University of Oklahoma
   Vanilla JS, no dependencies, no build step.
   =========================================================================== */

const SEIS = (function () {
  'use strict';

  /* ---------------------------------------------------------------------
     WAVELETS
     All zero-phase, normalized so w(0) = 1.
     --------------------------------------------------------------------- */

  // Ricker: the classic single-parameter wavelet. f = peak frequency (Hz).
  function ricker(t, f) {
    const a = Math.PI * Math.PI * f * f * t * t;
    return (1 - 2 * a) * Math.exp(-a);
  }

  function sinc(x) {
    if (Math.abs(x) < 1e-12) return 1;
    return Math.sin(x) / x;
  }

  // Ormsby trapezoidal bandpass: f1 low-cut, f2 low-pass, f3 high-pass, f4 high-cut.
  function ormsbyRaw(t, f1, f2, f3, f4) {
    const term = (f) => Math.PI * f * f * Math.pow(sinc(Math.PI * f * t), 2);
    return (
      (term(f4) - term(f3)) / (f4 - f3) -
      (term(f2) - term(f1)) / (f2 - f1)
    );
  }

  function ormsby(t, f1, f2, f3, f4) {
    const norm = ormsbyRaw(0, f1, f2, f3, f4);
    return ormsbyRaw(t, f1, f2, f3, f4) / norm;
  }

  /**
   * Build a wavelet evaluator from a config object.
   * cfg = { type:'ricker', f:30 }  or  { type:'ormsby', f1:5,f2:10,f3:40,f4:50 }
   * Returns { fn(t), fdom, halfLength } with t in SECONDS.
   */
  function makeWavelet(cfg) {
    if (cfg.type === 'ormsby') {
      const { f1, f2, f3, f4 } = cfg;
      return {
        fn: (t) => ormsby(t, f1, f2, f3, f4),
        fdom: (f2 + f3) / 2,
        halfLength: 2.2 / f1,
      };
    }
    const f = cfg.f;
    return {
      fn: (t) => ricker(t, f),
      fdom: f,
      halfLength: 1.4 / f,
    };
  }

  // Amplitude spectrum by brute-force DFT of a sampled wavelet. Small n, fine.
  function spectrum(wav, dt, nf, fmax) {
    const half = wav.halfLength;
    const n = Math.ceil(half / dt);
    const out = [];
    for (let k = 0; k < nf; k++) {
      const f = (k / (nf - 1)) * fmax;
      let re = 0, im = 0;
      for (let i = -n; i <= n; i++) {
        const t = i * dt;
        const v = wav.fn(t);
        const ph = -2 * Math.PI * f * t;
        re += v * Math.cos(ph);
        im += v * Math.sin(ph);
      }
      out.push({ f, a: Math.hypot(re, im) * dt });
    }
    const mx = out.reduce((m, p) => Math.max(m, p.a), 1e-12);
    out.forEach((p) => (p.a /= mx));
    return out;
  }

  /* ---------------------------------------------------------------------
     SYNTHETIC TRACES
     Spikes are convolved analytically (sum of scaled, shifted wavelets)
     so reflector timing is never rounded to the sample grid. This keeps
     tuning curves smooth instead of stair-stepped.
     --------------------------------------------------------------------- */

  // spikes: [{t: seconds, r: reflection coefficient}, ...]
  function traceValue(spikes, t, wfn) {
    let v = 0;
    for (let i = 0; i < spikes.length; i++) {
      v += spikes[i].r * wfn(t - spikes[i].t);
    }
    return v;
  }

  function sampleTrace(spikes, t0, dt, nt, wfn) {
    const out = new Float32Array(nt);
    for (let i = 0; i < nt; i++) out[i] = traceValue(spikes, t0 + i * dt, wfn);
    return out;
  }

  /**
   * Same result as sampleTrace, but each spike only writes over the samples its
   * wavelet actually reaches. With a few reflectors it makes no difference; with
   * forty of them it is several times faster, because the cost stops scaling
   * with the length of the trace.
   */
  function traceFromSpikes(spikes, t0, dt, nt, wav) {
    const out = new Float32Array(nt);
    const half = wav.halfLength;
    for (let s = 0; s < spikes.length; s++) {
      const st = spikes[s].t, sr = spikes[s].r;
      const i0 = Math.max(0, Math.ceil((st - half - t0) / dt));
      const i1 = Math.min(nt - 1, Math.floor((st + half - t0) / dt));
      for (let i = i0; i <= i1; i++) out[i] += sr * wav.fn(t0 + i * dt - st);
    }
    return out;
  }

  /* ---------------------------------------------------------------------
     REFLECTION COEFFICIENTS
     --------------------------------------------------------------------- */

  function rc(v1, rho1, v2, rho2) {
    const i1 = v1 * rho1, i2 = v2 * rho2;
    return (i2 - i1) / (i2 + i1);
  }

  /* ---------------------------------------------------------------------
     RANDOM + NOISE
     --------------------------------------------------------------------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussRand(rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Band-limited noise: white reflectivity convolved with the same wavelet,
   * so the noise looks like seismic rather than TV static.
   *
   * `lateral` gives the noise trace-to-trace correlation (a triangular smoother
   * that many traces wide). Without it the field is spatially white and reads
   * as vertical striping, which is not what noise on a migrated section
   * looks like — and vertical striping is far too easy to tell apart from a fault.
   *
   * Returns Float32Array[nx*nt], RMS-normalized to 1.
   */
  function bandLimitedNoise(nx, nt, dt, wav, seed, lateral) {
    const rnd = mulberry32(seed);
    const hw = Math.ceil(wav.halfLength / dt);
    const wsamp = new Float32Array(2 * hw + 1);
    for (let i = -hw; i <= hw; i++) wsamp[i + hw] = wav.fn(i * dt);

    const out = new Float32Array(nx * nt);
    const white = new Float32Array(nt + 2 * hw);
    for (let ix = 0; ix < nx; ix++) {
      for (let i = 0; i < white.length; i++) white[i] = gaussRand(rnd);
      for (let it = 0; it < nt; it++) {
        let s = 0;
        for (let k = -hw; k <= hw; k++) s += white[it + hw + k] * wsamp[hw - k];
        out[ix * nt + it] = s;
      }
    }

    // lateral correlation: triangular smoother across traces
    const L = Math.max(0, Math.floor(lateral === undefined ? 3 : lateral));
    if (L > 0) {
      const tmp = new Float32Array(nx);
      for (let it = 0; it < nt; it++) {
        for (let ix = 0; ix < nx; ix++) {
          let s = 0, wsum = 0;
          for (let k = -L; k <= L; k++) {
            const j = ix + k;
            if (j < 0 || j >= nx) continue;
            const wgt = (L + 1 - Math.abs(k));
            s += out[j * nt + it] * wgt; wsum += wgt;
          }
          tmp[ix] = s / wsum;
        }
        for (let ix = 0; ix < nx; ix++) out[ix * nt + it] = tmp[ix];
      }
    }

    let sum2 = 0;
    for (let i = 0; i < out.length; i++) sum2 += out[i] * out[i];
    const rms = Math.sqrt(sum2 / (nx * nt)) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= rms;
    return out;
  }

  /* ---------------------------------------------------------------------
     FFT  (radix-2, in place)
     --------------------------------------------------------------------- */

  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
          const vr = ar * cr - ai * ci, vi = ar * ci + ai * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  /**
   * Rotate a wavelet's phase, exactly, through the frequency domain: positive
   * frequencies are multiplied by e^-i*phi and negative ones by its conjugate,
   * which is the same thing as w*cos(phi) - H{w}*sin(phi) without needing a
   * separate Hilbert transform.
   *
   * Returns an object with the same shape as makeWavelet, so it can be passed
   * anywhere a wavelet is expected. The rotated wavelet has longer tails than
   * the one it came from, so halfLength grows to match.
   */
  function phaseRotate(wav, degrees) {
    const deg = ((degrees % 360) + 540) % 360 - 180;      // into -180..180
    if (Math.abs(deg) < 1e-9) return wav;

    const dt = Math.min(wav.halfLength / 96, 0.0004);
    const hw = Math.ceil(wav.halfLength / dt);
    const out = 3 * hw;                                    // room for the tails
    let n = 1;
    while (n < 4 * out) n *= 2;

    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = -hw; i <= hw; i++) re[(i + n) % n] = wav.fn(i * dt);
    fft(re, im, false);

    const ph = deg * Math.PI / 180;
    const c = Math.cos(ph), s = Math.sin(ph);
    for (let k = 0; k < n; k++) {
      const sgn = (k === 0 || k === n / 2) ? 0 : (k < n / 2 ? 1 : -1);
      const cc = c, ss = -sgn * s;
      const a = re[k], b = im[k];
      re[k] = a * cc - b * ss;
      im[k] = a * ss + b * cc;
    }
    fft(re, im, true);

    const samp = new Float64Array(2 * out + 1);
    for (let i = -out; i <= out; i++) samp[i + out] = re[(i + n) % n];

    const half = out * dt;
    return {
      fdom: wav.fdom,
      halfLength: half,
      phase: deg,
      fn: function (t) {
        const p = t / dt + out;
        if (p < 0 || p > 2 * out) return 0;
        const i = Math.floor(p), f = p - i;
        if (i >= 2 * out) return samp[2 * out];
        return samp[i] + (samp[i + 1] - samp[i]) * f;
      },
    };
  }

  /**
   * f-k amplitude spectrum of a trace-major field. nx and nt must be powers of
   * two. A cosine taper is applied in both directions first, otherwise the
   * edges of the panel smear energy across the whole plot.
   *
   * Returns { mag, nk, nf } with mag laid out [ik * nf + iff], ik running from
   * -Nyquist to +Nyquist (already shifted) and iff from 0 Hz upward.
   */
  function fkSpectrum(field, nx, nt) {
    const nf = nt / 2;
    const tw = new Float64Array(nt), xw = new Float64Array(nx);
    for (let i = 0; i < nt; i++) tw[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (nt - 1));
    for (let i = 0; i < nx; i++) xw[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (nx - 1));

    // time transform, one trace at a time
    const sr = new Float64Array(nx * nf), si = new Float64Array(nx * nf);
    const re = new Float64Array(nt), im = new Float64Array(nt);
    for (let ix = 0; ix < nx; ix++) {
      for (let it = 0; it < nt; it++) { re[it] = field[ix * nt + it] * tw[it] * xw[ix]; im[it] = 0; }
      fft(re, im, false);
      for (let f = 0; f < nf; f++) { sr[ix * nf + f] = re[f]; si[ix * nf + f] = im[f]; }
    }
    // space transform, one frequency at a time
    const mag = new Float32Array(nx * nf);
    const xr = new Float64Array(nx), xi = new Float64Array(nx);
    for (let f = 0; f < nf; f++) {
      for (let ix = 0; ix < nx; ix++) { xr[ix] = sr[ix * nf + f]; xi[ix] = si[ix * nf + f]; }
      fft(xr, xi, false);
      for (let ik = 0; ik < nx; ik++) {
        const shifted = (ik + nx / 2) % nx;          // put k = 0 in the middle
        mag[ik * nf + f] = Math.hypot(xr[shifted], xi[shifted]);
      }
    }
    return { mag, nk: nx, nf };
  }

  /* ---------------------------------------------------------------------
     COLOR MAPS
     Each returns [r,g,b] for x in [-1, 1].
     --------------------------------------------------------------------- */

  function lerp(a, b, t) { return a + (b - a) * t; }

  function rampMap(stops) {
    return function (x) {
      const v = Math.max(-1, Math.min(1, x));
      const p = (v + 1) / 2 * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(p));
      const f = p - i;
      const a = stops[i], b = stops[i + 1];
      return [
        Math.round(lerp(a[0], b[0], f)),
        Math.round(lerp(a[1], b[1], f)),
        Math.round(lerp(a[2], b[2], f)),
      ];
    };
  }

  /**
   * Seismic color maps. Each maps an amplitude in [-1, 1], so the NEGATIVE end
   * is a trough and the POSITIVE end is a peak.
   *
   * Under the SEG normal convention a peak is blue, or black on a gray display,
   * and a trough is red. Polarity is handled where the traces are built, by
   * flipping the sign of the reflection coefficients, so these maps never need
   * to change: a peak is always the positive end and always plots the same.
   */
  const COLORMAPS = {
    // trough red -- white -- peak blue
    bwr: rampMap([
      [92, 14, 12], [176, 36, 24], [214, 138, 122],
      [248, 248, 246],
      [122, 168, 214], [27, 79, 156], [12, 44, 92],
    ]),
    // trough white -- peak black, the classic printed section
    gray: rampMap([
      [253, 253, 252], [226, 227, 228], [188, 190, 193],
      [140, 144, 148],
      [92, 96, 100], [48, 51, 55], [12, 14, 16],
    ]),
    // trough orange -- peak blue: safe for deuteranopia / protanopia
    cbsafe: rampMap([
      [127, 63, 0], [224, 130, 20], [253, 190, 110],
      [247, 247, 247],
      [146, 197, 222], [33, 102, 172], [8, 48, 107],
    ]),
  };

  /**
   * Sequential maps, for quantities that run from low to high rather than
   * negative to positive: thickness, amplitude magnitude, depth. Viridis and
   * cividis are both perceptually uniform and safe for colour-vision
   * deficiency; cividis is optimised for it specifically. Rainbow maps are
   * avoided because they invent boundaries where the data has none.
   */
  const SEQMAPS = {
    viridis: rampMapSeq([
      [68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],
      [31,158,137],[53,183,121],[109,205,89],[180,222,44],[253,231,37],
    ]),
    cividis: rampMapSeq([
      [0,32,76],[0,67,88],[0,89,100],[62,109,105],[95,127,98],
      [128,146,89],[165,166,76],[203,187,60],[243,209,39],[255,233,69],
    ]),
    // Shallow red through cream to deep blue-purple: the usual structure-map
    // convention, and safe for colour-vision deficiency because the difficult
    // pair is red against green, not red against blue.
    structure: rampMapSeq([
      [124,24,10],[168,60,18],[205,112,35],[232,175,95],[243,222,175],
      [196,220,205],[120,180,200],[52,120,175],[30,66,135],[40,30,90],
    ]),
    // A single-hue green ramp for thickness, so it cannot be confused with
    // either the structure map or the amplitude map at a glance.
    thickness: rampMapSeq([
      [250,253,246],[215,238,205],[168,220,175],[112,196,155],
      [58,166,140],[24,124,120],[12,80,90],
    ]),
    warm: rampMapSeq([
      [252,250,246],[253,231,160],[247,190,90],[233,131,60],[196,60,45],[110,16,20],
    ]),
  };

  // like rampMap, but the input runs 0..1 instead of -1..1
  function rampMapSeq(stops) {
    return function (u) {
      const v = Math.max(0, Math.min(1, u));
      const p = v * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(p));
      const f = p - i;
      const a = stops[i], b = stops[i + 1];
      return [
        Math.round(lerp(a[0], b[0], f)),
        Math.round(lerp(a[1], b[1], f)),
        Math.round(lerp(a[2], b[2], f)),
      ];
    };
  }

  /* ---------------------------------------------------------------------
     CANVAS HELPERS
     --------------------------------------------------------------------- */

  // Size a canvas for the device pixel ratio and return a scaled 2D context.
  function fitCanvas(canvas, cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /**
   * Variable-density image of a [nx][nt] amplitude field.
   * data: Float32Array laid out trace-major (ix*nt + it)
   * Drawn into rect {x,y,w,h}; time increases downward.
   */
  function drawVarDensity(ctx, data, nx, nt, rect, opts) {
    const o = opts || {};
    const cmap = o.cmap || COLORMAPS.bwr;
    const gain = o.gain || 1;
    let peak = o.clip;
    if (!peak) {
      peak = 0;
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
      }
      peak = peak || 1;
    }
    const off = document.createElement('canvas');
    off.width = nx; off.height = nt;
    const octx = off.getContext('2d');
    const img = octx.createImageData(nx, nt);
    for (let ix = 0; ix < nx; ix++) {
      for (let it = 0; it < nt; it++) {
        const v = (data[ix * nt + it] / peak) * gain;
        const c = cmap(v);
        const p = (it * nx + ix) * 4;
        img.data[p] = c[0]; img.data[p + 1] = c[1];
        img.data[p + 2] = c[2]; img.data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = o.smooth !== false;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    return peak;
  }

  /**
   * Wiggle + positive variable-area overlay.
   * step: draw every Nth trace. excursion: trace spacing multiples.
   */
  function drawWiggle(ctx, data, nx, nt, rect, opts) {
    const o = opts || {};
    const step = o.step || 1;
    const exc = o.excursion || 1.4;
    const peak = o.clip || 1;
    const dx = rect.w / nx;
    const traceW = dx * step * exc;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.lineWidth = o.lineWidth || 0.9;
    ctx.strokeStyle = o.stroke || 'rgba(22,25,28,0.85)';
    ctx.fillStyle = o.fill || 'rgba(22,25,28,0.75)';
    for (let ix = 0; ix < nx; ix += step) {
      const x0 = rect.x + (ix + 0.5) * dx;
      ctx.beginPath();
      for (let it = 0; it < nt; it++) {
        const y = rect.y + (it / (nt - 1)) * rect.h;
        const x = x0 + (data[ix * nt + it] / peak) * traceW;
        it === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      // positive-lobe fill
      ctx.beginPath();
      ctx.moveTo(x0, rect.y);
      for (let it = 0; it < nt; it++) {
        const y = rect.y + (it / (nt - 1)) * rect.h;
        const a = data[ix * nt + it];
        ctx.lineTo(x0 + Math.max(0, a / peak) * traceW, y);
      }
      ctx.lineTo(x0, rect.y + rect.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------------
     AXES
     --------------------------------------------------------------------- */

  const AX = {
    font: '11px "IBM Plex Mono", ui-monospace, monospace',
    color: '#5C6670',
    grid: 'rgba(92,102,112,0.16)',
  };

  function niceTicks(min, max, target) {
    const span = max - min;
    if (span <= 0) return [min];
    const raw = span / (target || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const stepN = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    const step = stepN * mag;
    const start = Math.ceil(min / step) * step;
    const out = [];
    for (let v = start; v <= max + step * 1e-6; v += step) {
      out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    }
    return out;
  }

  function frame(ctx, rect) {
    ctx.save();
    ctx.strokeStyle = 'rgba(22,25,28,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
    ctx.restore();
  }

  function axisBottom(ctx, rect, min, max, label, fmt, opts) {
    const o = opts || {};
    ctx.save();
    ctx.font = AX.font; ctx.fillStyle = AX.color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeStyle = AX.color; ctx.lineWidth = 1;
    niceTicks(min, max, o.ticks || 6).forEach((v) => {
      const x = rect.x + ((v - min) / (max - min)) * rect.w;
      ctx.beginPath();
      ctx.moveTo(x, rect.y + rect.h);
      ctx.lineTo(x, rect.y + rect.h + 4);
      ctx.stroke();
      ctx.fillText(fmt ? fmt(v) : String(Math.round(v * 100) / 100), x, rect.y + rect.h + 6);
    });
    if (label) {
      ctx.font = '11px "IBM Plex Sans", sans-serif';
      ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h + 22);
    }
    ctx.restore();
  }

  function axisLeft(ctx, rect, min, max, label, fmt, opts) {
    const o = opts || {};
    ctx.save();
    ctx.font = AX.font; ctx.fillStyle = AX.color;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = AX.color; ctx.lineWidth = 1;
    niceTicks(min, max, o.ticks || 5).forEach((v) => {
      const f = (v - min) / (max - min);
      const y = o.flip ? rect.y + rect.h - f * rect.h : rect.y + f * rect.h;
      ctx.beginPath();
      ctx.moveTo(rect.x - 4, y);
      ctx.lineTo(rect.x, y);
      ctx.stroke();
      ctx.fillText(fmt ? fmt(v) : String(Math.round(v * 100) / 100), rect.x - 6, y);
      if (o.grid) {
        ctx.save();
        ctx.strokeStyle = AX.grid;
        ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke();
        ctx.restore();
      }
    });
    if (label) {
      ctx.translate(rect.x - 42, rect.y + rect.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.font = '11px "IBM Plex Sans", sans-serif';
      ctx.fillText(label, 0, 0);
    }
    ctx.restore();
  }

  function dashedLine(ctx, x1, y1, x2, y2, color, dash, width) {
    ctx.save();
    ctx.setLineDash(dash || [5, 4]);
    ctx.strokeStyle = color; ctx.lineWidth = width || 1.4;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function tag(ctx, x, y, text, color, align) {
    ctx.save();
    ctx.font = '10px "IBM Plex Mono", monospace';
    const w = ctx.measureText(text).width + 8;
    const ax = align === 'right' ? x - w : x;
    ctx.fillStyle = color;
    ctx.fillRect(ax, y - 7, w, 14);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, ax + 4, y + 0.5);
    ctx.restore();
  }

  /**
   * Horizontal color bar, drawn in terms of REFLECTION COEFFICIENT rather than
   * displayed amplitude. That distinction matters: the color map itself never
   * changes, but polarity decides whether a positive RC is drawn as a peak or a
   * trough, so labelling the bar by RC makes the bar itself flip when polarity
   * is switched. Pass pol = -1 for reverse polarity.
   */
  function drawColorbar(ctx, rect, cmap, opts) {
    const o = opts || {};
    const pol = o.pol === -1 ? -1 : 1;
    const n = Math.max(2, Math.round(rect.w));
    for (let i = 0; i < n; i++) {
      const rcv = -1 + (2 * i) / (n - 1);          // reflection coefficient axis
      const c = cmap(pol * rcv * 0.92);
      ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      ctx.fillRect(rect.x + i * (rect.w / n), rect.y, rect.w / n + 1, rect.h);
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(22,25,28,.45)'; ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
    ctx.font = '9.5px "IBM Plex Mono", monospace';
    ctx.fillStyle = AX.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(o.left || '\u2212 RC', rect.x, rect.y + rect.h + 3);
    ctx.textAlign = 'right';
    ctx.fillText(o.right || '+ RC', rect.x + rect.w, rect.y + rect.h + 3);
    if (o.title) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(o.title, rect.x + rect.w / 2, rect.y - 3);
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------------
     UNITS
     --------------------------------------------------------------------- */

  const UNITS = {
    m: { len: 1, lab: 'm', vel: 1, vlab: 'm/s' },
    ft: { len: 3.28084, lab: 'ft', vel: 3.28084, vlab: 'ft/s' },
  };

  /* ---------------------------------------------------------------------
     URL STATE  (so instructors can hand out a link to an exact setup)
     --------------------------------------------------------------------- */

  function readState(defaults) {
    const p = new URLSearchParams(location.search);
    const out = Object.assign({}, defaults);
    for (const k of Object.keys(defaults)) {
      if (!p.has(k)) continue;
      const raw = p.get(k);
      out[k] = typeof defaults[k] === 'number' ? parseFloat(raw)
             : typeof defaults[k] === 'boolean' ? raw === '1' || raw === 'true'
             : raw;
    }
    return out;
  }

  let writeTimer = null;
  function writeState(state, defaults) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      const p = new URLSearchParams();
      for (const k of Object.keys(state)) {
        if (defaults && state[k] === defaults[k]) continue;
        p.set(k, typeof state[k] === 'boolean' ? (state[k] ? 1 : 0) : state[k]);
      }
      const q = p.toString();
      history.replaceState(null, '', q ? '?' + q : location.pathname);
    }, 250);
  }

  function copyLink(btn) {
    navigator.clipboard.writeText(location.href).then(() => {
      const old = btn.textContent;
      btn.textContent = 'Link copied';
      setTimeout(() => (btn.textContent = old), 1600);
    });
  }

  function savePNG(canvas, name) {
    const a = document.createElement('a');
    a.download = name + '.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  /* ---------------------------------------------------------------------
     FAILURE IS LOUD, NOT SILENT

     When a module throws while drawing, every canvas on the page stays blank
     and nothing says why. That has happened more than once by updating a
     module without also updating this file, since modules rely on helpers that
     were added here later. This puts a message on the page instead.
     --------------------------------------------------------------------- */

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('error', function (ev) {
      if (document.getElementById('seis-error-banner')) return;
      const msg = (ev && ev.message) || 'Unknown error';
      const likelyStale = /is not a function|is not defined|undefined/.test(msg);
      const el = document.createElement('div');
      el.id = 'seis-error-banner';
      el.setAttribute('style', [
        'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:9999',
        'background:#841617', 'color:#fff', 'padding:12px 18px',
        'font:13px/1.5 ui-monospace,Menlo,monospace', 'box-shadow:0 2px 10px rgba(0,0,0,.3)',
      ].join(';'));
      el.textContent = 'This page stopped drawing: ' + msg +
        (likelyStale
          ? '  —  this usually means assets/seismic.js is older than the module using it. Upload the current assets/seismic.js and reload.'
          : '');
      const dismiss = document.createElement('span');
      dismiss.textContent = '  [dismiss]';
      dismiss.setAttribute('style', 'cursor:pointer;text-decoration:underline');
      dismiss.onclick = function () { el.remove(); };
      el.appendChild(dismiss);
      (document.body || document.documentElement).appendChild(el);
    });
  }

  /* --------------------------------------------------------------------- */

  return {
    ricker, ormsby, makeWavelet, spectrum,
    traceValue, sampleTrace, traceFromSpikes, rc,
    mulberry32, gaussRand, bandLimitedNoise, fft, fkSpectrum, phaseRotate,
    COLORMAPS, SEQMAPS, fitCanvas, drawVarDensity, drawWiggle,
    niceTicks, frame, axisBottom, axisLeft, dashedLine, tag, drawColorbar,
    UNITS, readState, writeState, copyLink, savePNG,
  };
})();
