# AGENTS.md

## Project

**Blueprint Animation Exporter** — renders animated SVG artwork to transparent video deliverables (1920x1080 landscape, 1080x1920 portrait, or explicit sizes such as 1080x1350) for video editors and the web.

- GitHub: `https://github.com/ModernAmusements/BluePrint_Gen_mA` (public)
- Default branch: `main`
- Runtime: Node.js 18+ / CommonJS, Puppeteer + `pngjs`, FFmpeg
- No build step, no framework, no tests directory

## Commands

```bash
npm install

npm run render            # test.svg     -> animation.*
npm run render:robotarm   # robotarm.svg -> robotarm.*
npm run render:network    # network.svg  -> network.* (1080x1350)
npm run render:variants   # mesh, ring, hub, spine -> four 1080x1350 variants

# Generic form
node render-video.js <svg-file> <output-base> [WIDTHxHEIGHT]
```

Outputs per run (30 fps, 5 s, transparent; canvas is 1920x1080 landscape or 1080x1920 portrait by default, or the explicit `WIDTHxHEIGHT`):

- `<base>.mp4` — HEVC/H.265 with alpha (`hvc1`)
- `<base>-prores4444.mov` — ProRes 4444 with alpha
- `<base>.apng` — looping APNG

Current deliverables:

| Source | Base | MP4 | ProRes 4444 | APNG |
| --- | --- | --- | --- | --- |
| `test.svg` (143x86) | `animation` | 3.6 MB | 33 MB | 8.6 MB |
| `robotarm.svg` (233x155) | `robotarm` | 3.4 MB | 39 MB | 6.7 MB |
| `network.svg` (1080x1350) | `network` | 1.1 MB | 17 MB | 4.0 MB |
| `mesh.svg` (1080x1350) | `mesh` | 0.88 MB | 9.8 MB | 3.3 MB |
| `ring.svg` (1080x1350) | `ring` | 0.71 MB | 8.5 MB | 3.3 MB |
| `hub.svg` (1080x1350) | `hub` | 0.63 MB | 8.9 MB | 2.3 MB |
| `spine.svg` (1080x1350) | `spine` | 0.85 MB | 11 MB | 2.5 MB |

The four variants are alternative topologies drawn in the same monospace/transparent style: `mesh` (peer-to-peer), `ring` (resilient loop), `hub` (star), `spine` (spine-leaf fabric). Mesh and ring use an SVG mask to hide links behind node cards; flows and packets are masked with the same mask.

Local-only asset: `supplychain.svg` (1080x1920) produces `supplychain.*` but has no npm script. Its ProRes is 142 MB, above GitHub's 100 MB limit; do not include it in a normal commit.

## Network Series (1080x1350)

The network graphics (`network.svg` plus `mesh`, `ring`, `hub`, `spine`) share one design system:

- Pure black (`#000`) line art on a transparent canvas; no background fill.
- Monospace labels only (`"SF Mono", Menlo, "Roboto Mono", monospace`). No display/sans title font.
- Header: `NAME / NN` top-left, status top-right, thin rule at `y=150`.
- Footer: four metrics at `y=1176–1237`, rule at `y=1286`, status line at `y=1312`.
- Live motion: short draw-in (~1.5 s), then continuous traffic pulses (CSS `stroke-dashoffset`), SMIL packets, blinking LEDs. The graphic should read as a working network, not just a reveal.
- Mesh and ring mask links, flows, and packets behind node cards so traffic disappears into nodes.

Variant identities:

| Name | File | Structure |
| --- | --- | --- |
| MESH / 01 | `mesh.svg` | 6 peer nodes in a hexagon, 6 perimeter + 3 diagonal links |
| RING / 02 | `ring.svg` | 6 nodes on a 300 px loop, clockwise + counter-clockwise traffic |
| HUB / 03 | `hub.svg` | Central 220 px switch, 6 orthogonal spokes |
| SPINE / 04 | `spine.svg` | 2 spines above 4 leaves, dual-homed fabric links, 4 workloads |

## Pipeline

1. `render-video.js` opens the SVG in headless Chrome with a transparent page background.
2. SVG dimensions are parsed from `viewBox`; artwork is scaled to full height, centered, and rendered at 1920x1080 (landscape) or 1080x1920 (portrait). An explicit `WIDTHxHEIGHT` argument fits the artwork inside that canvas instead.
3. Animations:
   - **Animated SVG** (contains `@keyframes` or `<animate>`): use the SVG's own CSS animations.
   - **Static SVG**: auto-inject a staggered stroke-draw animation:
     - `getTotalLength()` per path -> `--len`
     - delays spread linearly over 2.8 s, draw duration 1.2 s
     - filled paths (`fill="black"`) use a 0.8 s fade instead
4. Every frame: pause and seek all CSS animations with `document.getAnimations()` (`animation.currentTime = time * 1000`), pause and seek SMIL with `svg.pauseAnimations()` + `svg.setCurrentTime(time)`, screenshot with `omitBackground: true`, decode PNG with `pngjs`, and write raw RGBA to disk.
5. FFmpeg encodes the raw RGBA stream into MP4, ProRes 4444, and APNG. Intermediate frames are deleted.

## Critical Notes — Do Not Regress

- **Do not use VP9/WebM for alpha in this environment.** FFmpeg 8.0.1 with `libvpx-vp9` silently drops alpha and produces `yuv420p`, even with `-pix_fmt yuva420p`. The earlier `animation.webm` was opaque/black-background because of this.
- **H.264 MP4 cannot carry alpha.** Use HEVC with alpha instead.
- **Do not feed Puppeteer PNGs directly to FFmpeg.** FFmpeg's PNG decoder reads these screenshots as fully zero (alpha lost). Capture with `pngjs` and pass raw frames via `-f rawvideo -pix_fmt rgba`.
- **Preserve original colors.** Keep RGB=0 (black strokes) and the alpha coverage. Do not convert strokes to white; earlier exports were white because of a failed workaround.
- **Seek CSS animations with the Web Animations API**, not `svg.setCurrentTime()` (SMIL only) and not manual `strokeDashoffset` loops (`el.style.strokeDasharray` is not inline). Use:
  ```js
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = time * 1000;
  }
  ```
- **Injected JavaScript must be wrapped in `<script>` tags.** A missing tag rendered the code as visible text, broke flex centering, and left the SVG static.
- **ProRes requires even dimensions.** 1920x1080 and 1080x1350 are even. If output dimensions become odd, pad by one transparent pixel.
- **CSS transform animations override the SVG `transform` attribute.** When animating a node's scale in an SVG, wrap it in a positioned `<g transform="translate(...)">` and animate a child `<g>`; applying the CSS animation to the positioned group snaps it to the origin (this broke `network.svg`'s edge cards on the first pass).
- **SMIL packet `begin` times must precede the group reveal.** A `<circle>` with `<animateMotion begin="…">` sits at `(0,0)` before its begin time. If the packet group is revealed earlier, those circles flash in the top-left corner. Keep every `begin` below the group's fade-in delay.
- **Mask links, flows, and packets together in mesh/ring layouts.** Use a mask with black card-sized holes and apply it to all three groups; the cards stay unmasked on top. Without the mask, links run visibly through node interiors.
- **HEVC alpha requires macOS VideoToolbox** (`hevc_videotoolbox`, tag `hvc1`). On other platforms only ProRes/APNG are available.
- **GitHub file limit is 100 MB.** Current network ProRes files are ~8.5–39 MB; the local `supplychain-prores4444.mov` is 142 MB and must not be committed as-is. Raising the resolution to 4K will likely exceed the limit too; render ProRes at 1080p or compress/split it.

## Exact Encoder Settings

Use the render's actual `WIDTHxHEIGHT` for `-s` (the examples below show 1920x1080; the network variants use 1080x1350).

MP4 (HEVC alpha):

```bash
ffmpeg -y -f rawvideo -pix_fmt rgba -s 1920x1080 -framerate 30 -i frames.raw \
  -vf format=bgra \
  -c:v hevc_videotoolbox -alpha_quality 1 -allow_sw 1 -b:v 25M \
  -tag:v hvc1 -pix_fmt bgra out.mp4
```

ProRes 4444:

```bash
ffmpeg -y -f rawvideo -pix_fmt rgba -s 1920x1080 -framerate 30 -i frames.raw \
  -vf format=yuva444p10le \
  -c:v prores_ks -profile:v 4444 -alpha_bits 16 -pix_fmt yuva444p10le out.mov
```

APNG:

```bash
ffmpeg -y -f rawvideo -pix_fmt rgba -s 1920x1080 -framerate 30 -i frames.raw \
  -c:v apng -pix_fmt rgba -plays 0 out.apng
```

## Verification

Probe the output:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,codec_tag_string,pix_fmt,width,height,r_frame_rate,duration,nb_frames \
  -of default=nw=1 animation.mp4
```

Expected: `hevc`, `hvc1`, 1920x1080, `30/1`, `5.000000`, 150 frames for `animation.mp4`; the 1080x1350 network variants report 1080x1350 instead. Alpha is stored as a separate HEVC auxiliary layer, so `pix_fmt` still reports `yuv420p`; verify alpha by decoding to RGBA and counting non-zero alpha pixels across frames. The count must grow over time (draw-in), not stay constant.

Decode a frame and inspect it:

```bash
ffmpeg -v error -i animation.mp4 -vf "select=eq(n\,149)" -frames:v 1 preview.png
```

Delete preview PNGs afterwards; they are ignored by git.

## Repo Layout

```
render-video.js            # render + encode pipeline
test.svg                   # animated blueprint source
robotarm.svg               # static robot-arm source (auto-animated)
network.svg                # monospace network topology with live traffic (1080x1350)
mesh.svg                   # peer-to-peer mesh variant
ring.svg                   # resilient loop variant
hub.svg                    # star topology variant
spine.svg                  # spine-leaf fabric variant
animation.*                # blueprint deliverables
robotarm.*                 # robot-arm deliverables
network.*                  # network deliverables
mesh.*, ring.*, hub.*, spine.*  # variant deliverables
supplychain.svg            # local-only colored supply-chain diagram (1080x1920)
supplychain.*              # local-only deliverables (ProRes 142 MB)
README.md                  # user-facing docs
AGENTS.md                  # this file
.agents/, .claude/         # installed anatomy skill (vendored)
```

## Conventions

- Keep `render-video.js` dependency-light and CommonJS.
- Output naming is `<base>.mp4`, `<base>-prores4444.mov`, `<base>.apng`.
- Preserve black line art; do not alter the SVG's stroke color for export.
- Do not commit `node_modules/`, `frames/`, `*.raw`, or `preview-*.png`.
- Commit messages: `feat: ...`, `fix: ...`, `docs: ...`.
- Push to `origin main`; the repo is public.
