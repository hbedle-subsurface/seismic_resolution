# Maintaining this repository

Build notes. The mission, the audience and the module list are in the top-level
README; this file is only the plumbing.

## Layout

```
index.html              landing page, animated wedge hero, module grid
assets/
  seismic.js            all the physics and plotting, commented
  style.css             one stylesheet, OU crimson and cream
  count.js              page-view counting; see the file's own notes
modules/                one self-contained page per module
docs/                   this file
```

Each module is a standalone page that pulls in `assets/seismic.js`. Adding one
means copying an existing module and rewriting the model and the two teaching
blocks at the bottom — the wavelets, convolution, color maps, axes, unit
handling and URL state are all already there.

The exercise pop-out wires itself. A module needs only `id="teach"` on the
teaching block and a `#popBtn` button beside it, both of which come along when
an existing module is copied; `seismic.js` finds them on DOMContentLoaded. A
browser that blocks the window is reported in `#popNote` rather than leaving the
click to do nothing.

There is no build step, no bundler and no dependency to install. Everything is
vanilla JavaScript and one stylesheet.

## Publishing

1. Push this folder to a repository.
2. **Settings → Pages → Source → Deploy from a branch**, pick `main` and
   `/ (root)`.
3. It goes live at `https://<user>.github.io/<repo>/` within a minute or so.

Opening `index.html` straight off a hard drive works too, which is what makes
the modules usable on conference wifi.

## Notes on the physics

Traces are 1D convolutional models. Reflection coefficients are convolved with a
zero-phase wavelet analytically — as a sum of shifted, scaled wavelets rather
than on a sample grid — so reflector timing is exact and tuning curves come out
smooth rather than stair-stepped.

Amplitudes and apparent thicknesses are picked the way you would pick them in an
interpretation package: significant local extrema, matched by polarity to the
top and base reflections, refined by parabolic interpolation.

The wedge module measures a tuning thickness of λ/5.1 for a Ricker wavelet, not
the λ/4 of the rule of thumb. That is Kallweit and Wood's 1/(2.6·f), and the gap
between the two numbers is deliberate teaching content rather than an error.

Noise is band-limited — random reflectivity convolved with the same wavelet —
and laterally correlated, so it looks like seismic noise rather than static, and
so it is not trivially distinguishable from real structure.

Deliberately omitted, each deserving its own module: offset and NMO stretch,
anything genuinely 3D, transmission loss and internal multiples, lateral velocity
variation, fault-plane reflections and tip diffractions, and migration artifacts.
Wavelet bandwidth and spatial aliasing were drafted as modules 01 and 06 of a
longer sequence and are not part of this release; the numbering here runs 00 to
08 without them.

## Page-view counting

`assets/count.js` is the same file used across the other teaching repositories,
with the same GoatCounter code, so one dashboard covers all of them and the path
tells the sites apart. It is off for local copies and for anyone browsing with
Do Not Track set. Deleting the file and the one `<script>` line at the foot of
each page removes it entirely.

The footers on every page were brought into line with the other sites using
`tools/retrofit-footer.py` in the `single-trace` repository. If footers change
again, change them there and re-run it rather than editing ten files by hand.

The footer carries the CC BY-SA 4.0 statement and the citation line, and both
have to match `LICENSE` at the repository root and the license section of
`README.md`. Changing one without the other two is the usual way these drift.

## References

- Widess, M.B., 1973, How thin is a thin bed?: *Geophysics*, 38, 1176–1180.
- Kallweit, R.S., and Wood, L.C., 1982, The limits of resolution of zero-phase
  wavelets: *Geophysics*, 47, 1035–1046.
- Chung, H., and Lawton, D.C., 1995, Frequency characteristics of seismic
  reflections from thin beds: *CJEG*, 31, 32–37.
- Chopra, S., and Marfurt, K.J., 2007, *Seismic Attributes for Prospect
  Identification and Reservoir Characterization*: SEG.
- Simm, R., and Bacon, M., 2014, *Seismic Amplitude: An Interpreter's Handbook*:
  Cambridge University Press.
