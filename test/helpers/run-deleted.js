// Orca deletes a Run, as Orca 1.4.262 and later do (#820).
//
// From 1.4.262 Orca deletes a Run, and every letter filed under it, once the
// Run has had no write for 24 hours (no letter to it, no read or
// acknowledgement, no rebind) and no party is live: for a kit session, its tab
// is not open. Read in Orca's source at tag v1.4.263, not seen live. After
// that, `run-show`, `run-use`, `check` and `send` on its id are refused
// `run_not_found`, as for a Run that this Orca never had. The kit has no
// command to delete a Run.
//
// The fake Orca (helpers/fake-orca.js) answers a Run that is not in its `runs`
// that way already. What this adds is the rest of what Orca deletes with it:
// the letters to `run:<id>` in `messages`, the batches in `deliveries` that
// were handed over from it, and its `inbox` entry. The clock is not modelled:
// a test deletes the Run when it means the day to have passed.
//
// And what the kit's words about a missing Run must carry since #820, pinned
// as facts and not as sentences: both causes (Orca 1.4.262 and later deleted
// it; the book was written for another Orca, as on another machine), and that
// the letters that waited in it are gone.

import assert from 'node:assert/strict';

/** Delete Run `id` from the fake Orca, and every letter filed under it. The fake must have it. */
export async function orcaDeletesRun(box, id) {
  const state = await box.orca.state();
  assert.ok((state.runs ?? []).some((run) => run.id === id), `the premise: Orca has the Run ${id} before it deletes it`);
  const inbox = { ...(state.inbox ?? {}) };
  delete inbox[id];
  await box.orca.set({
    runs: state.runs.filter((run) => run.id !== id),
    messages: (state.messages ?? []).filter((message) => message.to !== `run:${id}`),
    deliveries: (state.deliveries ?? []).filter((delivery) => delivery.run !== id),
    inbox,
  });
}

/** Every run of whitespace as one space, so a re-wrapped sentence still reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ');

/**
 * Assert `said` names both causes of a missing Run: that Orca 1.4.262 and later
 * delete a mailbox, and that the book may have been written for another Orca,
 * as on another machine.
 */
export function assertNamesBothCauses(said) {
  const text = flat(said);
  assert.ok(text.includes('1.4.262'), `it names the first cause, that Orca 1.4.262 and later delete a mailbox, got:\n${said}`);
  assert.match(text, /another (machine|Orca)/i, `and the second, that the book was written for another Orca, as on another machine, got:\n${said}`);
}

/**
 * That the letters that waited in the Run are gone: the letters, the mail or
 * the messages, and then, in the same sentence, that they are, were or have
 * been gone, lost or deleted. The first cause names a letter too ("a day after
 * its last letter"), so a "last letter" does not count.
 */
const LETTERS_GONE = /(?<!\blast )\b(letters?|mail|messages?)\b[^.;]{0,100}?\b(is|are|was|were|been)\b[^.;]{0,30}?\b(gone|lost|deleted)\b/i;

/** Assert `said` says the letters that waited in the Run are gone. */
export function assertSaysLettersGone(said) {
  assert.match(flat(said), LETTERS_GONE, `it says the letters that waited in it are gone, got:\n${said}`);
}

/**
 * Assert `said` does not say that a mailbox or its letters are gone: it names
 * neither cause of a missing Run and says nothing of letters gone, and no
 * mailbox is called gone, lost or deleted. For a Run that Orca still has.
 */
export function assertSaysNothingGone(said) {
  const text = flat(said);
  assert.ok(!text.includes('1.4.262'), `it names no cause of a missing Run, got:\n${said}`);
  assert.doesNotMatch(text, LETTERS_GONE, `it does not say the letters are gone, got:\n${said}`);
  assert.doesNotMatch(text, /\bmailbox\b[^.;]{0,100}?\b(gone|lost|deleted)\b/i, `and does not say the mailbox is gone, got:\n${said}`);
}
