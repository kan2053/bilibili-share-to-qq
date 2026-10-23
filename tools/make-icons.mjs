#!/usr/bin/env node
/**
 * 生成扩展图标（纯 Node，无第三方依赖）：粉底圆角方块 + 白色「分享」网络图标。
 * 用法：node tools/make-icons.mjs
 * 输出：icons/icon16.png, icon32.png, icon48.png, icon128.png
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'icons');
const SIZES = [16, 32, 48, 128];

/* ------------------------------- PNG 编码 ------------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA 像素数组 → PNG Buffer */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------- 几何 ------------------------------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? clamp01((wx * vx + wy * vy) / len2) : 0;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

// 图标几何（归一化到 0..1）
const NODE_A = { x: 0.315, y: 0.5, r: 0.083 };
const NODE_B = { x: 0.695, y: 0.295, r: 0.083 };
const NODE_C = { x: 0.695, y: 0.705, r: 0.083 };
const LINK_W = 0.062; // 连线的视觉宽度（直径）

function glyphInside(u, v) {
  const da = Math.hypot(u - NODE_A.x, v - NODE_A.y);
  const db = Math.hypot(u - NODE_B.x, v - NODE_B.y);
  const dc = Math.hypot(u - NODE_C.x, v - NODE_C.y);
  if (da <= NODE_A.r || db <= NODE_B.r || dc <= NODE_C.r) return true;
  const half = LINK_W / 2;
  if (distToSegment(u, v, NODE_A.x, NODE_A.y, NODE_B.x, NODE_B.y) <= half) return true;
  if (distToSegment(u, v, NODE_A.x, NODE_A.y, NODE_C.x, NODE_C.y) <= half) return true;
  return false;
}

/* ------------------------------- 渲染 ------------------------------- */

const BG_TOP = [0xfe, 0x8f, 0xb5]; // 浅一点的粉
const BG_BOTTOM = [0xf0, 0x4e, 0x7d]; // 深一点的粉

function render(size) {
  const SS = 4; // 4x 超采样
  const rgba = Buffer.alloc(size * size * 4);
  const radius = 0.225;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;

          const inside = sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, radius) <= 0;
          if (!inside) continue;

          // 对角渐变底色
          const t = clamp01((u + v) / 2);
          let r = lerp(BG_TOP[0], BG_BOTTOM[0], t);
          let g = lerp(BG_TOP[1], BG_BOTTOM[1], t);
          let b = lerp(BG_TOP[2], BG_BOTTOM[2], t);

          if (glyphInside(u, v)) {
            r = 255;
            g = 255;
            b = 255;
          }

          rSum += r;
          gSum += g;
          bSum += b;
          aSum += 255;
        }
      }

      const samples = SS * SS;
      const i = (y * size + x) * 4;
      const a = aSum / samples;
      if (a <= 0) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
      } else {
        // 颜色按已覆盖样本平均，再按 alpha 预乘回不透明色
        const cov = aSum / 255;
        rgba[i] = Math.round(rSum / cov);
        rgba[i + 1] = Math.round(gSum / cov);
        rgba[i + 2] = Math.round(bSum / cov);
        rgba[i + 3] = Math.round(a);
      }
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, render(size));
  console.log(`✔ ${file}`);
}
console.log('图标生成完成');
