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
    paint: { body: '#26408f', light: '#4d6dd6', dark: '#131f4a' } },
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
    if (h <= 0.9) return mix(dark, paintDk, 0.35);

    if (y > cabLo + 3 && y < cabHi - 3
      && h > roof - (spec.shape === 'van' ? 6.8 : isSofa ? 5.3 : 6.8)) {
      if (h > roof - 1.7) return mix(paintDk, paint, 0.5);
      return mix(glass, glassLt, clamp((h - (roof - 6.8)) / 6.6, 0, 1));
    }
    let c = mix(paintDk, paint, 0.62);
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
    let c = mix(paintDk, paint, 0.4 + clamp(h / 20.3, 0, 1) * 0.45);
    if (h < 3.1) c = mix(c, paintDeep, 0.18);
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
        vox[at(z, y, x)] = mul(c, 0.78 + 0.16 * (z / H));
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
// shared static-prop helpers: ordered dither + angle wrap
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dith = (x, z) => BAYER[(z & 3) * 4 + (x & 3)] / 16 - 0.5;
const angNorm = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// pine: 40×40, 18 layers — stepped bough platters over a trunk that pokes
// through the south rim. Each platter is flat with a ragged, tip-serrated edge.
function pineAtlas() {
  const W = 40, H = 40, L = 18, C = 20, CZ = 20;
  const leafLt = hex('#86cf6a'), leafDk = hex('#2a6138'), leafDeep = hex('#1b4227');
  const crownC = hex('#b9e489');
  const bark = hex('#7a5638'), barkDk = hex('#4a3324'), line = hex('#132a10');

  // rim radius per layer: bough platters in pairs, then the spire taper
  const RL = [13.9, 13.9, 12.5, 12.5, 11.1, 11.1, 9.5, 9.5, 8.0, 8.0,
    6.4, 6.4, 5.0, 3.9, 3.1, 2.5, 2.0, 1.6];
  // angular serration: distinct tip counts per tier so no two rims align
  const rimR = (x, z, y) => {
    const n = 7 + (Math.floor(y / 2) % 3) * 2;
    const t = (((Math.atan2(z - CZ, x - C) + Math.PI) / (Math.PI * 2)) * n) % 1;
    return RL[y] * (1 + (Math.abs(t - 0.5) * 2 - 0.5) * 0.13);
  };
  const hAt = (x, z) => {
    const d = Math.hypot(x - C, z - CZ);
    let h = 0;
    for (let y = 0; y < L; y++) if (d < rimR(x, z, y)) h = y + 0.92;
    return h;
  };
  const trunkCZ = 30.2, trunkR = 2.05, trunkH = 7.2;
  const inTrunk = (x, z) => Math.hypot(x - C, z - trunkCZ) < trunkR;
  const Hh = (x, z) => Math.max(hAt(x, z), inTrunk(x, z) ? trunkH : 0);

  return (x, z, y) => {
    const h = Hh(x, z);
    if (h <= 0 || y > h) return [0, 0, 0, 0];
    const top = y > h - 1.0;
    if (inTrunk(x, z) && h === trunkH) {
      // sawn trunk: ring texture, dark rim where it breaks the boughs
      let col = y % 3 === 0 ? barkDk : top ? bark : mix(bark, barkDk, 0.5);
      if (top && Math.hypot(x - C, z - trunkCZ) > trunkR - 0.9) col = mix(col, line, 0.65);
      return col;
    }
    const gx = Hh(x - 1, z) - Hh(x + 1, z);
    const gz = Hh(x, z - 1) - Hh(x, z + 1);
    const lit = clamp(1 + (gx - gz) * 0.09, 0.82, 1.14);
    if (top) {
      const d = Math.hypot(x - C, z - CZ);
      // dithered tone ramp per tier — flat fills, no smooth bands
      const v = clamp(0.16 + (y / 17) * 0.74 + dith(x, z) * 0.38, 0, 1);
      let col = mix(leafDk, leafLt, v);
      const tierY = clamp(Math.round(h - 0.92), 0, L - 1);
      if (rimR(x, z, tierY) - d < 1.7) col = mix(col, leafLt, 0.4);   // sunlit bough rim
      if (y >= 15) col = mix(col, crownC, 0.45 + dith(x, z) * 0.3);   // pale crown spire
      if (Hh(x - 1, z) < h - 0.5 || Hh(x + 1, z) < h - 0.5
        || Hh(x, z - 1) < h - 0.5 || Hh(x, z + 1) < h - 0.5)
        col = mix(col, line, 0.75);                                    // 1px outline
      return [col[0] * lit, col[1] * lit, col[2] * lit, 255];
    }
    // bough underside / side wall: deep green, darker still near the ground
    let col = mix(leafDeep, leafDk, clamp(0.3 + dith(x, z) * 0.5 + (y / 17) * 0.25, 0, 1));
    if (h - y > 4) col = mix(col, leafDeep, 0.45);
    const ao = 0.64 + 0.36 * clamp(y / h, 0, 1);
    return [col[0] * lit * ao, col[1] * lit * ao, col[2] * lit * ao, 255];
  };
}

// palm: 40×40, 18 layers — leaning ringed trunk + a crown of 7 serrated fronds
function palmAtlas() {
  const W = 40, H = 40, L = 18;
  const trunk = hex('#96754b'), trunkHi = hex('#b28d5c'), trunkDk = hex('#6b4e30'), trunkDeep = hex('#4a3520');
  const leafLt = hex('#93d678'), leafDk = hex('#2f7444'), leafDeep = hex('#1c4527'), leaf = hex('#57ae63');
  const line = hex('#143318');

  const baseX = 16.5, baseZ = 28.8, crownX = 23.5, crownZ = 13.8, trunkH = 14.6;
  const trunkX = (z) => baseX + Math.pow(clamp((baseZ - z) / (baseZ - crownZ + 1.2), 0, 1), 1.7) * (crownX - baseX);
  const trunkR = (z) => (z > baseZ - 1.5 ? 2.45 : 1.75) - clamp((baseZ - z) / 15, 0, 1) * 0.55;
  const inTrunk = (x, z) =>
    z > crownZ - 1.6 && z < baseZ + 1.8 && Math.abs(x - trunkX(z)) < trunkR(z);

  const frondA = [], frondL = [];
  for (let k = 0; k < 7; k++) {
    frondA.push((k / 7) * Math.PI * 2 + 0.42);
    frondL.push(12.6 - ((k * 5) % 3) * 1.1);   // long/short mix so no two fronds match
  }
  const FROND_T = 2.3;                          // blade thickness in layers
  const frondAt = (x, z) => {
    const dx = x - crownX, dz = (z - crownZ) * 1.08;
    const r = Math.hypot(dx, dz);
    if (r < 0.9 || r > 13) return null;
    const ang = Math.atan2(dz, dx);
    let best = null;
    for (let k = 0; k < 7; k++) {
      if (r > frondL[k]) continue;
      const lat = Math.abs(angNorm(ang - frondA[k])) * r;
      // width pulses along the frond → leaflets; blades taper toward the tip
      const w = (1.6 - r * 0.055) * ((((Math.floor(r * 1.55) + k * 2) % 3) === 0) ? 0.55 : 1.05);
      if (lat < w) {
        const h = 16.3 - r * 0.27;             // droop: tips fall below the crown
        if (!best || h > best.h) best = { k, h };
      }
    }
    return best;
  };
  const crownH = (x, z) => {
    const d = Math.hypot(x - crownX, z - crownZ);
    return d < 2.5 ? 17.4 - d * 0.35 : 0;      // the palm heart caps the trunk
  };

  return (x, z, y) => {
    const cH = crownH(x, z);
    const f = frondAt(x, z);
    const inT = inTrunk(x, z);
    let mode = null, h = 0, fk = -1;
    if (inT && y <= trunkH) { mode = 'trunk'; h = trunkH; }
    if (f && y <= f.h && y > f.h - FROND_T && cH <= y) { mode = 'frond'; h = f.h; fk = f.k; }
    if (cH > y) { mode = 'crown'; h = cH; }
    if (!mode) return [0, 0, 0, 0];
    if (mode === 'trunk') {
      // ringed segments, sun on the west face, dark seam at the silhouette
      const u = (trunkH - y) % 2.5;
      let col = u < 0.75 ? trunkHi : u < 1.25 ? trunkDk : trunk;
      if (Math.abs(x - trunkX(z)) > trunkR(z) - 0.8) col = mix(col, trunkDeep, 0.55);
      const lit = x < trunkX(z) ? 1.14 : 0.9;
      const ao = 0.75 + 0.25 * clamp(y / trunkH, 0, 1);
      return [col[0] * lit * ao, col[1] * lit * ao, col[2] * lit * ao, 255];
    }
    if (mode === 'crown') {
      const top = y > cH - 1.0;
      let col = top ? mix(leaf, leafLt, clamp(dith(x, z) + 0.5, 0, 1)) : mix(trunkDk, trunk, 0.3);
      if (top && Math.hypot(x - crownX, z - crownZ) > 1.6) col = mix(col, line, 0.5);
      return col;
    }
    // frond blade
    if (y > h - 1.0) {
      const r = Math.hypot(x - crownX, (z - crownZ) * 1.08);
      const v = clamp(0.42 + (12.6 - r) * 0.035 + dith(x, z) * 0.4, 0, 1);
      let col = mix(leafDk, leafLt, v);
      // 1px dark outline along the blade edge (gaps stay transparent → sky)
      const e = (q) => !q || q.k !== fk;
      if (e(frondAt(x - 1, z)) || e(frondAt(x + 1, z)) || e(frondAt(x, z - 1)) || e(frondAt(x, z + 1)))
        col = mix(col, line, 0.75);
      return col;
    }
    // blade underside — what shows between fronds from the side
    let col = mix(leafDeep, leafDk, clamp(0.35 + dith(x, z) * 0.4, 0, 1));
    const ao = 0.7 + 0.3 * clamp(y / h, 0, 1);
    return [col[0] * ao, col[1] * ao, col[2] * ao, 255];
  };
}

// rock: 28×28, 10 layers — faceted boulder: 4 flat planes with crisp edges,
// moss on the lit side, a shadowed base against the asphalt
function rockAtlas() {
  const W = 28, H = 28, L = 10, C = 14;
  const stoneHi = hex('#cfd3d8'), stone = hex('#9a9ea6'), stoneDk = hex('#62666e'), stoneDeep = hex('#3d4048');
  const moss = hex('#6f9a5a'), mossDk = hex('#4c7040');
  const line = hex('#23262e'), asphalt = hex('#2b2b33');

  // irregular footprint: two sine harmonics dent the rim
  const footR = (a) => 9.5 * (1 + 0.10 * Math.sin(a * 3 + 1.1) + 0.06 * Math.sin(a * 5 + 2.7));
  // each facet is a plane; the argmax decides the tone → hard facet edges
  const facets = [
    { h: 9.7, sx: 0.16, sz: 0.30, tone: stoneHi },    // catches the upper-left light
    { h: 9.1, sx: -0.40, sz: 0.02, tone: stone },     // ridge falling away east
    { h: 8.3, sx: 0.34, sz: -0.36, tone: stoneDk },   // south-east face
    { h: 7.3, sx: -0.06, sz: 0.46, tone: stoneDeep }, // north escarpment
  ];
  const info = (x, z) => {
    const dx = x - C, dz = z - C;
    const a = Math.atan2(dz, dx);
    if (Math.hypot(dx, dz) > footR(a)) return null;
    let h = 0, f = 0;
    for (let i = 0; i < facets.length; i++) {
      const v = facets[i].h - dx * facets[i].sx - dz * facets[i].sz;
      if (v > h) { h = v; f = i; }
    }
    return { h: Math.min(h, 9.55), f };
  };
  const mossAt = (x, z) =>
    Math.hypot(x - 11.5, z - 10.5) < 3.3 || Math.hypot(x - 17, z - 8) < 2.0
    || ((x * 7 + z * 11) % 31 === 0 && (x + z) < 26);

  return (x, z, y) => {
    const p = info(x, z);
    if (!p || y > p.h) return [0, 0, 0, 0];
    const fc = facets[p.f];
    if (y > p.h - 1.0) {
      // flat facet fill, a whisper of grit dither, never a gradient
      let col = mix(fc.tone, p.f < 2 ? stone : stoneDk, 0.1 + Math.max(0, dith(x, z)) * 0.12);
      if (mossAt(x, z)) col = mix(col, moss, 0.8);
      else if (((x * 5 + z * 3) % 17) < 2 && p.f < 2) col = mix(col, mossDk, 0.35);
      // crisp facet edges and a 1px silhouette outline
      const n = [info(x - 1, z), info(x + 1, z), info(x, z - 1), info(x, z + 1)];
      if (n.some((q) => !q || q.f !== p.f || q.h < p.h - 1.4)) col = mix(col, line, 0.7);
      return col;
    }
    // wall: facet-tinted, dithered, fading to asphalt shadow at the base
    let col = mix(fc.tone, stoneDeep, 0.45 + Math.max(0, dith(x, z)) * 0.15);
    if (y < 1.6) col = mix(col, asphalt, 0.5);
    const ao = 0.66 + 0.34 * clamp(y / p.h, 0, 1);
    return [col[0] * ao, col[1] * ao, col[2] * ao, 255];
  };
}

/* ------------------------------------------------------------ building ---- */
// 64×64, 14 layers — parapet, roof plant, framed windows with sills, and a
// shopfront awning. Three skins: res (red residential), office (blue),
// shop (ochre) so a street reads as three different buildings.
function buildingAtlas(kind) {
  const W = 64, H = 64, L = 14, C = 32;
  const K = {
    res:    { roof: '#a8564a', roofDk: '#7e3a31', wall: '#c9a892', wallDk: '#8a6a55',
              wallLt: '#e8d4bb', win: '#3f5d70', trim: '#5c4a3a', cap: '#d8cfc0' },
    office: { roof: '#43566e', roofDk: '#2e3c4e', wall: '#aeb9c4', wallDk: '#76838f',
              wallLt: '#d0dae2', win: '#26333f', trim: '#394654', cap: '#c8d0d8' },
    shop:   { roof: '#c9a24a', roofDk: '#93722e', wall: '#d8c9a8', wallDk: '#9c8a62',
              wallLt: '#efe4c4', win: '#334652', trim: '#6b5a44', cap: '#e3dcc8' },
  }[kind];
  const roof = hex(K.roof), roofDk = hex(K.roofDk), wall = hex(K.wall), wallDk = hex(K.wallDk),
    wallLt = hex(K.wallLt), win = hex(K.win), trim = hex(K.trim), cap = hex(K.cap);
  const glassLit = hex('#ffd98a'), sky = hex('#8fb3c9'), asphalt = hex('#2b2b33');
  const awnA = hex('#e0513f'), awnB = hex('#f2eee1');   // game palette: red + cream

  const bodyD = (x, z) => sdRect(x, z, C, C, 23, 19, 4);
  const parapet = (x, z) => bodyD(x, z) <= 0 && bodyD(x, z) > -2.1;
  const hBody = 10;

  // roof plant per variant
  const plant = [];
  if (kind === 'res') {
    plant.push({ kind: 'tank', cx: 43.5, cz: 21.5, r: 3.7, h: 13.3 });          // water tank
    plant.push({ kind: 'vent', cx: 24, cz: 40.5, hw: 1.5, hl: 1.5, h: 11.8 });
  } else if (kind === 'office') {
    plant.push({ kind: 'ac', cx: 24.5, cz: 26.5, hw: 4.8, hl: 3.8, h: 13.3 });  // big AC + fan
    plant.push({ kind: 'ac', cx: 42.5, cz: 38.5, hw: 4.0, hl: 3.2, h: 12.0 });
  } else {
    plant.push({ kind: 'vent', cx: 40.5, cz: 22.5, hw: 1.7, hl: 1.7, h: 13.3 }); // vent stack
    plant.push({ kind: 'box', cx: 46.5, cz: 42.5, hw: 3.0, hl: 2.4, h: 11.9 });  // roof access
  }
  const plantAt = (x, z) => {
    for (const p of plant) {
      if (p.kind === 'tank') { if (Math.hypot(x - p.cx, z - p.cz) < p.r) return p; }
      else if (Math.abs(x - p.cx) < p.hw && Math.abs(z - p.cz) < p.hl) return p;
    }
    return null;
  };
  const Hh = (x, z) => {
    if (bodyD(x, z) > 0) return 0;
    let h = parapet(x, z) ? 11.7 : hBody;
    const p = plantAt(x, z);
    if (p) h = Math.max(h, p.h);
    return h;
  };

  // the outer skin of the footprint is what renders as a wall face
  const face = (x, z) => {
    const d = bodyD(x, z);
    if (d > 0 || d < -1.4) return null;
    const dx = x - C, dz = z - C;
    if (23 - Math.abs(dx) < 19 - Math.abs(dz))
      return { side: dx < 0 ? 'W' : 'E', u: z, lit: dx < 0 ? 1.06 : 0.88 };
    return { side: dz < 0 ? 'N' : 'S', u: x, lit: dz < 0 ? 1.02 : 0.84 };
  };

  // wall dressing: framed windows with sills, or glass bands, or a shopfront
  const winCol = (side, u, y) => {
    if (u < 12 || u > 52) return null;   // keep clear of the corners
    const sideI = side === 'N' ? 1 : side === 'W' ? 2 : side === 'E' ? 3 : 5;
    if (kind === 'office') {
      const bands = [[3.4, 5.9], [6.5, 9.0]];
      for (const [b0, b1] of bands) {
        if (y > b0 && y < b1) {
          if (y < b0 + 0.7 || y > b1 - 0.7) return mix(trim, wallDk, 0.4);
          if (u % 4 < 0.9) return mul(trim, 0.55);                        // dark mullions
          let g = mix(win, sky, 0.18);
          if ((Math.floor(u) + Math.floor(y * 2)) % 11 < 2) g = mix(g, sky, 0.5);
          if (sideI === 1 && (Math.floor(u) * 7 + Math.floor(y)) % 5 === 0) return glassLit;
          return g;
        }
      }
      if (y > 9.0 && y < 9.6) return wallLt;                              // sill band
      return null;
    }
    if (kind === 'shop' && side === 'S') {
      if (y > 2.2 && y < 6.6) {                                           // storefront
        if (Math.abs(u - 32) < 3.4) {                                      // door
          if (Math.abs(u - 32) > 2.3 || y < 2.9 || y > 6.0) return trim;
          return mix(hex('#4a3a2c'), trim, 0.25);
        }
        if (y < 2.9 || y > 6.0) return trim;
        if (u % 6 < 0.9) return trim;
        return mix(win, sky, 0.22);
      }
      if (y >= 7.0 && y <= 9.4) {                                          // awning
        const stripe = (Math.floor(u / 3) % 2 === 0) ? awnA : awnB;
        return y > 9.0 ? mul(stripe, 0.72) : stripe;
      }
      return null;
    }
    // punched windows, two floors (res + shop's N/E/W faces)
    const floors = [[3.4, 5.7], [6.7, 9.0]];
    for (let f = 0; f < 2; f++) {
      const [b0, b1] = floors[f];
      if (y <= b0 - 0.8 || y >= b1 + 1.4) continue;
      const wu = u % 7;
      const inWin = wu > 1.8 && wu < 5.4;
      if (y > b0 - 0.8 && y < b0) return inWin ? trim : null;             // frame head
      if (y > b1 && y < b1 + 0.7) return inWin ? wallLt : null;            // sill
      if (y >= b1 + 0.7 && y < b1 + 1.4) return inWin ? mix(wallDk, trim, 0.5) : null;
      if (!inWin) return null;
      if (wu < 2.7 || wu > 4.5) return trim;                               // jambs
      const litW = (Math.floor(u) * 13 + f * 7 + sideI) % 6 === 0;
      return litW ? glassLit : mix(win, sky, 0.15);
    }
    return null;
  };

  const roofCol = (x, z) => {
    let c = roof;
    if (x % 8 === 0 || z % 8 === 0) c = mix(c, roofDk, 0.55);   // slab seams
    if (dith(x, z) > 0.25) c = mix(c, roofDk, 0.18);            // gravel grit
    return c;
  };

  const plantCol = (p, x, z, y, top) => {
    if (p.kind === 'ac') {
      if (!top) return mix(hex('#7a828c'), hex('#565e68'), y % 2 ? 0 : 0.4);
      const d = Math.hypot(x - p.cx, z - p.cz);
      const a = Math.atan2(z - p.cz, x - p.cx);
      if (d > Math.min(p.hw, p.hl) - 0.9) return hex('#4a5058');
      if (d < 2.6) {
        if (d < 0.7) return hex('#2e333a');                    // fan hub
        for (let k = 0; k < 3; k++)                             // fan blades
          if (Math.abs(angNorm(a - k * 2.094)) < 0.14 + d * 0.14) return hex('#39414a');
        if (Math.abs(d - 1.9) < 0.25) return hex('#6f7982');   // guard ring
        return hex('#8d95a0');
      }
      return hex('#9aa3ad');
    }
    if (p.kind === 'vent') {
      if (!top) return mix(hex('#7d6a52'), hex('#5c4c38'), 0.5 + dith(x, z) * 0.45);
      return Math.hypot(x - p.cx, z - p.cz) < 0.9 ? asphalt : hex('#8d7c60');
    }
    if (p.kind === 'box') {
      if (!top) return mix(wallDk, trim, 0.4);
      const dE = Math.max(Math.abs(x - p.cx) - p.hw, Math.abs(z - p.cz) - p.hl);
      if (dE > -1.0) return trim;
      if (Math.abs(x - p.cx) < 1.1 && Math.abs(z - p.cz) < 0.5) return mix(trim, wallDk, 0.5); // hatch seam
      return mix(hex('#a89c88'), hex('#8d8270'), dith(x, z) + 0.5);
    }
    // water tank: staved timber + hoops, deck with a hatch
    const d = Math.hypot(x - p.cx, z - p.cz), a = Math.atan2(z - p.cz, x - p.cx);
    if (!top) {
      let c = (Math.floor(((a + Math.PI) / (Math.PI * 2)) * 9) % 2) === 0 ? hex('#a58a5f') : hex('#8a6f47');
      if ((p.h - y) % 2.2 < 0.6) c = hex('#6b5638');            // hoops
      return c;
    }
    if (d > p.r - 0.8) return hex('#6b5638');                   // rim
    if (Math.abs(x - p.cx) < 1.2 && Math.abs(z - p.cz) < 1.2) return hex('#a58a5f');
    return mix(hex('#7c6440'), hex('#8a6f47'), dith(x, z) + 0.5);
  };

  return (x, z, y) => {
    const h = Hh(x, z);
    if (h <= 0 || y > h) return [0, 0, 0, 0];
    const top = y > h - 1.0;
    const p = plantAt(x, z);
    if (p && h === p.h) {
      const col = plantCol(p, x, z, y, top);
      if (top) {
        // outline the plant against the roof
        const edge = plantAt(x - 1, z) !== p || plantAt(x + 1, z) !== p
          || plantAt(x, z - 1) !== p || plantAt(x, z + 1) !== p;
        if (edge && p.kind !== 'tank') return mix(col, hex('#22262c'), 0.6);
      }
      return [col[0], col[1], col[2], 255];
    }
    if (top && parapet(x, z)) {
      let col = mix(cap, roof, 0.18);
      if (dith(x, z) > 0.3) col = mix(col, cap, 0.5);
      if (Hh(x - 1, z) < h - 0.5 || Hh(x + 1, z) < h - 0.5
        || Hh(x, z - 1) < h - 0.5 || Hh(x, z + 1) < h - 0.5)
        col = mix(col, trim, 0.75);                             // cap outline
      return [col[0], col[1], col[2], 255];
    }
    if (top) return [...roofCol(x, z), 255];
    const f = face(x, z);
    if (f) {
      let col;
      if (y > hBody) col = mix(trim, cap, 0.3);                 // parapet band
      else if (y < 1.3) col = mix(wallDk, asphalt, 0.45);        // plinth
      else col = winCol(f.side, f.u, y) || mix(wall, wallLt, 0.2 + dith(x, z) * 0.12);
      const ao = 0.72 + 0.28 * clamp(y / h, 0, 1);
      return [col[0] * f.lit * ao, col[1] * f.lit * ao, col[2] * f.lit * ao, 255];
    }
    const col = mix(wallDk, wall, 0.5);                          // rarely-seen inner columns
    return [col[0], col[1], col[2], 255];
  };
}

/* -------------------------------------------------------------- lamp ------ */
// 16×16, 26 layers — base plate, segmented pole, arm, lamp head with a warm
// lens and a small pool of light on the top slice
function lampAtlas() {
  const W = 16, H = 16, L = 26;
  const metal = hex('#3f454d'), metalLt = hex('#79828c');
  const dark = hex('#22262c');
  const lens = hex('#ffdf8e'), lensHi = hex('#fff4c8');
  const PX = 8, PZ = 12.4, HX = 8, HZ = 7.4;

  const inPlate = (x, z) => Math.hypot(x - PX, (z - PZ) * 1.25) < 3.2;
  const poleR = (y) => 1.05 + (y % 4 === 0 ? 0.3 : 0) + clamp(1 - y / 22, 0, 1) * 0.4;
  const inPole = (x, z, y) => y >= 1.5 && y <= 22.2 && Math.hypot(x - PX, z - PZ) < poleR(y);
  const inArm = (x, z, y) => y >= 21.5 && y <= 23.6
    && Math.abs(x - PX) < 1.15 && z < PZ && z > PZ - (y - 20.4) * 1.35;
  const inHead = (x, z, y) => y >= 23.3 && y <= 25.7 && sdRect(x, z, HX, HZ, 3.5, 2.5, 1.6) < 0;

  return (x, z, y) => {
    // warm light pool on the head's top slice
    if (y === 25 && !inHead(x, z, y)) {
      const d = Math.hypot(x - HX, (z - HZ) * 0.9);
      if (d < 6.2 && d > 3.2) {
        return [255, 224, 130, Math.round(clamp(1 - (d - 3.2) / 3.0, 0, 1) * 58)];
      }
    }
    let col;
    if (inHead(x, z, y)) {
      if (y > 24.7) {
        const inner = sdRect(x, z, HX, HZ, 2.3, 1.4, 1.0) < 0;
        if (inner) col = mix(lens, lensHi, clamp(dith(x, z) + 0.5, 0, 1));   // warm lens
        else col = sdRect(x, z, HX, HZ, 3.5, 2.5, 1.6) > -1.0 ? metalLt : hex('#2c3036');
      } else col = (z < HZ) === (x < HX) ? metalLt : metal;                // top-lit bevel
    } else if (inArm(x, z, y)) {
      col = x < PX + 0.4 ? metalLt : metal;
    } else if (inPole(x, z, y)) {
      col = y % 4 === 0 ? metalLt
        : y % 4 === 1 ? mix(dark, metal, 0.15 + Math.max(0, dith(x, z)) * 0.3) : metal;
      if (x < PX - 0.3) col = mix(col, metalLt, 0.5);                      // sunlit side
      if (x > PX + 0.5) col = mix(col, dark, 0.4);
    } else if (inPlate(x, z) && y <= 1.8) {
      if (y > 0.9) {
        col = metalLt;
        for (const [bx, bz] of [[6, 11], [10, 11], [6, 13.6], [10, 13.6]])
          if (Math.hypot(x - bx, z - bz) < 0.6) col = dark;                // bolt dots
      } else col = mix(dark, metal, 0.12 + Math.max(0, dith(x, z)) * 0.22);
    } else return [0, 0, 0, 0];
    return [col[0], col[1], col[2], 255];
  };
}


// tyre stack: 24×24, 12 layers — tread blocks, sidewall highlight, dark gap
function tyreAtlas() {
  const W = 24, H = 24, L = 12, C = 12;
  const rubber = hex('#232429'), rubberLt = hex('#3b3d45'), rubberHi = hex('#60626b'),
    rubberDk = hex('#14151a'), rubberDeep = hex('#0b0c10');
  const hubWall = hex('#565b64');

  return (x, z, y) => {
    const dx = x - C, dz = z - C;
    const d = Math.hypot(dx, dz);
    if (d > 8.45) return [0, 0, 0, 0];
    const band = y % 4;
    const topBand = band === 3;
    const tyre = Math.floor(y / 4);                     // 0 bottom … 2 top tyre
    const au = (Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2) * 12;
    const seg = Math.floor(au), frac = au % 1;          // 12 tread blocks around

    if (d < 2.7) {                                      // hub bore
      if (topBand && tyre === 2 && d > 2.0) return hubWall;
      return rubberDeep;
    }
    if (d > 8.05) return topBand ? rubberDk : rubberDeep;   // bold silhouette edge
    if (d > 6.7) {                                      // tread shoulder
      let c = seg % 2 === 0 ? rubberLt : rubber;
      if (frac < 0.22) c = rubberDk;                    // 1px groove between blocks
      if (!topBand) c = mix(c, rubberDk, 0.55);         // lug shading on the wall
      if (band === 0) c = mix(c, rubberDeep, 0.6);      // contact shadow ring
      return c;
    }
    // sidewall
    let c = topBand ? rubberLt : rubber;
    if (d > 4.0 && d < 4.7) c = mix(c, rubberDk, 0.6);  // groove rings
    if (d > 5.8 && d < 6.2) c = mix(c, rubberDk, 0.5);
    if (topBand && tyre === 2 && dx + dz < 1.5 && d > 3.2 && d < 6.6)
      c = mix(c, rubberHi, clamp(0.75 - (dx + dz) * 0.16, 0, 0.8) + dith(x, z) * 0.25);
    if (!topBand) c = mix(c, rubberDk, 0.45);
    if (band === 0) c = mix(c, rubberDeep, 0.5);         // dark gap between tyres
    const ao = 0.78 + 0.22 * (y / L);
    return [c[0] * ao, c[1] * ao, c[2] * ao, 255];
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
stack(64, 64, 14, buildingAtlas('res'), 'building-a.png');     // residential red
stack(64, 64, 14, buildingAtlas('office'), 'building-b.png');  // office blue
stack(64, 64, 14, buildingAtlas('shop'), 'building-c.png');    // shop ochre
stack(16, 16, 26, lampAtlas(), 'lamp.png');
stack(24, 24, 12, tyreAtlas(), 'tyres.png');
shadowPng();

// contact sheet so the art can be eyeballed without opening the game
console.log('done');
