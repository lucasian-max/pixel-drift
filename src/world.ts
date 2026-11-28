import * as THREE from 'three';
import { instancedStack, loadSheet, shadowPatch, type Placement, type StackDef } from './stack';

/* All five are set from the active map in buildWorld. A map may widen its
   playfield (the Interlagos lap is 1.6 km and needs 400 units across); maps
   that declare nothing keep the 172 x 172 world, the 180 unit painted ground
   and the 2048 px texture they always had. */
export let WORLD = 172;
let ROAD_HALF = 4.4;
let PX = 2048;
// The painted ground is wider than the playable area, so props and the camera
// never see the texture edge.
let GX = 180;
let HALF_G = GX / 2;
let PPU = PX / GX;
let HALF = WORLD / 2;

export interface Collider { x: number; z: number; r: number }

export interface World {
  group: THREE.Group;
  sky: string;
  roadHalf: number;
  /** half the playfield side: the car is kept inside it */
  half: number;
  update(): void;
  colliders: Collider[];
  roadAt(x: number, z: number): boolean;
  kerbAt(x: number, z: number): boolean;
  start: { x: number; z: number; heading: number };
  addSkid(x: number, z: number, angle: number, strength: number): void;
  clearSkid(): void;
  minimapPath: { x: number; z: number }[];
  track: { x: number; z: number }[];
  groundAt?: (x: number, z: number, heading: number, trackIdx?: number) => number;
  bridgeColliders?: Collider[];
}

type P2 = { x: number; z: number };

/** one unit box, shared by every batched prop in the file */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** One authored piece of planting. A grove is a stand with a dense middle and a
 *  ragged edge, a row is a line that follows the circuit for a stretch, a bed is
 *  a pile of rock, and open ground is nothing at all — negative space is part of
 *  the composition, not an oversight. */
export interface Dressing {
  /** stands of trees: [x, z, radius, count, palm?, scale?] */
  groves?: { x: number; z: number; r: number; n: number; palm?: boolean; scale?: number }[];
  /** a row that hugs the circuit, centred on the track point nearest `near` */
  rows?: { near: [number, number]; metres: number; side: number; offset: number;
    step: number; palm?: boolean; scale?: number }[];
  /** rock as a bed rather than as noise */
  beds?: { x: number; z: number; r: number; n: number; scale?: number }[];
  /** ground the map keeps clear of every prop */
  open?: { x: number; z: number; r: number }[];
}

export interface MapDef {
  id: string;
  name: string;
  ctrl: [number, number][];
  roadHalf: number;
  smooth?: boolean;
  palette: {
    grass: string; tones: [string, string, string, string, string];
    bladeA: string; bladeB: string;
    sand: string; water: string; waterLt: string;
    shoulder: string; asphalt: string; grainA: string; grainB: string;
    line: string; kerbA: string; kerbB: string;
  };
  lake?: { x: number; z: number; rx: number; rz: number };
  /** more water than the one lake above: each is painted as its own shore */
  lakes?: { x: number; z: number; rx: number; rz: number }[];
  /** playfield side in units; the ground texture grows to match. Default 172 */
  world?: number;
  tint?: string;
  trees?: 'pine' | 'palm' | 'mixed' | 'sakura';
  town?: [number, number][];
  props?: { trees: number; rocks: number; buildings: number; lampStride: number; rockScale: number };
  density?: number;
  buildingScale?: number;
  sky?: string;
  petals?: boolean;
  snow?: boolean;
  snowGear?: boolean;
  grandstands?: boolean;
  armco?: boolean;
  /** white and red kerbs give way to flag green and yellow through the
   *  corners, and the tight ones get a painted gravel apron behind them */
  flagKerbs?: boolean;
  /** a line of tyres along each lakeshore the circuit runs close to */
  shoreBarriers?: boolean;
  /** the tree scatter gathers into groves instead of even noise */
  groves?: boolean;
  /** mown grass in broad diagonal bands, under the lake and road paint */
  mown?: boolean;
  /** rust-red laterite blotches through the infield grass */
  redEarth?: boolean;
  ferris?: { x: number; z: number; rot: number; scale: number };
  /** a fairground carousel standing in the middle of the corner named for it */
  carousel?: { x: number; z: number; rot: number; scale: number };
  torii?: { x: number; z: number; rot: number; scale: number };
  pagoda?: { x: number; z: number; rot: number; scale: number };
  pondBridge?: boolean;
  fuji?: { x: number; z: number; scale: number };
  overpass?: boolean;
  /** where the planting, the rows and the empty ground go */
  dressing?: Dressing;
  /** reeds and a foam line at the waterline of every lake on the map */
  shoreReeds?: boolean;
  /** saltmarsh: reed belts and pale salt pans spread out from the water */
  marsh?: boolean;
  /** desert wind ripples combed through the sand, all one way */
  windRipples?: boolean;
  /** desert: a broad dark verge of compacted dirt flanks the road, so the dust
   *  the cars kick up reads against the sand instead of vanishing into it */
  dustVerge?: boolean;
  /** a timber jetty out over the lake */
  jetty?: { x: number; z: number; rot: number; len: number };
  /** flat-topped rock plateaus standing out in the desert */
  mesas?: { x: number; z: number; r: number; h: number; rot: number }[];
  /** saguaro cactus families */
  cacti?: { x: number; z: number; rot: number; scale: number }[];
  /** saltmarsh: a working quay of creosote mooring posts with cream caps
   *  marching through the shallows of the lake shore the circuit runs beside */
  pylonWall?: boolean;
  /** tyre-wall lines that close a gap between two branches of the circuit, as
   *  centreline points (x1, z1, x2, z2); the wall stops short of both roads */
  fences?: [number, number, number, number][];
}

function figure8(rx: number, rz: number, n = 64, phase = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = phase + (i / n) * Math.PI * 2;
    pts.push([rx * Math.sin(t), rz * Math.sin(2 * t)]);
  }
  return pts;
}

export const MAPS: MapDef[] = [
  {
    id: 'coast', name: 'Saltmarsh Coast', roadHalf: 4.4,
    ctrl: [
      [-51.4, 18.6], [-59.0, 26.3], [-61.8, 36.7], [-59.0, 47.1], [-51.4, 54.7],
      [-41.0, 57.5], [-25.4, 57.5], [-9.8, 57.5], [5.9, 57.5], [21.4, 57.5], [31.2, 57.5],
      [42.2, 55.1], [51.2, 48.1], [57.9, 40.3], [61.0, 29.4], [61.4, 18.1],
      [60.1, -5.2], [55.9, -18.2], [44.9, -26.3], [31.2, -26.3], [20.2, -18.2],
      [15.9, -5.2], [12.3, 7.8], [2.9, 17.3], [-10.1, 20.8],
      [-20.8, 20.4], [-31.9, 16.4], [-41.0, 15.9]],
    palette: {
      grass: '#4f7c46', tones: ['#5b8c4e', '#3d6636', '#6fa05d', '#33582f', '#7fb367'],
      bladeA: '#8cc274', bladeB: '#356031',
      sand: '#c9bd8b', water: '#2f6f86', waterLt: 'rgba(96,170,186,0.55)',
      shoulder: '#6b6350', asphalt: '#43434b', grainA: '#6a6a76', grainB: '#2b2b33',
      line: 'rgba(232,226,206,0.85)', kerbA: '#d8d2bc', kerbB: '#c8463c',
    },
    lake: { x: 34, z: -38.5, rx: 14, rz: 8 },
    trees: 'mixed', density: 1,
    props: { trees: 280, rocks: 58, buildings: 15, lampStride: 58, rockScale: 1 },
    /* The coast is a fishing hamlet on the water and a pine ridge behind it, and
       then a great deal of nothing: salt flat to the west and south, open marsh
       north. The village sits on the far shore of the lake so the top corner
       looks across the water at it, and the pines start behind the rooftops. */
    town: [
      [18, -49], [27, -47], [36, -49], [45, -46],
      [21, -57], [30, -58], [39, -56], [46, -55],
      [24, -64], [33, -65], [42, -63],
    ],
    dressing: {
      rows: [
        // a pine line down the outside of the pit straight, the only grandstand
        // the circuit has: it frames the run to the line
        { near: [60, 6], metres: 96, side: 1, offset: 10, step: 7.5 },
        // and a deeper rank behind it, so the straight reads as an avenue
        { near: [60, 8], metres: 96, side: 1, offset: 16.5, step: 11 },
        // palms along the beach where the top corner meets the water
        { near: [46, -22], metres: 34, side: -1, offset: 8, step: 6, palm: true },
        // the pine wall on the outside of the carousel, behind the tyres: the
        // bowl the pylon quay closes
        { near: [31, -26], metres: 46, side: 1, offset: 9.5, step: 7 },
        // palms up the sandy rise on the exit of the carousel, pines behind them
        { near: [19, -12], metres: 22, side: -1, offset: 8, step: 6.5, palm: true },
        // a windbreak behind the far side of the bottom straight: two ranks of
        // grown pines, thick enough to read as a wall from the racing line
        { near: [-6, 58], metres: 110, side: -1, offset: 12, step: 6.5, scale: 1.2 },
        { near: [-6, 58], metres: 110, side: -1, offset: 17.5, step: 9, scale: 1.1 },
      ],
      groves: [
        { x: 30, z: -63, r: 15, n: 20 },                       // the ridge behind the village
        { x: 58, z: -55, r: 12, n: 12 },                       // north-east treeline
        { x: 6, z: -58, r: 13, n: 14 },                        // north-west shoulder
        { x: 70, z: -12, r: 8, n: 7 },                         // the point past the pits
        { x: 74, z: 26, r: 11, n: 10 },                        // the east wood
        { x: 70, z: 62, r: 12, n: 12 },                        // closes the south-east corner
        { x: -76, z: 44, r: 11, n: 11 },                       // the west treeline
        { x: -74, z: -46, r: 9, n: 9 },                        // and its north end
        { x: -8, z: -34, r: 9, n: 8 },                         // west of the lake
        { x: 12, z: -44, r: 8, n: 6, palm: true, scale: 1.05 },  // west beach palms
        { x: 57, z: -31, r: 5, n: 5, palm: true },              // the east beach
        { x: 4, z: -18, r: 6, n: 6 },                          // pines behind the exit palms
      ],
      beds: [
        { x: 20, z: -30, r: 7, n: 6, scale: 1.4 },   // the boulders the shore is made of
        { x: 8, z: 40, r: 8, n: 5, scale: 1.2 },
        { x: -34, z: 62, r: 9, n: 5 },
        { x: 76, z: -40, r: 7, n: 4, scale: 1.6 },
      ],
      /* The salt flat is the composition: a wide plain of pan and reed that the
         circuit curls around, deliberately bare of trees. */
      open: [
        { x: -44, z: 26, r: 32 },
        { x: -66, z: -24, r: 20 },
        { x: -30, z: -66, r: 16 },
        { x: 30, z: 40, r: 14 },
      ],
    },
    jetty: { x: 38, z: -44.5, rot: -0.52, len: 9 },
    shoreReeds: true,
    marsh: true,
    pylonWall: true,
  },
  {
    id: 'alpine', name: 'Frostbite Pass', roadHalf: 4.2, smooth: true,
    ctrl: [
      [-50, 4], [-40, 22], [-20, 36], [4, 42], [28, 38], [46, 28], [58, 10],
      [58, -10], [50, -30], [34, -44], [12, -50],
      [-8, -48], [-14, -43], [-15, -36], [-10, -31], [0, -29], [10, -29],
      [19, -28], [26, -24], [29, -19], [28, -15], [21, -12], [9, -11],
      [-3, -11], [-15, -12], [-23, -14], [-27, -15], [-36, -19], [-44, -24],
      [-49, -18], [-52, -8],
    ],
    palette: {
      grass: '#dfe6ea', tones: ['#eef3f6', '#c9d5dc', '#f7fafc', '#b6c6d0', '#ffffff'],
      bladeA: '#ffffff', bladeB: '#a9bcc8',
      sand: '#b9c6cd', water: '#8fc9dc', waterLt: 'rgba(205,240,248,0.65)',
      shoulder: '#93a2ab', asphalt: '#4a4f57', grainA: '#737a84', grainB: '#2f333a',
      line: 'rgba(250,252,255,0.85)', kerbA: '#f2f6f8', kerbB: '#3f6fb0',
    },
    lake: { x: 2, z: 8, rx: 10, rz: 7 },
    trees: 'pine', density: 1.0, tint: '#f3fbff', snow: true, snowGear: true,
    props: { trees: 230, rocks: 44, buildings: 0, lampStride: 46, rockScale: 1.2 },
    // Frostbite Pass doubles back on itself three times: 18.2 m, 20.4 m and
    // 28.6 m apart. A car can cross a gap up to twice the off-road tolerance
    // (2 x 18.2 m) without ever leaving the road's shadow, and each crossing
    // skips 71 m to 152 m of the lap, so tyre walls close all three
    fences: [
      [-1.6, -29.2, -3.1, -11],
      [24.7, -47.6, 18.3, -28.2],
      [57.4, -12.6, 29.1, -16.9],
    ],
    town: [],
    sky: '#cfe4f2',
    /* Frostbite is a pass between two walls of pine. The trees answer the
       corners, not the tarmac: a dense cluster stands at every bend entry and
       on the outside of every wall, the straights are left open so the road
       reads, and the frozen lake gets a pine crescent on its far rim so the
       ice is framed like a picture instead of sitting in dead ground. The
       high ground stays open snow, because an open snowfield is what the map
       is. */
    dressing: {
      rows: [
        // the north sweep, clustered at the two bend entries, gap on the straight
        { near: [-14, 39], metres: 26, side: -1, offset: 8.5, step: 5 },
        { near: [38, 34], metres: 26, side: -1, offset: 8.5, step: 5 },
        // the east wall: two overlapping lines so it reads as a wall, not a dotted row
        { near: [57, 6], metres: 54, side: -1, offset: 9, step: 5.5 },
        { near: [55, 2], metres: 44, side: -1, offset: 12.5, step: 6.5 },
        // the west corner and the run down to it
        { near: [-49, 3], metres: 22, side: -1, offset: 8, step: 5 },
        { near: [-40, 22], metres: 44, side: -1, offset: 8, step: 6 },
        // the top hairpin, both ends of it
        { near: [34, -44], metres: 48, side: -1, offset: 9, step: 6.5 },
        { near: [46, -34], metres: 20, side: -1, offset: 8.5, step: 5 },
        // the switchback wall with its entry
        { near: [-24, -46], metres: 54, side: -1, offset: 8.5, step: 6 },
        { near: [-6, -49], metres: 18, side: -1, offset: 8.5, step: 5 },
        // the inner chicane, trees on the outside of each flick
        { near: [10, -32], metres: 20, side: -1, offset: 8, step: 5 },
        { near: [32, -21], metres: 18, side: -1, offset: 8, step: 5 },
        // the lake straight runs open: the pines are on the far rim of the
        // lake, in the crescent below, not marching along the road
      ],
      groves: [
        { x: 6, z: -62, r: 16, n: 22 },      // the wood in the south bowl
        { x: 18, z: -70, r: 11, n: 12 },     // its far edge, clear of the lift
        { x: -66, z: 16, r: 13, n: 14 },     // the west wood
        { x: 14, z: 62, r: 14, n: 16 },      // the run-out
        { x: 24, z: 20, r: 7, n: 8 },        // the pocket inside the last switchback
        { x: -6, z: -24, r: 6, n: 6 },       // a stand between the folds
        { x: 34, z: 24, r: 8, n: 11 },       // the north-east pocket
        { x: -20, z: -32, r: 8, n: 9 },      // the fold west of the switchbacks
        { x: -58, z: -30, r: 9, n: 12 },     // the wood behind the last corner
        { x: 26, z: -6, r: 7, n: 9 },        // the mid-field pocket east of the lake
        { x: -32, z: 12, r: 8, n: 8 },       // the open ground west of the lake
        { x: -24, z: 34, r: 7, n: 8 },       // the stand between the west and north sweeps
        { x: -38, z: 38, r: 7, n: 8 },       // closes the north-west quarter
        // the pine crescent on the lake's far rim: dense at the flanks, a thin
        // line of tall ones behind the middle so the ice keeps its sightline
        { x: -17, z: 16, r: 5.5, n: 9 },      // west flank of the crescent, behind the ice camp
        { x: 16, z: 13, r: 6.5, n: 10 },
        { x: -3, z: 18, r: 5, n: 4, scale: 1.15 },
        { x: 18, z: 4, r: 5, n: 6 },
        { x: -15, z: 5, r: 4.5, n: 5 },
      ],
      beds: [
        { x: -2, z: -20, r: 7, n: 5, scale: 1.5 },   // boulders at the switchback
        { x: 20, z: 2, r: 8, n: 6, scale: 1.3 },
        { x: -50, z: 2, r: 6, n: 4, scale: 1.4 },
        { x: 52, z: -34, r: 7, n: 5, scale: 1.6 },
        { x: -34, z: -24, r: 6, n: 4, scale: 1.3 },  // rocks in the west fold
      ],
      open: [
        { x: -38, z: -66, r: 18 },    // the high snowfield, nothing on it
        { x: 64, z: 46, r: 16 },
        { x: -30, z: 56, r: 14 },
      ],
    },
  },
  {
    id: 'sakura', name: 'Sakura Circuit', roadHalf: 4.2, smooth: true,
    ctrl: figure8(58, 38, 72, 0.35),
    palette: {
      grass: '#315b42', tones: ['#3c6e4e', '#244632', '#4c825f', '#1b3727', '#5d9572'],
      bladeA: '#7fb38a', bladeB: '#1c3a29',
      sand: '#b9b08c', water: '#2b6f72', waterLt: 'rgba(110,190,185,0.5)',
      shoulder: '#6b6653', asphalt: '#41434a', grainA: '#646671', grainB: '#282a30',
      line: 'rgba(248,246,232,0.88)', kerbA: '#f2eee2', kerbB: '#c8463c',
    },
    lake: { x: 0, z: -30, rx: 10, rz: 7 },
    trees: 'sakura', density: 1.15, tint: '#ffe2ef', petals: true,
    props: { trees: 190, rocks: 38, buildings: 0, lampStride: 42, rockScale: 1.1 },
    town: [],
    sky: '#9fbea7',
    ferris: { x: -30, z: 0, rot: 0.2, scale: 1.15 },
    torii: { x: 28, z: 0, rot: Math.PI / 2, scale: 1.1 },
    pagoda: { x: 0, z: 30, rot: 0, scale: 0.8 },
    pondBridge: true,
    overpass: true,
    shoreReeds: true,
    /* The figure eight leaves four wide corners off the track and a clearing
       round the pond. The blossom grows in groves in the four corners and along
       the two straights that feed the crossing, so the infield stays open lawn
       and the pond keeps its petalled shore clear. */
    dressing: {
      rows: [
        { near: [-40, -18], metres: 54, side: 1, offset: 9, step: 7 },
        { near: [40, 18], metres: 54, side: -1, offset: 9, step: 7 },
        { near: [6, -34], metres: 40, side: -1, offset: 10, step: 7.5 },
      ],
      groves: [
        { x: -58, z: -42, r: 12, n: 14 },
        { x: 58, z: -42, r: 12, n: 14 },
        { x: -58, z: 42, r: 12, n: 14 },
        { x: 58, z: 42, r: 13, n: 15 },
        { x: -34, z: 14, r: 9, n: 10 },
        { x: 34, z: -14, r: 9, n: 10 },
        { x: 2, z: -62, r: 10, n: 11 },
        { x: -4, z: 62, r: 10, n: 11 },
      ],
      beds: [
        { x: 22, z: -18, r: 6, n: 4, scale: 1.3 },
        { x: -20, z: 24, r: 6, n: 4 },
        { x: 62, z: 16, r: 5, n: 3, scale: 1.1 },
      ],
      open: [
        { x: 0, z: -30, r: 17 },    // the pond and its shore
        { x: -16, z: 6, r: 12 },    // the infield of the crossing
      ],
    },
  },
  {
    id: 'mesa', name: 'Mirage Mesa', roadHalf: 3.4, smooth: true,
    // A desert serpentine with room to breathe: four lanes 21.7 m apart, one
    // shallow rounded gate per lane (a ~55 m run-up per swing, so the gates
    // flow instead of pinching), two hairpins at the east end and a single 15 m
    // carousel closing the loop down the west edge, 401 m around. Every
    // non-adjacent part of the loop stays 18 m clear, where the six-lane layout
    // this replaced closed to 8 m at the hairpin bulges and read as crossovers.
    // The half width stays 3.4: 18 m of clearance still leaves 11 m of open
    // ground between lane edges, and a wider road would spend it.
    ctrl: [
      [4.36, -33.49], [10.34, -33.37], [13.32, -33.1], [19.3, -32.64], [25.28, -32.54], [28.52, -32.04],
      [31.47, -30.59], [33.85, -28.33], [35.45, -25.46], [36.11, -22.24], [35.78, -18.97], [34.48, -15.95],
      [32.34, -13.46], [29.55, -11.72], [26.37, -10.9], [22.35, -10.95], [19.42, -11.57], [16.49, -12.77],
      [10.64, -14.66], [7.71, -13.97], [4.78, -12.05], [1.85, -9.64], [-1.07, -7.72], [-6.93, -7.62],
      [-9.86, -8.92], [-15.71, -10.74], [-20.82, -10.62], [-23.9, -9.48], [-26.5, -7.47], [-28.38, -4.78],
      [-29.36, -1.64], [-29.36, 1.64], [-28.38, 4.78], [-26.5, 7.47], [-23.9, 9.48], [-20.82, 10.62],
      [-18.64, 10.85], [-12.78, 11.3], [-9.86, 12.05], [-4, 13.22], [-1.07, 12.79], [1.85, 11.6],
      [4.78, 10.09], [10.64, 8.47], [13.57, 8.83], [16.49, 9.64], [22.35, 10.78], [27.46, 11.07],
      [30.54, 12.21], [33.14, 14.22], [35.01, 16.91], [36, 20.05], [36, 23.33], [35.01, 26.47],
      [33.14, 29.16], [30.54, 31.17], [27.46, 32.31], [25.28, 32.54], [19.3, 32.3], [16.31, 31.84],
      [13.32, 31.2], [10.34, 30.57], [4.36, 30.29], [1.37, 30.9], [-1.62, 31.94], [-4.6, 33.13],
      [-7.59, 34.17], [-13.57, 34.88], [-16.56, 34.5], [-19.54, 33.87], [-22.53, 33.23], [-28.51, 32.57],
      [-33.75, 32.54], [-37.52, 32.46], [-40.48, 31.87], [-43.27, 30.72], [-45.79, 29.04], [-47.92, 26.9],
      [-49.6, 24.39], [-50.76, 21.6], [-51.35, 18.63], [-51.42, 17.12], [-51.42, 14.01], [-51.42, 10.9],
      [-51.42, 7.78], [-51.42, 4.67], [-51.42, 1.56], [-51.42, -1.56], [-51.42, -4.67], [-51.42, -7.78],
      [-51.42, -10.9], [-51.42, -14.01], [-51.35, -18.63], [-50.76, -21.6], [-49.6, -24.39], [-47.92, -26.9],
      [-45.79, -29.04], [-43.27, -30.72], [-40.48, -31.87], [-37.52, -32.46], [-33.75, -32.54], [-28.51, -32.52],
      [-22.53, -32.24], [-19.54, -31.97], [-13.57, -31.55], [-7.59, -31.85], [-4.6, -32.28],
    ],
    palette: {
      grass: '#c2a06a', tones: ['#cdad74', '#b08f5c', '#dcc191', '#9c7c4e', '#e6cfa2'],
      bladeA: '#d8c48d', bladeB: '#a8823f',
      sand: '#e0c894', water: '#3f8fa0', waterLt: 'rgba(120,190,190,0.5)',
      shoulder: '#8d7448', asphalt: '#4a4640', grainA: '#6f6759', grainB: '#2f2b26',
      line: 'rgba(240,232,206,0.85)', kerbA: '#e8d7ab', kerbB: '#b4553a',
    },
    trees: 'palm', density: 0.9, windRipples: true, dustVerge: true,
    props: { trees: 170, rocks: 76, buildings: 0, lampStride: 52, rockScale: 1.4 },
    town: [],
    sky: '#e8c49a',
    /* Mirage Mesa is composed as three theatres. The grand carousel: the
       fairground carousel turns on the grass at the centre of the corner named
       for it, a hoarding arc and two ranks of palms wrap the outside, and the
       kerb climbs terracotta through the entry. The start straight is a palm
       allee, two ranks on the desert side and one in the corridor it shares
       with the back lane, so the run to the line is shaded the whole way. The
       lane-2 flick is fenced with oil drums, a slalom the drift reads against.
       The buttes stand on the horizon the circuit turns around, never on the
       racing surface, and the desert beyond the theatre stays bare. */
    mesas: [
      { x: -72, z: -34, r: 17, h: 7, rot: 0.3 },
      { x: 62, z: -56, r: 12, h: 5.5, rot: 0.9 },
      { x: -46, z: 58, r: 11, h: 4.5, rot: -0.4 },
      { x: 66, z: 34, r: 9, h: 4, rot: 0.2 },
    ],
    // the fair at the centre of the carousel corner: the corner the map is
    // read from, and the landmark the corner is named for
    carousel: { x: -34.3, z: 15.1, rot: 0.3, scale: 1.15 },
    cacti: [
      { x: -62, z: 6, rot: 0.4, scale: 1.15 },
      { x: -60, z: -2, rot: 2.1, scale: 0.9 },
      { x: -64, z: -1, rot: 1.2, scale: 1.35 },
      { x: -58, z: 8, rot: 3.4, scale: 0.8 },
      { x: -65, z: 9, rot: 0.9, scale: 1.05 },
      { x: 30, z: 40, rot: 1.7, scale: 1.1 },
      { x: 35, z: 43, rot: 0.2, scale: 0.85 },
      { x: 39, z: 38, rot: 2.6, scale: 1.25 },
      { x: 26, z: 44, rot: 3.9, scale: 0.95 },
      { x: 6, z: -48, rot: 0.7, scale: 1.2 },
      { x: 12, z: -52, rot: 2.9, scale: 0.9 },
      { x: 1, z: -54, rot: 1.4, scale: 1.05 },
      { x: 56, z: -4, rot: 2.2, scale: 1.0 },
      { x: 60, z: 2, rot: 0.5, scale: 0.8 },
    ],
    dressing: {
      rows: [
        // the allee on the start straight: two ranks marching down the desert
        // side, the deeper one taller so the avenue reads in depth
        { near: [-4, -32], metres: 52, side: 1, offset: 9, step: 8, palm: true, scale: 1.05 },
        { near: [-4, -32], metres: 52, side: 1, offset: 15, step: 12, palm: true, scale: 1.2 },
        // and a single rank in the corridor behind it, shared with lane 2
        { near: [-4, -32], metres: 46, side: -1, offset: 9, step: 11, palm: true, scale: 0.95 },
        // palms through the corridor the top lane shares with lane 3, the
        // approach to the carousel, ending before the corner so the theatre
        // reads as its own event
        { near: [4, 32], metres: 76, side: -1, offset: 10, step: 9, palm: true },
        // the theatre: a knot at the carousel entry, then the crescent that
        // wraps the outside of the corner in two ranks behind the hoardings
        { near: [-24, 33.5], metres: 18, side: 1, offset: 8.5, step: 6, palm: true, scale: 1.15 },
        { near: [-50.5, 17], metres: 40, side: 1, offset: 7.5, step: 6.5, palm: true, scale: 1.1 },
        { near: [-49, 19], metres: 46, side: 1, offset: 13, step: 9, palm: true, scale: 1.25 },
      ],
      groves: [
        { x: -14, z: -52, r: 8, n: 9, palm: true },    // the oasis the allee runs at
        { x: 16, z: -46, r: 5, n: 5, palm: true },
        { x: 44, z: -20, r: 6, n: 6, palm: true },     // and shade on the east hairpin
        { x: -44, z: 50, r: 7, n: 7, palm: true },     // the grove behind the theatre
      ],
      beds: [
        { x: -20, z: -30, r: 9, n: 9, scale: 1.7 },    // the rock garden in the allee corridor
        { x: 44, z: -8, r: 10, n: 8, scale: 1.5 },
        { x: -54, z: 22, r: 8, n: 6, scale: 1.9 },     // the big slabs at the carousel exit
        { x: 12, z: 52, r: 9, n: 6, scale: 1.4 },
      ],
      open: [
        { x: -78, z: 46, r: 14 },     // bare desert beyond the theatre, the mesa's own floor
        { x: 24, z: -66, r: 16 },
        { x: 0, z: 6, r: 14 },        // the middle of the loop stays clean
      ],
    },
  },
  {
    id: 'interlagos', name: 'Interlagos', roadHalf: 3.4, smooth: true,
    // The real Autódromo José Carlos Pace, from OpenStreetMap ways: 4.29 km of
    // survey centreline assembled, smoothed and fitted to 160 control points
    // (0.97 units of reproduction error), scaled to a 1.59 km lap and turned
    // into its own 400-unit playfield so the genuine shape survives at the
    // game's road width. Every non-adjacent stretch stays 18.97 m clear,
    // including the Ferradura and Pinheirinho folds, which is why the four
    // tightest ones were opened by 4-5 units as the survey points came in.
    // The circuit sits between two lakes: a long one inside the loop and a
    // small one beside the Descida do Lago, with the palms and the stands of
    // a São Paulo park circuit around it.
    world: 400,
    ctrl: [
      [-118.34, 69.83], [-119.11, 59.96], [-120.72, 50.12], [-121.73, 40.20], [-121.75, 30.24], [-120.50, 20.35], [-118.79, 10.53],
      [-116.71, 0.77], [-114.44, -8.93], [-114.21, -18.88], [-113.78, -28.81], [-110.93, -38.36], [-108.06, -47.91], [-105.30, -57.49],
      [-102.64, -67.10], [-100.08, -76.74], [-97.54, -86.38], [-95.00, -96.03], [-92.47, -105.67], [-89.93, -115.31], [-87.39, -124.96],
      [-84.85, -134.60], [-82.31, -144.25], [-79.77, -153.89], [-77.23, -163.53], [-74.69, -173.18], [-71.97, -182.77], [-64.77, -188.99],
      [-55.61, -185.43], [-47.11, -180.25], [-40.05, -173.25], [-32.72, -166.52], [-23.20, -165.56], [-14.57, -170.54], [-6.10, -175.80],
      [2.81, -180.20], [12.51, -182.35], [22.46, -182.14], [32.08, -179.61], [40.77, -174.79], [48.02, -167.98], [53.50, -159.69],
      [59.72, -152.21], [68.16, -147.13], [72.35, -138.92], [75.78, -129.66], [80.94, -121.13], [86.11, -112.60], [91.29, -104.08],
      [95.56, -95.22], [97.20, -85.38], [98.84, -75.54], [92.30, -68.07], [88.04, -59.91], [89.96, -50.13], [92.55, -40.49],
      [95.13, -30.86], [97.71, -21.23], [100.29, -11.60], [102.88, -1.97], [105.51, 7.65], [108.13, 17.27], [110.75, 26.90],
      [113.46, 36.49], [116.18, 46.09], [118.90, 55.68], [121.48, 65.31], [121.02, 75.16], [115.36, 83.09], [106.10, 86.55],
      [96.31, 88.42], [86.48, 90.13], [76.63, 91.65], [66.69, 91.92], [56.94, 89.95], [47.91, 85.78], [40.00, 79.74],
      [33.27, 72.39], [27.15, 64.52], [21.23, 56.50], [15.36, 48.43], [9.52, 40.36], [3.67, 32.28], [-2.16, 24.18],
      [-8.03, 16.12], [-13.96, 8.11], [-19.85, 0.06], [-25.74, -7.98], [-31.64, -16.03], [-37.01, -24.42], [-42.06, -33.02],
      [-50.55, -37.84], [-59.68, -41.60], [-69.07, -38.24], [-77.67, -33.68], [-84.00, -25.98], [-89.22, -17.60], [-92.94, -8.35],
      [-97.11, 0.65], [-98.62, 10.51], [-100.47, 20.31], [-101.90, 30.17], [-100.38, 39.79], [-91.75, 43.85], [-82.82, 39.71],
      [-74.78, 33.85], [-65.15, 31.91], [-56.20, 35.95], [-51.07, 44.34], [-51.80, 54.13], [-57.87, 61.96], [-64.98, 68.95],
      [-71.95, 76.09], [-78.43, 83.66], [-83.20, 92.38], [-85.60, 102.06], [-87.56, 111.83], [-88.07, 121.71], [-81.36, 128.52],
      [-72.48, 125.54], [-65.70, 118.23], [-59.19, 110.68], [-52.52, 103.26], [-45.09, 96.67], [-36.21, 92.19], [-26.45, 90.33],
      [-16.51, 90.65], [-7.04, 93.70], [1.22, 99.22], [7.73, 106.73], [13.22, 115.05], [18.56, 123.47], [23.87, 131.91],
      [29.15, 140.37], [34.43, 148.83], [39.53, 157.40], [42.60, 166.64], [37.13, 174.50], [28.11, 178.72], [18.79, 182.25],
      [9.40, 185.63], [-0.08, 188.70], [-9.99, 188.38], [-19.84, 186.80], [-29.65, 184.99], [-39.33, 182.68], [-48.66, 179.15],
      [-57.75, 175.05], [-66.77, 170.80], [-75.59, 166.16], [-83.82, 160.53], [-91.37, 154.04], [-97.76, 146.42], [-102.69, 137.77],
      [-105.94, 128.35], [-108.35, 118.68], [-110.43, 108.92], [-112.24, 99.12], [-114.10, 89.32], [-116.13, 79.56],
    ],
    palette: {
      grass: '#557a3a', tones: ['#608549', '#476b35', '#759a53', '#3a5b2c', '#8aad60'],
      bladeA: '#a9c76b', bladeB: '#36542c',
      sand: '#e0cb9a', water: '#1f6d84', waterLt: 'rgba(138,214,220,0.52)',
      shoulder: '#7c6a4e', asphalt: '#43444c', grainA: '#6c6d77', grainB: '#2c2d34',
      line: 'rgba(240,236,216,0.86)', kerbA: '#f2eee4', kerbB: '#c8463c',
    },
    // Three lakes, all of them close enough to the road to be seen from a
    // corner: the big one inside the loop, one on the inside of the last two
    // corners and one on the outside of the Senna S run out. Interlagos means
    // "between the lakes" and the ground should say so.
    lakes: [
      { x: -26, z: -106, rx: 48, rz: 32 },
      { x: 62, z: -88, rx: 26, rz: 17 },
      { x: 104, z: 118, rx: 28, rz: 21 },
    ],
    trees: 'palm', density: 1.05, tint: '#ffeccb',
    props: { trees: 1120, rocks: 300, buildings: 8, lampStride: 20, rockScale: 1.2 },
    // the pit block on the inside of the main straight, facing the stands
    town: [
      [84.5, -26.2], [88.1, -12.5], [91.8, 1.3], [95.6, 14.9],
      [99.3, 28.7], [103.2, 42.4], [107.1, 56.2], [110.1, 66.3],
    ],
    // late afternoon in São Paulo: the sun is low and warm and the haze takes
    // the edge off the green
    sky: '#e9a173',
    grandstands: true,
    armco: true,
    flagKerbs: true,
    shoreBarriers: true,
    groves: true,
    mown: true,
    redEarth: true,
    /* The palm rows are the one thing this circuit is known by from the air, so
       they are placed by hand along the main straight and the run out of the
       Senna S rather than left to the grove scatter. The park between the
       lakes stays the open lawn the grove pass already gives it. */
    dressing: {
      rows: [
        { near: [121, 20], metres: 150, side: -1, offset: 11, step: 9, palm: true },
        { near: [121, 20], metres: 150, side: 1, offset: 11, step: 9, palm: true },
        { near: [-100, 116], metres: 90, side: 1, offset: 10, step: 9, palm: true },
      ],
      open: [
        { x: -26, z: -60, r: 34 },     // the infield lawn inside the loop
        { x: 30, z: 60, r: 26 },
      ],
    },
  },
];

// Fill long polygon edges with points so roadAt/minimap see the whole straight.
function densify(pts: P2[], maxStep = 0.55): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / maxStep));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function sampleTrack(ctrl: [number, number][], smooth = true): P2[] {
  if (smooth) {
    const curve = new THREE.CatmullRomCurve3(
      ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5,
    );
    return curve.getPoints(900).map((p) => ({ x: p.x, z: p.z }));
  }
  // Polygon with filleted corners: keeps the hard layout while giving the
  // kerb offset a radius to work with.
  const n = ctrl.length;
  const r = 4.5;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = ctrl[(i - 1 + n) % n], b = ctrl[i], c = ctrl[(i + 1) % n];
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const p1 = { x: b[0] + ((a[0] - b[0]) / la) * r, z: b[1] + ((a[1] - b[1]) / la) * r };
    const p2 = { x: b[0] + ((c[0] - b[0]) / lc) * r, z: b[1] + ((c[1] - b[1]) / lc) * r };
    out.push(p1);
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      out.push({
        x: u * u * p1.x + 2 * u * t * b[0] + t * t * p2.x,
        z: u * u * p1.z + 2 * u * t * b[1] + t * t * p2.z,
      });
    }
  }
  return densify(out);
}

// Pick the straightest stretch, away from self-crossings, for the start line.
function straightestIndex(track: P2[], minOriginDist = 0): number {
  const n = track.length;
  const win = n > 300 ? 16 : 4;
  const avoid = Math.max(24, Math.round(n * 0.08));
  let best = Math.floor(n / 3), bestScore = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const b = track[i];
    if (Math.hypot(b.x, b.z) < minOriginDist) continue;
    const a = track[(i - win + n) % n];
    const c = track[(i + win) % n];
    const v1x = b.x - a.x, v1z = b.z - a.z;
    const v2x = c.x - b.x, v2z = c.z - b.z;
    const l1 = Math.hypot(v1x, v1z) || 1, l2 = Math.hypot(v2x, v2z) || 1;
    const dot = (v1x * v2x + v1z * v2z) / (l1 * l2);
    const span = Math.hypot(c.x - a.x, c.z - a.z);
    const score = dot * 100 + span;
    if (score <= bestScore) continue;
    let crossing = false;
    for (let k = 0; k < n; k += 4) {
      if (Math.abs(k - i) < avoid) continue;
      const p = track[k];
      if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 < 14 * 14) { crossing = true; break; }
    }
    if (crossing) continue;
    bestScore = score;
    best = i;
  }
  return best;
}

function offsetPath(pts: P2[], dist: number): P2[] {
  return pts.map((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dz / len) * dist, z: p.z - (dx / len) * dist };
  });
}

/** Signed turn at a centreline point: positive turns one way, negative the
 *  other, and the sign is what picks the outside of a corner. */
function curvature(track: P2[], i: number): number {
  const n = track.length;
  const a = track[(i - 8 + n) % n], b = track[i], c = track[(i + 8) % n];
  const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
  const l1 = Math.hypot(v1x, v1z) || 1, l2 = Math.hypot(v2x, v2z) || 1;
  return (v1x * v2z - v1z * v2x) / (l1 * l2);
}

/** A point `dist` metres off the centreline at `i`, positive to the left. */
function edgeAt(track: P2[], i: number, dist: number): P2 {
  const n = track.length;
  const a = track[(i - 3 + n) % n], b = track[(i + 3) % n];
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: track[i].x + (dz / len) * dist, z: track[i].z - (dx / len) * dist };
}

function strokePath(ctx: CanvasRenderingContext2D, pts: P2[], color: string, width: number,
  close = true) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = (p.x + HALF_G) * PPU, y = (p.z + HALF_G) * PPU;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  if (close) ctx.closePath();
  ctx.stroke();
}

function dotted(ctx: CanvasRenderingContext2D, pts: P2[], color: string, width: number, on: number, off: number,
  close = true) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([on, off]);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = (p.x + HALF_G) * PPU, y = (p.z + HALF_G) * PPU;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  if (close) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function paintGround(track: P2[], map: MapDef): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const g = cv.getContext('2d')!;

  const rnd = mulberry(1337);
  // a map with several water bodies, or one that asks for a coast, gets the
  // shoreline pass; every other map with a single lake keeps the flat disc
  const shoreDetail = (map.lakes?.length ?? 0) > 0 || !!map.shoreReeds;

  g.fillStyle = map.palette.grass;
  g.fillRect(0, 0, PX, PX);

  const tones = map.palette.tones;
  for (let i = 0; i < 42000; i++) {
    const x = (rnd() * PX) | 0, y = (rnd() * PX) | 0;
    g.fillStyle = tones[(rnd() * tones.length) | 0];
    g.globalAlpha = 0.55 + rnd() * 0.45;
    g.fillRect(x, y, 2, 2);
  }
  g.globalAlpha = 1;

  for (let i = 0; i < 3000; i++) {
    const x = (rnd() * PX) | 0, y = (rnd() * PX) | 0;
    g.fillStyle = rnd() > 0.6 ? map.palette.bladeA : map.palette.bladeB;
    g.globalAlpha = 0.6 + rnd() * 0.4;
    g.fillRect(x, y, 1, 2);
  }
  g.globalAlpha = 1;

  /* Mown grass: a park circuit is a kept lawn, and a kept lawn is striped. Two
     tones of broad diagonal band under everything else, which gives a field of
     this size some structure from above. */
  if (map.mown) {
    g.save();
    g.translate(PX / 2, PX / 2);
    g.rotate(0.62);
    const band = 13 * PPU;
    g.fillStyle = 'rgba(28,52,16,0.075)';
    for (let x = -PX; x < PX; x += band * 2) g.fillRect(x, -PX, band, PX * 2);
    g.fillStyle = 'rgba(255,240,190,0.045)';
    for (let x = -PX + band; x < PX; x += band * 2) g.fillRect(x, -PX, band, PX * 2);
    g.restore();
  }

  /* Red earth: the park at Interlagos weeds through to the laterite under it,
     so the infield is green and rust, not green. Broad blotches of iron-red
     clay, kept off the tarmac and out of the lakes. */
  if (map.redEarth) {
    const water = [map.lake, ...(map.lakes ?? [])].filter((l) => !!l);
    const laid: { x: number; z: number }[] = [];
    for (let i = 0; i < 900 && laid.length < 150; i++) {
      const wx = -HALF_G + rnd() * 2 * HALF_G;
      const wz = -HALF_G + rnd() * 2 * HALF_G;
      const rx = (9 + rnd() * 20) * PPU, rz = (6 + rnd() * 12) * PPU;
      // even cover, no clumps: one blotch per neighbourhood, or the near field
      // of the start straight ends up entirely rust
      if (laid.some((p) => Math.hypot(wx - p.x, wz - p.z) < 24)) continue;
      if (water.some((l) => Math.hypot(wx - l!.x, wz - l!.z) < Math.max(l!.rx, l!.rz) + 5)) continue;
      if (track.some((p) => Math.hypot(wx - p.x, wz - p.z) < ROAD_HALF + 5)) continue;
      laid.push({ x: wx, z: wz });
      const cx = (wx + HALF_G) * PPU, cy = (wz + HALF_G) * PPU;
      g.fillStyle = rnd() > 0.5 ? 'rgba(146,64,36,0.15)' : 'rgba(174,88,46,0.12)';
      g.beginPath();
      g.ellipse(cx, cy, rx, rz, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(206,134,84,0.09)';
      g.beginPath();
      g.ellipse(cx + rx * 0.2, cy - rz * 0.25, rx * 0.55, rz * 0.5, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Cherry petals: a soft pink scatter under the blossom trees.
  if (map.petals) {
    for (let i = 0; i < 9000; i++) {
      const x = (rnd() * PX) | 0, y = (rnd() * PX) | 0;
      g.fillStyle = rnd() > 0.45 ? 'rgba(255,196,218,0.55)' : 'rgba(255,225,236,0.45)';
      g.fillRect(x, y, rnd() > 0.6 ? 2 : 1, 1);
    }
    for (let i = 0; i < 180; i++) {
      const cx = rnd() * PX, cy = rnd() * PX;
      for (let k = 0; k < 10; k++) {
        g.fillStyle = rnd() > 0.5 ? 'rgba(255,190,214,0.5)' : 'rgba(255,232,240,0.4)';
        g.fillRect((cx + (rnd() - 0.5) * 20) | 0, (cy + (rnd() - 0.5) * 20) | 0, 1, 1);
      }
    }
  }

  for (let i = 0; i < 420; i++) {
    const cx = rnd() * PX, cy = rnd() * PX;
    for (let k = 0; k < 14; k++) {
      g.fillStyle = rnd() > 0.5 ? map.palette.bladeB : map.palette.bladeA;
      g.globalAlpha = 0.35;
      g.fillRect((cx + (rnd() - 0.5) * 22) | 0, (cy + (rnd() - 0.5) * 22) | 0, 2, 2);
    }
  }
  g.globalAlpha = 1;

  /* Wind ripples. A desert floor is not one flat colour: the wind combs the
     sand into low ridges, and every ridge in a stretch of desert runs the same
     way. Two tones of short stroke at one angle, and the sand reads as sand. */
  if (map.windRipples) {
    g.save();
    g.translate(PX / 2, PX / 2);
    g.rotate(0.52);
    for (let i = 0; i < 1600; i++) {
      const x = (rnd() - 0.5) * PX * 1.5;
      const y = (rnd() - 0.5) * PX * 1.5;
      g.fillStyle = rnd() > 0.5 ? 'rgba(232,210,164,0.28)' : 'rgba(148,116,70,0.20)';
      g.fillRect(x, y, 9 + rnd() * 24, 1);
    }
    g.restore();
  }

  /* Saltmarsh. The water sits in a flat of reed and salt pan instead of in a
     lawn, which is what makes this a coast: pale pans spreading out from the
     lake, reed beds round every rim, and a tide line left a little way back. */
  if (map.marsh && map.lake) {
    const lk = map.lake;
    const lx = (lk.x + HALF_G) * PPU, ly = (lk.z + HALF_G) * PPU;
    const pans: { x: number; y: number; rx: number; ry: number }[] = [];
    const panAt = (px: number, py: number) => {
      if (px < 40 || py < 40 || px > PX - 40 || py > PX - 40) return;
      const rx = (4.5 + rnd() * 9) * PPU, ry = (3 + rnd() * 6) * PPU;
      pans.push({ x: px, y: py, rx, ry });
      g.fillStyle = rnd() > 0.5 ? 'rgba(122,148,96,0.42)' : 'rgba(196,198,150,0.40)';
      g.beginPath();
      g.ellipse(px, py, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    };
    for (let i = 0; i < 140 && pans.length < 24; i++) {
      const a = rnd() * Math.PI * 2;
      const d = lk.rx * (1.2 + rnd() * 1.5);
      panAt(lx + Math.cos(a) * d * PPU, ly + Math.sin(a) * d * 0.8 * PPU);
    }
    /* The ground the map keeps clear of trees is the salt flat, so the flat is
       painted as pan and reed: one broad pale wash per zone carries the plain,
       a scatter of bright salt speckle sits on it, and the pans and their reed
       rings gather on top — an empty quarter that reads as a place, not as
       scattered ovals. */
    if (map.marsh && map.dressing?.open) {
      for (const zone of map.dressing.open) {
        const zx = (zone.x + HALF_G) * PPU, zy = (zone.z + HALF_G) * PPU;
        g.fillStyle = 'rgba(214,212,172,0.42)';
        g.beginPath();
        g.ellipse(zx, zy, zone.r * 0.92 * PPU, zone.r * 0.6 * PPU, rnd() * Math.PI, 0, Math.PI * 2);
        g.fill();
        for (let i = 0; i < zone.r * 9; i++) {
          g.fillStyle = rnd() > 0.5 ? 'rgba(238,236,220,0.5)' : 'rgba(210,208,180,0.42)';
          g.fillRect((zx + (rnd() - 0.5) * zone.r * 1.6 * PPU) | 0,
            (zy + (rnd() - 0.5) * zone.r * 1.05 * PPU) | 0, 1, 1);
        }
        const n = Math.max(6, Math.round(zone.r / 2.4));
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, r = zone.r * Math.sqrt(rnd()) * 0.85;
          panAt((zone.x + Math.cos(a) * r + HALF_G) * PPU,
            (zone.z + Math.sin(a) * r + HALF_G) * PPU);
        }
      }
    }
    const tuft = (x: number, y: number) => {
      const n = 2 + ((rnd() * 4) | 0);
      for (let k = 0; k < n; k++) {
        g.fillStyle = rnd() > 0.4 ? 'rgba(56,90,50,0.8)' : 'rgba(126,154,88,0.75)';
        g.fillRect((x + (rnd() - 0.5) * 7) | 0, (y + (rnd() - 0.5) * 5) | 0, 1,
          2 + ((rnd() * 3) | 0));
      }
    };
    for (let i = 0; i < 1100; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 1 + rnd() * 0.55;
      tuft(lx + Math.cos(a) * lk.rx * r * PPU, ly + Math.sin(a) * lk.rz * r * PPU);
    }
    for (const p of pans) {
      for (let i = 0; i < 34; i++) {
        const a = rnd() * Math.PI * 2;
        tuft(p.x + Math.cos(a) * p.rx * (0.88 + rnd() * 0.22),
          p.y + Math.sin(a) * p.ry * (0.88 + rnd() * 0.22));
      }
    }
    g.strokeStyle = 'rgba(74,92,62,0.32)';
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a0 = rnd() * Math.PI * 2;
      const rad = 1.55 + rnd() * 0.85;
      g.beginPath();
      for (let s = 0; s <= 20; s++) {
        const a = a0 + s * 0.07;
        const x = lx + Math.cos(a) * lk.rx * rad * PPU;
        const y = ly + Math.sin(a) * lk.rz * rad * PPU;
        s ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  }

  /* A street through a village. Buildings standing alone in a field read as
     crates dropped from above; a track between them reads as a place. Every
     building is joined to its two nearest neighbours, so the streets follow the
     layout instead of a hand-drawn line that no longer fits it. */
  if (map.town && map.town.length > 2) {
    const pts = map.town.map(([x, z]) => ({ x: (x + HALF_G) * PPU, y: (z + HALF_G) * PPU }));
    const links = new Set<string>();
    const mToPx = 1 * PPU;
    g.lineCap = 'round';
    for (let i = 0; i < pts.length; i++) {
      const near = pts
        .map((p, j) => ({ j, d: Math.hypot(p.x - pts[i].x, p.y - pts[i].y) }))
        .filter((o) => o.j !== i && o.d < 16 * mToPx)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const { j } of near) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (links.has(key)) continue;
        links.add(key);
        g.strokeStyle = 'rgba(150,132,98,0.55)';
        g.lineWidth = 3.2 * mToPx;
        g.beginPath();
        g.moveTo(pts[i].x, pts[i].y);
        g.lineTo(pts[j].x, pts[j].y);
        g.stroke();
      }
    }
    for (let i = 0; i < 2400; i++) {
      const p = pts[(rnd() * pts.length) | 0];
      g.fillStyle = rnd() > 0.5 ? 'rgba(120,104,74,0.5)' : 'rgba(176,160,124,0.5)';
      g.fillRect((p.x + (rnd() - 0.5) * 26 * mToPx) | 0,
        (p.y + (rnd() - 0.5) * 26 * mToPx) | 0, 1, 1);
    }
    g.lineCap = 'butt';
  }

  for (const lake of [map.lake, ...(map.lakes ?? [])]) {
    if (!lake) continue;
    const lx = (lake.x + HALF_G) * PPU, ly = (lake.z + HALF_G) * PPU;
    g.fillStyle = map.palette.sand;
    g.beginPath();
    g.ellipse(lx, ly, lake.rx * PPU, lake.rz * PPU, 0.35, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = map.palette.water;
    g.beginPath();
    g.ellipse(lx, ly, (lake.rx - 2) * PPU, (lake.rz - 1.8) * PPU, 0.35, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = map.palette.waterLt;
    g.beginPath();
    g.ellipse(lx - 2 * PPU, ly - 1.5 * PPU, lake.rx * 0.55 * PPU, lake.rz * 0.42 * PPU, 0.35, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, r = rnd();
      g.fillStyle = 'rgba(220,245,250,0.45)';
      g.fillRect(lx + Math.cos(a) * lake.rx * 0.8 * PPU * r, ly + Math.sin(a) * lake.rz * 0.7 * PPU * r, 6, 2);
    }

    /* A map with several lakes is read from above and from the bank, so its
       water gets the cues that make it water: a deeper middle, a foam line at
       the waterline, reeds in the shallows and dry sand up the beach. */
    if (shoreDetail) {
      const ca = Math.cos(0.35), sa = Math.sin(0.35);
      const at = (u: number, v: number) => ({
        x: lx + (u * ca - v * sa) * PPU,
        y: ly + (u * sa + v * ca) * PPU,
      });
      g.save();
      g.beginPath();
      g.ellipse(lx, ly, (lake.rx - 2) * PPU, (lake.rz - 1.8) * PPU, 0.35, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = 'rgba(12,44,62,0.26)';
      g.beginPath();
      g.ellipse(lx, ly, (lake.rx - 2) * 0.58 * PPU, (lake.rz - 1.8) * 0.58 * PPU, 0.35, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.strokeStyle = 'rgba(226,246,244,0.42)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.ellipse(lx, ly, (lake.rx - 2) * PPU, (lake.rz - 1.8) * PPU, 0.35, 0, Math.PI * 2);
      g.stroke();
      for (let i = 0; i < 170; i++) {
        const t = rnd() * Math.PI * 2;
        const p = at(Math.cos(t) * (lake.rx - 2) * (0.94 + rnd() * 0.05),
          Math.sin(t) * (lake.rz - 1.8) * (0.94 + rnd() * 0.05));
        g.fillStyle = rnd() > 0.45 ? 'rgba(62,110,60,0.75)' : 'rgba(96,146,78,0.7)';
        g.fillRect(p.x | 0, p.y | 0, 1, rnd() > 0.6 ? 3 : 2);
      }
      for (let i = 0; i < 220; i++) {
        const t = rnd() * Math.PI * 2;
        const p = at(Math.cos(t) * lake.rx * (1 + rnd() * 0.05),
          Math.sin(t) * lake.rz * (1 + rnd() * 0.05));
        g.fillStyle = rnd() > 0.5 ? 'rgba(246,234,200,0.5)' : 'rgba(150,128,92,0.4)';
        g.fillRect(p.x | 0, p.y | 0, 1, 1);
      }
    }

    /* The quay's surf: where the pylon wall stands the waterline carries a
       broad cream band inside it — surf breaking on a working shore — and only
       along the arc the circuit runs beside. */
    if (map.pylonWall) {
      const ca2 = Math.cos(0.35), sa2 = Math.sin(0.35);
      const nearRoad = (x: number, z: number, r: number) =>
        track.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r);
      const surf = (f: number, w: number, color: string) => {
        g.strokeStyle = color;
        g.lineWidth = w;
        g.beginPath();
        let pen = false;
        for (let s = 0; s <= 64; s++) {
          const t = (s / 64) * Math.PI * 2;
          const wx = lake.x + Math.cos(t) * (lake.rx - 2) * f * ca2
            - Math.sin(t) * (lake.rz - 1.8) * f * sa2;
          const wz = lake.z + Math.cos(t) * (lake.rx - 2) * f * sa2
            + Math.sin(t) * (lake.rz - 1.8) * f * ca2;
          if (!nearRoad(wx, wz, ROAD_HALF + 17)) { pen = false; continue; }
          const px = (wx + HALF_G) * PPU, py = (wz + HALF_G) * PPU;
          pen ? g.lineTo(px, py) : g.moveTo(px, py);
          pen = true;
        }
        g.stroke();
      };
      surf(0.965, 3.6, 'rgba(238,247,243,0.30)');
      surf(0.925, 2.2, 'rgba(244,250,246,0.34)');
      surf(0.885, 1.6, 'rgba(226,246,244,0.30)');
    }
  }

  /* The frozen lake is the map's destination, so its ice is authored, not a
     blue disc: pale ice freezing from the rim in, a crack web from a few
     impact points, wind-scoured streaks off the pass, skate trails, two
     fishing holes that match the tip-ups standing on the ice, and drifts
     blown over the shore. */
  if (map.snow && map.lake) {
    const lk = map.lake;
    const lx = (lk.x + HALF_G) * PPU, ly = (lk.z + HALF_G) * PPU;
    const ca = Math.cos(0.35), sa = Math.sin(0.35);
    const at = (u: number, v: number) => ({
      x: lx + (u * ca - v * sa) * PPU,
      y: ly + (u * sa + v * ca) * PPU,
    });
    const rimU = lk.rx - 2, rimV = lk.rz - 1.8;
    // the ice sheet: pale at the rim where it froze first, blue toward the middle
    g.save();
    g.beginPath();
    g.ellipse(lx, ly, rimU * PPU, rimV * PPU, 0.35, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#d4ecf5';
    g.fillRect(lx - rimU * PPU, ly - rimV * PPU, rimU * 2 * PPU, rimV * 2 * PPU);
    g.fillStyle = 'rgba(111,161,197,0.5)';
    g.beginPath();
    g.ellipse(lx, ly, rimU * 0.62 * PPU, rimV * 0.62 * PPU, 0.35, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(63,111,176,0.35)';
    g.beginPath();
    g.ellipse(lx, ly, rimU * 0.34 * PPU, rimV * 0.34 * PPU, 0.35, 0, Math.PI * 2);
    g.fill();
    // wind scours streaks across the ice, off the pass toward the south-east
    for (let i = 0; i < 26; i++) {
      const u = -rimU + rnd() * rimU * 2, v = -rimV + rnd() * rimV * 2;
      const p = at(u, v), q = at(u + 5 + rnd() * 4, v + 2.4 + rnd() * 1.6);
      g.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.30)' : 'rgba(150,196,222,0.35)';
      g.lineWidth = 1 + rnd() * 2;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(q.x, q.y);
      g.stroke();
    }
    // trapped air bubbles under the surface
    for (let i = 0; i < 130; i++) {
      const t = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
      const p = at(Math.cos(t) * rimU * 0.9 * r, Math.sin(t) * rimV * 0.9 * r);
      g.fillStyle = rnd() > 0.4 ? 'rgba(255,255,255,0.5)' : 'rgba(214,236,246,0.6)';
      g.fillRect(p.x | 0, p.y | 0, 1, 1);
    }
    // the crack web: long radiating splits from three impact points
    for (const [hu, hv] of [[-3, 1.5], [3.5, -2], [0.5, 3]] as [number, number][]) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + rnd() * 0.5;
        let u = hu, v = hv;
        g.beginPath();
        for (let s = 0; s < 6; s++) {
          const step = 1.2 + rnd() * 1.4;
          u += Math.cos(a + (rnd() - 0.5) * 0.35) * step;
          v += Math.sin(a + (rnd() - 0.5) * 0.35) * step * (rimV / rimU);
          const p = at(u, v);
          s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
        }
        g.strokeStyle = 'rgba(43,84,120,0.5)';
        g.lineWidth = 1.4;
        g.stroke();
        // the white refraction line a hand-width off the crack
        g.save();
        g.translate(PPU * 0.12, PPU * 0.12);
        g.strokeStyle = 'rgba(255,255,255,0.4)';
        g.lineWidth = 1;
        g.stroke();
        g.restore();
      }
    }
    // skate trails: two loops somebody cut on the way to the holes
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.4;
    for (const [tu, tv, tr] of [[-2, 5, 3.2], [4, 2, 2.6]] as [number, number, number][]) {
      g.beginPath();
      for (let s = 0; s <= 22; s++) {
        const a = (s / 22) * Math.PI * 2;
        const p = at(tu + Math.cos(a) * tr * (1 + 0.18 * Math.sin(a * 2)),
          tv + Math.sin(a) * tr * 0.62 * (1 + 0.18 * Math.cos(a * 3)));
        s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
      }
      g.stroke();
    }
    // the fishing holes, dark water showing through, with a pale lip
    for (const [hu, hv] of [[-4.5, 10.5], [-1.5, 12.5]] as [number, number][]) {
      const p = at(hu, hv);
      g.fillStyle = 'rgba(21,42,64,0.9)';
      g.beginPath();
      g.ellipse(p.x, p.y, 0.55 * PPU, 0.4 * PPU, 0.35, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(233,247,252,0.8)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(p.x, p.y, 0.7 * PPU, 0.52 * PPU, 0.35, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    // drifts blown over the shore ring, arcs of snow across the icy sand
    for (let i = 0; i < 12; i++) {
      const t = rnd() * Math.PI * 2;
      const u = Math.cos(t) * lk.rx * (0.98 + rnd() * 0.06);
      const v = Math.sin(t) * lk.rz * (0.98 + rnd() * 0.06);
      const p = at(u, v);
      g.strokeStyle = 'rgba(250,253,255,0.85)';
      g.lineWidth = 2 + rnd() * 3;
      g.beginPath();
      g.moveTo(p.x, p.y);
      const q = at(u + 2.5 + rnd() * 2, v + 1.2 + rnd() * 1.2);
      g.quadraticCurveTo(p.x + (q.x - p.x) * 0.4, p.y - 3, q.x, q.y);
      g.stroke();
    }
  }

  /* The dust verge. On a desert map the whole world is the colour of the dust
     the cars kick up, so a plume vanishes into the ground it lands on. A broad
     band of compacted dirt — darker than the sand, the track's own working
     apron — flanks the road on both sides, and the pale plume reads against
     it. Corners also blow a tail of fine dust off their exits, downwind the
     same way the ripples comb, so the map says "dust lives here" before a
     wheel turns. */
  if (map.dustVerge) {
    const margin = ROAD_HALF + 5.5;
    strokePath(g, track, 'rgba(94, 70, 42, 0.42)', (margin * 2) * PPU);
    // mottle the band: packed dirt is not one flat tone
    for (let i = 0; i < 9000; i++) {
      const p = track[(rnd() * track.length) | 0];
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * margin;
      if (r < ROAD_HALF) continue;
      const x = (p.x + Math.cos(a) * r + HALF_G) * PPU;
      const y = (p.z + Math.sin(a) * r + HALF_G) * PPU;
      g.fillStyle = rnd() > 0.5 ? 'rgba(74, 54, 32, 0.5)' : 'rgba(120, 94, 62, 0.5)';
      g.fillRect(x | 0, y | 0, rnd() > 0.7 ? 2 : 1, 1);
    }
    // the dust tails: pale streaks blown off the outside of each corner exit,
    // laid the same way the wind combs the ripples
    const nD = track.length;
    let lastTail = -999;
    for (let k = 0; k < nD; k++) {
      const c = Math.abs(curvature(track, k));
      if (c < 0.22) continue;
      if (c < Math.abs(curvature(track, (k - 1 + nD) % nD))) continue;
      if (k - lastTail < 60) continue;
      lastTail = k;
      const side = curvature(track, k) > 0 ? 1 : -1;
      for (let s = 0; s < 4; s++) {
        const at = (k + 14 + ((rnd() * 22) | 0)) % nD;
        const p = edgeAt(track, at, side * (ROAD_HALF + 1.5 + rnd() * 3.5));
        const x = (p.x + HALF_G) * PPU, y = (p.z + HALF_G) * PPU;
        g.strokeStyle = 'rgba(240, 222, 178, 0.30)';
        g.lineWidth = 1.4 + rnd() * 2.2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (4 + rnd() * 9) * PPU, y + (2 + rnd() * 4.5) * PPU);
        g.stroke();
      }
    }
  }

  strokePath(g, track, map.palette.shoulder, (ROAD_HALF * 2 + 1.6) * PPU);
  strokePath(g, track, map.palette.asphalt, ROAD_HALF * 2 * PPU);

  g.globalAlpha = 1;
  for (let i = 0; i < 24000; i++) {
    const p = track[(rnd() * track.length) | 0];
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * ROAD_HALF * 0.96;
    const x = (p.x + Math.cos(a) * r + HALF_G) * PPU;
    const y = (p.z + Math.sin(a) * r + HALF_G) * PPU;
    g.globalAlpha = 0.5 + rnd() * 0.4;
    g.fillStyle = rnd() > 0.5 ? map.palette.grainA : map.palette.grainB;
    g.fillRect(x | 0, y | 0, rnd() > 0.7 ? 2 : 1, 1);
  }

  g.globalAlpha = 1;

  /* Gravel: every corner that actually asks something of the car gets a
     painted run-off apron behind it, with the red and white band along its far
     edge. The flag kerb pair for the same corners is painted after the plain
     kerb, further down. */
  if (map.flagKerbs) {
    const n = track.length;

    let lastTrap = -999;
    for (let k = 0; k < n; k++) {
      const c = Math.abs(curvature(track, k));
      if (c < 0.5) continue;
      if (c < Math.abs(curvature(track, (k - 1 + n) % n)) || c < Math.abs(curvature(track, (k + 1) % n))) continue;
      if (k - lastTrap < 40) continue;
      lastTrap = k;
      // outside of the corner: the sign of the turn picks which side that is
      const side = curvature(track, k) > 0 ? 1 : -1;
      const span = 13;
      const inner: P2[] = [], outer: P2[] = [];
      for (let s = -span; s <= span; s++) {
        const t = Math.abs(s) / span;
        const depth = 5.2 * (1 - t * t * t);
        const at = (k + s + n) % n;
        inner.push(edgeAt(track, at, side * (ROAD_HALF + 0.3)));
        outer.push(edgeAt(track, at, side * (ROAD_HALF + 0.3 + depth)));
      }
      // a run-off that would run into a lake just muddles the shore: skip it
      if (outer.some((p) => [map.lake, ...(map.lakes ?? [])].some((l) => l
        && ((p.x - l.x) / (l.rx + 1.6)) ** 2 + ((p.z - l.z) / (l.rz + 1.6)) ** 2 < 1))) continue;
      g.beginPath();
      inner.forEach((p, idx) => {
        const x = (p.x + HALF_G) * PPU, y = (p.z + HALF_G) * PPU;
        idx ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      for (let idx = outer.length - 1; idx >= 0; idx--) {
        const p = outer[idx];
        g.lineTo((p.x + HALF_G) * PPU, (p.z + HALF_G) * PPU);
      }
      g.closePath();
      g.fillStyle = '#b9ae8e';
      g.fill();
      g.save();
      g.clip();
      for (let d = 0; d < 900; d++) {
        const p = outer[(rnd() * outer.length) | 0];
        const q = inner[(rnd() * inner.length) | 0];
        const m = rnd();
        const x = (q.x + (p.x - q.x) * m + HALF_G) * PPU;
        const y = (q.z + (p.z - q.z) * m + HALF_G) * PPU;
        g.fillStyle = rnd() > 0.5 ? '#cbc2a4' : '#9c9274';
        g.fillRect(x | 0, y | 0, 1, 1);
      }
      g.restore();
      // the red and white band on the far edge of the run-off
      strokePath(g, outer, '#efe9d8', 0.8 * PPU, false);
      dotted(g, outer, '#c8463c', 0.8 * PPU, 1.1 * PPU, 1.1 * PPU, false);
    }
  }

  strokePath(g, offsetPath(track, ROAD_HALF - 0.45), map.palette.line, 0.34 * PPU);
  strokePath(g, offsetPath(track, -(ROAD_HALF - 0.45)), map.palette.line, 0.34 * PPU);

  for (const side of [1, -1]) {
    const edge = offsetPath(track, side * (ROAD_HALF + 0.15));
    strokePath(g, edge, map.palette.kerbA, 0.7 * PPU);
    dotted(g, edge, map.palette.kerbB, 0.7 * PPU, 1.5 * PPU, 1.5 * PPU);

  }

  /* Flag kerbs: the corners the gravel belongs to also swap the plain white
     and red pair for the flag's green and yellow, so the kerb itself tells you
     where the work is. */
  if (map.flagKerbs) {
    const n = track.length;
    const flagY = '#f4c518', flagG = '#0e7f3c';
    let i = 0;
    while (i < n) {
      if (Math.abs(curvature(track, i)) < 0.18) { i++; continue; }
      const from = i;
      while (i < n && Math.abs(curvature(track, i)) >= 0.18) i++;
      if (i - from < 10) continue;
      for (const side of [1, -1]) {
        const edge: P2[] = [];
        for (let k = from; k <= i; k++) edge.push(edgeAt(track, k % n, side * (ROAD_HALF + 0.15)));
        strokePath(g, edge, flagY, 0.7 * PPU, false);
        dotted(g, edge, flagG, 0.7 * PPU, 1.5 * PPU, 1.5 * PPU, false);
      }
    }
  }

  dotted(g, track, 'rgba(246,246,240,0.62)', 0.16 * PPU, 1.9 * PPU, 2.4 * PPU);

  const si = straightestIndex(track, map.overpass ? 46 : 0);
  const s = track[si], s2 = track[(si + 3) % track.length];
  // The start line runs across the road, not along it.
  const ang = Math.atan2(s2.z - s.z, s2.x - s.x) + Math.PI * 0.5;
  g.save();
  g.translate((s.x + HALF_G) * PPU, (s.z + HALF_G) * PPU);
  g.rotate(ang);
  const cw = 0.9 * PPU;
  for (let row = 0; row < 2; row++) {
    for (let col = -6; col < 6; col++) {
      g.fillStyle = (row + col) % 2 === 0 ? '#f2eee2' : '#33333a';
      g.fillRect(col * cw * 0.85, (row - 1) * cw * 0.85, cw * 0.85, cw * 0.85);
    }
  }
  g.restore();

  return cv;
}

function mulberry(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cream sponsor board with a hard accent rule, drawn at pixel scale. */
function boardTexture(label: string, accent: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 48;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f2eee1';
  g.fillRect(0, 0, 160, 48);
  g.fillStyle = accent;
  g.fillRect(0, 0, 160, 4);
  g.fillRect(0, 44, 160, 4);
  g.fillStyle = '#14161a';
  g.fillRect(6, 9, 148, 2);
  g.fillRect(6, 37, 148, 2);
  g.font = 'bold 20px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 80, 25);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 === 0 ? accent : '#14161a';
    g.fillRect(4 + i * 4, 4, 3, 3);
    g.fillRect(160 - 7 - i * 4, 41, 3, 3);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Japanese circuit board: cream field, red rising sun, kanji. */
function jpBoardTexture(label: string, accent: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f6f0e4'; g.fillRect(0, 0, 160, 64);
  g.fillStyle = accent; g.fillRect(0, 0, 160, 7); g.fillRect(0, 57, 160, 7);
  g.fillStyle = '#22252a';
  g.fillRect(5, 9, 150, 2); g.fillRect(5, 53, 150, 2);
  g.beginPath(); g.arc(25, 27, 11, 0, Math.PI * 2); g.fillStyle = '#c8463c'; g.fill();
  g.fillStyle = '#f6f0e4'; g.beginPath(); g.arc(25, 27, 7, 0, Math.PI * 2); g.fill();
  g.font = 'bold 27px "Noto Sans CJK JP", "Noto Sans JP", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1b1d22';
  g.fillText(label, 100, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function jpBannerTexture(label: string, accent: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 192;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f6f0e4'; g.fillRect(0, 0, 64, 192);
  g.fillStyle = accent; g.fillRect(0, 0, 64, 8); g.fillRect(0, 184, 64, 8);
  g.fillStyle = '#22252a'; g.fillRect(4, 12, 56, 2); g.fillRect(4, 178, 56, 2);
  g.font = 'bold 44px "Noto Sans CJK JP", "Noto Sans JP", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1b1d22';
  const chars = [...label];
  chars.forEach((ch, i) => g.fillText(ch, 32, 40 + i * 54));
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Brazilian flag board: a yellow field with green rules or the reverse, with
 *  blue corner ticks. Sizeable mono type, so it still reads when it is only a
 *  few dozen pixels tall in the chase view. */
function brBoardTexture(label: string, yellow: boolean): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 192; cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = yellow ? '#ffce00' : '#0b8043';
  g.fillRect(0, 0, 192, 64);
  g.fillStyle = yellow ? '#0b8043' : '#ffce00';
  g.fillRect(0, 0, 192, 7);
  g.fillRect(0, 57, 192, 7);
  g.fillStyle = '#1d3f94';
  g.fillRect(5, 11, 16, 4);
  g.fillRect(171, 49, 16, 4);
  g.fillStyle = yellow ? '#0b3a20' : '#ffe97a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 30;
  g.font = `bold ${size}px monospace`;
  while (g.measureText(label).width > 176 && size > 11) {
    size--;
    g.font = `bold ${size}px monospace`;
  }
  g.fillText(label, 96, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The same flag colours standing up: one letter per band, roadside banner. */
function brBannerTexture(label: string, yellow: boolean): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 192;
  const g = cv.getContext('2d')!;
  g.fillStyle = yellow ? '#ffce00' : '#0b8043';
  g.fillRect(0, 0, 64, 192);
  g.fillStyle = yellow ? '#0b8043' : '#ffce00';
  g.fillRect(0, 0, 64, 9);
  g.fillRect(0, 183, 64, 9);
  const chars = [...label];
  const step = Math.min(46, (192 - 22) / Math.max(1, chars.length));
  g.font = `bold ${Math.min(34, Math.round(step * 0.95))}px monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = yellow ? '#0b3a20' : '#ffe97a';
  chars.forEach((ch, i) => g.fillText(ch, 32, 11 + step * 0.5 + i * step));
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Mesa's standing banner: the fair's sign, one tall cream band with a dust
 *  orange sun and the letters stacked down it, amber and ink on cream so it
 *  survives the tan the way a red banner would not. */
function mesaBannerTexture(label: string, accent: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 192;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f2eee1';
  g.fillRect(0, 0, 64, 192);
  g.fillStyle = accent;
  g.fillRect(0, 0, 64, 9);
  g.fillRect(0, 183, 64, 9);
  g.fillStyle = '#22252a';
  g.fillRect(4, 13, 56, 2);
  g.fillRect(4, 177, 56, 2);
  // the desert sun: a dust-orange disc banded in amber, over the word
  g.fillStyle = accent;
  g.beginPath(); g.arc(32, 40, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f0a828';
  g.fillRect(20, 38, 24, 4);
  g.fillStyle = '#f2eee1';
  g.beginPath(); g.arc(32, 40, 8, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1d1f24';
  g.font = 'bold 34px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = [...label];
  const step = Math.min(34, (192 - 92) / Math.max(1, chars.length));
  chars.forEach((ch, i) => g.fillText(ch, 32, 78 + step * 0.5 + i * step));
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Turn board: three chunky chevrons, pointing left (-1) or right (+1). */
function arrowTexture(dir: number): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#14161a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f2eee1';
  g.fillRect(0, 0, 64, 3);
  g.fillRect(0, 61, 64, 3);
  g.fillRect(0, 0, 3, 64);
  g.fillRect(61, 0, 3, 64);
  g.fillStyle = '#e0513f';
  for (let i = 0; i < 3; i++) {
    const x = 18 + i * 14;
    for (let k = 0; k < 6; k++) {
      const w = 3;
      const up = 8 + k * 4;
      const down = 56 - k * 4;
      g.fillRect(dir > 0 ? x + k * 3 : x - k * 3, up, w, 6);
      g.fillRect(dir > 0 ? x + k * 3 : x - k * 3, down, w, 6);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function buildWorld(scene: THREE.Scene, mapId?: string): Promise<World> {
  const map = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
  ROAD_HALF = map.roadHalf ?? 4.4;
  WORLD = map.world ?? 172;
  GX = WORLD + 8;
  // a wide playfield needs more pixels per unit or the ground goes soft
  PX = WORLD > 300 ? 3072 : 2048;
  HALF_G = GX / 2;
  PPU = PX / GX;
  HALF = WORLD / 2;
  const group = new THREE.Group();
  scene.add(group);

  const track = sampleTrack(map.ctrl, map.smooth !== false);

  // Fig-eight overpass: one branch climbs a short bridge, the other passes
  // underneath; which branch rises is picked by x-tangent, not heading.
  let bridge: { cx: number; cz: number; dirx: number; dirz: number;
    halfW: number; deckHalf: number; ramp: number; height: number; upperIdx: number } | null = null;
  const bridgeColliders: Collider[] = [];
  if (map.overpass) {
    const near: number[] = [];
    for (let i = 0; i < track.length; i += 2) {
      if (Math.hypot(track[i].x, track[i].z) < 2.2) near.push(i);
    }
    const i0 = near[0] ?? 0;
    const i1 = near.find((i) => Math.abs(i - i0) > track.length / 4)
      ?? (i0 + Math.floor(track.length / 2)) % track.length;
    const tangent = (i: number) => {
      const a = track[(i - 5 + track.length) % track.length];
      const b = track[(i + 5) % track.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      return { x: dx / l, z: dz / l };
    };
    const t0 = tangent(i0);
    const t1 = tangent(i1);
    const dir = t0.x >= t1.x ? t0 : t1;
    bridge = {
      cx: 0, cz: 0, dirx: dir.x, dirz: dir.z,
      halfW: ROAD_HALF + 1.2, deckHalf: 0, ramp: 14.0, height: 3.4,
      upperIdx: dir === t0 ? i0 : i1,
    };
  }
  const bridgeHeight = (along: number) => {
    if (!bridge) return 0;
    const a = Math.abs(along);
    if (a >= bridge.ramp) return 0;
    const t = a / bridge.ramp;
    return bridge.height * (1 - t * t);
  };
  const groundAt = (x: number, z: number, heading: number, trackIdx?: number) => {
    if (!bridge) return 0;
    if (trackIdx !== undefined) {
      const n = track.length;
      let d = trackIdx - bridge.upperIdx;
      d = ((d + n / 2) % n + n) % n - n / 2;
      if (Math.abs(d) > 70) return 0;
    }
    const dx = x - bridge.cx, dz = z - bridge.cz;
    const along = dx * bridge.dirx + dz * bridge.dirz;
    const across = dx * -bridge.dirz + dz * bridge.dirx;
    if (Math.abs(across) > bridge.halfW || Math.abs(along) >= bridge.ramp) return 0;
    if (trackIdx === undefined) {
      const fwdX = -Math.sin(heading), fwdZ = -Math.cos(heading);
      if (fwdX * bridge.dirx + fwdZ * bridge.dirz < 0.6) return 0;
    }
    return bridgeHeight(along);
  };

  const cell = 1;
  const dim = Math.ceil(WORLD / cell);
  const grid = new Uint8Array(dim * dim);
  const kerbs = new Uint8Array(dim * dim);
  const gx = (x: number) => Math.floor((x + HALF) / cell);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      const x = i * cell - HALF + cell / 2;
      const z = j * cell - HALF + cell / 2;
      let best = 1e9;
      for (const p of track) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) best = d;
      }
      const d = Math.sqrt(best);
      const at = j * dim + i;
      if (d < ROAD_HALF) grid[at] = 1;
      if (d >= ROAD_HALF - 1.0 && d <= ROAD_HALF + 0.55) kerbs[at] = 1;
    }
  }
  const roadAt = (x: number, z: number) => {
    const i = gx(x), j = gx(z);
    if (i < 0 || j < 0 || i >= dim || j >= dim) return false;
    return grid[j * dim + i] === 1;
  };
  const kerbAt = (x: number, z: number) => {
    const i = gx(x), j = gx(z);
    if (i < 0 || j < 0 || i >= dim || j >= dim) return false;
    return kerbs[j * dim + i] === 1;
  };
  const nearbyRoad = (x: number, z: number, dist: number) => {
    for (const p of track) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < dist * dist) return true;
    }
    return false;
  };

  const canvas = paintGround(track, map);
  const groundTex = new THREE.CanvasTexture(canvas);
  groundTex.magFilter = THREE.NearestFilter;
  groundTex.minFilter = THREE.NearestFilter;
  groundTex.generateMipmaps = false;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GX, GX),
    new THREE.MeshBasicMaterial({ map: groundTex, toneMapped: false }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  group.add(ground);

  const SK = 512;
  const skidCanvas = document.createElement('canvas');
  skidCanvas.width = skidCanvas.height = SK;
  const skidCtx = skidCanvas.getContext('2d')!;
  const skidTex = new THREE.CanvasTexture(skidCanvas);
  skidTex.colorSpace = THREE.SRGBColorSpace;
  const skidMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshBasicMaterial({
      map: skidTex, transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false,
    }),
  );
  skidMesh.rotation.x = -Math.PI / 2;
  skidMesh.position.y = 0.008;
  skidMesh.renderOrder = 1;
  group.add(skidMesh);
  let skidDirty = false, skidPending = false;

  const addSkid = (x: number, z: number, angle: number, strength: number) => {
    if (skidPending) return;
    skidPending = true;
    const px = ((x + HALF) / WORLD) * SK;
    const py = ((z + HALF) / WORLD) * SK;
    skidCtx.save();
    skidCtx.translate(px, py);
    skidCtx.rotate(-angle);
    skidCtx.fillStyle = `rgba(22,20,24,${Math.min(0.32, 0.12 + strength * 0.25)})`;
    skidCtx.fillRect(-2.2, -5, 2.0, 10);
    skidCtx.fillRect(0.6, -5, 2.0, 10);
    skidCtx.restore();
    skidDirty = true;
    requestAnimationFrame(() => { skidPending = false; });
  };
  const clearSkid = () => {
    skidCtx.clearRect(0, 0, SK, SK);
    skidDirty = true;
  };

  const [pineTex, sakuraTex, snowTex, palmTex, rockTex, lampTex, tyreTex, bldA, bldB, bldC, shadowTex] = await Promise.all([
    loadSheet('/sprites/pine.png'), loadSheet('/sprites/sakura.png'),
    loadSheet('/sprites/pine-snow.png'), loadSheet('/sprites/palm.png'),
    loadSheet('/sprites/rock.png'), loadSheet('/sprites/lamp.png'), loadSheet('/sprites/tyres.png'),
    loadSheet('/sprites/building-a.png'), loadSheet('/sprites/building-b.png'),
    loadSheet('/sprites/building-c.png'), loadSheet('/sprites/shadow.png'),
  ]);

  const defs: Record<string, StackDef> = {
    pine: { layers: 18, sheetW: 40, sheetH: 40, worldW: 3.1, lift: 0.125 },
    sakura: { layers: 18, sheetW: 40, sheetH: 40, worldW: 3.1, lift: 0.125 },
    palm: { layers: 18, sheetW: 40, sheetH: 40, worldW: 3.4, lift: 0.135 },
    rock: { layers: 10, sheetW: 28, sheetH: 28, worldW: 1.9, lift: 0.09 },
    lamp: { layers: 26, sheetW: 16, sheetH: 16, worldW: 1.0, lift: 0.075 },
    tyres: { layers: 12, sheetW: 24, sheetH: 24, worldW: 1.5, lift: 0.072 },
    snowpine: { layers: 18, sheetW: 40, sheetH: 40, worldW: 3.1, lift: 0.125 },
    bldA: { layers: 14, sheetW: 64, sheetH: 64, worldW: 7.0, lift: 0.30 },
    bldB: { layers: 14, sheetW: 64, sheetH: 64, worldW: 7.0, lift: 0.30 },
    bldC: { layers: 14, sheetW: 64, sheetH: 64, worldW: 7.0, lift: 0.30 },
  };

  const colliders: Collider[] = [];
  const shadows: Placement[] = [];
  const rnd = mulberry(90210);
  const taken: { x: number; z: number; r: number }[] = [];

  const inLake = (x: number, z: number, pad = 1) => {
    for (const lake of [map.lake, ...(map.lakes ?? [])]) {
      if (!lake) continue;
      const dx = (x - lake.x) / (lake.rx + pad);
      const dz = (z - lake.z) / (lake.rz + pad);
      if (dx * dx + dz * dz < 1) return true;
    }
    return false;
  };
  /* Negative space: ground the map deliberately keeps empty. Composition is as
     much about where the dressing stops as where it goes. */
  const openZones = map.dressing?.open ?? [];
  const inOpen = (x: number, z: number) => {
    for (const o of openZones) if ((o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r) return true;
    return false;
  };
  const free = (x: number, z: number, r: number, pad = 2.4) => {
    if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) return false;
    if (inLake(x, z, 1.5)) return false;
    if (inOpen(x, z)) return false;
    if (nearbyRoad(x, z, ROAD_HALF + pad + r)) return false;
    for (const t of taken) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + r) ** 2) return false;
    return true;
  };

  const TOWN: [number, number][] = [
    [2, -8], [13, -10], [20, -2], [6, 2], [17, 7], [-2, 6],
    [4, 14], [14, 16], [-6, -2], [22, 26], [-10, 12], [10, 22],
    [-14, -4], [26, 14], [0, 26],
  ];
  const buildings: Placement[][] = [[], [], []];
  const town = map.town ?? TOWN;
  const townCount = map.props?.buildings ?? town.length;
  town.slice(0, townCount).forEach(([x, z], i) => {
    const r = 4.2;
    if (!free(x, z, r)) return;
    const rot = Math.round(rnd() * 3) * (Math.PI / 2) + (rnd() - 0.5) * 0.15;
    buildings[i % 3].push({ x, z, rot, scale: (map.buildingScale ?? 1) * (0.9 + rnd() * 0.25) });
    taken.push({ x, z, r });
    colliders.push({ x, z, r: 4.0 });
    shadows.push({ x, z, rot, scale: 1.35 });
  });

  const pines: Placement[] = [], palms: Placement[] = [], sakuras: Placement[] = [];
  const addTree = (x: number, z: number, palm = false, scale = 0) => {
    if (!free(x, z, 1.5, 0.9)) return false;
    const s = scale > 0 ? scale : 0.85 + rnd() * 0.45;
    if (map.trees === 'sakura') sakuras.push({ x, z, rot: rnd() * 6.28, scale: s });
    else if (palm) palms.push({ x, z, rot: rnd() * 6.28, scale: s });
    else pines.push({ x, z, rot: rnd() * 6.28, scale: s });
    taken.push({ x, z, r: 1.5 });
    colliders.push({ x, z, r: 0.7 });
    shadows.push({ x, z, rot: 0, scale: 1.7 });
    return true;
  };

  const rocks: Placement[] = [];
  const addRock = (x: number, z: number, scale: number) => {
    if (!free(x, z, 1.3)) return false;
    rocks.push({ x, z, rot: rnd() * 6.28, scale });
    taken.push({ x, z, r: 1.3 });
    colliders.push({ x, z, r: 0.7 });
    shadows.push({ x, z, rot: 0, scale: 1.5 });
    return true;
  };

  /* Distances along the centreline, so a planted row can be placed in metres
     from a track point instead of a lap fraction nobody can read. */
  const cum: number[] = [0];
  for (let i = 1; i < track.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(track[i].x - track[i - 1].x, track[i].z - track[i - 1].z));
  }
  const lapLen = cum[cum.length - 1] + Math.hypot(
    track[0].x - track[cum.length - 1].x, track[0].z - track[cum.length - 1].z);
  const indexAt = (m: number) => {
    const d = ((m % lapLen) + lapLen) % lapLen;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const nearestIndex = (x: number, z: number) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < track.length; i++) {
      const d = (track[i].x - x) ** 2 + (track[i].z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  const dress = map.dressing;
  /* A row is a line of trees at a fixed offset from the circuit, on a chosen
     side, over a measured stretch: the pine wall on the outside of a corner
     instead of trees that happen to fall near it. */
  for (const row of dress?.rows ?? []) {
    const centre = cum[nearestIndex(row.near[0], row.near[1])];
    const from = centre - row.metres / 2;
    const base = row.scale ?? 1;
    for (let m = from; m <= from + row.metres; m += row.step) {
      const i = indexAt(m + (rnd() - 0.5) * row.step * 0.3);
      const p = edgeAt(track, i, row.side * (row.offset + (rnd() - 0.5) * 1.1));
      addTree(p.x, p.z, !!row.palm, base * (0.9 + rnd() * 0.2));
    }
  }

  /* Authored stands. Each grove grows outward from a dense middle and thins to a
     ragged edge, with a few strays loose in the grass around it, which is what a
     stand of trees looks like from above and what even scatter never does. */
  for (const g of dress?.groves ?? []) {
    const base = g.scale ?? 1;
    for (let k = 0; k < g.n; k++) {
      const core = k < g.n * 0.7;
      const t = core ? 0.12 + rnd() * 0.6 : 0.72 + rnd() * 0.7;
      const a = rnd() * Math.PI * 2;
      const r = g.r * Math.sqrt(t);
      addTree(g.x + Math.cos(a) * r, g.z + Math.sin(a) * r, !!g.palm, base * (0.88 + rnd() * 0.24));
    }
  }

  // Trees: a corridor along the track, then loose woodland clusters in the open.
  // Only for a map that does not plant by hand.
  if (!dress?.groves) {
    for (let i = 0; i < track.length; i += 9) {
      if (rnd() > 0.62) continue;
      const p = track[i];
      const q = track[(i + 4) % track.length];
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const side = rnd() > 0.5 ? 1 : -1;
      const out = ROAD_HALF + 1.8 + rnd() * 7.5;
      const x = p.x + (dz / len) * out * side;
      const z = p.z - (dx / len) * out * side;
      const nearLake = map.lake ? Math.hypot(x - map.lake.x, z - map.lake.z) < map.lake.rx + 2 : false;
      const palmChance = map.snow ? 0 : map.trees === 'palm' ? 0.9 : map.trees === 'mixed' ? 0.45 : 0.08;
      addTree(x + (rnd() - 0.5) * 2, z + (rnd() - 0.5) * 2, !map.snow && nearLake ? rnd() > 0.35 : rnd() < palmChance);
    }

    let guard = 0;
    const treeTarget = map.props?.trees ?? Math.round(190 * (map.density ?? 1));
    /* Groves: an even scatter over a big field reads as noise from above. A map
       that asks for groves grows most of its trees in a handful of stands of
       palms and keeps the rest of the ground open lawn. */
    const groveCentres: P2[] = [];
    if (map.groves) {
      for (let a = 0; a < 400 && groveCentres.length < 8; a++) {
        const x = (rnd() - 0.5) * (WORLD - 40);
        const z = (rnd() - 0.5) * (WORLD - 40);
        if (nearbyRoad(x, z, ROAD_HALF + 16)) continue;
        if (inLake(x, z, 8)) continue;
        if (groveCentres.some((c) => Math.hypot(c.x - x, c.z - z) < 56)) continue;
        groveCentres.push({ x, z });
      }
    }
    while (pines.length + palms.length + sakuras.length < treeTarget && guard++ < 3000) {
      let x = (rnd() - 0.5) * (WORLD - 8);
      let z = (rnd() - 0.5) * (WORLD - 8);
      if (groveCentres.length && rnd() < 0.78) {
        const c = groveCentres[(rnd() * groveCentres.length) | 0];
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 30;
        x = c.x + Math.cos(a) * r;
        z = c.z + Math.sin(a) * r;
      }
      const palmChance = map.snow ? 0 : map.trees === 'palm' ? 0.9 : map.trees === 'mixed' ? 0.45 : 0.08;
      const nearLake = map.lake ? Math.hypot(x - map.lake.x, z - map.lake.z) < map.lake.rx + 3 : false;
      addTree(x, z, !map.snow && nearLake ? rnd() > 0.35 : rnd() < palmChance);
    }
  }

  /* Rock beds: a cluster where the ground says so, none anywhere else. */
  for (const b of dress?.beds ?? []) {
    for (let k = 0; k < b.n; k++) {
      const a = rnd() * Math.PI * 2, r = b.r * Math.sqrt(rnd());
      addRock(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r,
        (b.scale ?? 1) * (0.7 + rnd() * 0.7));
    }
  }
  if (!dress?.beds) {
    const rockCount = map.props?.rocks ?? 34;
    for (let i = 0; i < rockCount; i++) {
      const x = (rnd() - 0.5) * (WORLD - 10);
      const z = (rnd() - 0.5) * (WORLD - 10);
      addRock(x, z, (0.7 + rnd() * 0.7) * (map.props?.rockScale ?? 1));
    }
  }

  const lamps: Placement[] = [];
  for (let i = 0; i < track.length; i += (map.props?.lampStride ?? 58)) {
    const p = track[i];
    const q = track[(i + 6) % track.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len;
    const x = p.x + nx * (ROAD_HALF + 1.6);
    const z = p.z + nz * (ROAD_HALF + 1.6);
    // A nearby branch of the circuit can put the lamp on tarmac, and a lake
    // can put it on the sand; skip both.
    if (nearbyRoad(x, z, ROAD_HALF + 0.7)) continue;
    if (inLake(x, z, 1.2)) continue;
    lamps.push({ x, z, rot: Math.atan2(dx, dz), scale: 1 });
    colliders.push({ x, z, r: 0.28 });
    shadows.push({ x, z, rot: 0, scale: 0.6 });
  }

  const tyres: Placement[] = [];
  const n = track.length;
  for (let i = 0; i < n; i += 14) {
    const a = track[(i - 8 + n) % n], b = track[i], c = track[(i + 8) % n];
    const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
    const l1 = Math.hypot(v1x, v1z) || 1, l2 = Math.hypot(v2x, v2z) || 1;
    const curv = (v1x * v2z - v1z * v2x) / (l1 * l2);
    if (Math.abs(curv) < 0.14) continue;
    if (tyres.some((t) => (t.x - b.x) ** 2 + (t.z - b.z) ** 2 < 64)) continue;
    const nx = v1z / l1, nz = -v1x / l1;
    const side = curv > 0 ? 1 : -1;
    for (let k = -2; k <= 2; k++) {
      const bx = b.x + nx * side * (ROAD_HALF + 1.1) + (v1x / l1) * k * 1.5;
      const bz = b.z + nz * side * (ROAD_HALF + 1.1) + (v1z / l1) * k * 1.5;
      if (nearbyRoad(bx, bz, ROAD_HALF + 0.5)) continue;
      tyres.push({ x: bx, z: bz, rot: rnd() * 6.28, scale: 0.95 + rnd() * 0.15 });
      colliders.push({ x: bx, z: bz, r: 0.62 });
      shadows.push({ x: bx, z: bz, rot: 0, scale: 0.9 });
    }
  }

  // a fence across a gap the circuit leaves open: without it a car can drive
  // between two branches and skip the road that runs between them
  for (const [ax, az, bx, bz] of map.fences ?? []) {
    const dx = bx - ax;
    const dz = bz - az;
    const span = Math.hypot(dx, dz);
    const inset = ROAD_HALF + 1.3;   // stop on the grass, clear of both roads
    if (span <= inset * 2) continue;
    const ux = dx / span;
    const uz = dz / span;
    const steps = Math.round((span - inset * 2) / 1.5);
    for (let k = 0; k <= steps; k++) {
      const f = inset + ((span - inset * 2) * k) / steps;
      const x = ax + ux * f;
      const z = az + uz * f;
      tyres.push({ x, z, rot: rnd() * 6.28, scale: 0.95 + rnd() * 0.15 });
      colliders.push({ x, z, r: 0.62 });
      shadows.push({ x, z, rot: 0, scale: 0.9 });
    }
  }

  /* A tyre barrier along every lakeshore the circuit runs beside. The lakes
     are what this map is named for, so the water gets an edge you can read at
     speed instead of a painted smudge behind the grass. */
  if (map.shoreBarriers) {
    for (const lake of map.lakes ?? []) {
      const ca = Math.cos(0.35), sa = Math.sin(0.35);
      const steps = Math.max(24, Math.round((lake.rx + lake.rz) * 1.6));
      for (let s = 0; s < steps; s++) {
        const t = (s / steps) * Math.PI * 2;
        const u = Math.cos(t) * lake.rx, v = Math.sin(t) * lake.rz;
        const x = lake.x + u * ca - v * sa;
        const z = lake.z + u * sa + v * ca;
        // only where the racing line can see the water, and never on tarmac
        if (!nearbyRoad(x, z, ROAD_HALF + 11)) continue;
        if (nearbyRoad(x, z, ROAD_HALF + 1.2)) continue;
        if (tyres.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < 1.7 * 1.7)) continue;
        tyres.push({ x, z, rot: rnd() * 6.28, scale: 0.95 + rnd() * 0.15 });
        colliders.push({ x, z, r: 0.62 });
        shadows.push({ x, z, rot: 0, scale: 0.9 });
      }
    }
  }

  /* Every hand-built prop is a box. A box is recorded here as an empty node
     carrying its size and colour, and the whole furniture layer is baked into
     one instanced mesh per colour at the end: the gantry, the stands, the torii
     and the pit wall were several hundred draw calls between them. */
  const matCache = new Map<number, THREE.MeshBasicMaterial>();
  const basic = (color: number) => {
    let m = matCache.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      matCache.set(color, m);
    }
    return m;
  };
  const addBox = (g: THREE.Group, w: number, h: number, d: number, color: number,
    x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.userData.box = { w, h, d, color };
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const bakeBoxes = (root: THREE.Object3D) => {
    const byColor = new Map<number, THREE.Matrix4[]>();
    const marked: THREE.Object3D[] = [];
    root.traverse((o) => {
      const box = o.userData.box as { w: number; h: number; d: number; color: number } | undefined;
      if (!box) return;
      marked.push(o);
      o.updateWorldMatrix(true, false);
      const s = new THREE.Matrix4().makeScale(box.w, box.h, box.d);
      const m = new THREE.Matrix4().multiplyMatrices(o.matrixWorld, s);
      const list = byColor.get(box.color);
      if (list) list.push(m); else byColor.set(box.color, [m]);
    });
    for (const o of marked) o.removeFromParent();
    for (const [color, mats] of byColor) {
      const mesh = new THREE.InstancedMesh(UNIT_BOX, basic(color), mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      root.add(mesh);
    }
  };

  if (map.grandstands) {
    let ccx = 0, ccz = 0;
    for (const p of track) { ccx += p.x; ccz += p.z; }
    ccx /= track.length; ccz /= track.length;
    const standStart = straightestIndex(track);
    const seatColours = [0xe0513f, 0xf2eee1, 0x2b6d7a];
    const headingAt = (i: number) => {
      const p = track[i % track.length], q = track[(i + 1) % track.length];
      return Math.atan2(q.z - p.z, q.x - p.x);
    };
    // How far the start/finish straight runs before it bends, so the stands
    // line that straight however long the lap is instead of landing wherever a
    // fixed index offset happens to fall.
    const h0 = headingAt(standStart);
    let run = 0;
    while (run < 400) {
      let d = Math.abs(headingAt(standStart + run) - h0) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d > 0.16) break;
      run++;
    }
    const stand = (i: number, k: number) => {
      i %= track.length;
      const p = track[i], q = track[(i + 6) % track.length];
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;
      const a = Math.hypot(p.x + nx * 4 - ccx, p.z + nz * 4 - ccz);
      const b = Math.hypot(p.x - nx * 4 - ccx, p.z - nz * 4 - ccz);
      const side = a > b ? 1 : -1;
      const x = p.x + nx * side * (ROAD_HALF + 7.4);
      const z = p.z + nz * side * (ROAD_HALF + 7.4);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = Math.atan2(dx, dz);
      addBox(g, 6.2, 0.30, 13.5, 0x5a5a62, 0, 0.15, 0);
      for (let row = 0; row < 4; row++) {
        const rx = side * (-1.9 + row * 1.2);
        addBox(g, 1.25, 0.45, 12.6, seatColours[(row + k) % 3], rx, 0.55 + row * 0.46, 0);
      }
      addBox(g, 0.40, 1.35, 13.6, 0x2b2d33, side * 3.0, 0.68, 0);
      addBox(g, 0.14, 0.70, 7.0, 0xe0513f, side * -3.0, 1.45, 0);
      addBox(g, 0.10, 0.18, 13.4, 0xf2eee1, side * 3.0, 1.40, 0);
      group.add(g);
      colliders.push({ x, z, r: 7.0 });
    };
    const blocks = Math.max(3, Math.min(7, Math.round(run / 16)));
    const spread = run >= 24 ? run : track.length;
    for (let k = 0; k < blocks; k++) {
      stand(standStart + Math.round(spread * (0.06 + (0.88 * k) / (blocks - 1))), k);
    }
  }

  if (map.armco) {
    const pieces: { x: number; z: number; rot: number; len: number }[] = [];
    /* A rail every ~2 units of centreline however long the lap is. Each piece
       runs between two offset points rather than sitting on one point at a
       fixed length: on the inside of a hairpin a straight 4.65 rail aimed
       along the tangent swings across the tarmac, and this circuit is 1.59 km
       of one tight corner after another. */
    let lapLen = 0;
    for (let i = 0; i < track.length; i++) {
      const a = track[i], b = track[(i + 1) % track.length];
      lapLen += Math.hypot(b.x - a.x, b.z - a.z);
    }
    const stride = Math.max(1, Math.round((2 * (track.length - 1)) / (lapLen || 1)));
    for (let i = 0; i < track.length; i += stride) {
      const i2 = (i + stride) % track.length;
      for (const side of [-1, 1]) {
        const a = edgeAt(track, i, side * (ROAD_HALF + 1.15));
        const b = edgeAt(track, i2, side * (ROAD_HALF + 1.15));
        // where the offset path folds over itself the rail would stand on the
        // tarmac: drop those pieces and leave the corner to the tyres
        if (nearbyRoad(a.x, a.z, ROAD_HALF + 0.6)) continue;
        if (nearbyRoad(b.x, b.z, ROAD_HALF + 0.6)) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.3) continue;
        pieces.push({
          x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
          rot: Math.atan2(dx, dz), len: len * 1.12,
        });
      }
    }
    const railGeo = new THREE.BoxGeometry(0.12, 0.46, 1);
    const capGeo = new THREE.BoxGeometry(0.18, 0.08, 1);
    const rails = new THREE.InstancedMesh(railGeo, basic(0xb9bec4), pieces.length);
    const caps = new THREE.InstancedMesh(capGeo, basic(0xeef0ec), pieces.length);
    const dummy = new THREE.Object3D();
    pieces.forEach((p, i) => {
      dummy.position.set(p.x, 0.40, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(1, 1, p.len);
      dummy.updateMatrix();
      rails.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0.66;
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
      if (i % 3 === 0) colliders.push({ x: p.x, z: p.z, r: 0.8 });
    });
    rails.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    group.add(rails, caps);
  }

  /* The jetty makes the lake a coast: planks on piles running out from the
     beach, with a lantern on the end of it. */
  if (map.jetty) {
    const j = map.jetty;
    const g = new THREE.Group();
    g.position.set(j.x, 0, j.z);
    g.rotation.y = j.rot;
    const plank = 0x9a7a52, pile = 0x6b5236;
    addBox(g, 2.0, 0.20, j.len, plank, 0, 0.62, j.len / 2);
    for (const sx of [-0.8, 0.8]) {
      for (let z = 0.8; z < j.len; z += 1.8) {
        addBox(g, 0.18, 0.85, 0.18, pile, sx, 0.3, z);
      }
    }
    // a mooring bollard at the end, low and out of the sight line: no lamp post,
    // the jetty is a quiet walk and a lamp on it reads as a pylon on the shore
    addBox(g, 0.30, 0.42, 0.30, pile, 0.75, 0.83, j.len - 0.5);
    group.add(g);
  }

  /* The quay. Where the circuit runs beside its lake, the shore is a working
     edge: tall creosote posts with cream caps march through the shallows along
     the waterline, close enough to the racing line to be read at speed and to
     be hit by a drift that runs wide. That line of posts is the wall the lake
     is read against, and the map's signature. */
  if (map.pylonWall && map.lake) {
    const lk = map.lake;
    const ca = Math.cos(0.35), sa = Math.sin(0.35);
    // one post every ~3.9 m of waterline, standing just inside it
    const stepT = 3.9 / Math.max(lk.rx - 2, lk.rz - 1.8);
    for (let t = 0; t < Math.PI * 2 - stepT * 0.5; t += stepT) {
      const wx = lk.x + Math.cos(t) * (lk.rx - 2) * 0.965 * ca
        - Math.sin(t) * (lk.rz - 1.8) * 0.965 * sa;
      const wz = lk.z + Math.cos(t) * (lk.rx - 2) * 0.965 * sa
        + Math.sin(t) * (lk.rz - 1.8) * 0.965 * ca;
      // only the stretch the racing line can see, and never on the verge
      if (!nearbyRoad(wx, wz, ROAD_HALF + 17)) continue;
      if (nearbyRoad(wx, wz, ROAD_HALF + 0.7)) continue;
      const g = new THREE.Group();
      const h = 3.1 + rnd() * 1.2;
      g.position.set(wx, 0, wz);
      g.rotation.y = rnd() * 6.28;
      const post = 0x2c2620, cream = 0xe9e4cf;
      addBox(g, 0.36, h, 0.36, post, 0, h / 2, 0);
      addBox(g, 0.46, 0.34, 0.46, cream, 0, h - 0.5, 0);
      group.add(g);
      colliders.push({ x: wx, z: wz, r: 0.45 });
      shadows.push({ x: wx, z: wz, rot: 0, scale: 0.5 });
    }
  }

  /* Cacti: a saguaro has a trunk and two arms that turn up, which is four boxes
     for the silhouette that says desert faster than any palm. */
  if (map.cacti) {
    for (const c of map.cacti) {
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      g.rotation.y = c.rot;
      g.scale.setScalar(c.scale);
      const green = 0x4f7d3f, dark = 0x3c6330;
      addBox(g, 0.95, 3.5, 0.95, green, 0, 1.75, 0);       // trunk
      addBox(g, 0.78, 0.3, 0.78, dark, 0, 3.6, 0);         // crown
      addBox(g, 0.7, 0.62, 0.7, green, -0.86, 1.85, 0);    // left elbow
      addBox(g, 0.58, 1.45, 0.58, green, -0.86, 2.7, 0);   // left arm
      addBox(g, 0.5, 0.22, 0.5, dark, -0.86, 3.45, 0);
      addBox(g, 0.7, 0.62, 0.7, green, 0.88, 2.25, 0);     // right elbow
      addBox(g, 0.58, 1.2, 0.58, green, 0.88, 3.0, 0);     // right arm
      addBox(g, 0.5, 0.22, 0.5, dark, 0.88, 3.62, 0);
      group.add(g);
      colliders.push({ x: c.x, z: c.z, r: 0.7 });
    }
  }

  /* Mirage Mesa's authored furniture: the oil drums and the carousel's banked
     kerb. The drums fence the outside of the lane-2 flick as a slalom line —
     seven of them, two on their sides where somebody went through — and stack
     in the fair's yard beside the carousel, rust and amber against the sand.
     The kerb is the theatre's stage lip: two climbing terracotta tiers with a
     cream cap through the carousel entry, the one stretch where the flat
     painted kerb gives way to a raised edge, so the corner is announced by the
     road itself. Every box lands in the shared instanced bake at the end. */
  if (map.id === 'mesa') {
    const rust = 0xb4553a, orange = 0xc66a2e, inkD = 0x2a2320, amber = 0xf0a828,
      cream = 0xe8d7ab, wood = 0x8a5f3a;
    const drum = (x: number, z: number, rot: number, col: number, tipped = false, y = 0) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      const h = 0.95, w = 0.62;
      if (tipped) {
        addBox(g, h, w, w, col, 0, y + w / 2, 0);
        addBox(g, 0.09, w * 1.05, w * 1.05, inkD, -0.22, y + w / 2, 0);
        addBox(g, 0.09, w * 1.05, w * 1.05, inkD, 0.22, y + w / 2, 0);
      } else {
        addBox(g, w, h, w, col, 0, y + h / 2, 0);
        addBox(g, w * 1.05, 0.07, w * 1.05, inkD, 0, y + h * 0.32, 0);
        addBox(g, w * 1.05, 0.07, w * 1.05, inkD, 0, y + h * 0.68, 0);
        addBox(g, w * 0.9, 0.05, w * 0.9, amber, 0, y + h + 0.025, 0);
      }
      group.add(g);
      if (y === 0) {
        colliders.push({ x, z, r: 0.5 });
        shadows.push({ x, z, rot: 0, scale: 0.55 });
      }
    };
    // the barrel chicane: drums down the outside of the lane-2 flick
    const chicane: [number, number, number][] = [
      [21.3, -16.8, 0.9], [19.0, -17.7, 1.4], [12.8, -19.8, 1.2], [6.0, -19.3, 1.1],
      [2.3, -17.1, 1.5], [-0.7, -14.6, 1.0], [-2.6, -13.0, 1.3],
    ];
    chicane.forEach(([x, z, rot], k) => {
      drum(x, z, rot, k % 3 === 1 ? orange : k % 3 === 2 ? inkD : rust, k === 2 || k === 5);
    });
    // the fair's yard beside the carousel: a stack of drums and crates, the
    // working end of the fairground the corner is named for
    drum(-40.5, 8.0, 0.4, rust);
    drum(-40.5, 8.0, 0.4, orange, false, 0.95);     // stacked on the first
    drum(-39.6, 8.6, 0.9, inkD, true);
    drum(-42.2, 10.0, 0.2, orange, true);
    drum(-41.4, 6.9, 0.55, rust);
    for (const [cx, cz, cr] of [[-41.8, 6.6, 0.5], [-40.4, 11.2, 0.9]] as [number, number, number][]) {
      const g = new THREE.Group();
      g.position.set(cx, 0, cz);
      g.rotation.y = cr;
      addBox(g, 1.15, 0.7, 1.15, wood, 0, 0.35, 0);
      addBox(g, 1.2, 0.08, 0.18, cream, 0, 0.35, 0);
      addBox(g, 0.18, 0.08, 1.2, cream, 0, 0.35, 0);
      addBox(g, 0.95, 0.5, 0.95, wood, 0.15, 0.9, -0.1);
      group.add(g);
      colliders.push({ x: cx, z: cz, r: 0.9 });
      shadows.push({ x: cx, z: cz, rot: 0, scale: 0.9 });
    }

    /* The banked kerb through the carousel entry, in the map's own terracotta
       and cream: blocks in two climbing tiers on the outside of the corner,
       from the entry board down to the tyre stack at the apex. */
    const kFrom = 600, kTo = 648;
    for (let i = kFrom; i <= kTo; i += 4) {
      const p = track[i % track.length], q = track[(i + 4) % track.length];
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = Math.atan2(dx, dz);
      const col = (((i - kFrom) / 4) | 0) % 2 === 0 ? rust : cream;
      // group-local +x is the road normal, and the outside of this corner is
      // the +x side
      const d = Math.hypot(dx, dz) * 1.08;
      addBox(g, 0.50, 0.13, d, col, ROAD_HALF + 0.42, 0.065, 0);
      addBox(g, 0.60, 0.30, d, col, ROAD_HALF + 0.95, 0.15, 0);
      addBox(g, 0.62, 0.05, d, cream, ROAD_HALF + 0.95, 0.325, 0);
      group.add(g);
      if (((i - kFrom) / 4) % 2 === 0) {
        colliders.push({
          x: p.x + nx * (ROAD_HALF + 0.95), z: p.z + nz * (ROAD_HALF + 0.95), r: 0.5,
        });
      }
    }
  }

  /* Buttes: stepped strata with a talus skirt, standing out in the desert. The
     map is named for them and until now it had none. */
  if (map.mesas) {
    for (const m of map.mesas) {
      const g = new THREE.Group();
      g.position.set(m.x, 0, m.z);
      g.rotation.y = m.rot;
      const strata = [0xc08a5a, 0xb2794a, 0xc99465, 0xa96f43];
      const tiers = 4;
      const band = m.h / tiers;
      for (let i = 0; i < tiers; i++) {
        // each tier weathers to its own footprint, so the silhouette is rock
        // and not a staircase
        const f = 1 - i * 0.11;
        const wx = (i % 2 ? 1.08 : 0.92) * f;
        const wz = (i % 2 ? 0.88 : 1.04) * f;
        addBox(g, m.r * 2 * wx, band, m.r * 1.55 * wz, strata[i % strata.length],
          (i % 2 ? -0.05 : 0.06) * m.r, band * (i + 0.5), (i % 2 ? 0.05 : -0.06) * m.r);
      }
      addBox(g, m.r * 2 * 0.72, 0.5, m.r * 1.55 * 0.72, 0xd8a877, 0, m.h + 0.25, 0);
      // talus: the scree apron the rock has shed, with a few slabs come loose
      addBox(g, m.r * 2.5, 0.5, m.r * 2.0, 0xb08a63, 0, 0.25, 0);
      addBox(g, m.r * 0.9, 0.8, m.r * 0.7, 0xa07a52, -m.r * 0.9, 0.4, m.r * 0.6);
      addBox(g, m.r * 0.6, 0.55, m.r * 0.5, 0xb08a63, m.r * 1.05, 0.28, -m.r * 0.5);
      group.add(g);
      // the footprint is solid: the car must not drive into the rock face
      for (let a = 0; a < 6; a++) {
        const t = (a / 6) * Math.PI * 2;
        colliders.push({
          x: m.x + Math.cos(t) * m.r * 0.8,
          z: m.z + Math.sin(t) * m.r * 0.62,
          r: m.r * 0.42,
        });
      }
    }
  }

  if (map.ferris) {
    const f = map.ferris;
    const g = new THREE.Group();
    g.position.set(f.x, 0, f.z);
    g.rotation.y = f.rot;
    g.scale.setScalar(f.scale);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5, 0.18, 4, 30), basic(0xf2eee1));
    rim.position.y = 7.2;
    g.add(rim);
    const rim2 = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.09, 4, 30), basic(0xe0513f));
    rim2.position.y = 7.2;
    g.add(rim2);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 12), basic(0x2b2d33));
    hub.rotation.x = Math.PI / 2;
    hub.position.y = 7.2;
    g.add(hub);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const sp = addBox(g, 0.10, 5, 0.10, 0xd8d8d8,
        Math.cos(a) * 2.5, 7.2 + Math.sin(a) * 2.5, 0);
      sp.rotation.z = a - Math.PI / 2;
      addBox(g, 0.62, 0.62, 0.62, [0xe0513f, 0xf2eee1, 0x2b6d7a][i % 3],
        Math.cos(a) * 5, 7.2 + Math.sin(a) * 5, 0);
    }
    for (const sx of [-3.6, 3.6]) {
      const leg = addBox(g, 0.34, 8.2, 0.34, 0xf2eee1, sx * 0.5, 3.6, 0);
      leg.rotation.z = sx > 0 ? -0.38 : 0.38;
    }
    addBox(g, 8.0, 0.3, 2.0, 0x2b2d33, 0, 0.15, 0);
    group.add(g);
    colliders.push({ x: f.x, z: f.z, r: 4.0 });
  }

  /* The fairground carousel. Mesa's grand corner is named for one, so one
     turns on the grass at the centre of the sweep: a plinth, a striped canopy
     climbing in three tiers, a king pole, and a ring of rider poles with
     mounts between them. Every piece is a box baked into the shared instanced
     mesh, and the whole thing sits inside the corner's radius, clear of the
     racing line on every side. It is the landmark the corner turns around. */
  if (map.carousel) {
    const c = map.carousel;
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    g.rotation.y = c.rot;
    g.scale.setScalar(c.scale);
    const amber = 0xf0a828, terracotta = 0xb4553a, cream = 0xe8d7ab,
      ink = 0x2a2320, wood = 0x8a5f3a;
    // the plinth the whole fair stands on
    addBox(g, 7.4, 0.3, 7.4, cream, 0, 0.15, 0);
    addBox(g, 7.8, 0.14, 7.8, terracotta, 0, 0.02, 0);
    // the king pole
    addBox(g, 0.5, 4.8, 0.5, wood, 0, 2.4, 0);
    addBox(g, 0.56, 0.5, 0.56, cream, 0, 2.5, 0);
    // the canopy: three tiers, each smaller, striped by alternating the tier
    // colour; the scallop board under the rim is the giveaway silhouette
    const tiers: [number, number][] = [[7.2, 4.4], [6.0, 5.05], [4.7, 5.65]];
    for (const [w, y] of tiers) {
      addBox(g, w, 0.5, w, amber, 0, y, 0);
      addBox(g, w * 0.78, 0.5, w * 0.78, terracotta, 0, y + 0.5, 0);
    }
    addBox(g, 7.5, 0.34, 0.6, cream, 0, 4.1, 3.45);
    addBox(g, 7.5, 0.34, 0.6, cream, 0, 4.1, -3.45);
    addBox(g, 0.6, 0.34, 7.5, cream, 3.45, 4.1, 0);
    addBox(g, 0.6, 0.34, 7.5, cream, -3.45, 4.1, 0);
    // the finial
    addBox(g, 0.3, 1.2, 0.3, ink, 0, 6.4, 0);
    addBox(g, 0.6, 0.4, 0.6, amber, 0, 7.1, 0);
    // the rider ring: poles at the rim, mounts hung between them
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = Math.cos(a) * 2.9, pz = Math.sin(a) * 2.9;
      addBox(g, 0.14, 3.9, 0.14, cream, px, 2.05, pz);
      addBox(g, 0.85, 0.62, 1.15, i % 2 ? terracotta : ink, px, 1.15, pz);
      addBox(g, 0.5, 0.5, 0.5, i % 2 ? amber : cream, px, 0.62, pz);
    }
    group.add(g);
    colliders.push({ x: c.x, z: c.z, r: 4.2 });
    shadows.push({ x: c.x, z: c.z, rot: 0, scale: 3.7 });
  }

  if (bridge) {
    const g = new THREE.Group();
    g.position.set(bridge.cx, 0, bridge.cz);
    g.rotation.y = Math.atan2(bridge.dirx, bridge.dirz);
    const W = bridge.halfW * 2;
    const H = bridge.height;
    const rp = bridge.ramp;
    const segs = 18;

    const deckMat = new THREE.MeshBasicMaterial({ color: 0x6b4a3a, toneMapped: false });
    const verts: number[] = [];
    for (let i = 0; i < segs; i++) {
      const za = -rp + (2 * rp * i) / segs;
      const zb = -rp + (2 * rp * (i + 1)) / segs;
      const ya = bridgeHeight(za), yb = bridgeHeight(zb);
      verts.push(-W / 2, ya, za, W / 2, yb, zb, W / 2, ya, za);
      verts.push(-W / 2, ya, za, -W / 2, yb, zb, W / 2, yb, zb);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, deckMat));

    for (let i = 1; i < segs; i++) {
      const z = -rp + (2 * rp * i) / segs;
      addBox(g, W - 0.34, 0.020, 0.10, 0x4a3228, 0, bridgeHeight(z) + 0.025, z);
    }
    const beam = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, color: number) => {
      const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
      const d = b.clone().sub(a);
      const o = addBox(g, t, d.length(), t, color, 0, 0, 0);
      o.position.copy(a).addScaledVector(d, 0.5);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    };

    for (const sx of [-W / 2 + 0.12, W / 2 - 0.12]) {
      for (let i = 0; i < segs; i++) {
        const za = -rp + (2 * rp * i) / segs;
        const zb = -rp + (2 * rp * (i + 1)) / segs;
        const ya = bridgeHeight(za), yb = bridgeHeight(zb);
        beam(sx, ya + 0.04, za, sx, yb + 0.04, zb, 0.22, 0xf2eee1);
        beam(sx, ya + 0.55, za, sx, yb + 0.55, zb, 0.085, 0xb5523f);
        beam(sx, ya + 1.02, za, sx, yb + 1.02, zb, 0.075, 0xb5523f);
      }
      for (let i = 0; i <= segs; i++) {
        const z = -rp + (2 * rp * i) / segs;
        const y = bridgeHeight(z);
        addBox(g, 0.13, 0.95, 0.13, 0xb5523f, sx, y + 0.50, z);
        if (i % 4 === 0) {
          addBox(g, 0.30, 0.34, 0.30, 0xffe1a0, sx, y + 1.20, z);
          addBox(g, 0.46, 0.10, 0.46, 0x2b2d33, sx, y + 1.42, z);
        }
      }
    }

    const stone = 0xa8adb3;
    for (const sx of [-W / 2 + 0.58, W / 2 - 0.58]) {
      for (const z of [-5.8, 5.8]) {
        const h = bridgeHeight(z);
        addBox(g, 0.58, h, 0.58, stone, sx, h / 2, z);
        const wx = bridge.cx + sx * bridge.dirz + z * bridge.dirx;
        const wz = bridge.cz - sx * bridge.dirx + z * bridge.dirz;
        colliders.push({ x: wx, z: wz, r: 0.5 });
      }
    }
    addBox(g, W - 0.7, 0.28, 0.55, stone, 0, H - 0.34, 0);
    for (const sx of [-W / 2 + 0.35, W / 2 - 0.35]) {
      for (let z = -10; z <= 10; z += 2.5) {
        const wx = bridge.cx + sx * bridge.dirz + z * bridge.dirx;
        const wz = bridge.cz - sx * bridge.dirx + z * bridge.dirz;
        bridgeColliders.push({ x: wx, z: wz, r: 0.35 });
      }
    }

    for (const sx of [-W / 2 - 0.02, W / 2 + 0.02]) {
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 0.95),
        new THREE.MeshBasicMaterial({ map: jpBoardTexture('桜橋', '#c8463c'), toneMapped: false }),
      );
      plaque.position.set(sx, H + 0.72, 0);
      plaque.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(plaque);
    }
    group.add(g);
  }

  if (map.pagoda) {
    const pd = map.pagoda;
    const g = new THREE.Group();
    g.position.set(pd.x, 0, pd.z);
    g.rotation.y = pd.rot;
    g.scale.setScalar(pd.scale);
    const red = 0xc8463c, roof = 0x8f2f2f, cream = 0xe8dcc2, stone = 0x9aa0a6, gold = 0xd9b45a;
    addBox(g, 9.2, 0.6, 9.2, stone, 0, 0.3, 0);
    addBox(g, 4.8, 3.0, 4.8, cream, 0, 2.1, 0);
    for (const px of [-2.1, 2.1]) for (const pz of [-2.1, 2.1]) {
      addBox(g, 0.34, 3.2, 0.34, red, px, 2.1, pz);
    }
    addBox(g, 7.6, 0.45, 7.6, roof, 0, 3.85, 0);
    addBox(g, 7.9, 0.10, 7.9, cream, 0, 4.05, 0);
    addBox(g, 3.6, 2.6, 3.6, cream, 0, 5.35, 0);
    for (const px of [-1.5, 1.5]) for (const pz of [-1.5, 1.5]) {
      addBox(g, 0.28, 2.8, 0.28, red, px, 5.35, pz);
    }
    addBox(g, 6.4, 0.42, 6.4, roof, 0, 6.85, 0);
    addBox(g, 6.7, 0.10, 6.7, cream, 0, 7.04, 0);
    addBox(g, 2.6, 2.2, 2.6, cream, 0, 8.15, 0);
    for (const px of [-1.0, 1.0]) for (const pz of [-1.0, 1.0]) {
      addBox(g, 0.24, 2.4, 0.24, red, px, 8.15, pz);
    }
    addBox(g, 5.2, 0.38, 5.2, roof, 0, 9.45, 0);
    addBox(g, 5.5, 0.10, 5.5, cream, 0, 9.62, 0);
    addBox(g, 0.22, 1.7, 0.22, gold, 0, 10.4, 0);
    group.add(g);
    colliders.push({ x: pd.x, z: pd.z, r: 5.2 });
  }

  if (map.pondBridge && map.lake) {
    const g = new THREE.Group();
    g.position.set(map.lake.x, 0, map.lake.z);
    const red = 0xc8463c, deck = 0xd9b45a;
    for (let i = -2; i <= 2; i++) {
      const h = 1.2 + (1 - Math.abs(i) / 2) * 0.9;
      addBox(g, 3.4, 0.18, 2.4, deck, i * 3.1, h, 0);
      for (const zs of [-1.25, 1.25]) addBox(g, 0.14, 0.9, 0.14, red, i * 3.1, h + 0.6, zs);
    }
    for (const zs of [-1.25, 1.25]) {
      addBox(g, 15.6, 0.12, 0.12, red, 0, 2.65, zs);
      addBox(g, 15.6, 0.10, 0.10, red, 0, 2.15, zs);
    }
    group.add(g);
  }

  if (map.fuji) {
    const f = map.fuji;
    const g = new THREE.Group();
    g.position.set(f.x, 0, f.z);
    g.scale.setScalar(f.scale);
    const base = new THREE.Mesh(new THREE.ConeGeometry(24, 32, 6), basic(0x6f8296));
    base.position.y = 16;
    g.add(base);
    const snow = new THREE.Mesh(new THREE.ConeGeometry(8.5, 11, 6), basic(0xf2f6f8));
    snow.position.y = 26.5;
    g.add(snow);
    group.add(g);
  }

  if (map.torii) {
    const t = map.torii;
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    g.rotation.y = t.rot;
    g.scale.setScalar(t.scale);
    const red = 0xc8463c, ink = 0x1d1f24;
    addBox(g, 0.55, 6.0, 0.55, red, -2.2, 3.0, 0);
    addBox(g, 0.55, 6.0, 0.55, red, 2.2, 3.0, 0);
    addBox(g, 6.3, 0.50, 0.70, red, 0, 6.1, 0);
    addBox(g, 5.4, 0.36, 0.62, red, 0, 4.9, 0);
    addBox(g, 6.9, 0.14, 0.82, ink, 0, 6.42, 0);
    addBox(g, 0.8, 0.25, 0.8, ink, -2.2, 0.12, 0);
    addBox(g, 0.8, 0.25, 0.8, ink, 2.2, 0.12, 0);
    group.add(g);
    colliders.push({ x: t.x - 2.2, z: t.z, r: 0.7 }, { x: t.x + 2.2, z: t.z, r: 0.7 });
  }

  if (map.snowGear) {
    const white = 0xf4f8fb, blue = 0x4f8fb5, red = 0xc8463c, ink = 0x22262c, steel = 0x9aa7b0;

    /* The lift climbs out of the south bowl toward the map edge: three pylons,
       each taller than the last, with the cable rising over them. A lift that
       stands in a field reads as scaffolding; a lift that climbs reads as a
       mountain. */
    const lift = new THREE.Group();
    const LX = 42;
    const pylons: [number, number][] = [[-48, 6.0], [-62, 8.2], [-76, 10.4]];
    const armY = (z: number) => pylons.find(([pz]) => pz === z)![1] + 0.3;
    for (const [pz, h] of pylons) {
      addBox(lift, 0.55, h, 0.55, steel, LX, h / 2, pz);
      addBox(lift, 3.4, 0.24, 0.3, steel, LX, h + 0.3, pz);
      addBox(lift, 0.32, 0.34, 0.32, red, LX - 1.6, h + 0.1, pz);
      addBox(lift, 0.32, 0.34, 0.32, red, LX + 1.6, h + 0.1, pz);
    }
    // the haul cable, rising pylon to pylon
    const slope = (ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      t: number, color: number) => {
      const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
      const d = b.clone().sub(a);
      const o = addBox(lift, t, d.length(), t, color, 0, 0, 0);
      o.position.copy(a).addScaledVector(d, 0.5);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    };
    for (const cx of [LX - 1.5, LX + 1.5]) {
      slope(cx, armY(-48), -48, cx, armY(-62), -62, 0.12, ink);
      slope(cx, armY(-62), -62, cx, armY(-76), -76, 0.12, ink);
    }
    // chairs riding the cable, hanging level while it climbs
    for (const [cz, f] of [[-53, 0.18], [-58, 0.36], [-68, 0.64], [-72, 0.82]] as [number, number][]) {
      const y = armY(-48) + (armY(-76) - armY(-48)) * f;
      addBox(lift, 0.08, 1.0, 0.08, ink, LX, y - 0.5, cz);
      addBox(lift, 1.0, 1.15, 1.15, red, LX, y - 1.3, cz);
      addBox(lift, 0.8, 0.7, 0.9, white, LX, y - 1.25, cz);
    }
    group.add(lift);

    const cannon = (x: number, z: number, rot: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      addBox(g, 1.0, 0.28, 1.0, ink, 0, 0.14, 0);
      addBox(g, 0.55, 2.3, 0.55, white, 0, 1.3, 0);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.38, 2.0, 8), basic(blue));
      barrel.rotation.x = Math.PI / 2.7;
      barrel.position.set(0, 2.65, 0.65);
      g.add(barrel);
      addBox(g, 0.75, 0.75, 0.10, ink, 0, 2.9, 1.55);
      const pile = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.0, 7), basic(white));
      pile.position.set(0, 0.5, 2.0);
      g.add(pile);
      group.add(g);
      colliders.push({ x, z, r: 1.1 });
    };
    cannon(-55, 20, 0.6);
    cannon(61, -28, -0.7);
    cannon(20, -56, Math.PI);

    // Scan outward from the service area for a patch free enough to park the
    // snowcat, so rocks or trees never evict it.
    let catAt: [number, number] | null = null;
    for (let a = 0; a < 96 && !catAt; a++) {
      const ang = a * 0.61;
      const rad = 7 + (a % 6) * 3.5;
      const px = 34 + Math.cos(ang) * rad;
      const pz = 6 + Math.sin(ang) * rad;
      if (free(px, pz, 3)) catAt = [px, pz];
    }
    if (catAt) {
      const [cx, cz] = catAt;
      const g = new THREE.Group();
      g.position.set(cx, 0, cz);
      g.rotation.y = 0.4;
      addBox(g, 4.2, 1.2, 2.0, red, 0, 1.0, 0);
      addBox(g, 2.0, 1.2, 1.7, white, -0.7, 2.05, 0);
      addBox(g, 1.7, 0.7, 1.5, ink, -0.7, 2.15, -0.58);
      for (const sx of [-1.6, 1.6]) {
        addBox(g, 0.55, 1.2, 3.0, ink, sx, 0.62, 0);
        for (const z of [-0.9, 0, 0.9]) addBox(g, 0.62, 0.10, 0.16, steel, sx, 0.74, z);
      }
      const blade = addBox(g, 4.2, 1.5, 0.22, white, 0, 0.85, 2.15);
      blade.rotation.x = -0.18;
      addBox(g, 0.25, 2.2, 0.25, red, -1.1, 3.1, -0.65);
      addBox(g, 0.25, 2.2, 0.25, red, 1.1, 3.1, -0.65);
      group.add(g);
      colliders.push({ x: cx, z: cz, r: 3.2 });
    }

    if (map.lake) {
      // the base station huts, at the foot of the lift and clear of the ice
      const huts: [number, number, number][] = [[47, -42, 0.3], [52, -46, -0.4], [44, -46, 0.8]];
      for (const [x, z, rot] of huts) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = rot;
        addBox(g, 2.2, 1.7, 2.2, white, 0, 0.85, 0);
        addBox(g, 2.5, 0.22, 2.5, blue, 0, 1.8, 0);
        addBox(g, 0.55, 1.0, 0.08, ink, 0, 0.8, 1.12);
        addBox(g, 0.22, 0.9, 0.22, ink, 0.6, 2.2, -0.4);
        group.add(g);
        colliders.push({ x, z, r: 1.7 });
      }
    }

    if (map.lake) {
      /* The banked kerb on the lake straight: the one stretch where the flat
         painted kerb gives way to raised blue-and-white blocks in two
         climbing tiers, so the frozen lake behind them is announced by the
         road itself. Every block is baked into the shared instanced mesh. */
      const kerbWhite = 0xf2f6f8, kerbBlue = 0x3f6fb0;
      const from = 612, to = 700;
      for (let i = from; i <= to; i += 4) {
        const p = track[i % track.length], q = track[(i + 4) % track.length];
        const dx = q.x - p.x, dz = q.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = dz / len, nz = -dx / len;
        const g = new THREE.Group();
        g.position.set(p.x, 0, p.z);
        g.rotation.y = Math.atan2(dx, dz);
        const col = (((i - from) / 4) | 0) % 2 === 0 ? kerbWhite : kerbBlue;
        // group-local x is the road normal; the lake is on the -x side here
        const d = Math.hypot(dx, dz) * 1.08;
        addBox(g, 0.50, 0.13, d, col, -(ROAD_HALF + 0.42), 0.065, 0);
        addBox(g, 0.60, 0.30, d, col, -(ROAD_HALF + 0.95), 0.15, 0);
        addBox(g, 0.62, 0.05, d, white, -(ROAD_HALF + 0.95), 0.325, 0);
        group.add(g);
        if (((i - from) / 4) % 2 === 0) {
          colliders.push({ x: p.x + nx * -(ROAD_HALF + 0.95), z: p.z + nz * -(ROAD_HALF + 0.95), r: 0.5 });
        }
      }

      /* The ice camp on the lake's north-west rim: two huts, a sled and a
         wood pile on the shore, and tip-ups standing over the two fishing
         holes painted in the ice. This is what makes the lake a destination
         instead of a blue patch. */
      const camp: [number, number, number][] = [[-8, 15.5, 0.5], [-11.2, 12.8, -0.2]];
      for (const [x, z, rot] of camp) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = rot;
        addBox(g, 2.2, 1.7, 2.2, white, 0, 0.85, 0);
        addBox(g, 2.5, 0.22, 2.5, blue, 0, 1.8, 0);
        addBox(g, 0.55, 1.0, 0.08, ink, 0, 0.8, 1.12);
        addBox(g, 0.22, 0.9, 0.22, ink, 0.6, 2.2, -0.4);
        group.add(g);
        colliders.push({ x, z, r: 1.7 });
      }
      // the sled, parked by the hut, runner-side to the lake
      {
        const g = new THREE.Group();
        g.position.set(-5.6, 0, 14.6);
        g.rotation.y = 0.9;
        addBox(g, 1.5, 0.10, 0.9, red, 0, 0.14, 0);
        addBox(g, 0.12, 0.12, 0.9, ink, -0.66, 0.07, 0);
        addBox(g, 0.12, 0.12, 0.9, ink, 0.66, 0.07, 0);
        addBox(g, 1.5, 0.28, 0.10, red, 0.66, 0.32, 0);
        group.add(g);
      }
      // the wood pile, snow-capped
      {
        const g = new THREE.Group();
        g.position.set(-9.5, 0, 18);
        g.rotation.y = 0.25;
        for (let k = 0; k < 3; k++) {
          addBox(g, 0.34, 0.34, 1.7, ink, (k - 1) * 0.36, 0.17, 0);
          addBox(g, 0.36, 0.10, 1.6, white, (k - 1) * 0.36, 0.39, 0);
        }
        group.add(g);
      }
      // tip-ups over the painted holes: a pole, a spool and a blue flag
      for (const [x, z] of [[-4.5, 10.5], [-1.5, 12.5]] as [number, number][]) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = x;
        addBox(g, 0.5, 0.1, 0.5, white, 0, 0.05, 0);
        addBox(g, 0.07, 1.0, 0.07, ink, 0, 0.5, 0);
        addBox(g, 0.24, 0.18, 0.04, blue, 0.15, 1.0, 0);
        group.add(g);
        colliders.push({ x, z, r: 0.3 });
      }
    }
  }

  let snowfall: { points: THREE.Points; pos: Float32Array; speed: Float32Array } | null = null;
  if (map.snow) {
    // 2400 flakes at 2 px: the fall reads as weather from the chase camera
    // without the whiteout that hides the road ahead
    const N = 2400;
    const pos = new Float32Array(N * 3);
    const speed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * WORLD;
      pos[i * 3 + 1] = Math.random() * 32;
      pos[i * 3 + 2] = (Math.random() - 0.5) * WORLD;
      speed[i] = 0.018 + Math.random() * 0.025;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 2, sizeAttenuation: false,
      transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    group.add(points);
    snowfall = { points, pos, speed };
  }

  const tint = map.tint ? new THREE.Color(map.tint) : undefined;
  group.add(instancedStack(map.snow ? snowTex : pineTex, map.snow ? defs.snowpine : defs.pine, pines, tint));
  group.add(instancedStack(sakuraTex, defs.sakura, sakuras, tint));
  group.add(instancedStack(palmTex, defs.palm, palms, tint));
  group.add(instancedStack(rockTex, defs.rock, rocks, tint));
  group.add(instancedStack(lampTex, defs.lamp, lamps, tint));
  group.add(instancedStack(tyreTex, defs.tyres, tyres, tint));
  group.add(instancedStack(bldA, defs.bldA, buildings[0], tint));
  group.add(instancedStack(bldB, defs.bldB, buildings[1], tint));
  group.add(instancedStack(bldC, defs.bldC, buildings[2], tint));
  group.add(shadowPatch(shadowTex, shadows, 2.6));

  const si = straightestIndex(track, map.overpass ? 46 : 0);
  const ahead = track.length > 300 ? 8 : 3;
  const s0 = track[si], s1 = track[(si + ahead) % track.length];
  const start = { x: s0.x, z: s0.z, heading: Math.atan2(-(s1.x - s0.x), -(s1.z - s0.z)) };

  {
    const g = new THREE.Group();
    const ink = 0x2a2d33;
    const span = (ROAD_HALF + 1.6) * 2;
    for (const side of [-1, 1]) {
      addBox(g, 0.28, 5.2, 0.28, ink, side * (span / 2 - 0.14), 2.6, 0);
      addBox(g, 0.7, 0.18, 0.7, ink, side * (span / 2 - 0.14), 0.09, 0);
    }
    addBox(g, span, 0.3, 0.36, ink, 0, 5.2, 0);

    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 48;
    const c2 = cv.getContext('2d')!;
    c2.fillStyle = '#f2eee1'; c2.fillRect(0, 0, 256, 48);
    for (let i = 0; i < 32; i++) {
      c2.fillStyle = i % 2 === 0 ? '#22252a' : '#f2eee1';
      c2.fillRect(i * 8, 0, 8, 10);
    }
    c2.fillStyle = '#22252a';
    c2.textAlign = 'center';
    if (map.id === 'sakura') {
      c2.font = 'bold 19px "Noto Sans CJK JP", "Noto Sans JP", sans-serif';
      c2.fillText('桜サーキット', 128, 34);
    } else if (map.id === 'interlagos') {
      c2.fillStyle = '#0b8043'; c2.fillRect(0, 10, 256, 38);
      c2.fillStyle = '#ffce00'; c2.fillRect(0, 10, 256, 3); c2.fillRect(0, 45, 256, 3);
      c2.fillStyle = '#ffce00';
      c2.font = 'bold 21px monospace';
      c2.fillText('INTERLAGOS', 128, 35);
    } else if (map.id === 'mesa') {
      c2.font = 'bold 16px monospace';
      c2.fillText('MIRAGE MESA', 128, 34);
    } else {
      c2.font = 'bold 16px monospace';
      c2.fillText('PIXEL DRIFT', 128, 34);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const bannerGeo = new THREE.PlaneGeometry(span - 0.6, 0.95);
    for (const zside of [0.19, -0.19]) {
      const banner = new THREE.Mesh(bannerGeo, new THREE.MeshBasicMaterial({
        map: tex, side: THREE.DoubleSide, toneMapped: false,
      }));
      banner.position.set(0, 4.6, zside);
      banner.rotation.y = zside > 0 ? 0 : Math.PI;
      // Named so main.ts can hide it behind the title.
      banner.name = 'gantryBanner';
      g.add(banner);
    }

    g.position.set(start.x, 0, start.z);
    g.rotation.y = start.heading;
    group.add(g);
  }

  {
    const furniture = new THREE.Group();
    const postColor = 0x24262b;
    const backMat = new THREE.MeshBasicMaterial({ color: 0xe8e2d2, toneMapped: false });
    const n = track.length;

    const placeBoard = (x: number, z: number, rot: number, tex: THREE.Texture,
      w: number, h: number, bottom: number) => {
      // never on the water or on the beach it frames: a board on a shore reads
      // as a sign nailed to the lake
      if (inLake(x, z, 1.4)) return;
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        addBox(g, 0.12, bottom + h * 0.5, 0.12, postColor,
          side * (w / 2 - 0.22), (bottom + h * 0.5) / 2, 0);
      }
      const geo = new THREE.PlaneGeometry(w, h);
      const face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      face.position.set(0, bottom + h / 2, 0.02);
      g.add(face);
      const back = new THREE.Mesh(geo, backMat);
      back.position.set(0, bottom + h / 2, -0.02);
      back.rotation.y = Math.PI;
      g.add(back);
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      furniture.add(g);
    };

    let ccx = 0, ccz = 0;
    for (const p of track) { ccx += p.x; ccz += p.z; }
    ccx /= n; ccz /= n;

    const sideAt = (p: P2, nx: number, nz: number) => {
      const a = Math.hypot(p.x + nx * 4 - ccx, p.z + nz * 4 - ccz);
      const b = Math.hypot(p.x - nx * 4 - ccx, p.z - nz * 4 - ccz);
      return a > b ? 1 : -1;
    };

    const brMap = map.id === 'interlagos';
    const alpineMap = map.id === 'alpine';
    const mesaMap = map.id === 'mesa';
    const straightLabels = map.id === 'sakura'
      ? ['桜', '鈴鹿', '日本', '富士', '速度', '東京']
      : brMap
        ? ['INTERLAGOS', 'SENNA', 'BRASIL', 'SÃO PAULO', 'OLEO', 'PIXEL']
        : alpineMap
          ? ['FROSTBITE', 'GLACIER', 'ICEWORKS', 'NORTH PASS', 'SNOWLINE', 'PIXEL']
          : mesaMap
            ? ['MIRAGE', 'OASIS', 'MESA', 'DRY LAKE', 'DUST DEVIL', 'PIXEL']
            : ['PIXEL', 'TURBO', 'DRIFT', '8-BIT', 'NITRO', 'OIL'];
    /* Frostbite's boards stay in its own accent family — ice blue and ink on
       cream — and Mirage Mesa's speak in dust orange, amber and ink, so a
       board never reads as another map's furniture in the tan. */
    const accents = alpineMap
      ? ['#3f6fb0', '#22262c', '#7fb3d0']
      : mesaMap
        ? ['#c66a2e', '#1d1f24', '#f0a828']
        : ['#e0513f', '#2b6d7a', '#b5432f'];

    let bi = 0;
    const brSpots: number[] = [];
    for (let k = -140; k <= 140; k += 34) {
      if (Math.abs(k) < 22) continue;
      // on the Brazilian map the run out of the line is the Senna S, and that
      // stretch gets its own boards below
      if (brMap && k > 22) continue;
      const i = (((si + k) % n) + n) % n;
      const p = track[i], q = track[(i + 4) % n];
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;
      const side = sideAt(p, nx, nz);
      const off = ROAD_HALF + 2.0 + (bi % 2) * 0.3;
      const x = p.x + nx * side * off;
      const z = p.z + nz * side * off;
      const rot = Math.atan2(-dx, -dz) - side * 0.55;
      const tex = map.id === 'sakura'
        ? jpBoardTexture(straightLabels[bi % straightLabels.length], accents[bi % accents.length])
        : brMap
          ? brBoardTexture(straightLabels[bi % straightLabels.length], bi % 2 === 0)
          : boardTexture(straightLabels[bi % straightLabels.length], accents[bi % accents.length]);
      placeBoard(x, z, rot, tex, 3.9, 1.18, 1.05);
      bi++;
    }

    if (map.id === 'sakura') {
      const banners = ['桜', '鈴鹿'];
      banners.forEach((label, k) => {
        const i = (((si + (k === 0 ? -16 : 16)) % n) + n) % n;
        const p = track[i], q = track[(i + 4) % n];
        const dx = q.x - p.x, dz = q.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = dz / len, nz = -dx / len;
        const side = sideAt(p, nx, nz);
        const x = p.x + nx * side * (ROAD_HALF + 2.6);
        const z = p.z + nz * side * (ROAD_HALF + 2.6);
        const rot = Math.atan2(-dx, -dz) - side * 0.35;
        placeBoard(x, z, rot, jpBannerTexture(label, k === 0 ? '#c8463c' : '#22252a'), 1.5, 3.4, 1.1);
      });
    }

    /* Senna S. This is the corner the circuit is known by, so it gets the
       furniture: yellow and green boards down the outside of the first two
       turns and a standing banner on the inside apex, where the chase camera
       looks straight through the corner. Key corners round the rest of the lap
       take the same colours at a smaller size. */
    if (brMap) {
      const spot = (k: number, outward: boolean, label: string, yellow: boolean,
        w: number, h: number, banner = false) => {
        const i = (((si + k) % n) + n) % n;
        const p = track[i], q = track[(i + 4) % n];
        const dx = q.x - p.x, dz = q.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = dz / len, nz = -dx / len;
        // the side a board belongs on is the side of the corner it points at,
        // which on a run-up is the curvature a dozen samples further on
        const turn = curvature(track, (i + 12) % n) || curvature(track, i);
        const side = (turn > 0 ? 1 : -1) * (outward ? 1 : -1);
        const off = ROAD_HALF + 2.7;
        const x = p.x + nx * side * off;
        const z = p.z + nz * side * off;
        // nothing in the way: not tarmac, not water
        if (nearbyRoad(x, z, ROAD_HALF + 1.0)) return;
        if (inLake(x, z, 0.5)) return;
        const rot = Math.atan2(-dx, -dz) - side * 0.5;
        const tex = banner ? brBannerTexture(label, yellow) : brBoardTexture(label, yellow);
        placeBoard(x, z, rot, tex, w, h, banner ? 1.15 : 1.2);
        brSpots.push(i);
      };
      spot(50, true, 'SENNA', true, 5.4, 1.7);          // run-up to turn 1
      spot(56, true, 'AYRTON', false, 4.2, 1.35);
      spot(64, false, 'SENNA', true, 1.6, 3.6, true);   // inside of turn 1
      spot(72, true, 'S DO SENNA', true, 4.6, 1.45);    // outside of turn 2
      spot(80, true, 'BRASIL', false, 4.2, 1.35);
      spot(90, true, 'PIXEL', true, 3.9, 1.18);
      spot(96, false, 'BRASIL', true, 1.6, 3.6, true);  // inside of turn 3
      spot(112, true, 'INTERLAGOS', false, 4.6, 1.45);  // out onto the back straight
      spot(258, true, 'SENNA', true, 4.4, 1.4);
      spot(348, true, 'SÃO PAULO', false, 4.4, 1.4);
      spot(398, true, 'OLEO', true, 3.9, 1.18);
      spot(-26, true, 'INTERLAGOS', true, 4.4, 1.4);    // the last corner
    }

    /* The carousel theatre. The grand carousel is the corner the map is read
       from, so its hoardings are composed as one backdrop: six boards down
       the outside of the sweep, each angled back up the road so the whole arc
       faces the car as it arrives, with a standing banner at the entry gate
       and two boards fencing the barrel chicane on the far side of the lap. */
    if (mesaMap) {
      // absolute track indices: the entry gate, then the sweep to the apex
      const theatreBoards: [number, string, boolean][] = [
        [606, 'MIRAGE', true],
        [618, 'MESA', false],
        [630, 'OASIS', true],
        [642, 'MESA', false],
        [654, 'DUST DEVIL', true],
        [666, 'MIRAGE', false],
      ];
      for (const [k, label, big] of theatreBoards) {
        const i = ((k % n) + n) % n;
        const p = track[i], q = track[(i + 4) % n];
        const dx = q.x - p.x, dz = q.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = dz / len, nz = -dx / len;
        // the outside of this left-hand sweep is the +normal side
        const x = p.x + nx * (ROAD_HALF + 2.6);
        const z = p.z + nz * (ROAD_HALF + 2.6);
        if (nearbyRoad(x, z, ROAD_HALF + 1.0)) continue;
        const rot = Math.atan2(-dx, -dz) + 0.5;
        placeBoard(x, z, rot, boardTexture(label, big ? '#c66a2e' : '#1d1f24'),
          big ? 5.0 : 3.9, big ? 1.6 : 1.18, 1.2);
      }
      // the standing banner at the entry gate, the fair's sign
      {
        const i = 602 % n;
        const p = track[i], q = track[(i + 4) % n];
        const dx = q.x - p.x, dz = q.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = dz / len, nz = -dx / len;
        const x = p.x + nx * (ROAD_HALF + 2.4);
        const z = p.z + nz * (ROAD_HALF + 2.4);
        const rot = Math.atan2(-dx, -dz) + 0.4;
        placeBoard(x, z, rot, mesaBannerTexture('MIRAGE', '#c66a2e'), 1.6, 3.6, 1.1);
      }
      // and the chicane's boards, on the drift side of the lane-2 flick
      const chicaneBoards: [number, string][] = [[136, 'OIL'], [172, 'DUST']];
      for (const [k, label] of chicaneBoards) {
        const i = ((k % n) + n) % n;
        const p = track[i], q = track[(i + 4) % n];
        const dx = q.x - p.x, dz = q.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = dz / len, nz = -dx / len;
        // the drums fence the -normal side; the boards stand behind them
        const x = p.x - nx * (ROAD_HALF + 3.6);
        const z = p.z - nz * (ROAD_HALF + 3.6);
        if (nearbyRoad(x, z, ROAD_HALF + 1.0)) continue;
        const rot = Math.atan2(-dx, -dz) - 0.45;
        placeBoard(x, z, rot, boardTexture(label, '#f0a828'), 3.9, 1.18, 1.05);
      }
    }

    const curvAt = (i: number) => {
      const a = track[(i - 8 + n) % n], b = track[i], c = track[(i + 8) % n];
      const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
      const l1 = Math.hypot(v1x, v1z) || 1, l2 = Math.hypot(v2x, v2z) || 1;
      return (v1x * v2z - v1z * v2x) / (l1 * l2);
    };
    let lastBoard = -999;
    for (let i = 0; i < n; i++) {
      const c = Math.abs(curvAt(i));
      if (c < 0.14 || c < Math.abs(curvAt((i - 1 + n) % n)) || c < Math.abs(curvAt((i + 1) % n))) continue;
      if (i - lastBoard < 80) continue;
      // do not stack a chevron on top of a board that is already there
      if (brSpots.some((s) => Math.min(Math.abs(s - i), n - Math.abs(s - i)) < 22)) continue;
      const p = track[i], q = track[(i + 4) % n], r = track[(i - 4 + n) % n];
      const tx = q.x - r.x, tz = q.z - r.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = tz / len, nz = -tx / len;
      const side = curvAt(i) > 0 ? 1 : -1;
      const x = p.x + nx * side * (ROAD_HALF + 3.0);
      const z = p.z + nz * side * (ROAD_HALF + 3.0);
      lastBoard = i;
      if (nearbyRoad(x, z, ROAD_HALF + 1.2)) continue;
      const rot = Math.atan2(-tx, -tz) - side * 0.35;
      placeBoard(x, z, rot, arrowTexture(curvAt(i) > 0 ? 1 : -1), 2.1, 2.1, 1.0);
    }
    group.add(furniture);
  }

  // Everything above drew boxes one mesh at a time. Collapse them now: one
  // instanced mesh per colour for the whole furniture layer of the map.
  bakeBoxes(group);

  return {
    group, colliders, roadAt, kerbAt, start, addSkid, clearSkid,
    roadHalf: ROAD_HALF,
    half: HALF,
    sky: map.sky ?? '#4e7a45',
    minimapPath: track.filter((_, i) => i % 2 === 0),
    track,
    groundAt,
    bridgeColliders: bridge ? bridgeColliders : undefined,
    update() {
      if (skidDirty) {
        skidTex.needsUpdate = true;
        skidDirty = false;
      }
      if (snowfall) {
        const p = snowfall.pos;
        for (let i = 0; i < snowfall.speed.length; i++) {
          p[i * 3 + 1] -= snowfall.speed[i];
          p[i * 3] += 0.004;
          if (p[i * 3 + 1] < 0) {
            p[i * 3 + 1] = 30 + Math.random() * 4;
            p[i * 3] = (Math.random() - 0.5) * WORLD;
            p[i * 3 + 2] = (Math.random() - 0.5) * WORLD;
          }
        }
        (snowfall.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
    },
  };
}
