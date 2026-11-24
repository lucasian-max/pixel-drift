---
name: pixel-car-stack
description: Add a playable pixel-art car to Sprite Drift from a four-view sheet, a reference image, or a procedural car spec, including its superpower. Use for new cars, liveries, rally/race variants, 3D car models, power/FX work, sprite-stack atlases, previews, and screenshots.
---

# Pixel-car stack / new car

Sprite Drift has three car paths. Pick deliberately:

1. **3D player car** — what actually ships. `src/carModel.ts::buildCarModel(variant)` returns the low-poly car; the rally car lives in `src/rallyCar.ts`. A new playable car normally means a new `buildXCar()` module plus a variant slot.
2. **Sprite-stack atlas** — the game's namesake, used for props and (historically) the first hero car. A four-view sheet is carved into slices for `src/stack.ts::SpriteStack`. Good for static cars, billboards and experiments; bad for the live player car because the sheet's wheels cannot steer or spin.
3. **Procedural sheet library** — `scripts/gen-assets.mjs` emits clean four-view cars at `48 × 76 × 28` for previews and static props.

The original hero went atlas → directional billboard → 3D. The 3D model is the one that stayed. A new playable car should therefore be authored as a 3D model first; make an atlas only if the request is about the stack itself.

## A. Four-view sheet → 3D player car (the shipping path)

The source of truth is the sheet, not a recolour of the hero's tables. Read all four views before writing code:

- **Top** sets the plan: nose taper, shoulder, cabin and boot width.
- **Side** sets the roofline, wheelbase, overhangs, sill height and livery.
- **Front/rear** set the fascia, lamp pod, bumpers, track width and tail.

Write a standalone module, e.g. `src/rallyCar.ts`:

```ts
export function buildRallyCar(): THREE.Group
```

### Hard contract

- Axes: +Z = nose, +X = right, +Y = up, ground at `y = 0`. The caller applies `rotation.y = Math.PI`.
- Keep the running gear: `WHEEL_R`, `WHEEL_W`, `WHEEL_X`, `FRONT_Z`, `REAR_Z`. The wheel mounts must be named `wheelFLMount` … `wheelRRMount`; each holds a spin group named `wheelFL` etc. Set:
  - `car.userData.wheels` = spin groups
  - `car.userData.frontMounts` = front two mounts
  - `car.userData.brakes` = tail-light meshes
- `car.name = 'car'`.
- Materials: `MeshLambertMaterial({ flatShading: true })`; `MeshBasicMaterial` only for inverted-hull outlines. No textures, no lights, no renderer. Import only `three`.
- Body size stays inside the collider envelope: length ≲ 4.5, width ≲ 2.1, height ≲ 1.35.
- TypeScript strict mode; no unused imports.

### Geometry recipe that works

- **Body**: a lofted hull from station tables (`Section`, `ring`, `loft`). Use a 12-station rally profile with a flat bonnet, near-vertical flanks, a small lower chamfer and a squared deck. Reusing the hero's 8-point ring unchanged makes another wedge — author new stations.
- **Greenhouse**: a second loft sunk into the deck. Add white/cream A-, B- and C-pillars as beams; add a roof slab. A bare black cabin loft reads as a brick.
- **Livery**: thin `ShapeGeometry` panels or `deckStrip` quads, offset 0.004–0.010 from the body with `polygonOffsetFactor: -2`.
- **Flares**: a single closed polygon ring around each wheel (outer arch → bottom → inner arch → back), extruded 0.05–0.06 outward. Do **not** use `Shape` holes for this; a single path is more robust. Extrude outward from the flank, not through it.
- **Wheels**: tyre cylinder rotated to the X axis, chunky tread blocks around the circumference, silver or gold 5-spoke rim, dark disc and hub. Mount at `y = WHEEL_R`; the tyre must touch `y = 0`.
- **Outlines**: an inverted-hull copy of the body, cabin, wing and flares (`BackSide`, scaled about the geometry bbox centre). Never let outlines cast shadows.
- **Decals/details**: lamps are cylinders rotated to face +Z; grille slats are thin boxes; mudflaps, mirrors, door handles, fuel filler, tow hook and exhaust are small boxes/cylinders.

### Integrate

`src/carModel.ts`:

```ts
import { buildRallyCar } from './rallyCar';

const RALLY_VARIANT = PALETTES.length;          // after the four paint jobs
export const CAR_VARIANTS = PALETTES.length + 1;

export function buildCarModel(variant = 0): THREE.Group {
  if (variant === RALLY_VARIANT) return buildRallyCar();
  ...
}
```

`Car.nextVariant` already cycles `CAR_VARIANTS`, so `C` reaches the new car. Do not hardcode `% 4`.

## B. Opus 5.5 authoring step (optional)

The hero and rally cars were/are meant to be authored by Opus 5.5 through Hack Club AI. The repo has `scripts/hackclub-image.mjs`:

```sh
node scripts/hackclub-image.mjs --model anthropic/claude-opus-5.5 --text \
  --prompt-file art/prompts/rally-car-model.txt \
  --ref art/sheets/rally-reference.png \
  --out tmp/opus-rally-model.txt --max-tokens 24000 --effort high
```

- Key: `HACKCLUB_API_KEY` or `~/.config/hackclub-ai.key`.
- The prompt must include the sheet, the hard contract, the rendering conventions and the pitfalls. `art/prompts/rally-car-model.txt` is the working template.
- Save the raw output, strip the Markdown fence, paste into `src/rallyCar.ts`, then typecheck and fix.
- **Check credits first.** A 402 `Insufficient credits` means the Hack Club/OpenRouter balance is empty; do not burn time retrying. Author the model directly and note it.

## C. Four-view sheet → stack atlas (static art)

Tools: `.venv-sprite/bin/python tools/four_view_car.py`, `tools/views_to_slices.py`, `tools/car_stack.py`, `tools/preview_stack.py`, `tools/bake_directions.py`.

```sh
mkdir -p art/build
.venv-sprite/bin/python tools/four_view_car.py art/sheets/car.png art/build/car \
  --target-width 36 --side-nose left --shade 0.15 --colours 28 --flat e8b02c
.venv-sprite/bin/python tools/preview_stack.py art/build/car-row.png preview/car-stack.png \
  --slices 28 --scale 8
```

- `--target-width 36` gives 36 × 76 × 28 slices; 48 is the library size.
- `--side-nose left` if the side view faces left; otherwise the car is mirrored.
- `--flat` flattens side livery; it also destroys multi-colour side art, so inspect the result.
- The converter removes near-white (`>250` RGB), not all off-whites. If `find_views` says `found 1 drawings`, lower to 248/245 or clean manually.
- Row preview is ground-first; `SpriteStack` wants the vertical atlas, top-first. `four_view_car.py` writes both.
- **Reality check:** a 2000 px AI sheet downsampled to 36 px turns livery into noise and repeats side art down every slice. The rally sheet at 36 px was not usable. Prefer the 3D path for a playable car; use 48+ px and manual cleanup for a static stack. The rally car ships as `src/rallyCar.ts` and a `Rally` variant in `src/carModel.ts`.

## D. Procedural sheet library

`scripts/gen-assets.mjs`:

1. Add a `CAR_SPECS` entry: `shape`, `livery`, `extra`, `paint`.
2. Implement the livery in `carAtlas`'s top/side passes.
3. Add the roof extra in `EXTRA` and `extraColor`.
4. `npm run assets`; inspect `preview/car-<name>-stack.png`.

## E. Superpowers

Every pickable car has one power in `src/powers.ts`, index-aligned with
`CAR_NAMES` and `CAR_VARIANTS`:

```ts
export const CAR_POWERS: CarPower[] = [ /* one per car, same order */ ];
```

- Physics multipliers (`speed`, `accel`, `grip`, `steer`), plus optional
  `burst` (forward impulse), `ghost` (skip colliders) and `zap` (yellow
  lightning FX).
- `Car` owns activation, cooldown, reset and FX; `F` activates in `main.ts`.
- Add a HUD card (name, READY/ACTIVE/cooldown, bar) and show the power name in
  the title car picker.
- FX: point light + additive ground ring + (for `zap`) six chunky lightning
  beams that sit **outside** the body radius. `setGhost()` fades the model for
  cloaks; `setGlow()` tints the body material.
- Test the multipliers with a direct loop: set the car on a straight, run 120
  `car.update(1/120, {throttle:1,steer:0,handbrake:false}, world)` steps with
  and without the power.

## F. Verification (required)

### Clean 3D views

`scripts/car-preview.html` mounts `buildCarModel(variant)` on a plain background with an orthographic camera:

```
http://127.0.0.1:5180/scripts/car-preview.html?view=side|front|rear|top|iso|reariso&zoom=1&variant=4
```

Because the caller rotates the car by PI, the **nose points −Z**: a front camera is at `(0, 0.85, −9)`, a rear camera at `(0, 0.85, 9)`.

### Browser screenshots on this machine

Playwright's bundled launch crashes this system's Chromium's GPU process. Use system Chromium under Xvfb + CDP:

```sh
mkdir -p tmp/chrome-profile
xvfb-run -a -s "-screen 0 1280x720x24" chromium \
  --no-sandbox --disable-dev-shm-usage --disable-extensions \
  --remote-debugging-port=9222 \
  --user-data-dir="$PWD/tmp/chrome-profile" \
  --window-size=1280,720 about:blank
```

- Keep the Chromium profile under `/home`; a `/tmp` profile produced disk-cache failures and browser crashes.
- Connect with a tiny WebSocket CDP client (`Page.navigate`, `Runtime.evaluate`, `Page.captureScreenshot`), not Playwright.
- In the game: `game.car.variant = 4; game.car.setSkin('car')`.
- To frame a car without the start gantry, move it to a track point:
  ```js
  const tr = game.world.track, i = 60, p = tr[i], q = tr[(i + 6) % tr.length];
  game.car.x = p.x; game.car.z = p.z;
  game.car.heading = Math.atan2(-(q.x - p.x), -(q.z - p.z));
  ```
- Hide the HUD with `document.getElementById('ui').style.display = 'none'`; restore it for the "in game" shot.
- The camera orbits a look-ahead point, so a 90° drag at high zoom can push the car out of frame. Use zoom ~1.0–1.5 for orbit shots.
- Drive test: dispatch `KeyW`/`KeyA`; then assert `game.car.model.userData.wheels[0].rotation.x` changed, `frontMounts[0].rotation.y` steered, and `brakes.length === 2`.

## Pitfalls that cost time

1. **Hack Club 402**: the key can run out mid-task. Test with a 16-token request before the real call.
2. **Playwright + system Chromium**: the GPU process exits 133 on WebGL. Use Xvfb + CDP.
3. **Chromium profile on `/tmp`**: disk-cache writes fail on this box; use a profile under the repo or `/home`.
4. **`deckStrip` at the outer edge**: it samples the centre deck height, so a strip at `x = 0.8…0.9` floats above the curved shoulder. Keep deck strips near the centreline, or build them as a shaped panel that follows `bodyAt(z)`.
5. **Flare holes**: `Shape` holes plus extrusion are fiddly. A single closed arch polygon (outer arc + inner arc) is reliable.
6. **Floating flare lips**: a long box on top of the arch reads as a spoiler. Keep it short and sit it on the arch, or skip it.
7. **Wing endplates**: 0.22 m tall endplates read as billboards in side view. Keep the blade at/near roof height and the endplates under ~0.18 m.
8. **Lamp pod on the hood**: lamps at `y ≈ 0.65` on a low nose end up on the bonnet. Put the lenses on the front fascia (`y ≈ 0.50–0.62`), proud of the grille, and check from a low front camera.
9. **B-pillar contrast**: a black B-pillar on black glass disappears. Use white/cream (or a bright trim) for readability at 360p.
10. **Wheel size vs. flare**: if the tyre radius grows, grow the flare inner radius and the mount height. The tyre must touch the ground; the game spins on the `0.33` divisor regardless.
11. **Nose direction**: sheet nose must be +Z before the caller's `rotation.y = Math.PI`. A mirrored car is obvious on the livery and the lamp pod.
12. **Cache**: bump `ASSET_V` in `src/stack.ts` only when replacing a stack sheet.
13. **Variants**: use `CAR_VARIANTS`, never a hardcoded modulo.
14. **Outlines on thin parts**: the bbox scale of a thin beam can produce a thick black ghost. Outline the body, cabin, wing and flares; leave beams alone.
15. **Too much detail at low resolution**: at 360 lines, bold colour blocks and chunky lamps read; hairlines, thin grilles and subtle bevels turn to noise.
16. **Atlas order**: `preview_stack.py` expects a row (ground first); `SpriteStack` expects a vertical atlas (top first).
17. **Power state belongs to the car, not the model**: reset `powerTime`, `powerCd`, ghost and glow when the variant changes or the race resets, or the old FX carries over.
18. **Lightning inside the body is invisible**: keep bolt radii outside the ~2.0 m body and thicken each segment to ~0.14 m at the game's 360-line scale.
19. **F must only fire while running**: consume the key but gate `activatePower()` on `running`, or the title car starts a cooldown behind the overlay.
20. **Cooldown UI width**: a two-row card or ~148 px width is needed for names such as THUNDERCLAP plus ACTIVE.

## Done means

- The car is visible in the viewer from side/front/rear/top and matches the sheet's silhouette and livery.
- In game, `C` reaches it, it does not z-fight, float, sink, invert or mirror, and the wheels steer/spin.
- A driving screenshot exists with the HUD on.
- `npm run build` passes.
- The skill's prompt/commands still reproduce the asset; if Opus was unavailable, say so.
