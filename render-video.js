const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const PNG = require('pngjs').PNG;

const SVG_PATH = path.resolve(__dirname, 'test.svg');
const OUTPUT_DIR = path.resolve(__dirname, 'frames');
const OUTPUT_MP4 = path.resolve(__dirname, 'animation.mp4');
const OUTPUT_PRORES = path.resolve(__dirname, 'animation-prores4444.mov');
const OUTPUT_APNG = path.resolve(__dirname, 'animation.apng');
const FRAME_RATE = 30;
const DURATION = 5;
const TOTAL_FRAMES = FRAME_RATE * DURATION;
const WIDTH = 143;
const HEIGHT = 86;
const FRAME_SIZE = WIDTH * HEIGHT * 4;

async function main() {
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR);

  const svgContent = fs.readFileSync(SVG_PATH, 'utf-8');
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; }
    html, body { background: transparent !important; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    svg { display: block; background: transparent; }
    ::before, ::after { background: transparent; }
  </style>
</head>
<body>
  ${svgContent}
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const svg = document.querySelector('svg');
      if (svg) {
        const styleSheets = Array.from(document.styleSheets);
        styleSheets.forEach(sheet => {
          try {
            Array.from(sheet.cssRules || []).forEach(rule => {
              if (rule.keyframes) {}
            });
          } catch (e) {}
        });
      }
    });

    window.seekAnimation = function(time) {
      const svg = document.querySelector('svg');
      if (svg && svg.setCurrentTime) svg.setCurrentTime(time);
      document.documentElement.style.setProperty('--seek-time', time + 's');
      const animated = document.querySelectorAll('path, g');
      animated.forEach(el => {
        const computed = getComputedStyle(el);
        const delay = parseFloat(computed.animationDelay) || 0;
        const duration = parseFloat(computed.animationDuration) || 0;
        if (duration > 0) {
          const localTime = Math.max(0, time - delay);
          const progress = Math.min(1, localTime / duration);
          if (el.style.strokeDasharray) {
            const len = parseFloat(el.style.strokeDasharray) || 0;
            el.style.strokeDashoffset = len * (1 - progress) + 'px';
            el.style.opacity = progress;
          } else if (computed.fill === 'rgb(0, 0, 0)' || computed.fill === 'black') {
            el.style.opacity = progress;
          }
        }
      });
    };
  </script>
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  await page.evaluate(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
  });

  await new Promise(r => setTimeout(r, 500));

  console.log(`Capturing ${TOTAL_FRAMES} frames at ${FRAME_RATE}fps...`);

  const rawFramesPath = path.join(OUTPUT_DIR, 'frames-rgba.raw');
  const rawFd = fs.openSync(rawFramesPath, 'w');

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const time = i / FRAME_RATE;

    await page.evaluate((t) => {
      const svg = document.querySelector('svg');
      if (svg && svg.setCurrentTime) svg.setCurrentTime(t);
      document.documentElement.style.setProperty('--seek-time', t + 's');
      const animated = document.querySelectorAll('path, g');
      animated.forEach(el => {
        const computed = getComputedStyle(el);
        const delay = parseFloat(computed.animationDelay) || 0;
        const duration = parseFloat(computed.animationDuration) || 0;
        if (duration > 0) {
          const localTime = Math.max(0, t - delay);
          const progress = Math.min(1, localTime / duration);
          if (el.style.strokeDasharray) {
            const len = parseFloat(el.style.strokeDasharray) || 0;
            el.style.strokeDashoffset = len * (1 - progress) + 'px';
            el.style.opacity = progress;
          } else if (computed.fill === 'rgb(0, 0, 0)' || computed.fill === 'black') {
            el.style.opacity = progress;
          }
        }
      });
    }, time);

    await new Promise(r => setTimeout(r, 50));

    const pngBuffer = await page.screenshot({ omitBackground: true, type: 'png' });
    const png = PNG.sync.read(pngBuffer);
    // Preserve the original colors (black strokes) and alpha exactly.
    // For black pixels, the straight-alpha RGBA values are already RGB=0 + alpha coverage.
    fs.writeSync(rawFd, png.data);

    if (i % 30 === 0) console.log(`  Frame ${i}/${TOTAL_FRAMES} (${time.toFixed(1)}s)`);
  }

  fs.closeSync(rawFd);
  await browser.close();
  console.log('Frames captured. Encoding...');

  // 1) MP4 with HEVC alpha (Apple HEVC + alpha, hvc1 tag)
  const mp4Ok = await encodeMp4HevcAlpha(rawFramesPath).catch(err => {
    console.error('\nMP4 HEVC alpha failed:', err.message);
    return false;
  });
  if (mp4Ok) console.log(`\n✓ Transparent MP4 (HEVC alpha): ${OUTPUT_MP4}`);

  // 2) ProRes 4444 MOV (universally supported transparent format for editors)
  // ProRes requires even dimensions; pad 143 -> 144 with a transparent column.
  await encodeProRes4444(rawFramesPath);
  console.log(`✓ Transparent ProRes 4444: ${OUTPUT_PRORES}`);

  // 3) APNG (web)
  await encodeApng(rawFramesPath);
  console.log(`✓ Transparent APNG: ${OUTPUT_APNG}`);

  fs.rmSync(OUTPUT_DIR, { recursive: true });
  console.log('\nDone.');
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';
    ffmpeg.stderr.on('data', d => {
      const s = d.toString();
      stderr += s;
      if (s.includes('frame=')) process.stdout.write('\r' + s.trim().split('\n').pop());
    });
    ffmpeg.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}\n${stderr.slice(-1500)}`));
    });
    ffmpeg.on('error', reject);
  });
}

function encodeMp4HevcAlpha(rawFramesPath) {
  return runFfmpeg([
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${WIDTH}x${HEIGHT}`,
    '-framerate', String(FRAME_RATE),
    '-i', rawFramesPath,
    '-vf', `format=rgba,pad=144:${HEIGHT}:0:0:color=black@0,format=bgra`,
    '-c:v', 'hevc_videotoolbox',
    '-alpha_quality', '1',
    '-allow_sw', '1',
    '-b:v', '5M',
    '-tag:v', 'hvc1',
    '-pix_fmt', 'bgra',
    OUTPUT_MP4
  ]).then(() => true);
}

function encodeProRes4444(rawFramesPath) {
  // 143 is odd; ProRes needs even dimensions. Pad right with transparent pixels.
  return runFfmpeg([
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${WIDTH}x${HEIGHT}`,
    '-framerate', String(FRAME_RATE),
    '-i', rawFramesPath,
    '-vf', `format=rgba,pad=144:${HEIGHT}:0:0:color=black@0,format=yuva444p10le`,
    '-c:v', 'prores_ks',
    '-profile:v', '4444',
    '-alpha_bits', '16',
    '-pix_fmt', 'yuva444p10le',
    OUTPUT_PRORES
  ]);
}

function encodeApng(rawFramesPath) {
  return runFfmpeg([
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${WIDTH}x${HEIGHT}`,
    '-framerate', String(FRAME_RATE),
    '-i', rawFramesPath,
    '-c:v', 'apng',
    '-pix_fmt', 'rgba',
    '-plays', '0',
    OUTPUT_APNG
  ]);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });