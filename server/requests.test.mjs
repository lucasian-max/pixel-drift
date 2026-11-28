// server/requests.test.mjs — the wishlist board: order, one vote per account,
// the toggle that takes a vote back, the rank-weighted vote the owner asked
// for, and the flag that switches the whole thing off. The case these encode:
// the owner turns the board on while his players are in the room, they write
// asks and vote each other up, the fast crowd speaks louder, and someone
// clicking twice must not count twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  Store, StoreError, emptyDb, FEATURES, FEATURES_DEFAULT_OFF,
  REQUEST_TEXT_MIN, REQUEST_TEXT_MAX, VOTE_WEIGHT_CAP,
} from './store.mjs';

/** A store on its own scratch db, so a test can reload it and see what landed. */
function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprite-requests-'));
  const file = path.join(dir, 'db.json');
  return { file, store: new Store(file) };
}

const alice = { id: 'u-alice', username: 'alice' };
const bob = { id: 'u-bob', username: 'bob' };

/* ------------------------------------------------------------------ flag */

test('the wishlist ships off until the db says true', () => {
  assert.ok(FEATURES.includes('requests'));
  assert.ok(FEATURES_DEFAULT_OFF.includes('requests'));
  const { store } = tempStore();
  assert.equal(store.features().requests, false);
  // the same rule as botguard: only an explicit true opens it
  store.setFeature('requests', true);
  assert.equal(store.features().requests, true);
  store.setFeature('requests', false);
  assert.equal(store.features().requests, false);
  store.close();
});

test('an empty db carries an empty requests array', () => {
  assert.deepEqual(emptyDb().requests, []);
});

/* ------------------------------------------------------------- the board */

test('a new wish keeps its author, its clean text and no votes', () => {
  const { store } = tempStore();
  const made = store.addRequest(alice, '  drift   score\nboard  ');
  assert.equal(made.username, 'alice');
  assert.equal(made.text, 'drift score board');   // whitespace collapsed, trimmed
  assert.deepEqual(made.votes, []);
  assert.ok(made.id && made.at);
  const [only] = store.listRequests();
  assert.equal(only.id, made.id);
  assert.equal(only.userId, alice.id);
  store.close();
});

test('text shorter than 2 or longer than 80 characters is refused', () => {
  const { store } = tempStore();
  for (const bad of ['', '   ', 'a', 'a'.repeat(REQUEST_TEXT_MAX + 1), null, 42, ['hi']]) {
    assert.throws(
      () => store.addRequest(alice, bad),
      (err) => err instanceof StoreError && err.status === 400 && err.code === 'invalid_text',
      JSON.stringify(bad),
    );
  }
  assert.equal(store.listRequests().length, 0);
  // exactly at both ends is fine: the limits are a row, not a paragraph
  store.addRequest(alice, 'ok');
  store.addRequest(alice, 'b'.repeat(REQUEST_TEXT_MAX));
  assert.equal(store.listRequests().length, 2);
  assert.equal(store.listRequests().find((r) => r.text.length === 2).text, 'ok');
  store.close();
});

test('the board sorts by votes first, then newest first', () => {
  const { store } = tempStore();
  const older = store.addRequest(alice, 'older two-vote ask');
  const newer = store.addRequest(bob, 'newer one-vote ask');
  const quiet = store.addRequest(alice, 'nobody voted for this');
  store.voteRequest(alice, older.id);
  store.voteRequest(bob, older.id);
  store.voteRequest(alice, newer.id);
  assert.deepEqual(
    store.listRequests().map((r) => r.text),
    ['older two-vote ask', 'newer one-vote ask', 'nobody voted for this'],
  );
  // a tie falls back to the newest wish
  const tie = store.addRequest(bob, 'tied, and newer than the quiet one');
  const order = store.listRequests().map((r) => r.text);
  assert.equal(order[1], 'newer one-vote ask');
  assert.ok(order.indexOf(tie.text) < order.indexOf(quiet.text));
  store.close();
});

test('two wishes written in the same millisecond still have one order', () => {
  // a busy board can hand out the same `at` twice; write order is the tiebreak,
  // so the list never shuffles between two reads of the same db
  const { store } = tempStore();
  store.addRequest(alice, 'written first');
  store.addRequest(bob, 'written second');
  for (const r of store.db.requests) r.at = '2026-11-28T00:00:00.000Z';
  assert.deepEqual(
    store.listRequests().map((r) => r.text),
    ['written second', 'written first'],
  );
  store.close();
});

/* ------------------------------------------------------------------ votes */

test('a vote lands once per account and the second click takes it back', () => {
  const { store } = tempStore();
  const req = store.addRequest(alice, 'a wish');
  assert.deepEqual(store.voteRequest(alice, req.id), { id: req.id, votes: 1, voted: true });
  // same account again: this is a toggle, not a second vote
  assert.deepEqual(store.voteRequest(alice, req.id), { id: req.id, votes: 0, voted: false });
  // a different account is a different vote
  assert.deepEqual(store.voteRequest(bob, req.id), { id: req.id, votes: 1, voted: true });
  assert.deepEqual(store.voteRequest(alice, req.id), { id: req.id, votes: 2, voted: true });
  // the stored vote is an entry now: who, and the weight the server gave it
  assert.deepEqual(store.listRequests()[0].votes, [
    { userId: bob.id, weight: 1 },
    { userId: alice.id, weight: 1 },
  ]);
  store.close();
});

test('voting for a request that is not there is a 404', () => {
  const { store } = tempStore();
  store.addRequest(alice, 'a wish');
  for (const bad of ['nope', '', undefined, 7]) {
    assert.throws(
      () => store.voteRequest(alice, bad),
      (err) => err instanceof StoreError && err.status === 404 && err.code === 'not_found',
      String(bad),
    );
  }
  store.close();
});

/* --------------------------------------------------------------- on disk */

test('wishes and votes survive a reload of the db', () => {
  const { file, store } = tempStore();
  const req = store.addRequest(alice, 'keep me');
  store.voteRequest(bob, req.id);
  store.flush();
  const reloaded = new Store(file);
  const [row] = reloaded.listRequests();
  assert.equal(row.text, 'keep me');
  assert.deepEqual(row.votes, [{ userId: bob.id, weight: 1 }]);
  // the toggle still knows this account already voted
  assert.deepEqual(reloaded.voteRequest(bob, req.id), { id: req.id, votes: 0, voted: false });
  store.close();
  reloaded.close();
});

/* ---------------------------------------------------- weighted votes */

/** A store with seeded drivers so the weight matrix has real leaderboards to
 *  read: `alice` holds rank 1 on a single map, `bob` on two maps, the two
 *  carols-of-the-world on none. Weights come from the stored best times,
 *  never from a claim. */
function weightedStore() {
  const { store } = tempStore();
  const carol = { id: 'u-carol', username: 'carol' };
  const dave = { id: 'u-dave', username: 'dave' };
  store.submitTime(alice, 10_000, 'coast');               // alice: rank 1 on coast only
  store.submitTime(bob, 8_000, 'alpine');                 // bob: rank 1 on alpine + sakura
  store.submitTime(bob, 9_000, 'sakura');
  store.submitTime(carol, 30_000, 'coast');              // carol: on the board, never rank 1
  store.submitTime(dave, 30_000, 'sakura');               // dave: same, another map
  return { store, carol, dave };
}

test('vote weight is 2^(maps where you are rank 1), 1x with none', () => {
  const { store, carol, dave } = weightedStore();
  assert.equal(store.mapsOwnedBy(bob.id), 2);
  assert.equal(store.voteWeight(alice.id), 2);   // one map owned: 2x
  assert.equal(store.voteWeight(bob.id), 4);     // two maps owned: 4x
  assert.equal(store.voteWeight(carol.id), 1);   // on boards, never rank 1: 1x
  assert.equal(store.voteWeight(dave.id), 1);    // same, another map
  assert.equal(store.voteWeight('u-nobody'), 1); // never drove: 1x
  store.close();
});

test('a weighted vote lands as its full weight and the toggle takes all of it back', () => {
  const { store, carol } = weightedStore();
  const req = store.addRequest(alice, 'weighted wish');
  store.voteRequest(carol, req.id);                        // 1x
  assert.deepEqual(store.voteRequest(alice, req.id), { id: req.id, votes: 3, voted: true });   // +2
  assert.deepEqual(store.voteRequest(bob, req.id), { id: req.id, votes: 7, voted: true });    // +4
  // second click on the same account: the toggle takes the whole weight out
  assert.deepEqual(store.voteRequest(bob, req.id), { id: req.id, votes: 3, voted: false });    // -4
  assert.deepEqual(store.voteRequest(alice, req.id), { id: req.id, votes: 1, voted: false }); // -2
  // and puts the whole weight back in again
  assert.deepEqual(store.voteRequest(alice, req.id), { id: req.id, votes: 3, voted: true });
  store.close();
});

test('the board sorts and sums by weighted votes', () => {
  const { store, carol } = weightedStore();
  const plain = store.addRequest(alice, 'plain wish');
  const heavy = store.addRequest(bob, 'heavy wish');
  store.voteRequest(carol, plain.id);              // 1
  store.voteRequest(bob, heavy.id);                // 4
  assert.deepEqual(store.listRequests().map((r) => r.text), ['heavy wish', 'plain wish']);
  // the entries keep who voted with what, the API sums them for the rows
  const [top] = store.listRequests();
  assert.deepEqual(top.votes, [{ userId: bob.id, weight: 4 }]);
  store.close();
});

test('weight is recomputed at vote time: a rank lost after voting does not rewrite the vote', () => {
  const { store } = weightedStore();
  const req = store.addRequest(bob, 'rank moves wish');
  // alice owns the coast at 10s: her vote lands as 2x
  assert.deepEqual(store.voteRequest(alice, req.id), { id: req.id, votes: 2, voted: true });
  // then dave takes the coast off her — the vote already cast keeps its 2
  store.submitTime({ id: 'u-dave', username: 'dave' }, 5_000, 'coast');
  assert.equal(store.voteWeight(alice.id), 1);
  assert.deepEqual(store.listRequests()[0].votes, [{ userId: alice.id, weight: 2 }]);
  // the toggle still takes the full 2 out, and the next vote lands as 1
  assert.deepEqual(store.voteRequest(alice, req.id), { id: req.id, votes: 0, voted: false });
  assert.deepEqual(store.voteRequest(alice, req.id), { id: req.id, votes: 1, voted: true });
  store.close();
});

test('owning every map caps the weight at 32, and a sixth map does not lift it', () => {
  const { store, carol } = weightedStore();
  const everyone = { id: 'u-everyone', username: 'everyone' };
  for (const map of ['coast', 'alpine', 'sakura', 'mesa', 'interlagos']) {
    store.submitTime(everyone, 1_000, map);
  }
  assert.equal(store.mapsOwnedBy(everyone.id), 5);
  assert.equal(store.voteWeight(everyone.id), VOTE_WEIGHT_CAP);
  // a sixth map some day: the cap is a rule, not an observation
  store.submitTime(everyone, 1_000, 'night');
  assert.equal(store.voteWeight(everyone.id), VOTE_WEIGHT_CAP);
  const req = store.addRequest(carol, 'cap wish');
  assert.deepEqual(store.voteRequest(everyone, req.id), { id: req.id, votes: 32, voted: true });
  store.close();
});

test('an api layer weight above the cap is clamped, and a bad one falls back to the leaderboard', () => {
  const { store } = weightedStore();
  const req = store.addRequest(alice, 'clamp wish');
  // the api passes its own math; nonsense from a caller can only shrink to it
  assert.equal(store.voteRequest(alice, req.id, 999).votes, VOTE_WEIGHT_CAP);
  assert.equal(store.voteRequest(alice, req.id).votes, 0);   // toggle off
  assert.equal(store.voteRequest(alice, req.id, 0).votes, 2);  // 0 is not a weight: leaderboard
  store.close();
});

/* ------------------------------------------------------ one-time card */

test('the requests card is once per account: seen is flagged on the user and saved', () => {
  const { file, store } = tempStore();
  const user = store.signup('alice', 'password123');   // a real account, as the flag lives on it
  assert.equal(store.hasRequestsSeen(user.id), false);
  store.markRequestsSeen(user.id);
  assert.equal(store.hasRequestsSeen(user.id), true);
  store.markRequestsSeen(user.id);            // dismissing twice is the normal case
  assert.equal(store.hasRequestsSeen(user.id), true);
  assert.equal(store.hasRequestsSeen('u-nobody'), false);    // another account: not seen
  store.flush();
  assert.equal(new Store(file).hasRequestsSeen(user.id), true); // survives a reload
  store.close();
});

/* --------------------------------------------------------------- on disk */

test('a db from before the rank system keeps its votes at weight 1', () => {
  const { file, store } = tempStore();
  const req = store.addRequest(alice, 'old-style wish');
  // hand-write the pre-rank shape: votes were bare account ids
  store.db.requests[0].votes = [bob.id, alice.id];
  store.flush();
  const reloaded = new Store(file);
  const [row] = reloaded.listRequests();
  assert.deepEqual(row.votes, [
    { userId: bob.id, weight: 1 },
    { userId: alice.id, weight: 1 },
  ]);
  // and the toggle takes exactly one of them back
  assert.deepEqual(reloaded.voteRequest(alice, req.id), { id: req.id, votes: 1, voted: false });
  store.close();
  reloaded.close();
});
