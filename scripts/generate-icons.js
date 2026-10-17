import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth 8
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * 4)] = 0; // Filter 0 (None)
    rgbaBuffer.copy(scanlines, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idatData = zlib.deflateSync(scanlines, { level: 9 });
  const idatChunk = createChunk('IDAT', idatData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Draw a themed icon for FanSphere (ArseFinland)
// Palette:
// Dark Navy: #0B1120 (11, 17, 32)
// Arsenal Red: #DC2626 (220, 38, 38)
// Deep Crimson: #991B1B (153, 27, 27)
// Arsenal Gold: #F59E0B (245, 158, 11)
// White: #FFFFFF (255, 255, 255)
function renderIconRgba(size, isMaskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const radius = isMaskable ? size * 0.38 : size * 0.44;
  const cornerRadius = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background color:
      // For maskable, entire canvas is deep navy-red gradient
      // For any, rounded squircle or circle
      let inCard = true;
      if (!isMaskable) {
        // Squircle shape
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const half = size * 0.46;
        if (absX > half || absY > half) {
          inCard = false;
        } else if (absX > half - cornerRadius && absY > half - cornerRadius) {
          const cornerDist = Math.sqrt(
            Math.pow(absX - (half - cornerRadius), 2) +
            Math.pow(absY - (half - cornerRadius), 2)
          );
          if (cornerDist > cornerRadius) {
            inCard = false;
          }
        }
      }

      if (!inCard) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Base gradient: Deep Slate to Dark Navy
      const gradRatio = (y / size);
      let r = Math.round(15 + gradRatio * 8);
      let g = Math.round(23 + gradRatio * 5);
      let b = Math.round(42 - gradRatio * 15);
      let a = 255;

      // Outer Crest Shield / Circle (Arsenal Red & Gold)
      const crestR = radius;
      if (dist <= crestR) {
        // Red crest disc
        const redRatio = 1 - (dist / crestR);
        r = Math.round(185 + redRatio * 45); // 185 to 230
        g = Math.round(25 + redRatio * 20);
        b = Math.round(25 + redRatio * 20);

        // Gold border ring
        if (dist >= crestR - (size * 0.035) && dist <= crestR) {
          r = 245;
          g = 158;
          b = 11;
        } else if (dist >= crestR - (size * 0.045) && dist < crestR - (size * 0.035)) {
          r = 251;
          g = 191;
          b = 36;
        }
      }

      // Inner Football Motif / Cannon Shield
      const ballR = radius * 0.58;
      if (dist <= ballR) {
        // Football white base
        const ballGrad = (dy + ballR) / (2 * ballR);
        r = Math.round(240 + (1 - ballGrad) * 15);
        g = Math.round(242 + (1 - ballGrad) * 13);
        b = Math.round(245 + (1 - ballGrad) * 10);

        // Gold border for football
        if (dist >= ballR - (size * 0.02) && dist <= ballR) {
          r = 217;
          g = 119;
          b = 6;
        }

        // Central dark pentagon
        if (dist <= ballR * 0.38) {
          r = 15;
          g = 23;
          b = 42;
        } else {
          // Seams / pentagon lines at angles
          const angle = Math.atan2(dy, dx);
          const angleNorm = (angle + 2 * Math.PI) % ((2 * Math.PI) / 5);
          const seamDist = Math.abs(angleNorm - (Math.PI / 5));
          if (dist > ballR * 0.38 && seamDist < 0.09) {
            r = 30;
            g = 41;
            b = 59;
          }
        }
      }

      // Small Red Star / Accent at top
      const starY = center - radius * 0.76;
      const starDist = Math.hypot(dx, y - starY);
      if (starDist <= size * 0.032) {
        r = 251;
        g = 191;
        b = 36;
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }

  return buf;
}

const staticDir = path.resolve(process.cwd(), 'static');

// 1. Generate 192x192
const buf192 = renderIconRgba(192, false);
fs.writeFileSync(path.join(staticDir, 'pwa-192x192.png'), encodePng(192, 192, buf192));
console.log('Generated pwa-192x192.png');

// 2. Generate 512x512
const buf512 = renderIconRgba(512, false);
fs.writeFileSync(path.join(staticDir, 'pwa-512x512.png'), encodePng(512, 512, buf512));
console.log('Generated pwa-512x512.png');

// 3. Generate 512x512 Maskable (with safe zone margin)
const bufMaskable = renderIconRgba(512, true);
fs.writeFileSync(path.join(staticDir, 'pwa-maskable-512x512.png'), encodePng(512, 512, bufMaskable));
console.log('Generated pwa-maskable-512x512.png');

// 4. Generate 180x180 Apple Touch Icon
const buf180 = renderIconRgba(180, false);
fs.writeFileSync(path.join(staticDir, 'apple-touch-icon.png'), encodePng(180, 180, buf180));
console.log('Generated apple-touch-icon.png');

// 5. Generate 64x64 favicon
const buf64 = renderIconRgba(64, false);
fs.writeFileSync(path.join(staticDir, 'favicon.png'), encodePng(64, 64, buf64));
console.log('Generated favicon.png');
