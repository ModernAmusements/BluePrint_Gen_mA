# Blueprint Animation Exporter

Renders animated SVG artwork to **transparent video** formats using Puppeteer (headless Chrome) and FFmpeg.

The renderer pauses and seeks every CSS animation deterministically with the Web Animations API, captures each frame with an alpha channel, and encodes editor-friendly deliverables. Static SVGs get a staggered stroke-draw animation automatically.

## Outputs

| File | Format | Notes |
| --- | --- | --- |
| `animation.mp4` | HEVC/H.265 with alpha (`hvc1`) | Transparent MP4 for Final Cut Pro / QuickTime and editors with HEVC-alpha support |
| `animation-prores4444.mov` | ProRes 4444 with alpha | Industry-standard transparent format for Premiere Pro, After Effects, DaVinci Resolve, Final Cut |
| `animation.apng` | Animated PNG (RGBA) | Infinite-loop transparent animation for the web |
| `robotarm.mp4` | HEVC/H.265 with alpha (`hvc1`) | Transparent MP4 of `robotarm.svg` |
| `robotarm-prores4444.mov` | ProRes 4444 with alpha | Transparent ProRes 4444 of `robotarm.svg` |
| `robotarm.apng` | Animated PNG (RGBA) | Web version of `robotarm.svg` |
| `network.mp4` | HEVC/H.265 with alpha (`hvc1`) | Transparent MP4 of `network.svg` (1080x1350) |
| `network-prores4444.mov` | ProRes 4444 with alpha | Transparent ProRes 4444 of `network.svg` |
| `network.apng` | Animated PNG (RGBA) | Web version of `network.svg` |

Landscape SVGs render at **1920x1080**; portrait SVGs render at **1080x1920** by default. All outputs are **30 fps, 5 seconds** (150 frames). Pass an explicit canvas size (`1080x1350`) to render other aspect ratios exactly.

### Topology variants

Four named 1080x1350 network variants share one monospace, transparent, live-traffic style:

| Source | Base | Topology |
| --- | --- | --- |
| `mesh.svg` | `mesh` | Peer-to-peer mesh, 6 nodes / 9 links |
| `ring.svg` | `ring` | Resilient loop, 6 nodes / 6 links |
| `hub.svg` | `hub` | Star topology with a central switch |
| `spine.svg` | `spine` | Spine-leaf fabric, 2 spines / 4 leaves |

Each variant exports `<base>.mp4`, `<base>-prores4444.mov`, and `<base>.apng`. All four use pure black line art on transparency, monospace labels only, and continuous live traffic rather than a one-off reveal.

## Requirements

- Node.js 18+
- FFmpeg with the `apng`, `prores_ks`, and `hevc_videotoolbox` encoders
  - On macOS, the Homebrew FFmpeg build works out of the box.
  - HEVC alpha encoding uses Apple VideoToolbox, so it requires macOS.

## Usage

```bash
npm install

# Blueprint (test.svg -> animation.*)
npm run render

# Robot arm (robotarm.svg -> robotarm.*)
npm run render:robotarm

# Network infrastructure (network.svg -> network.* at 1080x1350)
npm run render:network

# All four topology variants (mesh, ring, hub, spine)
npm run render:variants

# Any SVG: node render-video.js <svg-file> <output-base> [WIDTHxHEIGHT]
node render-video.js mysvg.svg my-animation
node render-video.js mysvg.svg my-animation 1080x1350
```

The script:

1. Loads the SVG into headless Chrome with a transparent background.
2. Adds a staggered draw-in animation to static SVGs, or uses the SVG's existing CSS animations.
3. Pauses and seeks the animations to each frame, then captures it as RGBA.
4. Encodes the frames into MP4 (HEVC + alpha), ProRes 4444 (alpha), and APNG.
5. Cleans up intermediate frames.

The SVG viewBox is detected automatically. The frame count is `FRAME_RATE * DURATION`.

### Customizing

Edit the timing constants at the top of `render-video.js`:

```js
const FRAME_RATE = 30;
const DURATION = 5;          // seconds
```

The canvas auto-selects 1920x1080 landscape or 1080x1920 portrait from the SVG's aspect ratio. Pass `WIDTHxHEIGHT` as the third CLI argument for an exact canvas, e.g. `1080x1350`; artwork is fitted and centered on a transparent background.

## Transparency Notes

- H.264 MP4 cannot store an alpha channel. The MP4 here uses HEVC with alpha instead.
- If your editor does not read HEVC alpha, use the ProRes 4444 `.mov`. It keeps full transparency and imports reliably in professional editors.
- Browsers do not play alpha video consistently, so use the `.apng` files for web pages.
- The artwork uses black strokes. Over a dark editor background the lines will be hard to see until composited over a lighter background.

## Project Structure

```
render-video.js          # Frame capture + encoding pipeline
test.svg                 # Animated blueprint source
robotarm.svg             # Static robot-arm illustration (auto-animated)
network.svg              # Monospace network topology with live traffic (hand-animated)
mesh.svg                 # Peer-to-peer mesh variant
ring.svg                 # Resilient loop variant
hub.svg                  # Star topology variant
spine.svg                # Spine-leaf fabric variant
animation.mp4            # Transparent HEVC MP4 (blueprint)
animation-prores4444.mov
animation.apng
robotarm.mp4             # Transparent HEVC MP4 (robot arm)
robotarm-prores4444.mov
robotarm.apng
network.mp4              # Transparent HEVC MP4 (1080x1350)
network-prores4444.mov
network.apng
mesh.mp4                 # Variant deliverables (same three formats each)
ring.mp4
hub.mp4
spine.mp4
```
