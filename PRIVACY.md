# Pixel Drift privacy policy

Last updated: 25 November 2026

This policy explains what Pixel Drift does with your data when you play in a
browser. It covers the game client, the game server and the dataset that
uploads end up in.

## Who operates the game

Pixel Drift is operated by <OPERATOR NAME> ("we", "us"), based in
<JURISDICTION>. Contact us at <CONTACT EMAIL>.

## What the game collects

You can play as a guest or signed in; what happens to your data depends on
that.

**Accounts.** Signing up needs a username and a password. We store the
username, the role, the creation time and a salted password hash. We never
store the raw password, an email address, payment details or your real name.

**Gameplay recordings.** The game records your driving by default; nothing
on screen mentions it, and `V` toggles recording. Each saved lap becomes one
episode, complete or partial, labelled as such. The grid launch is recorded
too. Episodes are sampled 60 times per second, or 120 with `?rec=120`, and
contain:

- your username, or the label "guest", and the date and time;
- the circuit, car and variant, superpower, and keyboard or gamepad;
- per-sample car state: position, heading, velocity, speed, slip, steering,
  flags, lap progress, superpower state;
- your exact inputs: throttle, steering, handbrake, superpower button;
- event markers: impacts (with strength and rough position), superpower uses,
  resets, off-track moments;
- per-episode stats: lap time if completed, off-track seconds, event counts.

A recording holds no video, audio, chat text, device location or advertising
identifier; the only person-related item is the username.

**Leaderboard (signed in).** Posting a lap stores your username, lap time,
circuit, car, submission times, and a shortened position trace of your best
lap per circuit (about 240 points) for replays. The server keeps a shared
recent-lap history (5000 entries) and validates laps against the real
circuit.

**Guests.** Episodes recorded while you are signed out are labelled "guest"
and stay in your browser. Signing in later does not upload them; only episodes
recorded while you are signed in are sent. Clear the site's storage to wipe
guest recordings.

**Signup and login limits.** The server holds IP addresses in memory only, to
rate-limit signup and login attempts (10 per minute per IP). It does not log
them to disk.

## Why we use it, and the legal basis

- Accounts, sessions and the leaderboard provide what you asked for when you
  sign up and post lap times. In GDPR-style terms, the basis is performance
  of a contract.
- Recordings from signed-in players are used to train AI models that play
  the game, and for research and analytics. The basis is our legitimate
  interest in improving the game. Per [TERMS.md](TERMS.md), nothing is sold,
  published or shared outside the private dataset.
- Rate limiting protects accounts from brute-force attempts. The basis is
  our legitimate interest in security.

Your data is not used for profiling or automated decisions about you.

## Cookies and local storage

- The `sd_session` cookie keeps you signed in: HttpOnly, SameSite=Lax, 7
  days. It holds a random token, not your password. Signing out revokes it.
- Local storage holds your chosen car and personal best times per circuit.
- An IndexedDB database (`pixel-drift-runs`) holds your recordings until they
  are uploaded, and guests' recordings until you clear them.
- The game has no advertising and no third-party analytics or tracking
  scripts; all its traffic goes to the game server.

## Sharing

The only external service that receives your data is Hugging Face. The game
server stages uploaded raw files under `server/data/runs/<username>/` only
until a sync job, which runs every 60 seconds, commits them to the private
Hugging Face dataset (`lucasian-max/pixel-drift-runs`) under
`raw/<username>/`, then deletes its raw copy. Hugging Face acts as a host and
processor, not a controller.

Small records stay on the game server: an upload manifest (username, file,
size, counts, timestamp) and an episode-ID index to reject duplicates.
The admin dashboard shows leaderboard stats and upload totals per username,
and can remove a leaderboard time. We do not sell or otherwise share your
data.

## Retention

- In your browser: recordings are deleted after the server accepts them;
  guests' copies stay until you clear them.
- On the game server: raw files exist only until the next sync, normally
  under a minute. Accounts, leaderboard entries, the manifest and the ID
  index are kept until deleted on request.
- In the private Hugging Face dataset: episodes are kept until deleted on
  request. There is no automatic expiry.
- Sessions last 7 days or until you sign out.

## Security

Passwords are stored as scrypt hashes with a random salt. Run uploads require
a signed-in session. Account data and run staging live in a server data
directory excluded from the repository, and upload sizes are capped and
validated. The dataset is private and reachable only with the operator's
token.

## Children

The game does not ask your age and has no age check. It is a general-audience
racing game, not directed at children. We do not knowingly collect recordings
from children. If a child's data appears on a leaderboard or in the dataset,
contact us and we will remove it.

## Your rights

Where local law gives you these rights, you can:

- **Access and copy** your data. Ask us, or press the in-game `X` key to
  download every recording on your device as a JSONL file.
- **Correct** your data. There is no self-service rename, so contact us.
- **Delete** your data. Ask us: the admin panel can remove a leaderboard time
  and associated lap history, and we can delete your episodes from the staged
  files, the manifest and the dataset. Locally, clear site storage or run
  `game.recorder.clear()`.
- **Object or opt out.** Play as a guest (recordings then stay local), press
  `V` to stop recording, or sign out to stop uploads. If you object to the
  AI-training use, we will delete your episodes from the dataset.
- **Portability.** The `X` export and the leaderboard give you the data in a
  reusable form.

We answer within a reasonable time. Where applicable, you may also complain
to your local data protection authority.

## International transfers

The game server runs in <JURISDICTION>. Recordings transferred to Hugging
Face may be stored on infrastructure in other countries, under Hugging
Face's own terms as our processor. If this matters to you, review their
policies or ask where your data sits.

## Changes to this policy

We update this file when our practices change and revise the date above.
Material changes are noted in the repository.

## Contact

Questions or data requests: <CONTACT EMAIL>, operated by <OPERATOR NAME>,
<JURISDICTION>. Include your username so we can find your laps quickly.

---

This is a plain-language draft, not legal advice; have it reviewed before
relying on it.
