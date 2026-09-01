# What Can You REALLY See in Seismic?

Browser-based experiments in seismic resolution, built for teaching. Free to
use, nothing to install, and everything on the screen is computed live while you
change it.

**[Open the modules →](https://hbedle-subsurface.github.io/seismic_resolution/)**

Heather Bedle, School of Geosciences, University of Oklahoma, with the
[AASPI](https://www.ou.edu/mcee/labs/aaspi) consortium.

---

## Why this exists

Seismic data does not show you the earth. It shows you the earth blurred by a
wavelet, and the blur is not a small correction — it decides which beds you can
see at all, how thick they appear, where their tops seem to be, and whether a
fault exists as far as your data is concerned.

Most people meet that as a rule: λ/4, quarter of a wavelength, resolution limit.
A rule that has been read is fragile. It gets applied where it is remembered and
forgotten everywhere else. What is much harder to forget is having *watched* a
bed thin until it disappeared while the seismic went on confidently reporting a
thickness that stopped being real thirty metres ago.

These are experiments, not lectures. Move a slider and watch something break.

## Who it is for

Three groups who mostly get skipped:

- **Undergraduates** meeting seismic for the first time, who need the pictures
  before the equations.
- **Graduate students** who *use* seismic data in their research without having
  been taught how it is made.
- **People who went straight to industry** and are now expected to map horizons
  on it. That is how I got started.

No install, no account, and no mathematics beyond `λ = V / f`.

## Start here

New to this? Go straight to the wedge model — it is the one everything else
builds on.

**[The wedge model and tuning](https://hbedle-subsurface.github.io/seismic_resolution/modules/wedge.html)**

Move the frequency slider, watch a bed thin to nothing, and see the seismic keep
reporting a thickness that stopped being real. Ten minutes, nothing to set up.

Then try **[Can you see the fault?](https://hbedle-subsurface.github.io/seismic_resolution/modules/faults.html)**
and turn on quiz mode.

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

**Hand out a link, not instructions.** Every module writes its full state into
the URL and has a *Copy link to this setup* button, so you can set up a specific
scenario and give students the link. Everyone starts on the identical
configuration, which makes these straightforward to assign as problem sets.

**Every module ends with guided experiments** — *Try this*, with the answer
written out — and a short *what to carry away*. The questions can be assigned
directly as homework.

**Save as PNG** exports the current panel for slides and reports. **Units**
toggle between metres and feet throughout.

**It works offline.** Download the folder and open `index.html` from your hard
drive. Useful for lecturing on conference wifi.

## One number worth knowing

The wedge module measures a tuning thickness of **λ/5.1** for a Ricker wavelet,
not the λ/4 of the usual rule of thumb. That is not a mistake. It is Kallweit and
Wood's 1/(2.6·f), and the gap between the two numbers is one of the things the
module is for.

## What this is not

These are teaching models, built to make ideas visible. The traces are
one-dimensional convolutional models on small synthetics, and each module says
what it leaves out. For real work on real volumes use
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

> Bedle, H. (2026). *What Can You REALLY See in Seismic?* University of Oklahoma.
> https://hbedle-subsurface.github.io/seismic_resolution/
> SSRN: [article link to follow]

The license statement appears in the footer of all eleven module pages and the
landing page, and the citation line on all twelve. `LICENSE` at the root carries
the full CC BY-SA 4.0 text, which is what GitHub reads to show the license on the
repository page — the footer sentence on its own is not enough. When the SSRN
working paper is published, the link needs adding in thirteen places: this file
and the citation line in each page's footer.

