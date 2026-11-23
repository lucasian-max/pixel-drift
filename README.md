# Sprite Drift

A pixel-art racer built on **sprite stacking**: every car and prop is a stack of
flat pixel slices drawn one pixel apart, so a 2D sprite turns like a 3D model.

![Sprite Drift](docs/title.png)

## Play

```bash
npm install
npm run dev      # http://127.0.0.1:5180
```

| Action | Keys |
| --- | --- |
| Drive | WASD / arrows |
| Handbrake drift | Space |
| Look around | Q / E or drag |
| Zoom | mouse wheel |
| Reset | R |
| Pause | P or Esc |
| Mute | M |

## Race online

Pick **RACE ONLINE** on the title screen to make a room. The four-character
code is in the URL (`?room=WUAP`) and on the title, so sending the link is
joining the room. Up to eight racers share the circuit; each car is simulated
locally and broadcast at 20 Hz, with server-side lap sanity checks.

The API and WebSocket live at `api.lucasian.tech`; see
[`docs/multiplayer.md`](docs/multiplayer.md) and [`server/README.md`](server/README.md).

## Four circuits

| | |
| --- | --- |
| **Saltmarsh Coast** — green, a lake, pines and palms | **Redrock Canyon** — sand, red kerbs, sparse pines |
| ![coast](docs/coast.png) | ![canyon](docs/canyon.png) |
| **Neon Docks** — dark, tight, yellow kerbs | **Frostbite Pass** — snow, blue kerbs, white pines |
| ![night](docs/night.png) | ![alpine](docs/alpine.png) |

Pick a circuit on the title screen with the arrows, or link straight to one:
`?map=coast|canyon|night|alpine`.

## The cars

Ten machines, carved from four flat views each. The hero is a pearl-white GT
with a twin racing stripe, a roof roundel, framed glass, mirrors, vented bonnet,
a ducktail spoiler and chrome exhausts.

![hero car](preview/hero-big.png)

Others include a taxi, a police car, a pizza van, a pickup, a sofa and a hot dog.

## How the art works

`scripts/gen-assets.mjs` authors each object as four orthographic views
(top, side, front, back). A voxel exists only where all four agree: the top face
takes the top view's colour, and exposed side faces take the colour of the view
they face. The volume is emitted as a vertical atlas — one slice per pixel of
height — which `src/stack.ts` draws as offset planes with nearest-neighbour
sampling.

Everything renders at 360 lines and is upscaled, so the world, the cars and the
HUD share one pixel grid.

```bash
npm run assets    # regenerate every sprite + flattened previews
npm run build     # typecheck + production build
```
