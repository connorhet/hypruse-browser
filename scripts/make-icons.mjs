// Draws the extension icons (a pointer on a rounded square) as PNG files with no
// dependencies. Run `pnpm icons` after changing the drawing; the PNGs are committed.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const BACKGROUND = [14, 116, 144];
const FOREGROUND = [255, 255, 255];
const SAMPLES = 4;

// The pointer, in unit coordinates of the icon.
const ARROW = [
  [0.3, 0.18],
  [0.3, 0.8],
  [0.45, 0.66],
  [0.55, 0.87],
  [0.64, 0.83],
  [0.54, 0.62],
  [0.73, 0.62],
];

function insideRoundedSquare(x, y) {
  const radius = 0.22;
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pixel(size, px, py) {
  let square = 0;
  let arrow = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const x = (px + (sx + 0.5) / SAMPLES) / size;
      const y = (py + (sy + 0.5) / SAMPLES) / size;
      if (insideRoundedSquare(x, y)) {
        square += 1;
        if (insidePolygon(x, y, ARROW)) arrow += 1;
      }
    }
  }
  const total = SAMPLES * SAMPLES;
  if (square === 0) return [0, 0, 0, 0];
  const mix = arrow / square;
  const rgb = BACKGROUND.map((b, i) => Math.round(b + (FOREGROUND[i] - b) * mix));
  return [...rgb, Math.round((255 * square) / total)];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      pixel(size, x, y).forEach((value, i) => (raw[offset + i] = value));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  writeFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url), png(size));
}
console.log(`wrote ${SIZES.length} icons`);
