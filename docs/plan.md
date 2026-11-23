# Sprite Drift — work plan

Cadence per block: design note → implement in slices (one commit each) → verify three
states (parked / mid-corner / at speed) → failure cases → tests → docs.

## Now: map detail pass (from the annotated overview)

**What changes**
1. Shift the town right (+8 x) so it sits in the open half of the infield.
2. Fill the empty infield and the right-hand void: more trees, scattered rocks, a few
   tyre stacks and lamp posts, so the centre reads as a place, not a lawn.
3. Add roadside furniture along the main straight: marker boards, a start gantry later.

**Why**
The annotated overview shows a big empty lawn inside the loop and a bare strip on the
right. Props are the cheapest way to make the circuit feel like a venue.

**What could break**
- Prop placement is rejection-tested against the road; raising counts can starve the
  sampler if the `free()` radius is too generous. Cap iterations and assert a minimum.
- Colliders grow with props: too many near the racing line makes the track feel narrower.
  Keep a 2.4-unit clearance from the kerb.
- The town shift must stay clear of the hairpin and the lake.

## Next: Block 3 — audio
1. Engine synth (RPM from speed + gear, load from throttle) — one commit.
2. Tyre squeal from slip, kerb rumble when on a kerb — one commit.
3. Impact thud + gravel crunch — one commit.
4. Music loop, ducked under the engine — one commit.

Failure cases to write down first: 0 speed, max speed, reversing, off-road, wall hit,
tab hidden (must suspend), mute toggle, audio context suspended until first gesture.

## Later: Block 5 — multiplayer rooms
Reuse the nest API host; WebSocket rooms, 20 Hz state, interpolation, join/leave,
server-side lap validation. Design note before any code.
