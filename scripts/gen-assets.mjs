// Procedural pixel-art generator for Sprite Drift.
// Every sprite is a *height stack*: layer N is a horizontal cross-section at height N.
// The game renders the stack as offset planes, which is the classic sprite-stacking look.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.resolve('public/sprites');

/* ---------------------------------------------------------------- PNG ---- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(file, Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* -------------------------------------------------------------- colour ---- */
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------- helpers ---- */
const sdRect = (x, z, cx, cz, hw, hl, r = 0) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qz = Math.abs(z - cz) - (hl - r);
  const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - r;
};

// stack(): fn(x,z,y) -> [r,g,b,a]; writes an atlas of w × (h*layers)
// plus a flattened, upscaled preview that mimics the in-game render.
function stack(w, h, layers, fn, file) {
  const px = new Uint8Array(w * h * layers * 4);
  let opaque = 0;
  for (let y = 0; y < layers; y++) {
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const c = fn(x, z, y);
        const i = ((y * h + z) * w + x) * 4;
        px[i] = clamp(c[0], 0, 255); px[i + 1] = clamp(c[1], 0, 255);
        px[i + 2] = clamp(c[2], 0, 255); px[i + 3] = c[3] ?? 255;
        if (px[i + 3] > 8) opaque++;
      }
    }
  }
  writePng(path.join(OUT, file), w, h * layers, px);
  console.log(`  ${file}  ${w}×${h * layers} (${layers} layers, ${((opaque / (w * h * layers)) * 100).toFixed(0)}% fill)`);
  previewStack(w, h, layers, fn, file.replace('.png', '-stack.png'));
}

// Flatten the stack the way the renderer draws it: one pixel of lift per layer.
function previewStack(w, h, layers, fn, file, scale = 6) {
  const W = w * scale, H = (h + layers) * scale;
  const out = new Uint8Array(W * H * 4);
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    const sa = a / 255, da = out[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    out[i] = (r * sa + out[i] * da * (1 - sa)) / oa;
    out[i + 1] = (g * sa + out[i + 1] * da * (1 - sa)) / oa;
    out[i + 2] = (b * sa + out[i + 2] * da * (1 - sa)) / oa;
    out[i + 3] = oa * 255;
  };
  for (let y = 0; y < layers; y++) {
    const dy = (layers - 1 - y) * scale;
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const c = fn(x, z, y);
        if ((c[3] ?? 255) < 8) continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++)
            put(x * scale + sx, dy + z * scale + sy, c[0], c[1], c[2], c[3] ?? 255);
      }
    }
  }
  writePng(path.join('preview', file), W, H, out);
}

/* ------------------------------------------------------------ the car ----- */
// Sprite-stack cars, carved from four flat views (top / side / front / back).
// One 48×76 canvas, 28 slices. The silhouette tables are still authored on the
// original 32×52 grid (z 0..51, half-width ≈ 11) and rescaled into canvas
// space, so the hand-tuned curves survive the bigger canvas. A spec swaps
// silhouette, livery and a roof "extra" so a grid of racers reads as
// different machines.
const ZS = 76 / 52, XS = 48 / 32, HS = 28 / 18; // length, width, height scale
const scaleShape = (s) => ({
  body: s.body.map(([z, w]) => [z * ZS, w * XS]),
  cabin: s.cabin.map(([z, w]) => [z * ZS, w * XS]),
  roof: s.roof.map(([z, h]) => [z * ZS, h * HS]),
  width: s.width.map(([h, w]) => [h * HS, w * XS]),
});
const CAR_SHAPES = {
  sport: scaleShape({
    body: [[0, 0], [1, 1.4], [2, 3.0], [3, 4.8], [4, 6.4], [5, 7.8], [6, 9.0],
      [7, 9.8], [8, 10.4], [10, 10.8], [14, 11.0], [24, 11.0], [32, 10.9],
      [36, 10.6], [40, 10.2], [44, 9.8], [46, 9.4], [48, 9.0], [49, 8.4],
      [50, 7.6], [51, 6.8]],
    cabin: [[0, 0], [16, 0], [17, 2.6], [19, 6.0], [21, 7.6], [23, 8.2],
      [33, 8.2], [35, 7.4], [37, 5.6], [38.5, 2.4], [40, 0], [51, 0]],
    roof: [[0, 6], [2, 7], [4, 8.4], [7, 9.6], [10, 10.2], [14, 10.6], [17, 11.2],
      [19, 13.2], [21, 15.2], [23, 16], [33, 16], [35, 14.6], [37, 12.4],
      [41, 10.8], [45, 10.2], [48, 9.2], [50, 7.6], [51, 6.6]],
    width: [[0, 6], [1, 7.5], [2, 8.6], [3, 9.4], [4, 9.8], [6, 10.4], [8, 10.6],
      [9, 10.4], [10, 9.6], [12, 8.8], [16, 8.2]],
  }),
  box: scaleShape({
    body: [[0, 0], [2, 0], [3, 4], [4, 6], [5, 8], [6, 9.5], [8, 10.4],
      [10, 10.6], [44, 10.6], [46, 10], [47, 8.5], [48, 6.4], [49, 4.2],
      [50, 3.4], [51, 2.8]],
    cabin: [[0, 0], [9, 0], [11, 4], [13, 7], [14, 8], [40, 8], [42, 7],
      [43, 4], [45, 0], [51, 0]],
    roof: [[0, 7], [5, 7], [7, 10], [9, 14], [11, 15.4], [42, 15.4], [44, 14],
      [46, 10], [47, 7]],
    width: [[0, 7], [2, 9], [4, 10.4], [8, 11.2], [12, 11.2], [16, 10.8]],
  }),
  van: scaleShape({
    body: [[0, 0], [2, 0], [3, 6], [4, 8], [5, 9.8], [6, 10.6], [7, 11],
      [46, 11], [47, 9.6], [48, 7], [49, 4.5], [50, 2.2], [51, 0.6]],
    cabin: [[0, 0], [8, 0], [10, 4], [12, 8], [14, 9.2], [40, 9.2], [42, 8],
      [43, 4], [45, 0], [51, 0]],
    roof: [[0, 8], [4, 8], [6, 12], [8, 15.6], [10, 16], [44, 16], [46, 13], [47, 9]],
    width: [[0, 7.5], [2, 9.5], [4, 10.8], [8, 11.5], [12, 11.5], [16, 11.2]],
  }),
  pickup: scaleShape({
    body: [[0, 0], [2, 0], [3, 4], [4, 6], [5, 8], [6, 9.4], [8, 10.2],
      [10, 10.4], [44, 10.4], [46, 9.8], [47, 8.4], [48, 6.2], [49, 4], [50, 2], [51, 0.6]],
    cabin: [[0, 0], [8, 0], [10, 3], [12, 7], [13, 8], [27, 8], [29, 7],
      [30, 3], [32, 0], [51, 0]],
    roof: [[0, 7], [5, 7], [8, 9], [10, 15.4], [27, 15.4], [29, 10], [31, 8.6],
      [44, 8.6], [46, 8], [47, 6]],
    width: [[0, 7], [2, 9], [4, 10.2], [8, 11], [12, 10.6], [16, 10.2]],
  }),
  sofa: scaleShape({
    body: [[0, 0], [4, 0], [6, 6], [8, 9.5], [10, 11], [13, 11], [45, 11],
      [47, 9.5], [48, 7], [50, 3], [51, 0]],
    cabin: [[0, 0], [9, 0], [10, 4], [12, 7], [14, 7.6], [18, 7.6], [20, 4], [22, 0], [51, 0]],
    roof: [[0, 8], [7, 8], [9, 10.6], [11, 11], [45, 11], [47, 9]],
    width: [[0, 9], [2, 10.5], [4, 11], [10, 11], [16, 10.8]],
  }),
  dog: scaleShape({
    body: [[0, 0], [3, 0], [5, 4], [6, 5.5], [8, 7], [10, 7.6], [42, 7.6],
      [44, 7], [46, 5.5], [47, 4], [49, 2], [50, 0.8], [51, 0]],
    cabin: [[0, 0], [10, 0], [12, 3], [14, 5.5], [16, 6], [20, 6], [22, 3], [24, 0], [51, 0]],
    roof: [[0, 7], [8, 8.6], [10, 9], [43, 9], [45, 8.6], [46, 7]],
    width: [[0, 6], [2, 7], [4, 8], [8, 8], [16, 7.6]],
  }),
};

const CAR_SPECS = [
  { file: 'car-hero', shape: 'sport', livery: 'hero', extra: 'spoiler',
    paint: { body: '#eae6db', light: '#fffdf4', dark: '#8b877c' } },
  { file: 'car-red', shape: 'sport', livery: 'stripe', extra: 'lip',
    paint: { body: '#d93b34', light: '#ff6f5f', dark: '#8a1d1a' } },
  { file: 'car-teal', shape: 'sport', livery: 'twin', extra: 'lip',
    paint: { body: '#1fa79a', light: '#4fe0d0', dark: '#0d6058' } },
  { file: 'car-hotrod', shape: 'sport', livery: 'flames', extra: 'wing',
    paint: { body: '#6c3fc4', light: '#a97bff', dark: '#3a1f75' } },
  { file: 'car-taxi', shape: 'box', livery: 'checker', extra: 'sign',
    paint: { body: '#e8b02c', light: '#ffd45e', dark: '#9a6c0e' } },
  { file: 'car-police', shape: 'box', livery: 'police', extra: 'lightbar',
    paint: { body: '#232733', light: '#f2eee1', dark: '#12151c' } },
  { file: 'car-van', shape: 'van', livery: 'stripe', extra: 'pizza',
    paint: { body: '#e2d6b8', light: '#fff6dc', dark: '#9c8f72' } },
  { file: 'car-pickup', shape: 'pickup', livery: 'bed', extra: 'none',
    paint: { body: '#3e7d4f', light: '#63b073', dark: '#224a2d' } },
  { file: 'car-sofa', shape: 'sofa', livery: 'none', extra: 'cushions',
    paint: { body: '#8a5a3c', light: '#b57a52', dark: '#5a3823' } },
  { file: 'car-hotdog', shape: 'dog', livery: 'mustard', extra: 'sausage',
    paint: { body: '#d9a45b', light: '#f0c47c', dark: '#9c6d31' } },
];

function carAtlas(spec) {
  const W = 48, L = 76, H = 28, C = 24;
  const shape = CAR_SHAPES[spec.shape] || CAR_SHAPES.sport;
  const BODY = shape.body, CABIN = shape.cabin, ROOF = shape.roof, WH = shape.width;
  const paint = hex(spec.paint.body);
  const paintLt = hex(spec.paint.light);
  const paintDk = hex(spec.paint.dark);
  const paintDeep = mul(paintDk, 0.45);
  const isSofa = spec.shape === 'sofa';
  const isDog = spec.shape === 'dog';
  const isHero = spec.livery === 'hero';
  const glass = hex(isSofa ? '#4a3324' : isDog ? '#804d2e' : '#1b2c3b');
  const glassLt = hex(isSofa ? '#6b4a34' : isDog ? '#a06a44' : '#3d6a84');
  const tyre = hex('#16161b');
  const rim = hex('#9aa2ab');
  const stripe = hex('#f2eee1');
  const cream = hex('#ffe7a3');
  const red = hex('#ff4a3d');
  const dark = hex('#14171c');
  const mustard = hex('#f2c94c');
  const sausage = hex('#9c2f2a');
  // hero livery: pearl white, racing red, graphite trim
  const heroRed = hex('#cf2e26');
  const heroTrim = hex('#272b34');
  const heroWhite = hex('#f7f4ea');
  const chrome = hex('#c9ced6');
  const line = isHero ? heroTrim : mix(dark, paintDk, 0.35);
  const DIGIT = ['110', '001', '010', '100', '111']; // racing number 2

  const tbl = (t, v) => {
    if (v <= t[0][0]) return t[0][1];
    if (v >= t[t.length - 1][0]) return t[t.length - 1][1];
    for (let i = 0; i < t.length - 1; i++) {
      if (v <= t[i + 1][0]) {
        const k = (v - t[i][0]) / (t[i + 1][0] - t[i][0]);
        return t[i][1] + (t[i + 1][1] - t[i][1]) * k;
      }
    }
    return 0;
  };

  const cabZ0 = CABIN[0][0], cabZ1 = CABIN[CABIN.length - 1][0];
  // the tables start/end with zero-width anchors, so the *real* glazed cabin
  // runs between the first/last positive-width entries
  const cabLo = CABIN.find(([z, w]) => w > 0)[0];
  const cabHi = [...CABIN].reverse().find(([z, w]) => w > 0)[0];
  const cabMid = (cabLo + cabHi) / 2;
  const wheelAt = [[18.3, 6.1], [57.7, 6.1]];
  const wheelDepth = (y) => Math.min(...wheelAt.map(([cy, r]) => Math.abs(y - cy) - r));
  const roofAt = (y) => tbl(ROOF, y);

  /* ---- roof extras: a raised slab sitting on the roofline ---- */
  const EXTRA = {
    lip: { rise: 2.4, z0: 55.3, z1: 58.8, half: 7.8 },
    wing: { rise: 4.8, z0: 52.6, z1: 56.1, half: 9.6 },
    spoiler: { rise: 5.0, z0: 64.5, z1: 69.5, half: 10.5, gap: 2.5, stalkDx: 6.4, paintTop: false },
    lightbar: { rise: 2.9, z0: 32.2, z1: 39.5, half: 8.1, inner: 2.4 },
    sign: { rise: 3.4, z0: 33.6, z1: 39.5, half: 4.65 },
    pizza: { rise: 2.4, z0: 29.2, z1: 48.2, half: 10.5 },
    cushions: { rise: 2.0, z0: 26.3, z1: 61.4, half: 11.1 },
    sausage: { rise: 4.0, z0: 14.6, z1: 61.4, half: 6.6 },
  }[spec.extra];

  const inExtraX = (x, y) => {
    if (!EXTRA || y < EXTRA.z0 || y > EXTRA.z1) return false;
    const dx = Math.abs(x - C);
    return dx <= EXTRA.half && dx >= (EXTRA.inner ?? 0);
  };
  const extraColor = (x, y) => {
    const dx = Math.abs(x - C);
    switch (spec.extra) {
      case 'lightbar': return x < C ? hex('#3f7bff') : hex('#ff3b30');
      case 'sign': return dx > 3.6 ? dark : hex('#fff4d0');
      case 'pizza': {
        if (dx > EXTRA.half - 1.2 || y < EXTRA.z0 + 1.2 || y > EXTRA.z1 - 1.2) return hex('#b08b5a');
        const pep = [[3.2, 32.5], [6.4, 37.0], [1.5, 40.5], [7.5, 44.0], [4.6, 46.0]];
        for (const [px, py] of pep) if (Math.hypot(dx - px, y - py) < 1.7) return hex('#c0392b');
        return hex('#d9b782');
      }
      case 'cushions': {
        const seam = (y > 37.4 && y < 38.9) || (y > 49.1 && y < 50.6) || dx > EXTRA.half - 1.1;
        return seam ? mix(paintDk, dark, 0.35) : mix(paint, paintLt, 0.35);
      }
      case 'sausage': return y % 9 < 3 ? mustard : sausage;
      case 'spoiler': {
        if (dx > EXTRA.half - 2.2) return heroRed;                    // red endplates
        if (y < EXTRA.z0 + 1.4) return mix(heroTrim, dark, 0.4);      // dark leading edge
        return heroTrim;
      }
      default: return mix(paint, paintDk, 0.3);
    }
  };

  /* ---- flat views ---- */
  const topView = (x, y) => {
    const dx = Math.abs(x - C);
    const hw = tbl(BODY, y);
    if (hw <= 0) return null;

    // tyres: a real, lower footprint sticking out of the arches
    const wd = wheelDepth(y);
    if (wd < 0.9 && dx > hw - 0.9 && dx <= hw + 3.3) {
      const cy = wheelAt.reduce((a, b) => (Math.abs(y - b[0]) < Math.abs(y - a[0]) ? b : a))[0];
      const across = dx - hw;
      const hubHit = Math.hypot((y - cy) * 1.15, (across - 1.7) * 2.2) < 1.35;
      if (hubHit) return mix(rim, tyre, 0.45);
      let t = mix(tyre, hex('#26262d'), 0.35);
      if (across > 2.7) t = mul(t, 0.72);               // dark tread shoulder
      else if (Math.abs(y - cy) < 5.2 && Math.floor((y + 2) / 2.1) % 2 === 0) t = mul(t, 1.3); // tread blocks
      return t;
    }
    if (dx > hw) return null;
    const edge = hw - dx;

    if (EXTRA && EXTRA.paintTop !== false && inExtraX(x, y)) return extraColor(x, y);

    const cabHW = tbl(CABIN, y);
    if (y > cabZ0 && y < cabZ1 && dx <= cabHW) {
      const front = clamp((y - cabLo) / 5.0, 0, 1);
      const rear = clamp((cabHi - y) / 4.7, 0, 1);
      const ramp = Math.min(front, rear);
      const boxy = spec.shape === 'box' || spec.shape === 'van' || spec.shape === 'pickup';
      const roofW = boxy ? cabHW - 1.5 : isSofa ? 6.3 : 7.8;
      const roofZone = boxy ? (y > cabLo + 3 && y < cabHi - 3) : (y > cabLo + 5.9 && y < cabHi - 5.9 && ramp > 0.95);
      if (dx < roofW && roofZone) {
        let c = mix(paint, paintDk, 0.08);
        if (spec.livery === 'stripe' && dx < 1.5) c = mix(c, stripe, 0.8);
        if (spec.livery === 'twin' && dx > 3.0 && dx < 4.4) c = mix(c, stripe, 0.8);
        if (spec.shape === 'pickup' && y > 45.4) c = mix(c, paintDk, 0.2);
        if (isHero) c = heroRoof(x, y, dx, c);
        return c;
      }
      // glazing: frame it so it reads as a window, not a hole
      let c = mix(glass, glassLt, clamp(0.1 + ramp * 0.75, 0, 1));
      if (topLabel(y, dx)) c = mix(c, hex('#dff2ff'), 0.25);
      if (dx > cabHW - 1.65 || y < cabZ0 + 1.8 || y > cabZ1 - 1.8) c = mix(c, paintDeep, 0.7);
      // B-pillar splits the side glass
      if (!isSofa && !isDog && Math.abs(y - cabMid) < 1.3) c = mix(c, paintDeep, 0.75);
      return c;
    }

    let c = mix(paint, paintLt, 0.16);
    if (edge < 1.65) c = line;

    // arch shading on the body just inside the tyre
    if (wd < 1.5 && dx > hw - 3.6 && y > 7.3 && y < 67.2) c = mix(c, paintDeep, 0.45);

    switch (spec.livery) {
      case 'stripe': if (dx > 0.6 && dx < 2.25) c = mix(c, stripe, 0.82); break;
      case 'twin': if (dx > 2.4 && dx < 3.75) c = mix(c, stripe, 0.78); break;
      case 'checker':
        if (y > cabZ0 && y < cabZ1 && (Math.floor(y / 3) + Math.floor(x / 3)) % 2 === 0 && dx > 3.6)
          c = mix(c, mix(dark, cream, 0.15), 0.85);
        break;
      case 'flames':
        if (y > 7.3 && y < 41 && dx < hw - 1.8) {
          const tip = 7.3 + dx * 2.4 + ((y * 3) % 7);
          if (y < tip) c = mix(c, y % 4 === 0 ? hex('#ffc247') : hex('#ff6a2b'), 0.92);
        }
        break;
      case 'police':
        if (y > cabZ0 && y < cabZ1 && dx > 3.0) c = mix(c, hex('#e9e6da'), 0.9);
        if (y > cabZ0 && y < cabZ0 + 3.7 && dx > 6.6) c = hex('#2f6bff');
        break;
      case 'mustard': if (dx < 6.9) c = mix(c, mustard, 0.65); break;
      case 'bed':
        if (y > 45.4 && dx < hw - 1.8) c = mix(c, mix(dark, paintDk, 0.35), 0.88);
        if (y > 44.1 && y < 45.9 && dx < hw - 1.2) c = mix(c, paintLt, 0.5);
        if (y > 65.8 && dx < hw - 2.1) c = mix(c, paintDk, 0.4);
        break;
      case 'hero':
        // two-tone: graphite nose + tail bands, twin racing stripe between
        if (y < 5.6) c = mix(c, heroTrim, 0.9);
        else if (y > 69.8) c = mix(c, heroTrim, 0.9);
        else if (dx > 1.3 && dx < 3.4) c = mix(c, heroRed, 0.95);
        if (y > 71 && y < 73 && dx > 5.2 && dx < 7.6) c = chrome; // exhaust tips
        break;
      default: break;
    }

    if (!isSofa && !isDog) {
      if (!isHero && y < 5.0) {
        if (dx > 3.3 && dx < 8.7) c = cream;
        else if (dx <= 1.8 && spec.shape !== 'van') c = dark;
      }
      if (!isHero && y > 69.9) {
        if (dx > 2.7 && dx < 9.3) c = y > 72.2 ? mix(red, hex('#ffe0d4'), 0.5) : red;
        else if (dx <= 1.5) c = mix(c, dark, 0.55);
      }
      // bonnet vents
      if (y > 12 && y < 15.2 && dx > 4.8 && dx < 8.4) c = mix(c, dark, 0.72);
      if (y > 15.8 && y < 19 && dx > 4.8 && dx < 8.4) c = mix(c, dark, 0.72);
      // door seams + fuel cap
      if ((Math.abs(y - 35.8) < 1.0 || Math.abs(y - 56.3) < 1.0) && dx > 7.8) c = mix(c, paintDeep, 0.55);
      if (Math.abs(y - 49.7) < 1.5 && dx > hw - 3.9 && dx < hw - 1.8) c = mix(c, dark, 0.45);
      // wing mirrors sit on the shoulder
      if (y > 31.3 && y < 33.9 && dx > hw - 3.0 && dx < hw - 0.6) c = mix(paintDk, dark, 0.5);
      if (isHero && y > 30.2 && y < 34.8 && dx > hw - 4.2 && dx < hw - 0.5) c = heroTrim;
    }
    return c;
  };

  // the hero's roof: racing roundel with a number, twin stripes around it
  const heroRoof = (x, y, dx, c) => {
    const d = Math.hypot(x - C, (y - cabMid) * 1.05);
    if (d < 6.2) {
      if (d > 5.2) return heroTrim;                 // roundel rim
      if (d > 4.4) return heroWhite;                // white ring
      // bold number block: a white tick inside the red disc stays legible at
      // any rotation, where a small glyph would turn to mush
      if (Math.abs(y - cabMid) < 1.3 && Math.abs(x - C) < 2.6) return heroWhite;
      return heroRed;
    }
    if (dx > 1.3 && dx < 3.4) return heroRed;       // stripes run over the roof
    return c;
  };

  // a subtle highlight band across the windscreen
  const topLabel = (y, dx) => Math.abs(y - cabMid) < 3.2 && dx < 4.5;
  const sideView = (y, h) => {
    if (y < 0 || y >= L) return null;
    const roof = roofAt(y);
    if (wheelDepth(y) < 0 && h <= 13.4) {
      const cy = wheelAt.reduce((a, b) => (Math.abs(y - b[0]) < Math.abs(y - a[0]) ? b : a))[0];
      const hub = Math.hypot(y - cy, h - 7.2);
      const band = Math.floor((y - cy + 6.1) / 2.05) % 2 === 0;
      if (hub < 2.7) return rim;
      if (hub < 4.0) return mix(rim, tyre, 0.45);
      return h < 1.6 ? mix(tyre, dark, 0.6) : band ? mix(tyre, hex('#3a3a44'), 0.5) : tyre;
    }
    if (h > roof) return null;
    if (h <= 0.9) return dark;

    if (y > cabLo + 3 && y < cabHi - 3
      && h > roof - (spec.shape === 'van' ? 6.8 : isSofa ? 5.3 : 6.8)) {
      if (h > roof - 1.7) return mix(paintDk, paint, 0.5);
      return mix(glass, glassLt, clamp((h - (roof - 6.8)) / 6.6, 0, 1));
    }
    let c = mix(paintDk, paint, clamp(h / Math.max(roof, 1), 0, 1) * 0.7);
    if (h > roof - 1.5) c = mix(c, paintLt, 0.35);
    if (h < 3.4) c = mix(c, paintDeep, 0.4);
    if (spec.livery === 'police' && h > 6.2 && h < 12.4 && y > cabZ0 && y < cabZ1) c = mix(c, hex('#e9e6da'), 0.85);
    if (spec.livery === 'checker' && h > 4.7 && h < 9.3 && y > cabZ0 && y < cabZ1
      && (Math.floor(y / 3) + Math.floor(h / 3)) % 2 === 0) c = mix(c, dark, 0.75);
    if (spec.livery === 'bed' && y > 45.4 && h < 12.4) c = mix(c, mix(dark, paintDk, 0.4), 0.8);
    if (!isSofa && !isDog && !isHero) {
      if (y < 3.5) c = h > 4.7 ? cream : mix(c, dark, 0.5);
      if (y > 72.2) c = h > 5.4 ? mix(paintDeep, dark, 0.5) : mix(c, dark, 0.5);
    }
    if (isHero) {
      // only the nose/tail cliff faces take side colours; low-door paint is
      // always hidden under upper layers in a sprite-stack render
      if (y < 3.5) {
        if (h > 7.4 && h < 10.2) c = mix(cream, hex('#ffffff'), 0.55); // light bar
        else if (h > 3.7) c = mix(c, heroTrim, 0.8);                  // graphite bumper
      }
      if (y > 72.2) {
        if (h > 6.8 && h < 10.2) c = red;                             // tail light bar
        else if (h > 3.2) c = mix(c, heroTrim, 0.8);                  // graphite diffuser band
      }
    }
    if (isDog && h > roof - 3.6 && y > 14.6 && y < 61.4) c = sausage;
    return c;
  };

  const endView = (x, h, back) => {
    const dx = Math.abs(x - C);
    const hw = tbl(WH, h) + (h < 7.2 ? 3.3 : 0);
    if (dx > hw) return null;
    if (h < 6.5 && dx > hw - 3.3) return h < 1.9 ? mix(tyre, dark, 0.5) : tyre;
    const glassLine = spec.shape === 'van' ? 14.6 : spec.shape === 'sofa' ? 14.3 : 13.4;
    if (h > glassLine && dx < 9.6 && !isSofa && !isDog) {
      return mix(glass, glassLt, clamp((h - glassLine) / 8.4, 0, 1));
    }
    let c = mix(paintDk, paint, clamp(h / 20.3, 0, 1) * 0.8);
    if (h < 3.1) c = mix(c, paintDeep, 0.45);
    if (h > 3.7 && h < 6.2 && dx < hw - 1.2) c = mix(dark, c, 0.25);
    if (!back && !isDog && !isSofa && h > 6.8 && h < 10.3 && dx > 3.9 && dx < 8.4) c = cream;
    if (back && h > 6.8 && h < 10.3 && dx > 3.0 && dx < 9.0) c = red;
    if (spec.livery === 'police' && h > 7.8 && h < 14.8 && dx < hw - 1.5) c = mix(c, hex('#e9e6da'), 0.85);
    if (spec.livery === 'mustard' && h > 9.3 && h < 13.2) c = mix(c, mustard, 0.7);
    if (isHero) {
      if (dx > 1.3 && dx < 3.4 && h > 7.4 && h < 14.6) c = mix(c, heroRed, 0.9); // stripes wrap the ends
      if (!back) {
        if (h > 3.7 && h < 6.2 && dx < hw - 1.2) c = mix(c, heroTrim, 0.9);      // grille bar
        if (h > 6.4 && h < 7.2) c = mix(c, heroTrim, 0.65);                     // light bezel
        if (h > 7.4 && h < 10.2 && dx > 3.9 && dx < 8.4) c = mix(cream, hex('#ffffff'), 0.55); // lenses
      } else {
        if (h > 6.8 && h < 10.2 && dx < hw - 1.8) c = red;                      // full light bar
        if (h > 3.2 && h < 5.8 && dx > 5.2 && dx < 7.8) c = chrome;             // exhaust tips
        if (h < 3.1) c = mix(c, heroTrim, 0.7);                                 // diffuser
      }
    }
    return c;
  };

  /* ---- carve ---- */
  const N = L * H * W;
  const vox = new Array(N).fill(null);
  const occ = new Uint8Array(N);
  const at = (z, y, x) => (z * L + y) * W + x;
  const solid = (z, y, x) =>
    (y < 0 || y >= L || x < 0 || x >= W || z < 0 || z >= H) ? 0 : occ[at(z, y, x)];

  const topRGBA = new Array(W * L).fill(null);
  for (let y = 0; y < L; y++) for (let x = 0; x < W; x++) topRGBA[y * W + x] = topView(x, y);

  for (let z = 0; z < H; z++) {
    for (let y = 0; y < L; y++) {
      if (!sideView(y, z)) continue;
      for (let x = 0; x < W; x++) {
        if (!topRGBA[y * W + x]) continue;
        if (!endView(x, z, false) && !endView(x, z, true)) continue;
        occ[at(z, y, x)] = 1;
      }
    }
  }

  for (let y = 0; y < L; y++) {
    for (let x = 0; x < W; x++) {
      let topZ = -1;
      for (let z = H - 1; z >= 0; z--) if (occ[at(z, y, x)]) { topZ = z; break; }
      if (topZ < 0) continue;
      const t = topRGBA[y * W + x];
      const lit = clamp(1.02 - Math.abs(x - C) * 0.008, 0.9, 1.03);
      vox[at(topZ, y, x)] = mul(mix(t, paintLt, 0.05), lit);
      for (let z = topZ - 1; z >= 0; z--) {
        if (!occ[at(z, y, x)]) continue;
        let c = null;
        const openX = !solid(z, y, x - 1) || !solid(z, y, x + 1);
        const openY = !solid(z, y - 1, x) || !solid(z, y + 1, x);
        if (openX) c = endView(x, z, y > L / 2);
        if (!c && openY) c = sideView(y, z);
        if (!c) {
          const above = vox[at(z + 1, y, x)];
          c = above ? mul(above, 0.94) : mix(paintDk, paint, 0.4);
        }
        vox[at(z, y, x)] = mul(c, 0.46 + 0.34 * (z / H));
      }
    }
  }

  // extras are stacked on top of the roofline
  if (EXTRA) {
    for (let y = Math.ceil(EXTRA.z0); y <= Math.floor(EXTRA.z1); y++) {
      const base = Math.min(H - 1, Math.floor(roofAt(y)));
      const top = Math.min(H - 1, base + Math.ceil(EXTRA.rise));
      for (let x = 0; x < W; x++) {
        if (!inExtraX(x, y)) continue;
        const dx = Math.abs(x - C);
        for (let z = base + 1; z <= top; z++) {
          // a spoiler on stalks: only the stalk columns fill the gap
          if (EXTRA.gap && z - base <= EXTRA.gap && Math.abs(dx - EXTRA.stalkDx) > 1.9) continue;
          occ[at(z, y, x)] = 1;
          const c = extraColor(x, y);
          const shade = z === top ? 1.0 : 0.72 + 0.16 * (z / H);
          vox[at(z, y, x)] = mul(c, shade * (1.0 - Math.abs(x - C) * 0.006));
        }
      }
    }
  }

  return (x, y, z) => {
    const v = vox[at(z, y, x)];
    return v ? [v[0], v[1], v[2], 255] : [0, 0, 0, 0];
  };
}

/* ---------------------------------------------------------- vegetation ---- */
// pine: 40×40, 18 layers — cone canopy over a trunk
function pineAtlas() {
  const W = 40, H = 40, L = 18, C = 20;
  const leafLt = hex('#6fbe5a'), leaf = hex('#3f8f43'), leafDk = hex('#256336');
  const bark = hex('#6a4a32'), barkDk = hex('#4a3324');

  const trunkH = (x, z) => (sdRect(x, z, C, 26, 2.2, 2.2, 1) < 0 ? 6 : 0);
  const canopyH = (x, z) => {
    const d = Math.hypot((x - C) * 1.0, (z - 21) * 1.05);
    const tiers = [
      { r: 13.5, top: 17.5 },
      { r: 10.5, top: 13.0 },
      { r: 7.0, top: 9.0 },
    ];
    let h = 0;
    for (const t of tiers) {
      if (d < t.r) h = Math.max(h, t.top * Math.pow(1 - d / t.r, 0.55));
    }
    // ragged silhouette
    const n = Math.sin(x * 1.7) * Math.cos(z * 1.3) * 0.55;
    return h > 0 ? h + n : 0;
  };
  const Hh = (x, z) => Math.max(trunkH(x, z), canopyH(x, z));

  return (x, z, y) => {
    const h = Hh(x, z);
    if (h <= 0 || y > h) return [0, 0, 0, 0];
    const top = Math.abs(y - h) < 0.6;
    const gx = Hh(x - 1, z) - Hh(x + 1, z);
    const gz = Hh(x, z - 1) - Hh(x, z + 1);
    const light = clamp(0.98 + gx * 0.055 - gz * 0.05, 0.6, 1.22);
    const ao = 0.55 + 0.45 * clamp(y / Math.max(h, 1), 0, 1);
    let col;
    if (canopyH(x, z) > 0 && h === canopyH(x, z)) {
      const t = clamp(h / 18, 0, 1);
      col = mix(leafDk, leafLt, t * 0.9);
      if (top && ((x * 7 + z * 13) % 11 === 0)) col = mix(col, hex('#a8e07a'), 0.5);
      if (y < h * 0.45) col = mix(col, leafDk, 0.45);
    } else {
      col = top ? bark : barkDk;
    }
    return [col[0] * light * ao, col[1] * light * ao, col[2] * light * ao, 255];
  };
}

// palm: 40×40, 18 layers — lean trunk + fronds
function palmAtlas() {
  const W = 40, H = 40, L = 18, C = 20;
  const trunk = hex('#8a6a44'), trunkDk = hex('#634a2f');
  const leaf = hex('#4fa860'), leafLt = hex('#86d071'), leafDk = hex('#2f7444');
  const lean = (y) => C + Math.pow(Math.max(0, y - 4) / 14, 1.7) * 4;

  return (x, z, y) => {
    const h = 15.5;
    if (y > h + 2.5) return [0, 0, 0, 0];
    const tx = lean(y);
    const trunkR = 2.1 - y * 0.03;
    const inTrunk = Math.hypot(x - tx, (z - 27) * 0.85) < trunkR && y <= h;
    // fronds: six arcs out of the crown
    let frond = false;
    const cy = 28, cx = lean(h);
    const k = y - h; // 0..2.5 above crown
    if (k >= -0.5 && k <= 2.5) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        const rad = 7 + k * 2.2;
        const d = Math.hypot((x - cx) - Math.cos(a) * rad * 0.9, (z - cy) - Math.sin(a) * rad * 0.75);
        if (d < 2.4 - k * 0.2) frond = true;
      }
      if (Math.hypot(x - cx, z - cy) < 3) frond = true;
    }
    if (!inTrunk && !frond) return [0, 0, 0, 0];
    const top = y > h - 0.5;
    const gx = (Math.hypot(x - tx + 1, z - 27) - Math.hypot(x - tx - 1, z - 27)) * 0.6;
    const light = clamp(1.0 + gx * 0.1, 0.65, 1.2);
    let col = frond ? mix(leafDk, leafLt, clamp((y - h + 1) / 3, 0, 1)) : (top ? trunk : trunkDk);
    if (frond && (x + z + y) % 7 === 0) col = mix(col, leaf, 0.4);
    const ao = 0.6 + 0.4 * clamp(y / h, 0, 1);
    return [col[0] * light * ao, col[1] * light * ao, col[2] * light * ao, 255];
  };
}

// rock: 28×28, 10 layers
function rockAtlas() {
  const W = 28, H = 28, L = 10, C = 14;
  const stone = hex('#8f9299'), stoneDk = hex('#5c6068'), stoneLt = hex('#c2c6cc'), moss = hex('#6f9a5a');
  const hAt = (x, z) => {
    const d = Math.hypot((x - C) / 8.5, (z - C) / 7.5);
    if (d > 1) return 0;
    return 8.2 * Math.sqrt(1 - d * d) + Math.sin(x * 1.9) * Math.cos(z * 1.7) * 0.7;
  };
  return (x, z, y) => {
    const h = hAt(x, z);
    if (h <= 0 || y > h) return [0, 0, 0, 0];
    const gx = hAt(x - 1, z) - hAt(x + 1, z);
    const gz = hAt(x, z - 1) - hAt(x, z + 1);
    const light = clamp(1.0 + gx * 0.11 - gz * 0.09, 0.6, 1.25);
    const ao = 0.55 + 0.45 * clamp(y / h, 0, 1);
    let col = mix(stoneDk, stoneLt, clamp(y / h, 0, 1));
    if (y > h - 1.4 && ((x * 5 + z * 3) % 13 < 4)) col = mix(col, moss, 0.6);
    return [col[0] * light * ao, col[1] * light * ao, col[2] * light * ao, 255];
  };
}

/* ------------------------------------------------------------ building ---- */
// 64×64, 14 layers — roof, vents, windows on the sides
function buildingAtlas(roofTone) {
  const W = 64, H = 64, L = 14, C = 32;
  const wall = hex('#c9b79a'), wallDk = hex('#8e7c62'), wallLt = hex('#e6d7bc');
  const roof = hex(roofTone);
  const win = hex('#3f5d70'), winLit = hex('#ffd98a'), trim = hex('#6b5a44');

  const bodyD = (x, z) => sdRect(x, z, C, C, 23, 19, 3);
  const hBody = (x, z) => {
    const d = bodyD(x, z);
    if (d > 0) return 0;
    return 10.5 - clamp(-d / 4, 0, 1) * 0.6;
  };
  const unitH = (x, z) => {
    const a = sdRect(x, z, 24, 26, 5, 4, 1) < 0 ? 12.5 : 0;
    const b = sdRect(x, z, 42, 38, 4, 3.2, 1) < 0 ? 12 : 0;
    return Math.max(a, b);
  };
  const Hh = (x, z) => Math.max(hBody(x, z), unitH(x, z));

  return (x, z, y) => {
    const h = Hh(x, z);
    if (h <= 0 || y > h) return [0, 0, 0, 0];
    const top = Math.abs(y - h) < 0.6;
    const gx = Hh(x - 1, z) - Hh(x + 1, z);
    const gz = Hh(x, z - 1) - Hh(x, z + 1);
    const light = clamp(1.0 + gx * 0.06 - gz * 0.05, 0.72, 1.18);
    const ao = 0.62 + 0.38 * clamp(y / h, 0, 1);
    let col;
    if (unitH(x, z) > 0 && h === unitH(x, z)) {
      col = top ? hex('#9aa3ad') : hex('#6f7982');
    } else if (top) {
      col = mix(roof, wallLt, 0.12);
      if (((x + z) % 9 === 0)) col = mix(col, wallDk, 0.25); // roof tiles
      if (x < 9 || x > 55 || z < 9 || z > 55) col = mix(col, trim, 0.55); // parapet
    } else {
      const band = (y % 4) / 4;
      col = mix(wallDk, wall, band);
      // windows sit on the wall faces
      const onFace = x < 9 || x > 55 || z < 9 || z > 55;
      if (onFace && y > 2 && y < 9 && ((x + z) % 6 < 3)) {
        col = ((x * 3 + z * 5 + y) % 17 === 0) ? winLit : win;
      }
      if (y <= 1) col = mix(col, wallDk, 0.55); // plinth
    }
    return [col[0] * light * ao, col[1] * light * ao, col[2] * light * ao, 255];
  };
}

/* -------------------------------------------------------------- lamp ------ */
function lampAtlas() {
  const W = 16, H = 16, L = 26;
  const metal = hex('#4a5058'), metalLt = hex('#8b939c'), glow = hex('#ffe9a8');
  return (x, z, y) => {
    const pole = Math.hypot(x - 8, z - 12) < 1.4 && y <= 23;
    const head = sdRect(x, z, 8, 9, 3.4, 2.6, 1.2) < 0 && y >= 20 && y <= 24;
    if (!pole && !head) return [0, 0, 0, 0];
    let col;
    if (head) {
      col = y >= 23 ? hex('#3a3f46') : (y === 22 ? metalLt : glow);
    } else {
      col = y % 4 === 0 ? metalLt : metal;
    }
    const shade = 0.8 + (y / 26) * 0.2;
    return [col[0] * shade, col[1] * shade, col[2] * shade, 255];
  };
}


// tyre stack: 24×24, 12 layers
function tyreAtlas() {
  const W = 24, H = 24, L = 12, C = 12;
  const rubber = hex('#1d1d24'), rubberLt = hex('#34343e'), rubberDk = hex('#0f0f14');
  const rim = hex('#8e96a0');
  return (x, z, y) => {
    const d = Math.hypot(x - C, z - C);
    if (d > 8.4) return [0, 0, 0, 0];
    const band = y % 4;                       // each tyre is 4 layers tall
    const topOfTyre = band === 3;
    if (d < 2.9) {
      // hub hole — the inner wall of the stack
      if (topOfTyre) return y % 4 === 3 && y > 8 ? [70, 74, 82, 255] : [22, 22, 27, 255];
      return [16, 16, 20, 255];
    }
    const edge = d > 7.6;
    let col = topOfTyre ? rubberLt : rubber;
    if (edge) col = topOfTyre ? mix(rubberLt, rim, 0.18) : rubberDk;
    if (band === 0) col = mix(col, rubberDk, 0.6);
    if (d > 7.9 && d < 8.3) col = mix(col, hex('#4a4a56'), 0.5);
    const ao = 0.72 + 0.28 * (y / L);
    return [col[0] * ao, col[1] * ao, col[2] * ao, 255];
  };
}

/* -------------------------------------------------------- shadows etc ----- */
function shadowPng(size = 64) {
  const px = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2 + 0.5) / (size / 2);
      const dz = (z - size / 2 + 0.5) / (size / 2);
      const d = Math.sqrt(dx * dx + dz * dz);
      const a = Math.pow(clamp(1 - d, 0, 1), 1.6) * 190;
      const i = (z * size + x) * 4;
      px[i] = 8; px[i + 1] = 10; px[i + 2] = 18; px[i + 3] = a;
    }
  }
  writePng(path.join(OUT, 'shadow.png'), size, size, px);
  console.log('  shadow.png');
}

/* --------------------------------------------------------------- main ----- */
fs.mkdirSync(OUT, { recursive: true });
console.log('generating sprite stacks…');

for (const spec of CAR_SPECS) stack(48, 76, 28, carAtlas(spec), `${spec.file}.png`);
stack(40, 40, 18, pineAtlas(), 'pine.png');
stack(40, 40, 18, palmAtlas(), 'palm.png');
stack(28, 28, 10, rockAtlas(), 'rock.png');
stack(64, 64, 14, buildingAtlas('#a8564a'), 'building-a.png');
stack(64, 64, 14, buildingAtlas('#5d7f9c'), 'building-b.png');
stack(64, 64, 14, buildingAtlas('#c9a24a'), 'building-c.png');
stack(16, 16, 26, lampAtlas(), 'lamp.png');
stack(24, 24, 12, tyreAtlas(), 'tyres.png');
shadowPng();

// contact sheet so the art can be eyeballed without opening the game
console.log('done');
