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

All outputs are **1920x1080, 30 fps, 5 seconds** (150 frames). Artwork is scaled to full height and centered on a transparent 1080p canvas, ready to drop into a 1080p timeline.

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

# Any SVG: node render-video.js <svg-file> <output-base>
node render-video.js mysvg.svg my-animation
```

The script:

1. Loads the SVG into headless Chrome with a transparent background.
2. Adds a staggered draw-in animation to static SVGs, or uses the SVG's existing CSS animations.
3. Pauses and seeks the animations to each frame, then captures it as RGBA.
4. Encodes the frames into MP4 (HEVC + alpha), ProRes 4444 (alpha), and APNG.
5. Cleans up intermediate frames.

The SVG viewBox is detected automatically. The frame count is `FRAME_RATE * DURATION`.

### Customizing

Edit the constants at the top of `render-video.js`:

```js
const FRAME_RATE = 30;
const DURATION = 5;          // seconds
const OUTPUT_WIDTH = 1920;   // final video resolution
const OUTPUT_HEIGHT = 1080;
```

Increase `OUTPUT_WIDTH`/`OUTPUT_HEIGHT` for 4K renders. The artwork width is derived from the SVG's aspect ratio.

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
animation.mp4            # Transparent HEVC MP4 (blueprint)
animation-prores4444.mov
animation.apng
robotarm.mp4             # Transparent HEVC MP4 (robot arm)
robotarm-prores4444.mov
robotarm.apng
```
