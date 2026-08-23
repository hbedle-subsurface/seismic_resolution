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
     All zero-phase, normalised so w(0) = 1.
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
   * Returns Float32Array[nx*nt], RMS-normalised to 1.
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
     COLOUR MAPS
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

  const COLORMAPS = {
    // Blue - white - red. The interpretation-industry default.
    bwr: rampMap([
      [12, 44, 92], [27, 79, 156], [122, 168, 214],
      [248, 248, 246],
      [214, 138, 122], [176, 36, 24], [92, 14, 12],
    ]),
    // Grey. Honest, and what a lot of published sections still use.
    grey: rampMap([
      [16, 18, 20], [86, 92, 98], [186, 190, 194],
      [246, 246, 244],
      [186, 190, 194], [86, 92, 98], [16, 18, 20],
    ]),
    // Blue - white - orange: safe for deuteranopia / protanopia.
    cbsafe: rampMap([
      [8, 48, 107], [33, 102, 172], [146, 197, 222],
      [247, 247, 247],
      [253, 190, 110], [224, 130, 20], [127, 63, 0],
    ]),
  };

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

  function axisBottom(ctx, rect, min, max, label, fmt) {
    ctx.save();
    ctx.font = AX.font; ctx.fillStyle = AX.color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeStyle = AX.color; ctx.lineWidth = 1;
    niceTicks(min, max, 6).forEach((v) => {
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
    niceTicks(min, max, 5).forEach((v) => {
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

  /* --------------------------------------------------------------------- */

  return {
    ricker, ormsby, makeWavelet, spectrum,
    traceValue, sampleTrace, rc,
    mulberry32, gaussRand, bandLimitedNoise,
    COLORMAPS, fitCanvas, drawVarDensity, drawWiggle,
    niceTicks, frame, axisBottom, axisLeft, dashedLine, tag,
    UNITS, readState, writeState, copyLink, savePNG,
  };
})();
