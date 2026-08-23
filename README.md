# What Can You REALLY See in Seismic?

Browser-based experiments in seismic resolution, built for teaching.

Aimed at three groups who mostly get skipped: undergraduates meeting seismic for the first time,
graduate students who *use* seismic data in their research without having been taught how it is
made, and people who went straight to industry and are now expected to map horizons on it (that was how I got started!). No
install, no account, no math prerequisite beyond `λ = V / f`.

Built by Heather Bedle, School of Geosciences, University of Oklahoma, with the
[AASPI](https://www.ou.edu/mcee/labs/aaspi) consortium.

---
## Get started

**→ [Open the site](https://hbedle-subsurface/seismic_resolution/)**

New to this? Go straight to the wedge model — it's the one everything else builds on:

**→ [Start here: The wedge model & tuning](https://hbedle-subsurface/seismic_resolution/modules/wedge.html)**

Move the frequency slider, watch a bed thin to nothing, and see the seismic keep
reporting a thickness that stopped being real. Ten minutes, no install, nothing to set up.

Then try **[Can you see the fault?](https://hbedle-subsurface/seismic_resolution/modules/faults.html)**
and turn on quiz mode.

---
## Live modules

| # | Module | Question it answers |
|---|--------|---------------------|
| 02 | `modules/wedge.html` | Why is the thin edge of my channel the brightest part? |
| 03 | `modules/faults.html` | How small a fault am I missing? |

Modules 01 and 04–08 are stubbed on the landing page and not yet built.

## Publishing to GitHub Pages

1. Push this folder to a repository.
2. **Settings → Pages → Source → Deploy from a branch**, pick `main` and `/ (root)`.
3. It goes live at `https://<user>.github.io/<repo>/` within a minute or so.

There is no build step, no bundler, and no dependency to install. Everything is vanilla JavaScript
and one stylesheet. Opening `index.html` straight off your hard drive works too — handy for lecturing
on conference wifi.

## Structure

```
index.html              landing page, animated wedge hero, module grid
assets/
  seismic.js            all the physics and plotting (~450 lines, commented)
  style.css             one stylesheet, OU crimson and cream
modules/
  wedge.html            module 02
  faults.html           module 03
```

Each module is a standalone page that pulls in `assets/seismic.js`. Adding a module means copying an
existing one and rewriting the model and the two teaching blocks at the bottom — the wavelets,
convolution, colour maps, axes, unit handling, and URL state are all already there.

## Using these in a class

**Deep links.** Every module writes its full state into the URL, and has a *Copy link to this setup*
button. So you can set up a specific scenario and hand students the link:

```
modules/wedge.html?f=18&v=5200&maxh=160&rc=0.2
modules/faults.html?thr=8&f=20&snr=4
```

Good for problem sets — everyone starts on the identical configuration.

**Structure of each module.** Controls on the left, live plots in the middle, then *Try this*
(guided experiments, each with the answer written out) and *What to carry away*. The *Try this*
questions are written so they can be assigned directly as homework.

**Save as PNG** exports the current panel for lecture slides and reports.

**Units** toggle between metres and feet throughout.

## Notes on the physics

Traces are 1D convolutional models. Reflection coefficients are convolved with a zero-phase wavelet
analytically — as a sum of shifted, scaled wavelets rather than on a sample grid — so reflector
timing is exact and tuning curves come out smooth rather than stair-stepped.

Amplitudes and apparent thicknesses are picked the way you would pick them in an interpretation
package: significant local extrema, matched by polarity to the top and base reflections, refined by
parabolic interpolation.

The wedge module measures a tuning thickness of **λ/5.1** for a Ricker wavelet, not the λ/4 of the
usual rule of thumb. That is not a bug — it is Kallweit and Wood's 1/(2.6·f), and the gap between
the two numbers is one of the things the module is for.

Noise is band-limited (random reflectivity convolved with the same wavelet) and laterally correlated,
so it looks like seismic noise rather than static, and so it is not trivially distinguishable from
real structure.

Deliberately omitted, each deserving its own module: non-zero wavelet phase, offset and NMO stretch,
anything genuinely 3D, transmission loss and internal multiples, lateral velocity variation, fault-plane
reflections and tip diffractions, and migration artefacts.

## References

- Widess, M.B., 1973, How thin is a thin bed?: *Geophysics*, 38, 1176–1180.
- Kallweit, R.S., and Wood, L.C., 1982, The limits of resolution of zero-phase wavelets: *Geophysics*, 47, 1035–1046.
- Chung, H., and Lawton, D.C., 1995, Frequency characteristics of seismic reflections from thin beds: *CJEG*, 31, 32–37.
- Chopra, S., and Marfurt, K.J., 2007, *Seismic Attributes for Prospect Identification and Reservoir Characterization*: SEG.
- Simm, R., and Bacon, M., 2014, *Seismic Amplitude: An Interpreter's Handbook*: Cambridge University Press.

## Licence

Free to use, fork, and adapt for teaching. A citation back is appreciated.
