// Generates cover.png (800x534) for gladys-ecodevices-ed3: plain Node, no
// dependency. A generic energy box on a DIN rail with its lights and network
// port, an electricity meter with its display, current clamps on a cable, a
// water drop, a light bulb on a relay, on a green gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
const skyAt = (x, y) => {
  const t = (x / W) * 0.6 + (y / H) * 0.4;
  return [120 - 60 * t, 210 - 70 * t, 170 - 40 * t];
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    set(x, y, skyAt(x, y));
  }
}
const white = [255, 255, 255];
const dark = [50, 40, 40];
const green = [90, 190, 120];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

// A DIN rail with the energy box: terminals on top and bottom, a row of
// lights, a network port.
box(40, 150, 760, 170, 4, [200, 200, 205]);
box(80, 80, 380, 260, 14, white);
for (let k = 0; k < 6; k += 1) {
  box(100 + k * 45, 92, 130 + k * 45, 116, 4, [120, 120, 130]);
  box(100 + k * 45, 224, 130 + k * 45, 248, 4, [120, 120, 130]);
  disc(115 + k * 45, 150, 9, k % 2 === 0 ? green : [200, 210, 200]);
}
box(290, 170, 360, 210, 4, dark);
// An electricity meter with its display.
box(470, 60, 720, 260, 18, white);
box(500, 90, 690, 150, 8, [40, 70, 60]);
for (let k = 0; k < 5; k += 1) box(515 + k * 34, 105, 538 + k * 34, 135, 3, [140, 230, 170]);
disc(595, 210, 22, [220, 220, 225]);
// A cable with two current clamps, down to the box.
line(380, 330, 760, 330, 10, dark);
for (const x of [500, 640]) {
  disc(x, 330, 28, [250, 190, 60]);
  disc(x, 330, 14, dark);
  line(x, 302, x - 60, 250, 4, [250, 190, 60]);
}
// A water drop.
disc(560, 445, 40, [90, 160, 230]);
for (let k = 0; k < 75; k += 1) disc(560, 445 - k, 40 * (1 - k / 75), [90, 160, 230]);
// A light bulb on a relay.
disc(150, 390, 50, [255, 235, 140]);
box(130, 435, 170, 470, 6, [150, 150, 160]);
line(150, 260, 150, 340, 5, dark);
// The network cable.
line(325, 210, 325, 290, 6, dark);
line(325, 290, 380, 290, 6, dark);

disc(400, 267, 300, white, 0.04);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
