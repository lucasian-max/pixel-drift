# Working rules for this repo

## Every new feature is admin-gated until the owner releases it

The game's owner reviews everything before players see it. The workflow is not
optional and has no shortcuts:

1. **Build the feature behind its flag.** Feature flags live in the store
   (`server/store.mjs`, the `features` map, default all `false`, surfaced via
   `/api/me` and `/api/times` as `features`). A feature is visible only when
   its flag is `true` OR the viewer is an admin (`server/data/admins.json` —
   `lucasian` is the only one).
2. **Tell the owner it landed.** Report what the feature does, how to try it
   (an admin sees it immediately), and how it is switched off (`?ghost=0`
   style URL kill-switches stay available).
3. **Release to everyone only with the owner's explicit go.** Either the owner
   flips it themselves through the in-game admin panel / the admin feature
   endpoint, or they say the words in conversation. Never turn a flag on
   publicly on your own judgment, and never treat silence as approval.

New flag names go in the gate system as they are built — do not invent ad-hoc
gating per feature.
