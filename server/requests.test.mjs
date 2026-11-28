// server/requests.test.mjs — the wishlist board: order, one vote per account,
// the toggle that takes a vote back, and the flag that switches the whole thing
// off. The case these encode: the owner turns the board on while his players
// are in the room, they write asks and vote each other up, and someone clicking
// twice must not count twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  Store, StoreError, emptyDb, FEATURES, FEATURES_DEFAULT_OFF,
  REQUEST_TEXT_MIN, REQUEST_TEXT_MAX,
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
  assert.deepEqual(store.listRequests()[0].votes, [bob.id, alice.id]);
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
  assert.deepEqual(row.votes, [bob.id]);
  // the toggle still knows this account already voted
  assert.deepEqual(reloaded.voteRequest(bob, req.id), { id: req.id, votes: 0, voted: false });
  store.close();
  reloaded.close();
});
