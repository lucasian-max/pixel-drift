// Procedural pixel-art generator for Pixel Drift.
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

/* ---------------------------------------------------------- vegetation ---- */
// shared static-prop helpers: ordered dither + angle wrap
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dith = (x, z) => BAYER[(z & 3) * 4 + (x & 3)] / 16 - 0.5;
const angNorm = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// pine: 40×40, 18 layers — stepped bough platters over a trunk that pokes
// through the south rim. Each platter is flat with a ragged, tip-serrated edge.
function pineAtlas(snow = false) {
  const W = 40, H = 40, L = 18, C = 20, CZ = 20;
  const leafLt = hex(snow ? '#f2fbff' : '#86cf6a');
  const leafDk = hex(snow ? '#7aa9bb' : '#2a6138');
  const leafDeep = hex(snow ? '#3e6878' : '#1b4227');
  const crownC = hex(snow ? '#ffffff' : '#b9e489');
  const bark = hex(snow ? '#5a4a42' : '#7a5638');
  const barkDk = hex(snow ? '#352c28' : '#4a3324');
  const line = hex(snow ? '#284a59' : '#132a10');

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
      if (snow && (y > 10 || rimR(x, z, tierY) - d < 3)) col = mix(col, crownC, 0.38 + dith(x, z) * 0.32);
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

// sakura: 40×40, 18 layers — rounded cherry-blossom crown, dark trunk
function sakuraAtlas() {
  const W = 40, H = 40, L = 18;
  const pinks = [hex('#ffe8f2'), hex('#ffc6de'), hex('#e77aa8'), hex('#b84f7d')];
  const crownC = hex('#fff6fa');
  const bark = hex('#6a4a3a'), barkDk = hex('#3f2a22'), line = hex('#4a1f33');
  const trunk = { x: 20, z: 27, r: 2.2, h: 10.0 };
  const branches = [
    [20, 27, 6.5, 9, 16, 11.0],
    [20, 27, 6.5, 31, 16, 11.0],
    [20, 27, 7.5, 20, 8, 12.5],
    [20, 27, 5.5, 20, 25, 10.0],
  ];
  const clusters = [
    { x: 9, z: 16, r: 6.2, base: 9.5, top: 16.5 },
    { x: 31, z: 16, r: 6.2, base: 9.5, top: 16.5 },
    { x: 20, z: 8, r: 6.0, base: 10.5, top: 18.0 },
    { x: 20, z: 25, r: 5.2, base: 9.0, top: 15.0 },
  ];
  const inTrunk = (x, z, y) => y <= trunk.h && Math.hypot(x - trunk.x, z - trunk.z) < trunk.r;
  const onBranch = (x, z, y) => {
    for (const [ax, az, ay, bx, bz, by] of branches) {
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      const px = ax + dx * t, pz = az + dz * t, py = ay + (by - ay) * t;
      if (Math.hypot(x - px, z - pz) < 1.15 && Math.abs(y - py) < 1.35) return true;
    }
    return false;
  };
  const clusterAt = (x, z) => {
    let best = null;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const d = Math.hypot(x - c.x, z - c.z);
      if (d >= c.r) continue;
      const h = c.base + (c.top - c.base) * (1 - (d / c.r) ** 2);
      if (!best || h > best.h) best = { h, base: c.base, i, d, r: c.r };
    }
    return best;
  };
  return (x, z, y) => {
    if (inTrunk(x, z, y)) {
      let col = y % 3 === 0 ? barkDk : mix(bark, barkDk, 0.35);
      if (x < trunk.x - 0.4) col = mix(col, hex('#8a6652'), 0.45);
      return col;
    }
    if (onBranch(x, z, y)) return mix(bark, barkDk, y % 2 ? 0.35 : 0.2);
    const c = clusterAt(x, z);
    if (!c || y < c.base || y > c.h) return [0, 0, 0, 0];
    const top = y > c.h - 1.0;
    const gx = (clusterAt(x - 1, z)?.h ?? 0) - (clusterAt(x + 1, z)?.h ?? 0);
    const gz = (clusterAt(x, z - 1)?.h ?? 0) - (clusterAt(x, z + 1)?.h ?? 0);
    const lit = clamp(1 + (gx - gz) * 0.08, 0.82, 1.14);
    if (top) {
      const v = clamp(0.14 + (y / 17) * 0.7 + dith(x, z) * 0.36 + (c.i % 3) * 0.035, 0, 1);
      let col = v < 0.42 ? mix(pinks[3], pinks[2], v / 0.42)
        : v < 0.74 ? mix(pinks[2], pinks[1], (v - 0.42) / 0.32)
          : mix(pinks[1], pinks[0], (v - 0.74) / 0.26);
      if (y >= 13) col = mix(col, crownC, 0.30 + dith(x, z) * 0.3);
      const edge = !clusterAt(x - 1, z) || !clusterAt(x + 1, z)
        || !clusterAt(x, z - 1) || !clusterAt(x, z + 1);
      if (edge) col = mix(col, line, 0.68);
      return [col[0] * lit, col[1] * lit, col[2] * lit, 255];
    }
    let col = mix(pinks[3], pinks[2], clamp(0.22 + dith(x, z) * 0.55 + (y / 17) * 0.25, 0, 1));
    const ao = 0.6 + 0.4 * clamp((y - c.base) / Math.max(1, c.h - c.base), 0, 1);
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

stack(40, 40, 18, pineAtlas(false), 'pine.png');
stack(40, 40, 18, sakuraAtlas(), 'sakura.png');
stack(40, 40, 18, pineAtlas(true), 'pine-snow.png');
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
