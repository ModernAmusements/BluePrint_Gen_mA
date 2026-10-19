# AGENTS.md

## Project

**Blueprint Animation Exporter** — renders animated SVG artwork to transparent 1080p video deliverables for video editors and the web.

- GitHub: `https://github.com/ModernAmusements/BluePrint_Gen_mA` (public)
- Default branch: `main`
- Runtime: Node.js 18+ / CommonJS, Puppeteer + `pngjs`, FFmpeg
- No build step, no framework, no tests directory

## Commands

```bash
npm install

npm run render            # test.svg     -> animation.*
npm run render:robotarm   # robotarm.svg -> robotarm.*

# Generic form
node render-video.js <svg-file> <output-base>
```

Outputs per run (all 1920x1080, 30 fps, 5 s, transparent):

- `<base>.mp4` — HEVC/H.265 with alpha (`hvc1`)
- `<base>-prores4444.mov` — ProRes 4444 with alpha
- `<base>.apng` — looping APNG

Current deliverables:

| Source | Base | MP4 | ProRes 4444 | APNG |
| --- | --- | --- | --- | --- |
| `test.svg` (143x86) | `animation` | 3.6 MB | 33 MB | 8.6 MB |
| `robotarm.svg` (233x155) | `robotarm` | 3.4 MB | 39 MB | 6.7 MB |

## Pipeline

1. `render-video.js` opens the SVG in headless Chrome with a transparent page background.
2. SVG dimensions are parsed from `viewBox`; artwork is scaled to full 1080p height, centered horizontally, and rendered at 1920x1080.
3. Animations:
   - **Animated SVG** (contains `@keyframes` or `<animate>`): use the SVG's own CSS animations.
   - **Static SVG**: auto-inject a staggered stroke-draw animation:
     - `getTotalLength()` per path -> `--len`
     - delays spread linearly over 2.8 s, draw duration 1.2 s
     - filled paths (`fill="black"`) use a 0.8 s fade instead
4. Every frame: pause and seek all animations with `document.getAnimations()`, set `animation.currentTime = time * 1000`, screenshot with `omitBackground: true`, decode PNG with `pngjs`, and write raw RGBA to disk.
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
- **ProRes requires even dimensions.** 1920x1080 is even. If output dimensions become odd, pad by one transparent pixel.
- **HEVC alpha requires macOS VideoToolbox** (`hevc_videotoolbox`, tag `hvc1`). On other platforms only ProRes/APNG are available.
- **GitHub file limit is 100 MB.** Current ProRes files are ~33–39 MB. Raising the resolution to 4K will likely exceed the limit; render ProRes at 1080p or compress/split it.

## Exact Encoder Settings

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

Expected: `hevc`, `hvc1`, 1920x1080, `30/1`, `5.000000`, 150 frames. Alpha is stored as a separate HEVC auxiliary layer, so `pix_fmt` still reports `yuv420p`; verify alpha by decoding to RGBA and counting non-zero alpha pixels across frames. The count must grow over time (draw-in), not stay constant.

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
animation.*                # blueprint deliverables
robotarm.*                 # robot-arm deliverables
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
