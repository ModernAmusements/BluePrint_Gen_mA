const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const PNG = require('pngjs').PNG;

// Usage:
//   node render-video.js [svg-file] [output-base]
// Examples:
//   node render-video.js test.svg animation
//   node render-video.js robotarm.svg robotarm
const svgArg = process.argv[2] || 'test.svg';
const svgBase = path.basename(svgArg, path.extname(svgArg));
const outputBase = process.argv[3] || (svgBase === 'test' ? 'animation' : svgBase);

const SVG_PATH = path.resolve(__dirname, svgArg);
const OUTPUT_DIR = path.resolve(__dirname, 'frames');
const OUTPUT_MP4 = path.resolve(__dirname, `${outputBase}.mp4`);
const OUTPUT_PRORES = path.resolve(__dirname, `${outputBase}-prores4444.mov`);
const OUTPUT_APNG = path.resolve(__dirname, `${outputBase}.apng`);
const FRAME_RATE = 30;
const DURATION = 5;

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;

const TOTAL_FRAMES = FRAME_RATE * DURATION;

function getSvgDimensions(svgContent) {
  const viewBox = svgContent.match(/viewBox="([^"]+)"/i);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const width = svgContent.match(/\bwidth="([\d.]+)"/i);
  const height = svgContent.match(/\bheight="([\d.]+)"/i);
  return {
    width: width ? Number(width[1]) : 1,
    height: height ? Number(height[1]) : 1
  };
}

async function main() {
  if (!fs.existsSync(SVG_PATH)) {
    throw new Error(`SVG not found: ${SVG_PATH}`);
  }

  const svgContent = fs.readFileSync(SVG_PATH, 'utf-8');
  const hasAnimation = /@keyframes|<animate/i.test(svgContent);
  const svgDims = getSvgDimensions(svgContent);
  const artWidth = Math.round(OUTPUT_HEIGHT * (svgDims.width / svgDims.height));

  // Static SVGs get the same staggered stroke-draw treatment as test.svg.
  const autoAnimCss = hasAnimation ? '' : `
    .auto-draw path:not([fill="black"]) {
      stroke-dasharray: var(--len);
      stroke-dashoffset: var(--len);
      opacity: 0;
      animation: autoDrawIn 1.2s ease-out forwards;
    }
    .auto-draw path[fill="black"] {
      opacity: 0;
      animation: autoFadeIn 0.8s ease-out forwards;
    }
    @keyframes autoDrawIn {
      from { stroke-dashoffset: var(--len); opacity: 0; }
      to   { stroke-dashoffset: 0; opacity: 1; }
    }
    @keyframes autoFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }`;

  const autoAnimScript = hasAnimation ? '' : `
    <script>
      (function () {
        const svg = document.querySelector('svg');
        if (!svg) return;
        const paths = Array.from(svg.querySelectorAll('path'));
        const total = paths.length;
        const maxDelay = 2.8;
        paths.forEach((p, i) => {
          let len = 100;
          try { len = Math.ceil(p.getTotalLength()); } catch (e) {}
          p.style.setProperty('--len', len);
          p.style.animationDelay = (maxDelay * (i / Math.max(1, total - 1))).toFixed(3) + 's';
        });
        svg.classList.add('auto-draw');
      })();
    </script>`;

  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR);

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
      width: ${artWidth}px;
      height: ${OUTPUT_HEIGHT}px;
      background: transparent;
    }
    ::before, ::after { background: transparent; }
    ${autoAnimCss}
  </style>
</head>
<body>
  ${svgContent}
  ${autoAnimScript}
  <script>
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

  console.log(`Rendering ${path.basename(SVG_PATH)} -> ${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}, ${FRAME_RATE}fps, ${DURATION}s`);
  console.log(`Capturing ${TOTAL_FRAMES} frames...`);

  const rawFramesPath = path.join(OUTPUT_DIR, 'frames-rgba.raw');
  const rawFd = fs.openSync(rawFramesPath, 'w');

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const time = i / FRAME_RATE;
    await page.evaluate((t) => window.seekTo(t), time);
    await new Promise(r => setTimeout(r, 30));

    const pngBuffer = await page.screenshot({ omitBackground: true, type: 'png' });
    const png = PNG.sync.read(pngBuffer);
    // Preserve original colors and alpha exactly.
    fs.writeSync(rawFd, png.data);

    if (i % 30 === 0) console.log(`  Frame ${i}/${TOTAL_FRAMES} (${time.toFixed(1)}s)`);
  }

  fs.closeSync(rawFd);
  await browser.close();
  console.log('Frames captured. Encoding...');

  const mp4Ok = await encodeMp4HevcAlpha(rawFramesPath).catch(err => {
    console.error('\nMP4 HEVC alpha failed:', err.message);
    return false;
  });
  if (mp4Ok) console.log(`\n✓ Transparent MP4 (HEVC alpha): ${OUTPUT_MP4}`);

  await encodeProRes4444(rawFramesPath);
  console.log(`✓ Transparent ProRes 4444: ${OUTPUT_PRORES}`);

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
