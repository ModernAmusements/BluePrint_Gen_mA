# Blueprint Animation Exporter

Renders an animated SVG blueprint to **transparent video** formats using Puppeteer (headless Chrome) and FFmpeg.

The bundled `test.svg` is a technical blueprint illustration with a staggered stroke-draw animation. The renderer seeks the CSS/SMIL animation frame by frame, captures each frame with an alpha channel, and encodes it into editor-friendly deliverables.

## Outputs

| File | Format | Notes |
| --- | --- | --- |
| `animation.mp4` | HEVC/H.265 with alpha (`hvc1`) | Small, transparent MP4 for Final Cut Pro / QuickTime and editors with HEVC-alpha support |
| `animation-prores4444.mov` | ProRes 4444 with alpha | Industry-standard transparent format for Premiere Pro, After Effects, DaVinci Resolve, Final Cut |
| `animation.apng` | Animated PNG (RGBA) | Infinite-loop transparent animation for the web (`<img src="animation.apng">`) |

All outputs are **144x86, 30 fps, 5 seconds** (150 frames). The source SVG is 143x86; one transparent column is padded because ProRes and HEVC require even dimensions.

## Requirements

- Node.js 18+
- FFmpeg with the `apng`, `prores_ks`, and `hevc_videotoolbox` encoders
  - On macOS, the Homebrew FFmpeg build works out of the box.
  - HEVC alpha encoding uses Apple VideoToolbox, so it requires macOS.

## Usage

```bash
npm install
npm run render
```

The script:

1. Loads `test.svg` into headless Chrome with a transparent background.
2. Seeks the animation to each frame (30 fps) and captures it as RGBA.
3. Encodes the frames into MP4 (HEVC + alpha), ProRes 4444 (alpha), and APNG.
4. Cleans up intermediate frames.

### Customizing

Edit the constants at the top of `render-video.js`:

```js
const SVG_PATH = path.resolve(__dirname, 'test.svg');
const FRAME_RATE = 30;
const DURATION = 5;      // seconds
const WIDTH = 143;
const HEIGHT = 86;
```

Drop in another animated SVG and point `SVG_PATH` at it. The frame count is `FRAME_RATE * DURATION`.

## Transparency Notes

- H.264 MP4 cannot store an alpha channel. The MP4 here uses HEVC with alpha instead.
- If your editor does not read HEVC alpha, use `animation-prores4444.mov`. It keeps full transparency and imports reliably in professional editors.
- Browsers do not play alpha video consistently, so use `animation.apng` for web pages.
- The original artwork uses black strokes. Over a dark editor background the lines will be hard to see until composited over a lighter background.

## Project Structure

```
render-video.js        # Frame capture + encoding pipeline
test.svg               # Animated blueprint source
robotarm.svg           # Additional SVG artwork
animation.mp4          # Transparent HEVC MP4
animation-prores4444.mov
animation.apng
```
