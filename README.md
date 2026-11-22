# Sprite Drift

A pixel-art racer where every car and prop is **sprite stacking**: a stack of
flat pixel slices drawn one pixel apart, so a 2D sprite turns like a 3D model.

- Four hand-tuned circuits (Saltmarsh Coast, Redrock Canyon, Neon Docks, Frostbite Pass)
- Real drift physics: grip, handbrake, slip angle, tyre smoke and skid marks
- Nine cars, carved from four flat views — including a sofa, a pizza van and a hot dog
- Renders at 360 lines and upscales with nearest-neighbour, so the world and HUD share one pixel grid

## Run

```bash
npm install
npm run dev      # http://127.0.0.1:5180
```

`npm run assets` regenerates every sprite (`public/sprites/*.png`) and writes
flattened previews to `preview/`.

## Controls

| Action | Keys |
| --- | --- |
| Drive | WASD / arrows |
| Handbrake drift | Space |
| Look around | Q / E or drag |
| Zoom | mouse wheel |
| Reset | R |
| Pause | P or Esc |
| Mute | M |

## How the art works

`scripts/gen-assets.mjs` authors each object as four orthographic views
(top, side, front, back). A voxel exists only where all four agree; the top
face takes the top view's colour and exposed side faces take the colour of the
view they face. The volume is then emitted as a vertical atlas, one slice per
pixel of height, which `src/stack.ts` draws as offset planes.

## Maps

`?map=coast|canyon|night|alpine` — or pick one on the title screen.
