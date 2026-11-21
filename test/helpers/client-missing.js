// Whether the kit's output says that Orca's runtime client is not there (#844).
//
// Where the Orca app is there with its binary and no client file is at the
// place the kit looks, the kit's "cannot tell" answer for the front-process
// question names the missing file by its full path and says that Orca's
// runtime client is not there. That is how a user or a reviewer notices that
// Orca moved its client again. The wording is the implementer's: the tests pin
// only the path, the words "runtime client" and words that say it is not there.
//
// Used by test/runtime-client-place.test.js against the fake Orca, and by
// test/system/runtime-client-live.test.js against the real one.

/**
 * Words that say a file is not there, in any of the usual ways. Broad, for the
 * answer that must say it: any plain way of saying it passes.
 */
export const NOT_THERE = /\bnot there\b|\bisn't there\b|\bis not (?:there|present|installed)\b|\bnot present\b|\bmissing\b|\bno such file\b|\bnot found\b|\bdoes not exist\b|\bdoesn't exist\b|\bcannot find\b|\bcan't find\b|\bcould not find\b|\bcouldn't find\b|\bno file\b|\bno client\b|\bno runtime client\b/i;

/**
 * Words that can only mean the file is not there. Narrow, for answers that
 * must not say it: an answer about a client that is there but went wrong may
 * well say "not found" of a method or "has no" of an export.
 */
const CLEARLY_NOT_THERE = String.raw`(?:not there|isn't there|is not (?:there|present)|not present|missing|no such file|does not exist|doesn't exist)`;

/**
 * Whether `text` says that the runtime client file at `file` is not there:
 * it names the full path, says "runtime client", and has words that say it is
 * not there.
 */
export const namesClientMissing = (text, file) => text.includes(file) && /runtime client/i.test(text) && NOT_THERE.test(text);

/**
 * Whether any one line of `text` says the runtime client, or its file, is not
 * there: a line that names a `client.js` and says it is not there, or one that
 * says so of "the runtime client" in so many words. For answers that must not
 * say so. A line that says the Orca app or its binary is missing, and names
 * the runtime client only as what cannot be asked, does not count.
 */
export function saysClientMissing(text) {
  const notThere = new RegExp(String.raw`\b${CLEARLY_NOT_THERE}\b`, 'i');
  const ofTheClient = new RegExp(String.raw`runtime client(?: file)?(?:\s+\S+){0,3}?\s+(?:is\s+|was\s+)?${CLEARLY_NOT_THERE}\b|\b(?:missing|no such file)\s+(?:\S+\s+)?runtime client`, 'i');
  return text.split('\n').some((line) => (/client\.js/.test(line) && notThere.test(line)) || ofTheClient.test(line));
}
