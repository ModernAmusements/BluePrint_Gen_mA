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

// Native SVG aspect ratio (143:86)
const SVG_WIDTH = 143;
const SVG_HEIGHT = 86;

// Final video resolution. Artwork is scaled to full height and centered.
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const ART_WIDTH = Math.round(OUTPUT_HEIGHT * (SVG_WIDTH / SVG_HEIGHT));
const ART_HEIGHT = OUTPUT_HEIGHT;

const TOTAL_FRAMES = FRAME_RATE * DURATION;
const FRAME_SIZE = OUTPUT_WIDTH * OUTPUT_HEIGHT * 4;

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
    html, body {
      background: transparent !important;
      width: ${OUTPUT_WIDTH}px;
      height: ${OUTPUT_HEIGHT}px;
      overflow: hidden;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    svg {
      display: block;
      width: ${ART_WIDTH}px;
      height: ${ART_HEIGHT}px;
      background: transparent;
    }
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

    window.seekTo = function(time) {
      // Deterministically seek every CSS animation to the requested time.
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = time * 1000;
      }
    };
  </script>
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, deviceScaleFactor: 1 });
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  await page.evaluate(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
  });

  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => window.seekTo(0));

  console.log(`Capturing ${TOTAL_FRAMES} frames at ${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}, ${FRAME_RATE}fps...`);

  const rawFramesPath = path.join(OUTPUT_DIR, 'frames-rgba.raw');
  const rawFd = fs.openSync(rawFramesPath, 'w');

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const time = i / FRAME_RATE;

    await page.evaluate((t) => window.seekTo(t), time);

    await new Promise(r => setTimeout(r, 30));

    const pngBuffer = await page.screenshot({ omitBackground: true, type: 'png' });
    const png = PNG.sync.read(pngBuffer);
    // Preserve original colors (black strokes) and alpha.
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
    '-s', `${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}`,
    '-framerate', String(FRAME_RATE),
    '-i', rawFramesPath,
    '-vf', 'format=bgra',
    '-c:v', 'hevc_videotoolbox',
    '-alpha_quality', '1',
    '-allow_sw', '1',
    '-b:v', '25M',
    '-tag:v', 'hvc1',
    '-pix_fmt', 'bgra',
    OUTPUT_MP4
  ]).then(() => true);
}

function encodeProRes4444(rawFramesPath) {
  return runFfmpeg([
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}`,
    '-framerate', String(FRAME_RATE),
    '-i', rawFramesPath,
    '-vf', 'format=yuva444p10le',
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
    '-s', `${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}`,
    '-framerate', String(FRAME_RATE),
    '-i', rawFramesPath,
    '-c:v', 'apng',
    '-pix_fmt', 'rgba',
    '-plays', '0',
    OUTPUT_APNG
  ]);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });