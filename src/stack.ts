import * as THREE from 'three';

export interface StackDef {
  url?: string;
  layers: number;
  sheetW: number;
  sheetH: number;
  /** world width of one slice */
  worldW: number;
  /** world units between two slices */
  lift: number;
}

const loader = new THREE.TextureLoader();

// bump when sprites change so edge caches never serve a stale 404
const ASSET_V = 'v6';

/** Load a sheet, retrying transient tunnel/proxy drops with a fresh cache key. */
export function loadSheet(url: string, attempt = 0): Promise<THREE.Texture> {
  const sep = url.includes('?') ? '&' : '?';
  const bust = `${sep}${ASSET_V}${attempt ? `r${attempt}` : ''}`;
  return new Promise((res, rej) => {
    loader.load(url + bust, (t) => {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      res(t);
    }, undefined, () => {
      if (attempt < 4) {
        setTimeout(() => loadSheet(url, attempt + 1).then(res, rej), 120 * (attempt + 1));
      } else {
        rej(new Error(`sprite failed after retries: ${url}`));
      }
    });
  });
}

/** One horizontal slice texture, rows [i, i+1) of the sheet. */
function sliceTexture(sheet: THREE.Texture, layers: number, i: number): THREE.Texture {
  const t = sheet.clone();
  t.needsUpdate = true;
  t.repeat.set(1, 1 / layers);
  t.offset.set(0, 1 - (i + 1) / layers);
  return t;
}

function sliceMaterial(sheet: THREE.Texture, layers: number, i: number, tint?: THREE.Color) {
  return new THREE.MeshBasicMaterial({
    map: sliceTexture(sheet, layers, i),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    toneMapped: false,
    color: tint ?? 0xffffff,
  });
}

export const SLICE_GEO = new THREE.PlaneGeometry(1, 1);
SLICE_GEO.rotateX(-Math.PI / 2);

/** A stack that can be rotated and moved every frame (the player car). */
export class SpriteStack extends THREE.Group {
  private parts: THREE.Mesh[] = [];
  constructor(sheet: THREE.Texture, def: StackDef) {
    super();
    const w = def.worldW;
    const d = (def.worldW * def.sheetH) / def.sheetW;
    for (let i = 0; i < def.layers; i++) {
      const m = new THREE.Mesh(SLICE_GEO, sliceMaterial(sheet, def.layers, i));
      m.scale.set(w, 1, d);
      m.position.y = i * def.lift;
      m.frustumCulled = false;
      this.add(m);
      this.parts.push(m);
    }
  }
}

export interface Placement {
  x: number;
  z: number;
  rot: number;
  scale: number;
}

/**
 * Many static stacks of one type. One draw call per layer for the whole type,
 * which is how a forest of 150 trees stays cheap.
 */
export function instancedStack(
  sheet: THREE.Texture,
  def: StackDef,
  placements: Placement[],
  tint?: THREE.Color,
): THREE.Group {
  const group = new THREE.Group();
  if (placements.length === 0) return group;
  const w = def.worldW;
  const d = (def.worldW * def.sheetH) / def.sheetW;
  const dummy = new THREE.Object3D();

  for (let i = 0; i < def.layers; i++) {
    const mesh = new THREE.InstancedMesh(SLICE_GEO, sliceMaterial(sheet, def.layers, i, tint), placements.length);
    mesh.frustumCulled = false;
    for (let n = 0; n < placements.length; n++) {
      const p = placements[n];
      dummy.position.set(p.x, i * def.lift, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(w * p.scale, 1, d * p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}

/** Flat soft blob used as a contact shadow. */
export function shadowPatch(sheet: THREE.Texture, placements: Placement[], size = 1): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: sheet,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(placements.length, 1));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const dummy = new THREE.Object3D();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, 0.012, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.set(size * p.scale, 1, size * p.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * A stack baked into N pre-rendered directions. The sheet is split into one
 * texture per direction at load, so the mesh swaps maps instead of doing atlas
 * UV math — no filtering bleed, no repeat/offset bugs.
 */
export class DirectionalCar extends THREE.Mesh {
  readonly dirs: number;
  private frames: THREE.Texture[] = [];
  private idx = -1;

  constructor(sheet: THREE.Texture, dirs: number, worldWidth: number, frameW: number, frameH: number) {
    const img = sheet.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = frameW;
    canvas.height = frameH;
    const ctx = canvas.getContext('2d')!;
    const frames: THREE.Texture[] = [];
    for (let i = 0; i < dirs; i++) {
      ctx.clearRect(0, 0, frameW, frameH);
      ctx.drawImage(img, i * frameW, 0, frameW, frameH, 0, 0, frameW, frameH);
      const t = new THREE.CanvasTexture(canvas.width ? canvas : canvas);
      const c2 = document.createElement('canvas');
      c2.width = frameW; c2.height = frameH;
      c2.getContext('2d')!.drawImage(canvas, 0, 0);
      const tex = new THREE.CanvasTexture(c2);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      frames.push(tex);
      t.dispose();
    }

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);          // pivot at the wheels
    super(geo, new THREE.MeshBasicMaterial({
      map: frames[0], alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.dirs = dirs;
    this.frames = frames;
    this.idx = 0;
    this.scale.set(worldWidth, (worldWidth * frameH) / frameW, 1);
    this.frustumCulled = false;
  }

  setFrame(i: number) {
    const n = ((i % this.dirs) + this.dirs) % this.dirs;
    if (n === this.idx) return;
    this.idx = n;
    (this.material as THREE.MeshBasicMaterial).map = this.frames[n];
  }
}
