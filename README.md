# What Can You REALLY See in Seismic?

Browser-based experiments in seismic resolution, built for teaching. Free to
use, nothing to install, and everything on the screen is computed live while you
change it.

**[Open the modules →](https://hbedle-subsurface.github.io/seismic_resolution/)**

Dr. Heather Bedle and Dr. April Moreno-Ward, University of Oklahoma, with the
[AASPI](https://www.ou.edu/mcee/labs/aaspi) consortium.

---

## Why this exists

Seismic data does not show the earth directly. It shows the earth convolved with
a wavelet, and that convolution sets which beds can be separated at all, how
thick they appear, where their tops appear to be, and whether a fault is visible.

Most people meet this as a rule: λ/4, a quarter of a wavelength, the resolution
limit. Stated as a rule it is easy to quote and easy to forget where it applies.
It is harder to forget having watched a bed thin until its top and base merged,
while the section carried on reporting a thickness that no longer matched the
model that produced it.

Each module is built around one experiment. Move a slider and watch a limit
take effect.

## Who it is for

Three groups that most seismic courses pass over:

- **Undergraduates** meeting seismic for the first time, who need the pictures
  before the equations.
- **Graduate students** who *use* seismic data in their research without having
  been taught how it is made.
- **People who went straight into industry** and are now expected to map
  horizons on seismic data.

No install, no account, and no mathematics beyond `λ = V / f`.

## The modules

In the order they build on each other.

| # | Module | The question it answers |
|---|--------|-------------------------|
| 00 | [How the earth changes with depth](modules/depthtrends.html) | Why does deep data always look softer? |
| 01 | [Where a seismic trace comes from](modules/model1d.html) | Why does that formation top have no reflector? |
| 02 | [The wedge model and tuning](modules/wedge.html) | Why is the thin edge of my channel the brightest part? |
| 03 | [Can you see the fault?](modules/faults.html) | How small a fault am I missing? |
| 04 | [Horizontal resolution](modules/fresnel.html) | How small a feature can I map in plan view? |
| 05 | [Resolution with depth](modules/depth.html) | Why does my deep interpretation feel so much vaguer? |
| 06 | [Resolution in map view](modules/mapres.html) | Where does my channel really end? |
| 07 | [Tuning in map view](modules/mapview.html) | Is that bright rim gas, or is it tuning? |
| 08 | [Phase, polarity and well ties](modules/phase.html) | Am I picking the top of the sand, or near it? |

## Using these in a class

**Hand out a link.** Every module writes its full state into
the URL and has a *Copy link to this setup* button, so you can set up a specific
scenario and give students the link. Everyone starts on the identical
configuration, which makes these straightforward to assign as problem sets.

**Every module ends with guided experiments** — *Try this*, with the answer
written out — and a short summary. The questions can be assigned directly as
homework.

**Save as PNG** exports the current panel for slides and reports. **Units**
toggle between meters and feet throughout.

## One number worth knowing

The wedge module measures a tuning thickness of **λ/5.1** for a Ricker wavelet
rather than the λ/4 of the usual rule of thumb. The measured value is Kallweit
and Wood's 1/(2.6·f). The difference between the two numbers is one of the things
the module is built to show.

## What this is not

These are teaching models. The traces are one-dimensional convolutional models
on small synthetics, and each module lists what it leaves out. For work on real
volumes use
[AASPI](https://www.ou.edu/mcee/labs/aaspi) or your interpretation package: the
numbers here describe the model on the screen, not your survey.

## Privacy

Nothing you do inside a module leaves your browser. No slider setting, no click,
no computed trace is transmitted anywhere.

The site does record an anonymous page count, with no cookie and no identifier,
so that the modules people actually use are the ones that get improved. See
`assets/count.js`, which explains exactly what is sent and how to switch it off.

## License and citation

Licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Free
to use, adapt and share, including in teaching and including commercially,
provided the source is credited and any adaptation is released under the same
license. If you use it in a course or a talk, a credit line and a link back are
all that is asked. The full legal text is in `LICENSE` at the repository root.

> Bedle, H., and Moreno-Ward, A. (2026). *What Can You REALLY See in Seismic? A Set
> of Browser-Based Interactive Modules for Teaching Seismic Resolution.* SSRN
> working paper, University of Oklahoma.
> https://hbedle-subsurface.github.io/seismic_resolution/

