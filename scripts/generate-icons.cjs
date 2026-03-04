const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Generate a PNG file programmatically (no dependencies)
// Design: rounded square with blue gradient (#2b67db -> #163B83), white circle-dot center

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function generateIcon(size) {
  // Colors
  const topColor = { r: 0x2b, g: 0x67, b: 0xdb };    // #2b67db
  const bottomColor = { r: 0x16, g: 0x3B, b: 0x83 };  // #163B83
  const white = { r: 255, g: 255, b: 255 };

  const cornerRadius = Math.max(2, Math.round(size * 0.2));
  const pixels = Buffer.alloc(size * size * 4); // RGBA

  // Helper: is point inside rounded rect
  function inRoundedRect(x, y, pad) {
    const left = pad, top = pad, right = size - 1 - pad, bottom = size - 1 - pad;
    const r = Math.max(1, cornerRadius - pad);
    if (x < left || x > right || y < top || y > bottom) return false;
    // Check corners
    const corners = [
      { cx: left + r, cy: top + r },
      { cx: right - r, cy: top + r },
      { cx: left + r, cy: bottom - r },
      { cx: right - r, cy: bottom - r },
    ];
    for (const c of corners) {
      const inCornerRegion =
        (x < left + r && y < top + r && x <= c.cx && y <= c.cy) ||
        (x > right - r && y < top + r && x >= c.cx && y <= c.cy) ||
        (x < left + r && y > bottom - r && x <= c.cx && y >= c.cy) ||
        (x > right - r && y > bottom - r && x >= c.cx && y >= c.cy);
      if (inCornerRegion) {
        const dx = x - c.cx;
        const dy = y - c.cy;
        if (dx * dx + dy * dy > r * r) return false;
      }
    }
    return true;
  }

  // Helper: distance from center
  function distFromCenter(x, y) {
    const cx = (size - 1) / 2;
    const cy = (size - 1) / 2;
    return Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
  }

  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const outerRing = size * 0.22;
  const innerRing = size * 0.16;
  const dotRadius = size * 0.08;
  const ringWidth = Math.max(1, size * 0.04);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      if (!inRoundedRect(x, y, 0)) {
        // Transparent
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
        continue;
      }

      // Gradient background
      const t = y / (size - 1);
      let r = lerp(topColor.r, bottomColor.r, t);
      let g = lerp(topColor.g, bottomColor.g, t);
      let b = lerp(topColor.b, bottomColor.b, t);
      let a = 255;

      // Draw the white circle-dot symbol (◉)
      const dist = distFromCenter(x, y);

      // Outer ring
      if (dist <= outerRing && dist >= outerRing - ringWidth) {
        r = white.r; g = white.g; b = white.b;
      }
      // Inner dot
      if (dist <= dotRadius) {
        r = white.r; g = white.g; b = white.b;
      }

      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = a;
    }
  }

  // Build PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT - raw image data with filter bytes
  const rawData = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    rawData[y * (1 + size * 4)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const srcIdx = (y * size + x) * 4;
      const dstIdx = y * (1 + size * 4) + 1 + x * 4;
      rawData[dstIdx] = pixels[srcIdx];
      rawData[dstIdx + 1] = pixels[srcIdx + 1];
      rawData[dstIdx + 2] = pixels[srcIdx + 2];
      rawData[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // IEND
  const iend = Buffer.alloc(0);

  const png = Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend),
  ]);

  return png;
}

const assetsDir = path.join(__dirname, '..', 'assets');

for (const size of [16, 48, 128]) {
  const png = generateIcon(size);
  const outPath = path.join(assetsDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${size}x${size}, ${png.length} bytes)`);
}
