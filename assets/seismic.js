/* ===========================================================================
   seismic.js — shared seismic math + plotting core
   "What Can You REALLY See in Seismic?"

   Heather Bedle / AASPI / University of Oklahoma
   Vanilla JS, no dependencies, no build step.

   DESIGN PRINCIPLES
   -----------------
   1. Synthetic seismic is generated from reflection coefficients and wavelets.
   2. Reflector times remain continuous; they are not rounded to samples.
   3. Physical units are explicit: seconds, Hz, m, m/s unless converted.
   4. Wavelet truncation is a numerical/display choice, not a physical boundary.
   5. Polarity/sign conventions are kept separate from display color conventions.
   6. Spectral axes are reported in physical frequency/wavenumber units.
   =========================================================================== */

const SEIS = (function () {
  'use strict';

  /* =========================================================================
     CONSTANTS
     ========================================================================= */

  const EPS = 1e-12;

  /* =========================================================================
     WAVELETS
     -------------------------------------------------------------------------
     All wavelets are zero-phase and normalized so w(0) = 1.

     Important:
     - Ricker f is its spectral peak frequency.
     - Ormsby is defined by four corner frequencies. It does NOT have a
       single "dominant frequency" in the same sense as a Ricker wavelet.
     - halfLength is a practical numerical truncation, not the mathematical
       duration of the wavelet.
     ========================================================================= */

  /**
   * Ricker wavelet.
   *
   * w(t) = (1 - 2*pi^2*f^2*t^2) * exp(-pi^2*f^2*t^2)
   *
   * @param {number} t - time in seconds
   * @param {number} f - peak frequency in Hz
   * @returns {number}
   */
  function ricker(t, f) {
    if (!(f > 0)) throw new RangeError('Ricker frequency must be > 0 Hz.');

    const pf_t = Math.PI * f * t;
    const a = pf_t * pf_t;

    return (1 - 2 * a) * Math.exp(-a);
  }

  /**
   * Normalized sinc:
   *
   * sinc(x) = sin(x) / x
   *
   * with sinc(0) = 1.
   */
  function sinc(x) {
    if (Math.abs(x) < EPS) return 1;
    return Math.sin(x) / x;
  }

  /**
   * Raw Ormsby wavelet.
   *
   * f1 = low-frequency cutoff
   * f2 = low-frequency passband edge
   * f3 = high-frequency passband edge
   * f4 = high-frequency cutoff
   */
  function ormsbyRaw(t, f1, f2, f3, f4) {
    validateOrmsby(f1, f2, f3, f4);

    const term = (f) =>
      Math.PI * f * f * Math.pow(sinc(Math.PI * f * t), 2);

    return (
      (term(f4) - term(f3)) / (f4 - f3) -
      (term(f2) - term(f1)) / (f2 - f1)
    );
  }

  /**
   * Validate Ormsby corner frequencies.
   */
  function validateOrmsby(f1, f2, f3, f4) {
    if (
      !(f1 > 0) ||
      !(f2 > f1) ||
      !(f3 > f2) ||
      !(f4 > f3)
    ) {
      throw new RangeError(
        'Ormsby frequencies must satisfy 0 < f1 < f2 < f3 < f4.'
      );
    }
  }

  /**
   * Normalized zero-phase Ormsby wavelet.
   *
   * The normalization makes w(0) = 1.
   */
  function ormsby(t, f1, f2, f3, f4) {
    validateOrmsby(f1, f2, f3, f4);

    const norm = ormsbyRaw(0, f1, f2, f3, f4);

    if (Math.abs(norm) < EPS) {
      throw new Error('Ormsby normalization is numerically unstable.');
    }

    return ormsbyRaw(t, f1, f2, f3, f4) / norm;
  }

  /**
   * Number of octaves between two frequencies.
   *
   * N_oct = log2(fhigh / flow)
   */
  function octaveBandwidth(flow, fhigh) {
    if (!(flow > 0) || !(fhigh > flow)) {
      throw new RangeError(
        'Octave bandwidth requires 0 < flow < fhigh.'
      );
    }

    return Math.log2(fhigh / flow);
  }

  /**
   * Build a wavelet evaluator from a configuration object.
   *
   * Ricker:
   *   { type: 'ricker', f: 30 }
   *
   * Ormsby:
   *   { type: 'ormsby', f1: 5, f2: 10, f3: 40, f4: 50 }
   *
   * Returns metadata deliberately distinguishing:
   *   fpeak      — spectral peak, where meaningful
   *   fcenter    — center of Ormsby passband
   *   bandwidth  — f4 - f1
   *   octaves    — log2(f4/f1)
   *
   * halfLength is a practical rendering/truncation window.
   */
  function makeWavelet(cfg) {
    if (!cfg || !cfg.type) {
      throw new TypeError('Wavelet configuration requires a type.');
    }

    if (cfg.type === 'ormsby') {
      const { f1, f2, f3, f4 } = cfg;

      validateOrmsby(f1, f2, f3, f4);

      const fcenter = (f2 + f3) / 2;
      const bandwidth = f4 - f1;
      const octaves = octaveBandwidth(f1, f4);

      return {
        type: 'ormsby',

        fn: (t) => ormsby(t, f1, f2, f3, f4),

        // There is no single sharp dominant frequency for an Ormsby.
        fpeak: null,

        // Center of the flat passband.
        fcenter,

        f1,
        f2,
        f3,
        f4,

        bandwidth,
        octaves,

        // Practical truncation only.
        halfLength: 2.2 / f1,

        description:
          `Ormsby ${f1}-${f2}-${f3}-${f4} Hz`
      };
    }

    if (cfg.type === 'ricker') {
      const f = Number(cfg.f);

      if (!(f > 0)) {
        throw new RangeError('Ricker frequency must be > 0 Hz.');
      }

      return {
        type: 'ricker',

        fn: (t) => ricker(t, f),

        // For Ricker, this really is the spectral peak frequency.
        fpeak: f,
        fcenter: f,

        bandwidth: null,
        octaves: null,

        f,

        // Practical truncation only.
        halfLength: 1.4 / f,

        description: `Ricker ${f} Hz`
      };
    }

    throw new RangeError(`Unknown wavelet type: ${cfg.type}`);
  }

  /* =========================================================================
     SPECTRUM
     ========================================================================= */

  /**
   * Numerically evaluate a normalized amplitude spectrum.
   *
   * This deliberately evaluates the Fourier transform at arbitrary requested
   * frequencies rather than forcing the result onto FFT bins.
   *
   * W(f) ~= sum w(t) exp(-i 2*pi*f*t) dt
   *
   * Returns:
   *   [
   *     { f: frequency in Hz, a: normalized amplitude }
   *   ]
   *
   * The maximum amplitude is normalized to 1 for display.
   */
  function spectrum(wav, dt, nf, fmax) {
    if (!wav || typeof wav.fn !== 'function') {
      throw new TypeError('spectrum() requires a wavelet object.');
    }

    if (!(dt > 0)) {
      throw new RangeError('dt must be > 0 seconds.');
    }

    if (!(nf >= 2)) {
      throw new RangeError('nf must be at least 2.');
    }

    if (!(fmax > 0)) {
      throw new RangeError('fmax must be > 0 Hz.');
    }

    const half = wav.halfLength;

    // Number of samples required to cover the practical wavelet support.
    const n = Math.ceil(half / dt);

    const out = new Array(nf);

    for (let k = 0; k < nf; k++) {
      const f = (k / (nf - 1)) * fmax;

      let re = 0;
      let im = 0;

      for (let i = -n; i <= n; i++) {
        const t = i * dt;
        const v = wav.fn(t);
        const phase = -2 * Math.PI * f * t;

        re += v * Math.cos(phase);
        im += v * Math.sin(phase);
      }

      out[k] = {
        f,
        a: Math.hypot(re, im) * dt
      };
    }

    let maxAmplitude = 0;

    for (const p of out) {
      if (p.a > maxAmplitude) maxAmplitude = p.a;
    }

    maxAmplitude = maxAmplitude || 1;

    for (const p of out) {
      p.a /= maxAmplitude;
    }

    return out;
  }

  /* =========================================================================
     SYNTHETIC TRACES
     ========================================================================= */

  /**
   * Evaluate a synthetic trace analytically:
   *
   * s(t) = sum Ri * w(t - ti)
   *
   * Reflector times remain continuous and are not rounded to the sample grid.
   */
  function traceValue(spikes, t, wfn) {
    let value = 0;

    for (let i = 0; i < spikes.length; i++) {
      value += spikes[i].r * wfn(t - spikes[i].t);
    }

    return value;
  }

  /**
   * Sample an analytical synthetic trace onto a regular time grid.
   */
  function sampleTrace(spikes, t0, dt, nt, wfn) {
    if (!(dt > 0) || !(nt > 0)) {
      throw new RangeError('dt must be > 0 and nt must be > 0.');
    }

    const out = new Float32Array(nt);

    for (let i = 0; i < nt; i++) {
      out[i] = traceValue(
        spikes,
        t0 + i * dt,
        wfn
      );
    }

    return out;
  }

  /**
   * Faster version of sampleTrace().
   *
   * halfLength defines practical computational support. The mathematical
   * wavelet itself is not actually zero outside this window.
   */
  function traceFromSpikes(spikes, t0, dt, nt, wav) {
    if (!wav || typeof wav.fn !== 'function') {
      throw new TypeError('traceFromSpikes() requires a wavelet.');
    }

    if (!(dt > 0) || !(nt > 0)) {
      throw new RangeError('dt must be > 0 and nt must be > 0.');
    }

    const out = new Float32Array(nt);
    const half = wav.halfLength;

    for (let s = 0; s < spikes.length; s++) {
      const spikeTime = spikes[s].t;
      const reflectionCoefficient = spikes[s].r;

      const i0 = Math.max(
        0,
        Math.ceil((spikeTime - half - t0) / dt)
      );

      const i1 = Math.min(
        nt - 1,
        Math.floor((spikeTime + half - t0) / dt)
      );

      for (let i = i0; i <= i1; i++) {
        const t = t0 + i * dt;
        out[i] += reflectionCoefficient *
          wav.fn(t - spikeTime);
      }
    }

    return out;
  }

  /* =========================================================================
     REFLECTION COEFFICIENTS
     ========================================================================= */

  /**
   * Acoustic impedance:
   *
   * Z = rho * V
   */
  function impedance(v, rho) {
    if (!(v > 0) || !(rho > 0)) {
      throw new RangeError(
        'Velocity and density must both be > 0.'
      );
    }

    return v * rho;
  }

  /**
   * Normal-incidence reflection coefficient:
   *
   * R = (Z2 - Z1) / (Z2 + Z1)
   */
  function rc(v1, rho1, v2, rho2) {
    const z1 = impedance(v1, rho1);
    const z2 = impedance(v2, rho2);

    return (z2 - z1) / (z2 + z1);
  }

  /**
   * Reflection coefficient directly from two impedances.
   */
  function rcFromImpedance(z1, z2) {
    if (!(z1 > 0) || !(z2 > 0)) {
      throw new RangeError('Impedances must both be > 0.');
    }

    return (z2 - z1) / (z2 + z1);
  }

  /* =========================================================================
     RESOLUTION / WAVELENGTH
     ========================================================================= */

  /**
   * Wavelength:
   *
   * lambda = V / f
   */
  function wavelength(v, f) {
    if (!(v > 0) || !(f > 0)) {
      throw new RangeError(
        'Velocity and frequency must both be > 0.'
      );
    }

    return v / f;
  }

  function quarterWavelength(v, f) {
    return wavelength(v, f) / 4;
  }

  function eighthWavelength(v, f) {
    return wavelength(v, f) / 8;
  }

  /**
   * Common nominal resolution scales.
   *
   * These are deliberately returned as labels/values rather than implying
   * that any one number is a universal resolution limit.
   */
  function resolutionScales(v, f) {
    const lambda = wavelength(v, f);

    return {
      lambda,
      rayleigh: lambda / 4,
      quarterWavelength: lambda / 4,
      eighthWavelength: lambda / 8
    };
  }

  /* =========================================================================
     RANDOM NUMBERS + NOISE
     ========================================================================= */

  /**
   * Deterministic seeded random generator.
   */
  function mulberry32(seed) {
    let a = seed >>> 0;

    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;

      let t = Math.imul(
        a ^ (a >>> 15),
        1 | a
      );

      t = (
        t +
        Math.imul(
          t ^ (t >>> 7),
          61 | t
        )
      ) ^ t;

      return (
        (t ^ (t >>> 14)) >>> 0
      ) / 4294967296;
    };
  }

  /**
   * Standard normal random variable using Box-Muller.
   */
  function gaussRand(rnd) {
    let u = 0;
    let v = 0;

    while (u === 0) u = rnd();
    while (v === 0) v = rnd();

    return Math.sqrt(
      -2 * Math.log(u)
    ) * Math.cos(
      2 * Math.PI * v
    );
  }

  /**
   * Generate wavelet-shaped, band-limited random seismic noise.
   *
   * This is NOT intended to represent every physical noise mechanism.
   * It represents random reflectivity convolved with the chosen wavelet.
   *
   * lateral:
   *   half-width of triangular spatial correlation kernel, in traces.
   *
   * lateral = 0:
   *   spatially independent traces.
   *
   * lateral = 3:
   *   7-trace triangular correlation kernel.
   *
   * Output is RMS-normalized to 1.
   */
  function bandLimitedNoise(
    nx,
    nt,
    dt,
    wav,
    seed,
    lateral
  ) {
    if (!(nx > 0) || !(nt > 0)) {
      throw new RangeError(
        'nx and nt must both be > 0.'
      );
    }

    if (!(dt > 0)) {
      throw new RangeError('dt must be > 0.');
    }

    if (!wav || typeof wav.fn !== 'function') {
      throw new TypeError(
        'bandLimitedNoise() requires a wavelet.'
      );
    }

    const rnd = mulberry32(seed);

    const hw = Math.ceil(
      wav.halfLength / dt
    );

    const wsamp = new Float32Array(
      2 * hw + 1
    );

    for (let i = -hw; i <= hw; i++) {
      wsamp[i + hw] = wav.fn(i * dt);
    }

    const out = new Float32Array(
      nx * nt
    );

    const white = new Float32Array(
      nt + 2 * hw
    );

    /*
     * Generate independent random reflectivity for each trace and convolve
     * it with the wavelet.
     */
    for (let ix = 0; ix < nx; ix++) {

      for (let i = 0; i < white.length; i++) {
        white[i] = gaussRand(rnd);
      }

      for (let it = 0; it < nt; it++) {
        let sum = 0;

        for (
          let k = -hw;
          k <= hw;
          k++
        ) {
          sum +=
            white[it + hw + k] *
            wsamp[hw - k];
        }

        out[ix * nt + it] = sum;
      }
    }

    /*
     * Apply optional lateral triangular correlation.
     */
    const L = Math.max(
      0,
      Math.floor(
        lateral === undefined ? 0 : lateral
      )
    );

    if (L > 0) {
      const tmp = new Float32Array(nx);

      for (let it = 0; it < nt; it++) {

        for (let ix = 0; ix < nx; ix++) {
          let sum = 0;
          let weightSum = 0;

          for (
            let k = -L;
            k <= L;
            k++
          ) {
            const j = ix + k;

            if (
              j < 0 ||
              j >= nx
            ) continue;

            const weight =
              L + 1 - Math.abs(k);

            sum +=
              out[j * nt + it] *
              weight;

            weightSum += weight;
          }

          tmp[ix] =
            weightSum > 0
              ? sum / weightSum
              : 0;
        }

        for (let ix = 0; ix < nx; ix++) {
          out[ix * nt + it] =
            tmp[ix];
        }
      }
    }

    /*
     * RMS normalization.
     */
    let sum2 = 0;

    for (let i = 0; i < out.length; i++) {
      sum2 += out[i] * out[i];
    }

    const rms =
      Math.sqrt(
        sum2 / out.length
      ) || 1;

    for (let i = 0; i < out.length; i++) {
      out[i] /= rms;
    }

    return out;
  }

  /* =========================================================================
     FFT
     ========================================================================= */

  /**
   * In-place radix-2 complex FFT.
   *
   * Forward transform:
   *   X[k] = sum x[n] exp(-i 2*pi*k*n/N)
   *
   * Inverse transform:
   *   x[n] = 1/N sum X[k] exp(+i 2*pi*k*n/N)
   *
   * n must be a power of two.
   */
  function fft(re, im, inverse) {
    const n = re.length;

    if (
      n < 1 ||
      (n & (n - 1)) !== 0
    ) {
      throw new RangeError(
        'FFT length must be a power of two.'
      );
    }

    if (im.length !== n) {
      throw new RangeError(
        'Real and imaginary arrays must have equal length.'
      );
    }

    /* Bit reversal. */
    for (
      let i = 1, j = 0;
      i < n;
      i++
    ) {
      let bit = n >> 1;

      for (; j & bit; bit >>= 1) {
        j ^= bit;
      }

      j ^= bit;

      if (i < j) {
        let temp = re[i];
        re[i] = re[j];
        re[j] = temp;

        temp = im[i];
        im[i] = im[j];
        im[j] = temp;
      }
    }

    /* Danielson-Lanczos stages. */
    for (
      let len = 2;
      len <= n;
      len <<= 1
    ) {
      const angle =
        (2 * Math.PI / len) *
        (inverse ? 1 : -1);

      const wr = Math.cos(angle);
      const wi = Math.sin(angle);

      for (
        let i = 0;
        i < n;
        i += len
      ) {
        let cr = 1;
        let ci = 0;

        for (
          let k = 0;
          k < len / 2;
          k++
        ) {
          const ur = re[i + k];
          const ui = im[i + k];

          const ar =
            re[i + k + len / 2];

          const ai =
            im[i + k + len / 2];

          const vr =
            ar * cr - ai * ci;

          const vi =
            ar * ci + ai * cr;

          re[i + k] =
            ur + vr;

          im[i + k] =
            ui + vi;

          re[i + k + len / 2] =
            ur - vr;

          im[i + k + len / 2] =
            ui - vi;

          const nextCr =
            cr * wr - ci * wi;

          ci =
            cr * wi + ci * wr;

          cr = nextCr;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  /* =========================================================================
     F-K SPECTRUM
     ========================================================================= */

  /**
   * Calculate a 2-D f-k amplitude spectrum.
   *
   * Input:
   *   field = Float32Array laid out [ix * nt + it]
   *   nx    = number of traces
   *   nt    = samples per trace
   *   dx    = trace spacing in meters/feet
   *   dt    = sample interval in seconds
   *
   * Returns:
   *   {
   *     mag,
   *     nk,
   *     nf,
   *     dk,
   *     df,
   *     kNyquist,
   *     fNyquist
   *   }
   *
   * k is in cycles per unit distance.
   * f is in Hz.
   *
   * Frequency output contains the non-negative frequencies including Nyquist.
   * Wavenumber output is shifted so k=0 is in the center.
   */
  function fkSpectrum(
    field,
    nx,
    nt,
    dx,
    dt
  ) {
    if (
      field.length !== nx * nt
    ) {
      throw new RangeError(
        'field length must equal nx * nt.'
      );
    }

    if (!(dx > 0)) {
      throw new RangeError(
        'dx must be > 0.'
      );
    }

    if (!(dt > 0)) {
      throw new RangeError(
        'dt must be > 0.'
      );
    }

    if (
      (nx & (nx - 1)) !== 0 ||
      (nt & (nt - 1)) !== 0
    ) {
      throw new RangeError(
        'nx and nt must both be powers of two.'
      );
    }

    /*
     * Non-negative temporal frequencies including Nyquist.
     */
    const nf =
      nt / 2 + 1;

    const dk =
      1 / (nx * dx);

    const df =
      1 / (nt * dt);

    const kNyquist =
      1 / (2 * dx);

    const fNyquist =
      1 / (2 * dt);

    /*
     * Hann windows in time and space reduce edge leakage.
     */
    const timeWindow =
      new Float64Array(nt);

    const spaceWindow =
      new Float64Array(nx);

    for (let i = 0; i < nt; i++) {
      timeWindow[i] =
        0.5 -
        0.5 *
        Math.cos(
          2 * Math.PI * i / (nt - 1)
        );
    }

    for (let i = 0; i < nx; i++) {
      spaceWindow[i] =
        0.5 -
        0.5 *
        Math.cos(
          2 * Math.PI * i / (nx - 1)
        );
    }

    /*
     * First transform time for every trace.
     */
    const timeRe =
      new Float64Array(
        nx * nf
      );

    const timeIm =
      new Float64Array(
        nx * nf
      );

    const re =
      new Float64Array(nt);

    const im =
      new Float64Array(nt);

    for (let ix = 0; ix < nx; ix++) {

      for (let it = 0; it < nt; it++) {
        re[it] =
          field[ix * nt + it] *
          timeWindow[it] *
          spaceWindow[ix];

        im[it] = 0;
      }

      fft(
        re,
        im,
        false
      );

      for (
        let f = 0;
        f < nf;
        f++
      ) {
        timeRe[ix * nf + f] =
          re[f];

        timeIm[ix * nf + f] =
          im[f];
      }
    }

    /*
     * Then transform across space for each frequency.
     */
    const mag =
      new Float32Array(
        nx * nf
      );

    const xr =
      new Float64Array(nx);

    const xi =
      new Float64Array(nx);

    for (
      let f = 0;
      f < nf;
      f++
    ) {
      for (let ix = 0; ix < nx; ix++) {
        xr[ix] =
          timeRe[ix * nf + f];

        xi[ix] =
          timeIm[ix * nf + f];
      }

      fft(
        xr,
        xi,
        false
      );

      for (
        let ik = 0;
        ik < nx;
        ik++
      ) {
        /*
         * Shift spatial spectrum so:
         *
         * negative k | 0 | positive k
         *
         * is displayed left-to-right.
         */
        const shifted =
          (ik + nx / 2) % nx;

        mag[
          ik * nf + f
        ] =
          Math.hypot(
            xr[shifted],
            xi[shifted]
          );
      }
    }

    return {
      mag,
      nk: nx,
      nf,

      dx,
      dt,

      dk,
      df,

      kNyquist,
      fNyquist
    };
  }

  /* =========================================================================
     COLOR MAPS
     ========================================================================= */

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rampMap(stops) {
    return function (x) {
      const v =
        Math.max(
          -1,
          Math.min(1, x)
        );

      const p =
        ((v + 1) / 2) *
        (stops.length - 1);

      const i =
        Math.min(
          stops.length - 2,
          Math.floor(p)
        );

      const f =
        p - i;

      const a = stops[i];
      const b = stops[i + 1];

      return [
        Math.round(
          lerp(a[0], b[0], f)
        ),
        Math.round(
          lerp(a[1], b[1], f)
        ),
        Math.round(
          lerp(a[2], b[2], f)
        )
      ];
    };
  }

  /*
   * DISPLAY CONVENTION
   *
   * This project uses:
   *
   *   negative displayed amplitude = red
   *   zero                         = white
   *   positive displayed amplitude = blue
   *
   * This is a COLOR convention, not the SEG polarity convention.
   *
   * Under the SEG normal polarity convention, a positive reflection
   * coefficient produces a positive/peak zero-phase response.
   *
   * The polarity multiplier is applied when the seismic is generated/displayed.
   */
  const COLORMAPS = {

    bwr: rampMap([
      [92, 14, 12],
      [176, 36, 24],
      [214, 138, 122],
      [248, 248, 246],
      [122, 168, 214],
      [27, 79, 156],
      [12, 44, 92]
    ]),

    /*
     * Printed grayscale:
     * negative = white
     * positive = black
     */
    gray: rampMap([
      [253, 253, 252],
      [226, 227, 228],
      [188, 190, 193],
      [140, 144, 148],
      [92, 96, 100],
      [48, 51, 55],
      [12, 14, 16]
    ]),

    /*
     * Blue-orange diverging map.
     */
    cbsafe: rampMap([
      [127, 63, 0],
      [224, 130, 20],
      [253, 190, 110],
      [247, 247, 247],
      [146, 197, 222],
      [33, 102, 172],
      [8, 48, 107]
    ])
  };

  /* =========================================================================
     CANVAS HELPERS
     ========================================================================= */

  /**
   * Size a canvas for device-pixel-ratio rendering.
   */
  function fitCanvas(
    canvas,
    cssW,
    cssH
  ) {
    const dpr =
      window.devicePixelRatio || 1;

    canvas.style.width =
      cssW + 'px';

    canvas.style.height =
      cssH + 'px';

    canvas.width =
      Math.round(
        cssW * dpr
      );

    canvas.height =
      Math.round(
        cssH * dpr
      );

    const ctx =
      canvas.getContext('2d');

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    return ctx;
  }

  /**
   * Variable-density seismic image.
   *
   * data layout:
   *   data[ix * nt + it]
   *
   * Time increases downward.
   */
  function drawVarDensity(
    ctx,
    data,
    nx,
    nt,
    rect,
    opts
  ) {
    const o = opts || {};

    const cmap =
      o.cmap ||
      COLORMAPS.bwr;

    const gain =
      o.gain === undefined
        ? 1
        : o.gain;

    let peak =
      o.clip;

    /*
     * If no clipping value is supplied, determine the maximum absolute
     * amplitude from the data.
     */
    if (
      !(peak > 0)
    ) {
      peak = 0;

      for (
        let i = 0;
        i < data.length;
        i++
      ) {
        const a =
          Math.abs(data[i]);

        if (a > peak) {
          peak = a;
        }
      }

      peak = peak || 1;
    }

    const off =
      document.createElement(
        'canvas'
      );

    off.width = nx;
    off.height = nt;

    const octx =
      off.getContext('2d');

    const image =
      octx.createImageData(
        nx,
        nt
      );

    for (
      let ix = 0;
      ix < nx;
      ix++
    ) {
      for (
        let it = 0;
        it < nt;
        it++
      ) {
        const value =
          (
            data[
              ix * nt + it
            ] / peak
          ) * gain;

        const c =
          cmap(value);

        const p =
          (
            it * nx + ix
          ) * 4;

        image.data[p] =
          c[0];

        image.data[p + 1] =
          c[1];

        image.data[p + 2] =
          c[2];

        image.data[p + 3] =
          255;
      }
    }

    octx.putImageData(
      image,
      0,
      0
    );

    ctx.save();

    ctx.imageSmoothingEnabled =
      o.smooth !== false;

    ctx.imageSmoothingQuality =
      'high';

    ctx.drawImage(
      off,
      rect.x,
      rect.y,
      rect.w,
      rect.h
    );

    ctx.restore();

    return peak;
  }

  /**
   * Wiggle + positive variable-area display.
   */
  function drawWiggle(
    ctx,
    data,
    nx,
    nt,
    rect,
    opts
  ) {
    const o = opts || {};

    const step =
      o.step || 1;

    const excursion =
      o.excursion || 1.4;

    const peak =
      o.clip > 0
        ? o.clip
        : 1;

    const dx =
      rect.w / nx;

    const traceW =
      dx *
      step *
      excursion;

    ctx.save();

    ctx.beginPath();
    ctx.rect(
      rect.x,
      rect.y,
      rect.w,
      rect.h
    );
    ctx.clip();

    ctx.lineWidth =
      o.lineWidth || 0.9;

    ctx.strokeStyle =
      o.stroke ||
      'rgba(22,25,28,0.85)';

    ctx.fillStyle =
      o.fill ||
      'rgba(22,25,28,0.75)';

    for (
      let ix = 0;
      ix < nx;
      ix += step
    ) {
      const x0 =
        rect.x +
        (ix + 0.5) * dx;

      /*
       * Trace.
       */
      ctx.beginPath();

      for (
        let it = 0;
        it < nt;
        it++
      ) {
        const y =
          rect.y +
          (it / (nt - 1)) *
          rect.h;

        const x =
          x0 +
          (
            data[
              ix * nt + it
            ] / peak
          ) *
          traceW;

        if (it === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();

      /*
       * Positive variable-area fill.
       */
      ctx.beginPath();

      ctx.moveTo(
        x0,
        rect.y
      );

      for (
        let it = 0;
        it < nt;
        it++
      ) {
        const y =
          rect.y +
          (it / (nt - 1)) *
          rect.h;

        const amplitude =
          data[
            ix * nt + it
          ];

        ctx.lineTo(
          x0 +
          Math.max(
            0,
            amplitude / peak
          ) *
          traceW,
          y
        );
      }

      ctx.lineTo(
        x0,
        rect.y + rect.h
      );

      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  /* =========================================================================
     AXES
     ========================================================================= */

  const AX = {
    font:
      '11px "IBM Plex Mono", ui-monospace, monospace',

    color:
      '#5C6670',

    grid:
      'rgba(92,102,112,0.16)'
  };

  /**
   * Generate visually sensible axis tick values.
   */
  function niceTicks(
    min,
    max,
    target
  ) {
    const span =
      max - min;

    if (!(span > 0)) {
      return [min];
    }

    const raw =
      span /
      (target || 5);

    const magnitude =
      Math.pow(
        10,
        Math.floor(
          Math.log10(raw)
        )
      );

    const normalized =
      raw / magnitude;

    const stepNumber =
      normalized < 1.5
        ? 1
        : normalized < 3
          ? 2
          : normalized < 7
            ? 5
            : 10;

    const step =
      stepNumber *
      magnitude;

    const start =
      Math.ceil(
        min / step
      ) * step;

    const out = [];

    for (
      let v = start;
      v <= max + step * 1e-6;
      v += step
    ) {
      out.push(
        Math.abs(v) <
          step * 1e-6
          ? 0
          : v
      );
    }

    return out;
  }

  function frame(
    ctx,
    rect
  ) {
    ctx.save();

    ctx.strokeStyle =
      'rgba(22,25,28,0.55)';

    ctx.lineWidth = 1;

    ctx.strokeRect(
      rect.x + 0.5,
      rect.y + 0.5,
      rect.w,
      rect.h
    );

    ctx.restore();
  }

  function axisBottom(
    ctx,
    rect,
    min,
    max,
    label,
    fmt
  ) {
    ctx.save();

    ctx.font = AX.font;
    ctx.fillStyle = AX.color;

    ctx.textAlign =
      'center';

    ctx.textBaseline =
      'top';

    ctx.strokeStyle =
      AX.color;

    ctx.lineWidth = 1;

    niceTicks(
      min,
      max,
      6
    ).forEach((v) => {

      const x =
        rect.x +
        (
          (v - min) /
          (max - min)
        ) *
        rect.w;

      ctx.beginPath();

      ctx.moveTo(
        x,
        rect.y + rect.h
      );

      ctx.lineTo(
        x,
        rect.y + rect.h + 4
      );

      ctx.stroke();

      ctx.fillText(
        fmt
          ? fmt(v)
          : String(
              Math.round(
                v * 100
              ) / 100
            ),
        x,
        rect.y + rect.h + 6
      );
    });

    if (label) {
      ctx.font =
        '11px "IBM Plex Sans", sans-serif';

      ctx.fillText(
        label,
        rect.x +
          rect.w / 2,
        rect.y +
          rect.h +
          22
      );
    }

    ctx.restore();
  }

  function axisLeft(
    ctx,
    rect,
    min,
    max,
    label,
    fmt,
    opts
  ) {
    const o =
      opts || {};

    ctx.save();

    ctx.font = AX.font;
    ctx.fillStyle = AX.color;

    ctx.textAlign =
      'right';

    ctx.textBaseline =
      'middle';

    ctx.strokeStyle =
      AX.color;

    ctx.lineWidth = 1;

    niceTicks(
      min,
      max,
      5
    ).forEach((v) => {

      const f =
        (v - min) /
        (max - min);

      const y =
        o.flip
          ? rect.y +
            rect.h -
            f * rect.h
          : rect.y +
            f * rect.h;

      ctx.beginPath();

      ctx.moveTo(
        rect.x - 4,
        y
      );

      ctx.lineTo(
        rect.x,
        y
      );

      ctx.stroke();

      ctx.fillText(
        fmt
          ? fmt(v)
          : String(
              Math.round(
                v * 100
              ) / 100
            ),
        rect.x - 6,
        y
      );

      if (o.grid) {
        ctx.save();

        ctx.strokeStyle =
          AX.grid;

        ctx.beginPath();

        ctx.moveTo(
          rect.x,
          y
        );

        ctx.lineTo(
          rect.x + rect.w,
          y
        );

        ctx.stroke();

        ctx.restore();
      }
    });

    if (label) {
      ctx.translate(
        rect.x - 42,
        rect.y +
          rect.h / 2
      );

      ctx.rotate(
        -Math.PI / 2
      );

      ctx.textAlign =
        'center';

      ctx.textBaseline =
        'bottom';

      ctx.font =
        '11px "IBM Plex Sans", sans-serif';

      ctx.fillText(
        label,
        0,
        0
      );
    }

    ctx.restore();
  }

  function dashedLine(
    ctx,
    x1,
    y1,
    x2,
    y2,
    color,
    dash,
    width
  ) {
    ctx.save();

    ctx.setLineDash(
      dash || [5, 4]
    );

    ctx.strokeStyle =
      color;

    ctx.lineWidth =
      width || 1.4;

    ctx.beginPath();

    ctx.moveTo(
      x1,
      y1
    );

    ctx.lineTo(
      x2,
      y2
    );

    ctx.stroke();

    ctx.restore();
  }

  function tag(
    ctx,
    x,
    y,
    text,
    color,
    align
  ) {
    ctx.save();

    ctx.font =
      '10px "IBM Plex Mono", monospace';

    const width =
      ctx.measureText(text)
        .width + 8;

    const left =
      align === 'right'
        ? x - width
        : x;

    ctx.fillStyle =
      color;

    ctx.fillRect(
      left,
      y - 7,
      width,
      14
    );

    ctx.fillStyle =
      '#fff';

    ctx.textAlign =
      'left';

    ctx.textBaseline =
      'middle';

    ctx.fillText(
      text,
      left + 4,
      y + 0.5
    );

    ctx.restore();
  }

  /* =========================================================================
     COLOR BAR
     ========================================================================= */

  /**
   * Draw color bar labelled in terms of REFLECTION COEFFICIENT.
   *
   * Important distinction:
   *
   *   RC belongs to the earth model.
   *   Polarity controls the sign of the displayed seismic response.
   *   Color is a display convention.
   *
   * pol = +1:
   *   normal display polarity
   *
   * pol = -1:
   *   reversed display polarity
   */
  function drawColorbar(
    ctx,
    rect,
    cmap,
    opts
  ) {
    const o =
      opts || {};

    const colorMap =
      cmap ||
      COLORMAPS.bwr;

    const pol =
      o.pol === -1
        ? -1
        : 1;

    const n =
      Math.max(
        2,
        Math.round(rect.w)
      );

    for (
      let i = 0;
      i < n;
      i++
    ) {
      const rcValue =
        -1 +
        (
          2 * i
        ) /
        (n - 1);

      const color =
        colorMap(
          pol *
          rcValue *
          0.92
        );

      ctx.fillStyle =
        `rgb(${color[0]},${color[1]},${color[2]})`;

      ctx.fillRect(
        rect.x +
          i *
          (rect.w / n),
        rect.y,
        rect.w / n + 1,
        rect.h
      );
    }

    ctx.save();

    ctx.strokeStyle =
      'rgba(22,25,28,.45)';

    ctx.lineWidth = 1;

    ctx.strokeRect(
      rect.x + 0.5,
      rect.y + 0.5,
      rect.w,
      rect.h
    );

    ctx.font =
      '9.5px "IBM Plex Mono", monospace';

    ctx.fillStyle =
      AX.color;

    ctx.textBaseline =
      'top';

    ctx.textAlign =
      'left';

    ctx.fillText(
      o.left || '− RC',
      rect.x,
      rect.y + rect.h + 3
    );

    ctx.textAlign =
      'right';

    ctx.fillText(
      o.right || '+ RC',
      rect.x + rect.w,
      rect.y + rect.h + 3
    );

    if (o.title) {
      ctx.textAlign =
        'center';

      ctx.textBaseline =
        'bottom';

      ctx.fillText(
        o.title,
        rect.x +
          rect.w / 2,
        rect.y - 3
      );
    }

    ctx.restore();
  }

  /* =========================================================================
     UNITS
     ========================================================================= */

  const UNITS = {
    m: {
      len: 1,
      lab: 'm',
      vel: 1,
      vlab: 'm/s'
    },

    ft: {
      len: 3.28084,
      lab: 'ft',
      vel: 3.28084,
      vlab: 'ft/s'
    }
  };

  /**
   * Convert a length from meters to selected display units.
   */
  function lengthFromMeters(
    meters,
    unit
  ) {
    const u =
      UNITS[unit] ||
      UNITS.m;

    return meters * u.len;
  }

  /**
   * Convert velocity from m/s to selected display units.
   */
  function velocityFromMps(
    metersPerSecond,
    unit
  ) {
    const u =
      UNITS[unit] ||
      UNITS.m;

    return metersPerSecond *
      u.vel;
  }

  /* =========================================================================
     URL STATE
     ========================================================================= */

  function readState(
    defaults
  ) {
    const params =
      new URLSearchParams(
        location.search
      );

    const out =
      Object.assign(
        {},
        defaults
      );

    for (
      const key of Object.keys(
        defaults
      )
    ) {
      if (!params.has(key)) {
        continue;
      }

      const raw =
        params.get(key);

      if (
        typeof defaults[key] ===
        'number'
      ) {
        const value =
          parseFloat(raw);

        if (
          Number.isFinite(value)
        ) {
          out[key] = value;
        }

      } else if (
        typeof defaults[key] ===
        'boolean'
      ) {
        out[key] =
          raw === '1' ||
          raw === 'true';

      } else {
        out[key] = raw;
      }
    }

    return out;
  }

  let writeTimer =
    null;

  function writeState(
    state,
    defaults
  ) {
    clearTimeout(
      writeTimer
    );

    writeTimer =
      setTimeout(() => {

        const params =
          new URLSearchParams();

        for (
          const key of Object.keys(
            state
          )
        ) {
          if (
            defaults &&
            state[key] ===
              defaults[key]
          ) {
            continue;
          }

          const value =
            typeof state[key] ===
            'boolean'
              ? state[key]
                ? 1
                : 0
              : state[key];

          params.set(
            key,
            value
          );
        }

        const query =
          params.toString();

        history.replaceState(
          null,
          '',
          query
            ? '?' + query
            : location.pathname
        );

      }, 250);
  }

  /**
   * Copy the current experiment URL.
   */
  function copyLink(btn) {
    if (
      !navigator.clipboard
    ) {
      return Promise.reject(
        new Error(
          'Clipboard API unavailable.'
        )
      );
    }

    return navigator.clipboard
      .writeText(
        location.href
      )
      .then(() => {

        if (!btn) return;

        const old =
          btn.textContent;

        btn.textContent =
          'Link copied';

        setTimeout(
          () => {
            btn.textContent =
              old;
          },
          1600
        );
      });
  }

  /**
   * Save a canvas as PNG.
   */
  function savePNG(
    canvas,
    name
  ) {
    if (!canvas) {
      throw new TypeError(
        'savePNG() requires a canvas.'
      );
    }

    const safeName =
      String(
        name || 'seismic-figure'
      )
        .replace(
          /[^a-z0-9._-]+/gi,
          '_'
        );

    const anchor =
      document.createElement(
        'a'
      );

    anchor.download =
      safeName + '.png';

    anchor.href =
      canvas.toDataURL(
        'image/png'
      );

    anchor.click();
  }

  /* =========================================================================
     PUBLIC API
     ========================================================================= */

  return {

    // Wavelets
    ricker,
    sinc,
    ormsbyRaw,
    ormsby,
    makeWavelet,
    spectrum,
    octaveBandwidth,

    // Synthetic seismic
    traceValue,
    sampleTrace,
    traceFromSpikes,

    // Rock physics / reflection
    impedance,
    rc,
    rcFromImpedance,

    // Resolution
    wavelength,
    quarterWavelength,
    eighthWavelength,
    resolutionScales,

    // Random/noise
    mulberry32,
    gaussRand,
    bandLimitedNoise,

    // FFT / spectral analysis
    fft,
    fkSpectrum,

    // Display
    COLORMAPS,
    fitCanvas,
    drawVarDensity,
    drawWiggle,

    // Axes
    niceTicks,
    frame,
    axisBottom,
    axisLeft,
    dashedLine,
    tag,
    drawColorbar,

    // Units
    UNITS,
    lengthFromMeters,
    velocityFromMps,

    // URL / export
    readState,
    writeState,
    copyLink,
    savePNG
  };
})();
