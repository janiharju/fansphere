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

// Check if (x, y) is inside tournament shield
// Normalized coordinates: center = (0, 0), top = -1, bottom = 1, width roughly -0.8 to 0.8
function inShield(nx, ny, scale = 1.0) {
  const x = Math.abs(nx) / scale;
  const y = (ny + 0.1) / scale; // shift slightly

  // Top edge chevron / dip
  const topEdge = -0.78 + (x * 0.14);
  if (y < topEdge) return false;

  // Bottom tapering curve
  if (y > 0.88) return false;
  if (y > 0.05) {
    const bottomWidth = 0.65 * Math.pow(Math.max(0, 1 - ((y - 0.05) / 0.83)), 0.62);
    if (x > bottomWidth) return false;
  } else {
    // Upper flank
    if (x > 0.66) return false;
  }

  return true;
}

function renderCrestRgba(size, isMaskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const scale = isMaskable ? 0.72 : 0.88;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = (x - center) / (size * 0.5);
      const ny = (y - center) / (size * 0.5);

      // Default background for maskable: Dark Slate navy fill
      if (isMaskable) {
        buf[idx] = 11;
        buf[idx + 1] = 17;
        buf[idx + 2] = 32;
        buf[idx + 3] = 255;
      }

      // Check outer shield rim
      const inOuter = inShield(nx, ny, scale);
      if (!inOuter) {
        continue;
      }

      // Check inner layers
      const inNavyFrame = inShield(nx, ny, scale * 0.94);
      const inWhiteLine = inShield(nx, ny, scale * 0.90);
      const inInnerField = inShield(nx, ny, scale * 0.87);

      let r = 245, g = 158, b = 11, a = 255; // Gold default

      if (!inNavyFrame) {
        // Outer Gold Bevel
        const grad = (ny + 1) / 2;
        r = Math.round(252 - grad * 35);
        g = Math.round(211 - grad * 70);
        b = Math.round(77 - grad * 60);
      } else if (!inWhiteLine) {
        // Dark Navy border frame
        r = 15;
        g = 23;
        b = 42;
      } else if (!inInnerField) {
        // White border line
        r = 255;
        g = 255;
        b = 255;
      } else {
        // Inside Shield Field
        const isLeft = nx < 0;
        if (isLeft) {
          // Left Half: Navy Blue (#1E293B to #0F172A)
          const navyGrad = (ny + 1) / 2;
          r = Math.round(30 - navyGrad * 15);
          g = Math.round(41 - navyGrad * 18);
          b = Math.round(59 - navyGrad * 20);
        } else {
          // Right Half: Crimson Red (#EF4444 to #991B1B)
          const redGrad = (ny + 1) / 2;
          r = Math.round(220 - redGrad * 40);
          g = Math.round(38 - redGrad * 15);
          b = Math.round(38 - redGrad * 15);
        }

        // Top Three Stars
        // Center Star: nx ~ 0, ny ~ -0.42
        const starDistCenter = Math.hypot(nx, ny + 0.42);
        const starDistLeft = Math.hypot(nx + 0.22, ny + 0.38);
        const starDistRight = Math.hypot(nx - 0.22, ny + 0.38);

        if (starDistCenter < 0.055 || starDistLeft < 0.042 || starDistRight < 0.042) {
          r = 253;
          g = 230;
          b = 138;
        }

        // Cheering Supporter Scarf Held Overhead
        // Horizontal curve at ny ~ -0.28 to -0.20, nx from -0.42 to 0.42
        const scarfY = -0.24 + Math.sin(Math.abs(nx) * Math.PI) * 0.06;
        if (Math.abs(nx) < 0.42 && Math.abs(ny - scarfY) < 0.045) {
          r = 254;
          g = 240;
          b = 138; // Gold scarf
        }
        // Scarf fringe tails
        if (nx < -0.38 && nx > -0.48 && ny > -0.25 && ny < -0.10) {
          r = 245; g = 158; b = 11;
        }
        if (nx > 0.38 && nx < 0.48 && ny > -0.25 && ny < -0.10) {
          r = 245; g = 158; b = 11;
        }

        // Cheering Supporter Head: center at (0, -0.06)
        const headDist = Math.hypot(nx, ny + 0.06);
        if (headDist < 0.08) {
          r = 245;
          g = 158;
          b = 11;
        }

        // Cheering Supporter Raised Arms (V-shape towards scarf)
        const armLeftDist = Math.abs((ny - 0.05) - (nx * 0.85 + 0.1));
        const armRightDist = Math.abs((ny - 0.05) - (-nx * 0.85 + 0.1));
        if (ny > -0.24 && ny < 0.08) {
          if (nx < -0.05 && nx > -0.35 && armLeftDist < 0.045) {
            r = 245; g = 158; b = 11;
          }
          if (nx > 0.05 && nx < 0.35 && armRightDist < 0.045) {
            r = 245; g = 158; b = 11;
          }
        }

        // Cheering Supporter Torso: nx between -0.12 and 0.12, ny from 0.0 to 0.45
        if (Math.abs(nx) < 0.10 && ny >= 0.0 && ny <= 0.45) {
          r = 245;
          g = 158;
          b = 11;
        }

        // Football on Lower Right: center at (0.34, 0.30), radius ~ 0.20
        const ballDist = Math.hypot(nx - 0.34, ny - 0.30);
        if (ballDist < 0.20) {
          // Ball Base: White
          r = 255;
          g = 255;
          b = 255;

          // Ball Red Center Pentagon
          if (ballDist < 0.075) {
            r = 220; g = 38; b = 38;
          } else if (ballDist > 0.185) {
            // Ball Red Rim
            r = 185; g = 28; b = 28;
          } else {
            // Seams and patches
            const bdx = nx - 0.34;
            const bdy = ny - 0.30;
            const bAngle = Math.atan2(bdy, bdx);
            const bAngleNorm = (bAngle + 2 * Math.PI) % ((2 * Math.PI) / 5);
            if (Math.abs(bAngleNorm - 0.62) < 0.12 && ballDist > 0.09 && ballDist < 0.17) {
              r = 220; g = 38; b = 38;
            }
          }
        }

        // Lower Left Dynamic Swooshes (White and Gold ribbons)
        const swoosh1 = (ny - 0.35) - (nx * 0.7);
        if (nx < 0.15 && nx > -0.55 && Math.abs(swoosh1) < 0.035 && ballDist >= 0.20) {
          r = 255; g = 255; b = 255; // White swoosh
        }
        const swoosh2 = (ny - 0.44) - (nx * 0.65);
        if (nx < 0.25 && nx > -0.50 && Math.abs(swoosh2) < 0.045 && ballDist >= 0.20) {
          r = 245; g = 158; b = 11; // Gold swoosh
        }

        // Bottom Star: center at (0, 0.66)
        const starDistBottom = Math.hypot(nx, ny - 0.66);
        if (starDistBottom < 0.038) {
          r = 253; g = 230; b = 138;
        }
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

// 1. Generate 192x192 PNG
const buf192 = renderCrestRgba(192, false);
fs.writeFileSync(path.join(staticDir, 'pwa-192x192.png'), encodePng(192, 192, buf192));
console.log('Generated pwa-192x192.png');

// 2. Generate 512x512 PNG
const buf512 = renderCrestRgba(512, false);
fs.writeFileSync(path.join(staticDir, 'pwa-512x512.png'), encodePng(512, 512, buf512));
console.log('Generated pwa-512x512.png');

// 3. Generate 512x512 Maskable PNG
const bufMaskable = renderCrestRgba(512, true);
fs.writeFileSync(path.join(staticDir, 'pwa-maskable-512x512.png'), encodePng(512, 512, bufMaskable));
console.log('Generated pwa-maskable-512x512.png');

// 4. Generate 180x180 Apple Touch Icon PNG
const buf180 = renderCrestRgba(180, false);
fs.writeFileSync(path.join(staticDir, 'apple-touch-icon.png'), encodePng(180, 180, buf180));
console.log('Generated apple-touch-icon.png');

// 5. Generate 64x64 favicon PNG
const buf64 = renderCrestRgba(64, false);
fs.writeFileSync(path.join(staticDir, 'favicon.png'), encodePng(64, 64, buf64));
console.log('Generated favicon.png');
