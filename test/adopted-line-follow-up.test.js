// Grooming follows up each adopted rule line, and the management session puts
// a line that did not hold to the user (issue #856).
//
// Grooming (skill obk-grooming) and fleet review (skill obk-fleet-review)
// propose lines for a bot's charter or for an always-on rule unit, each with a
// short note: the failure it answers, where it was seen, and its scope. Nothing
// in this change runs code: it is the text of two kit skills, so what is held
// here is what each says. The architect accepted that as a stand-in for the
// behaviour, as for #252 (test/temp-left-behind.test.js), beside one real run
// of the skill done by the implementer; it cannot show that a model following
// the text does the right thing, only that the text asks for it.
//
//   G1  obk-grooming follows up each adopted line: each run, in its usual
//       window, it counts whether the failure the line's note names came back,
//       and whether the case came up.
//   G2  It counts only work done under the line: a conversation that began, or
//       was cleared, after the line went in (a running conversation keeps the
//       rules it began with).
//   G3  One verdict per line, of three: held (the case came up and the failure
//       did not come back); did not hold (the failure came back in spite of the
//       line); no evidence (the case did not come up).
//   G4  "Held" and "no evidence" are given thirty days after the line went in.
//       "Did not hold" is given at once, in the run that sees the failure come
//       back, and ends the follow-up. "No evidence" at thirty days does not end
//       the follow-up; at ninety days with still no case, the follow-up ends.
//   G5  "No evidence" is never reported as "held".
//   G6  For "did not hold", the report proposes to remove or to replace the line
//       (with a check where one could hold the finding), with the evidence, and
//       gives both counts (cases and recurrences).
//   G7  For "no evidence" over the long time, the report may propose removal
//       only as a question to the user, not as a finding.
//   G8  The sentence that takes a finding off when it is fixed no longer removes
//       one whose follow-up is open: a finding whose fix was an adopted line
//       stays in the open findings until its follow-up ends.
//   G9  The note is kept once: on adoption it goes into grooming's open
//       findings, not into the charter or the unit (which carry only the line
//       and the user's order with its date). No second record of the same
//       facts: the follow-up entry is the note plus where the line is, its first
//       words and the day it went in.
//   G10 Grooming removes nothing and edits no rule and no charter: the user
//       decides, the management session makes the change.
//   G11 The follow-up runs in every run, a quiet one included (nothing moved
//       in the window): grooming still checks the lines under follow-up, and
//       a verdict or a question that falls due (at thirty or ninety days) is
//       still given. "Where nothing has moved, say so in a line and stop" does
//       not stop it.
//   F1  obk-fleet-review: the note is for the proposal; on the user's yes the
//       line goes into the file and the note into grooming's open findings,
//       under follow-up, with where the line is and the day it went in, written
//       by the management session that made the change.
//   F2  When a grooming report says an adopted line did not hold, or asks
//       whether to keep one that met no case, it puts it to the user with the
//       evidence; nothing is removed without the user's yes.
//   F3  On a yes, the line comes out by the kit's road: a charter with `obk bot
//       change --charter` and the whole charter; a unit of the user's own rules
//       by editing the file and running `obk rules build`.
//   F4  On a no, the line stays, and the answer is written in grooming's open
//       findings so it is not asked again.
//
// Meaning is matched, loosely; no sentence is pinned. Each skill's passage on
// the subject is the paragraphs that name it (an adopted line, a follow-up, or
// a line that did not hold), or every paragraph of a section whose heading
// does. Only that passage is read, so what either skill already says about
// other findings, notes, charters and declined offers does not answer for it.
// G8 alone reads the whole of obk-grooming, because the sentence it is about
// lives outside the passage. A paragraph that carries the subject but names
// none of those words, under a heading that names none of them, is not read.
//
// A "sentence" here is a sentence, or one item of a list, or one half of a
// sentence split at a semicolon. Where a sentence goes on in the next one with
// a pronoun ("That ends the follow-up."), the two are also read together. In a
// list item, each later sentence is also read under the item's head: its bold
// head ("**No evidence**: …"), or else its first sentence.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from './helpers/cli.js';
import { sectionsIn } from './helpers/rules.js';

// ------------------------------------------------------------ the words

/** A follow-up, in its usual spellings. */
const FOLLOW = /\bfollow(?:s|ed|ing)?[- ]?ups?\b|\bfollow(?:s|ed|ing)?\s+(?:it|them|each(?: one)?|the line|that line|every line)\s+up\b/i;

/** The verdict "did not hold". */
const DID_NOT_HOLD = /\b(?:did|does|do|would|will)\s+not\s+hold\b|\b(?:didn't|doesn't|don't|didn’t|doesn’t)\s+hold\b|\bfailed to hold\b|\bnot held\b/i;

/** The verdict "held". */
const HELD = /\bheld\b/i;

/** The verdict "no evidence". */
const NO_EVIDENCE = /\bno evidence\b/i;

/** What marks a paragraph or a heading as being about the follow-up of an adopted line. */
const SUBJECT = new RegExp(`\\badopt|${FOLLOW.source}|${DID_NOT_HOLD.source}`, 'i');

/** The case came up: the situation the line is about arose. */
const CASES = /\bcases?\b/i;
const CAME_UP = /\b(?:came|comes|come|coming)\s+up\b|\baros|\baris|\boccur|\bhappen|\bmet\b|\bmeets?\b|\bseen\b/i;

/** The case did not come up. */
const NO_CASE = /\bno evidence\b|\bno (?:such )?cases?\b|\bnot (?:yet )?(?:come|came)\s+up\b|\bnever (?:came|come)\s+up\b|\bwithout (?:a |any )?case\b|\bmet no case\b|\b(?:never|not) (?:been )?met\b/i;

/** The failure. */
const FAILURE = /\bfail/i;

/** The failure came back. */
const RECUR = /\b(?:came|comes|come|coming)\s+back\b|\brecurr?\w*|\breturn(?:s|ed)?\b|\bseen again\b|\bhappen(?:s|ed)? again\b|\brepeat(?:s|ed)?\b/i;

/** Counting or checking something. */
const COUNTS = /\bcount|\bcheck|\blook|\bwhether\b|\bhow often\b|\bhow many\b/i;

/** Counting turned off: "no counts", "does not count". */
const NO_COUNTING = /\b(?:no|not|never|nor|without)\s+(?:[\w'’-]+\s+){0,2}(?:counts?|counting|counted|check|checks|look)\b|n['’]t\s+(?:[\w'’-]+\s+){0,2}(?:counts?|check|look)\b/i;

/** A sentence that counts, and does not say the counting is not done. */
const countsIt = (unit) => COUNTS.test(unit) && !NO_COUNTING.test(bare(unit));

/** A quiet run: nothing moved in the window. */
const QUIET = /\bquiet\b|\bnothing (?:has )?(?:moved|moves|moving)\b|\bnothing (?:new|happened)\b|\bno (?:work|activity|conversations?)\b|\bempty window\b|\bwindow (?:is empty|held nothing|held no work|shows nothing)\b/i;

/** Each run of the pass. */
const EACH_RUN = /\b(?:each|every)\s+(?:run|pass|day|morning)\b|\bdaily\b/i;

/** Thirty days, and ninety. */
const THIRTY_DAYS = /\b(?:thirty|30)[\s-]+days?\b/i;
const NINETY_DAYS = /\b(?:ninety|90)[\s-]+days?\b/i;

/** At once: in the run that sees it, not after a wait. */
const AT_ONCE = /\bat once\b|\bimmediately\b|\bright away\b|\bstraight away\b|\bwithout waiting\b|\bin the (?:same |very )?run (?:that|which|where|in which)\b|\bthe (?:first )?run that (?:sees|finds)\b|\bas soon as\b/i;

/** Ending: the follow-up ends, closes, stops. */
const ENDS = /\bend(?:s|ed)?\b|\bclos(?:e|es|ed)\b|\bstop(?:s|ped)?\b|\bfinish(?:es|ed)?\b/gi;

/** Going on: the follow-up continues. */
const CONTINUES = /\bcontinu|\bgo(?:es)? on\b|\bcarr(?:y|ies) on\b|\bkeeps? (?:going|running|counting|on|it open|watching|following)\b|\b(?:stays?|remains?|still|kept) (?:open|under)\b|\bnot over\b/i;

/** Proposing, and taking out, and replacing. */
const PROPOSE = /\bpropos|\bsuggest|\brecommend|\boffer|\bask/i;
const REMOVE = /\bremov|\btak(?:e|es|ing|en)\s+(?:it\s+|the line\s+|that line\s+)?out\b|\bdrop|\bdelet|\bwithdraw|\bcut\b/i;
const REPLACE = /\breplac/i;

/** Evidence, read on a sentence with the verdict "no evidence" taken out. */
const EVIDENCE = /\bevidence\b|\bwhere (?:it|each|they|the failure|the recurrences?) (?:was|were) seen\b|\bquot/i;

/** The user, or the owner. */
const USER = /\buser\b|\bowner\b/i;

/** The user's yes. */
const YES = /\byes\b|\bagree|\bapprov|\bconsent|\baccept/i;

/** Writing something down. */
const WRITE = /\b(?:write|writes|wrote|written|add|adds|added|put|puts|record|records|recorded|enter|enters|entered|file|files|filed|note|notes|noted|keep|keeps|kept|log|logs|logged)\b/gi;

/** A negation that governs what follows it within a few words. */
const NEG_BEFORE = /\b(?:not|never|no longer)\s+(?:[\w'’-]+\s+){0,3}$|n['’]t\s+(?:[\w'’-]+\s+){0,3}$/i;

/** A negation anywhere. */
const NOT = /\b(?:not|never|nor|nothing|none|no)\b|n['’]t\b/i;

// ------------------------------------------------------------ reading a skill

/** Text with every run of white space made one space, so a wrapped line reads as one. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The pieces of a text: each list item apart, and the text between them. */
const chunksOf = (text) => text.split(/\n(?=\s*(?:[-*]|\d+\.)\s)/);

/** A list item's marker. */
const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;

/** The sentences of one piece, wrapped lines joined, split at . ! ? and ;. */
const sentencesIn = (chunk) => flat(chunk).split(/(?<=[.!?;])\s+/).filter((sentence) => sentence !== '');

/** The sentences of a text: list items apart, wrapped lines joined, split at . ! ? and ;. */
const sentencesOf = (text) => chunksOf(text).flatMap(sentencesIn);

/** What starts a sentence that goes on with the one before it. */
const GOES_ON = /^(?:that|this|it|its|such|which|then|doing so|that verdict|this verdict|the verdict)\b/i;

/**
 * The sentences of a text; each pair where the second goes on from the first;
 * and, in a list item, each later sentence read under the item's head: its
 * bold head where it has one ("**No evidence**: …"), else its first sentence.
 * A list of verdicts names the verdict in the head and gives the rule after it.
 */
function unitsOf(text) {
  const units = [];
  for (const chunk of chunksOf(text)) {
    const sentences = sentencesIn(chunk);
    units.push(...sentences);
    sentences.forEach((sentence, at) => {
      const next = sentences[at + 1];
      if (next !== undefined && GOES_ON.test(next)) units.push(`${sentence} ${next}`);
    });
    if (ITEM.test(chunk) && sentences.length > 1) {
      const bold = /^\s*(?:[-*]|\d+\.)\s+\*\*([^*]+?)\*\*/.exec(chunk);
      const head = bold === null ? sentences[0] : bold[1].trim();
      for (const later of sentences.slice(1)) units.push(`${head}: ${later}`);
    }
  }
  // A sentence that goes on across two pieces (the text before a list and its
  // first item is not one) is not joined: only within a piece.
  return units;
}

/** The user's no, as a noun: "on a no". */
const A_NO = /\bon a no\b|\b(?:says?|said|answers?|answered)\s+no\b|\bthe (?:user['’]s )?no\b/gi;

/**
 * A sentence with the verdicts "no evidence" and "did not hold", and the
 * user's "no", taken out, so their own "no" and "not" do not count as a
 * negation.
 */
const bare = (sentence) => sentence
  .replace(new RegExp(NO_EVIDENCE.source, 'gi'), ' ')
  .replace(new RegExp(DID_NOT_HOLD.source, 'gi'), ' ')
  .replace(A_NO, ' ');

/** Whether some match of `pattern` in the sentence is not governed by a negation just before it. */
function affirms(sentence, pattern) {
  const text = bare(sentence);
  const global = new RegExp(pattern.source, 'gi');
  for (const found of text.matchAll(global)) {
    if (!NEG_BEFORE.test(text.slice(0, found.index))) return true;
  }
  return false;
}

/** Whether some match of `pattern` in the sentence is governed by a negation just before it. */
function denies(sentence, pattern) {
  const text = bare(sentence);
  const global = new RegExp(pattern.source, 'gi');
  for (const found of text.matchAll(global)) {
    if (NEG_BEFORE.test(text.slice(0, found.index))) return true;
  }
  return false;
}

/** One kit skill's whole text. */
const skillText = (skill) => readFile(path.join(repoRoot, 'skills', skill, 'SKILL.md'), 'utf8');

/** The paragraphs of a skill, each with its section's heading. */
function paragraphsOf(text) {
  return sectionsIn(text).flatMap((section) => section.body.split(/\n\s*\n/)
    .map((paragraph) => ({ heading: section.heading, paragraph })));
}

/**
 * One kit skill's passage on following up adopted lines: the paragraphs that
 * name the subject, and a section whose heading names it, the heading read as
 * a sentence.
 */
async function passageOf(skill) {
  const text = await skillText(skill);
  const kept = [];
  for (const section of sectionsIn(text)) {
    const whole = SUBJECT.test(section.heading);
    if (whole) kept.push(`${section.heading}.`);
    for (const paragraph of section.body.split(/\n\s*\n/)) {
      if (whole || SUBJECT.test(paragraph)) kept.push(paragraph);
    }
  }
  return kept.join('\n\n');
}

/** The paragraphs of the passage. */
const passageParagraphs = (passage) => passage.split(/\n\s*\n/).filter((paragraph) => paragraph.trim() !== '');

/** The units of the passage for which every check given holds; a check is a pattern or a function of the unit. */
const saying = (passage, ...checks) => unitsOf(passage)
  .filter((unit) => checks.every((check) => (typeof check === 'function' ? check(unit) : check.test(unit))));

/** How a failure shows what was read, so the reader sees what the skill says. */
const shown = (skill, passage) => (passage.trim() === ''
  ? `skills/${skill}/SKILL.md has no passage on following up adopted lines at all`
  : `skills/${skill}/SKILL.md says, on following up adopted lines:\n${passage}`);

// ------------------------------------------------------------ obk-grooming

const GROOMING = 'obk-grooming';

/** A sentence that keeps the note out of somewhere: a negation, or leaving it out. */
const keptOut = (unit) => NOT.test(bare(unit))
  || /\b(?:leave|leaves|left|keep|keeps|kept)\s+(?:it|the note|its note)\s+out\b|\bout of the (?:charter|unit)/i.test(unit);

test('G1: each run, in its usual window, grooming follows up each adopted line: did the failure come back, did the case come up', async () => {
  const passage = await passageOf(GROOMING);
  // The passage is on adopted lines; a heading may name them and the body say
  // "follow-up", so the two words are asked of the passage, not of one sentence.
  assert.ok(
    saying(passage, /\badopt/i).length > 0 && saying(passage, (unit) => affirms(unit, FOLLOW)).length > 0,
    `the grooming skill should say it follows up each adopted line.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, countsIt, FAILURE, RECUR).length > 0,
    `the grooming skill should say it counts whether the failure that the line's note names came back.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, CASES, CAME_UP, countsIt).length > 0,
    `the grooming skill should say it counts whether the case the line is about came up.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, EACH_RUN).length > 0,
    `the grooming skill should say the follow-up is done in each run.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bwindow\b/i).length > 0,
    `the grooming skill should say the follow-up reads the run's usual window, not the whole history.\n${shown(GROOMING, passage)}`,
  );
});

test('G2: only work done under the line counts: a conversation begun or cleared after it went in; a running one keeps its rules', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, /\bconversations?\b|\bsessions?\b/i, /\b(?:began|begun|begins|begin|started|starts|start|opened)\b/i,
      /\bclear/i, /\bafter\b|\bsince\b/i).length > 0,
    `the grooming skill should count only conversations that began, or were cleared, after the line went in.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bconversations?\b/i, /\b(?:running|ongoing|already|older|earlier|before|still)\b/i,
      /\b(?:rules|charter|lines?|AGENTS\.md|instructions)\b/i,
      /\b(?:keeps?|kept|still (?:has|reads|works)|carr(?:y|ies)|works? from|loaded|began with|started with|begun with)\b|\bnot (?:see|seen|read|have|get|pick)/i).length > 0,
    `the grooming skill should say a running conversation keeps the rules it began with, so it does not count.\n${shown(GROOMING, passage)}`,
  );
});

test('G3: one verdict per line, of three: held, did not hold, no evidence, each with what it means', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, HELD, CASES, CAME_UP, (unit) => FAILURE.test(unit) || RECUR.test(unit),
      (unit) => NOT.test(bare(unit)) || /\bstay(?:s|ed)? away\b|\babsent\b/i.test(unit)).length > 0,
    `the grooming skill should give the verdict "held" when the case came up and the failure did not come back.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, DID_NOT_HOLD, RECUR).length > 0,
    `the grooming skill should give the verdict "did not hold" when the failure came back in spite of the line.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, NO_EVIDENCE, CASES, (unit) => NO_CASE.test(unit.replace(new RegExp(NO_EVIDENCE.source, 'gi'), ' '))).length > 0,
    `the grooming skill should give the verdict "no evidence" when the case did not come up.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bverdicts?\b|\bone of (?:three|the three)\b|\bthree\b/i, /\b(?:one|each|every|per)\b/i, /\blines?\b/i).length > 0,
    `the grooming skill should say each adopted line gets one verdict, of the three.\n${shown(GROOMING, passage)}`,
  );
});

test('G4: held and no evidence at thirty days; did not hold at once, ending the follow-up; no evidence ends it at ninety days', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, THIRTY_DAYS, HELD).length > 0,
    `the grooming skill should say "held" is given thirty days after the line went in.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, THIRTY_DAYS, NO_EVIDENCE).length > 0,
    `the grooming skill should say "no evidence" is given thirty days after the line went in.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, DID_NOT_HOLD, AT_ONCE).length > 0,
    `the grooming skill should say "did not hold" is given at once, in the run that sees the failure come back.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, DID_NOT_HOLD, (unit) => affirms(unit, ENDS), FOLLOW).length > 0,
    `the grooming skill should say "did not hold" ends the follow-up.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, NO_EVIDENCE, (unit) => denies(unit, ENDS) || CONTINUES.test(unit)).length > 0,
    `the grooming skill should say "no evidence" at thirty days does not end the follow-up.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, NINETY_DAYS, NO_CASE, (unit) => affirms(unit, ENDS)).length > 0,
    `the grooming skill should say the follow-up ends at ninety days when the case has still not come up.\n${shown(GROOMING, passage)}`,
  );
});

test('G5: "no evidence" is never reported as "held"', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, NO_EVIDENCE, (unit) => /\b(?:not|never)\s+(?:[\w'’-]+\s+){0,4}held\b|n['’]t\s+(?:[\w'’-]+\s+){0,4}held\b/i.test(bare(unit))).length > 0,
    `the grooming skill should say "no evidence" is never reported as "held".\n${shown(GROOMING, passage)}`,
  );
});

test('G6: for "did not hold", the report proposes removal or replacement, with the evidence and both counts', async () => {
  const passage = await passageOf(GROOMING);
  const paragraphs = passageParagraphs(passage);
  assert.ok(
    paragraphs.some((paragraph) => DID_NOT_HOLD.test(paragraph) && PROPOSE.test(paragraph) && REMOVE.test(paragraph) && REPLACE.test(paragraph)),
    `the grooming skill should say that for a line that did not hold, the report proposes to remove it or to replace it.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, REPLACE, /\bchecks?\b/i).length > 0,
    `the grooming skill should say the replacement can be a check, where one could hold the finding.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    paragraphs.some((paragraph) => DID_NOT_HOLD.test(paragraph) && EVIDENCE.test(bare(paragraph))),
    `the grooming skill should say the proposal for a line that did not hold comes with the evidence.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, CASES, /\brecurrences?\b|\b(?:came|come|comes)\s+back\b|\breturns?\b|\brecurred\b/i,
      /\bcounts?\b|\bnumbers?\b|\bhow many\b|\bboth\b|\btimes\b/i, (unit) => !NO_COUNTING.test(bare(unit))).length > 0,
    `the grooming skill should say the report gives both counts: the cases and the recurrences.\n${shown(GROOMING, passage)}`,
  );
});

test('G7: for "no evidence" over ninety days, removal may be proposed only as a question to the user, not as a finding', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, NO_CASE, /\bquestion|\bask/i, (unit) => REMOVE.test(unit) || /\bkeep\b/i.test(unit)).length > 0,
    `the grooming skill should say that for a line with no evidence over the long time, the report may ask the user whether to remove it.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bquestion/i, /\b(?:not|never|rather than|instead of)\s+(?:[\w'’-]+\s+){0,4}findings?\b/i).length > 0,
    `the grooming skill should say that question is not raised as a finding.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    passageParagraphs(passage).some((paragraph) => NINETY_DAYS.test(paragraph) && /\bquestion|\bask/i.test(paragraph)),
    `the grooming skill should tie the question about a line with no evidence to the long time, ninety days.\n${shown(GROOMING, passage)}`,
  );
});

test('G8: a finding whose fix was an adopted line stays in the open findings until its follow-up ends', async () => {
  const text = await skillText(GROOMING);
  const takesOff = (sentence) => /\bfindings?\b/i.test(sentence)
    && /\b(?:take|takes|taken|took|taking|comes?|goes?|came|went)\s+(?:[\w'’-]+\s+){0,3}off\b|\bremov|\bdrop|\bclos|\bleaves?\b/i.test(sentence)
    && /\bfixed\b|\bresolved\b|\bno longer true\b/i.test(sentence);
  const rule = paragraphsOf(text).filter(({ paragraph }) => sentencesOf(paragraph).some(takesOff));
  const unqualified = rule.filter(({ paragraph }) => !FOLLOW.test(paragraph));
  assert.deepEqual(
    unqualified.map(({ heading, paragraph }) => `## ${heading}\n${paragraph}`),
    [],
    'the grooming skill\'s sentence that takes a finding off when it is fixed should no longer remove one whose follow-up is open; '
      + 'these paragraphs take findings off with no word of a follow-up',
  );
  const stays = unitsOf(text).filter((unit) => /\bfindings?\b/i.test(unit)
    && FOLLOW.test(unit)
    && /\bstays?\b|\bremains?\b|\bkeeps?\b|\bkept\b|\bleft\b|\bopen\b/i.test(unit)
    && /\buntil\b|\btill\b|\bwhile\b|\bas long as\b|\bbefore\b/i.test(unit)
    && (affirms(unit, ENDS) || /\bover\b|\bdone\b|\bruns\b|\brunning\b|\blasts\b|\bgoes on\b|\bopen\b/i.test(unit)));
  assert.ok(
    stays.length > 0,
    `the grooming skill should say a finding under follow-up stays in the open findings until its follow-up ends.\n${shown(GROOMING, await passageOf(GROOMING))}`,
  );
});

test('G9: the note is kept once, in the open findings, and the follow-up entry is the note plus where the line is, its first words and its day', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, /\bnote\b/i, /\bopen findings\b/i).length > 0,
    `the grooming skill should say that when the line is adopted, its note goes into grooming's open findings.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bcharters?\b|\bunits?\b|\brule files?\b/i, (unit) => (/\bnote\b/i.test(unit) && keptOut(unit))
      || (/\b(?:only|just|nothing but|nothing else)\b/i.test(unit) && /\blines?\b/i.test(unit) && /\border\b|\bdate\b/i.test(unit))).length > 0,
    `the grooming skill should say the note does not go into the charter or the rule unit, which carry only the line and the user's order with its date.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bfirst (?:few )?words\b|\bopening words\b|\bwords it (?:starts|begins|opens) with\b|\bhow (?:it|the line) (?:starts|begins|opens)\b/i,
      /\b(?:day|date)\b/i, /\bwhere\b|\bfile\b|\bwhich (?:charter|unit)\b/i).length > 0,
    `the grooming skill should say the follow-up entry is the note plus where the line is, its first words and the day it went in.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage,
      /\b(?:second|separate|another|other|new|duplicate|extra|parallel)\s+(?:[\w'’-]+\s+){0,2}(?:record|copy|list|file|register|log|entry|place)\b|\bcop(?:y|ies)\b|\bduplicat|\bkept once\b|\bonly once\b|\bonce only\b|\bin one place\b|\bnowhere else\b|\btwice\b/i,
      (unit) => /\b(?:no|not|never|nothing|only|once|nowhere)\b|n['’]t\b|\bone place\b/i.test(bare(unit))).length > 0,
    `the grooming skill should say it adds no second record of the same facts: the note is kept once.\n${shown(GROOMING, passage)}`,
  );
  const record = /\b(?:second|separate|another|parallel|extra|duplicate)\s+(?:[\w'’-]+\s+){0,2}(?:record|copy|list|file|register|log)\b/gi;
  const negated = /\b(?:no|not|never|nor|without)\s+(?:[\w'’-]+\s+){0,2}$|n['’]t\s+(?:[\w'’-]+\s+){0,2}$/i;
  const keeps = unitsOf(passage).filter((unit) => [...unit.matchAll(record)]
    .some((found) => !negated.test(unit.slice(0, found.index))));
  assert.deepEqual(
    keeps,
    [],
    `the grooming skill should keep no second record of an adopted line beside the note; these sentences keep one.\n${shown(GROOMING, passage)}`,
  );
});

test('G10: grooming removes nothing and edits no rule and no charter: the user decides, the management session makes the change', async () => {
  const passage = await passageOf(GROOMING);
  const act = /\bremov|\bedit|\bchang|\bdelet|\btouch|\btak(?:e|es)\s+(?:[\w'’-]+\s+)?out\b/i;
  assert.ok(
    saying(passage, /\brules?\b|\bcharters?\b|\blines?\b|\bunits?\b|\bnothing\b/i,
      (unit) => denies(unit, act) || /\b(?:remov|edit|chang|delet|touch)\w*\s+(?:no|nothing|none)\b/i.test(bare(unit))).length > 0,
    `the grooming skill should say grooming removes nothing and edits no rule and no charter.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, USER, /\bdecid|\byes\b|\bchoos|\bapprov|\bagree/i).length > 0,
    `the grooming skill should say the user decides.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bmanagement session\b|\bfleet review\b/i, /\bmak|\bchang|\bremov|\bedit|\btak|\bcarr|\bdoes\b|\bdo\b/i).length > 0,
    `the grooming skill should say the management session makes the change.\n${shown(GROOMING, passage)}`,
  );
});

test('G11: the follow-up runs in a quiet run too: the lines under follow-up are checked, and a verdict or question that falls due is given', async () => {
  // Only the passage on adopted lines is read: the quiet-run exception of the
  // temporary sessions ("Read the books every run, a quiet one included") is
  // about the books, not about these lines.
  const passage = await passageOf(GROOMING);
  const skips = /\bskip|\bomit|\bleave (?:out|off)\b|\bstop before\b|\bwithout (?:the |any )?follow|\bwait|\bpostpon|\bdefer|\bnext run with\b/i;
  assert.ok(
    saying(passage, QUIET, /\bincluded\b|\btoo\b|\beven\b|\bstill\b|\bevery\b|\balso\b|\bas well\b|\banyway\b/i,
      (unit) => affirms(unit, new RegExp(`${FOLLOW.source}|\\bcheck|\\bverdict|\\blines? under\\b|\\badopted lines?\\b`, 'i')),
      (unit) => !skips.test(unit)).length > 0,
    `the grooming skill should say that a quiet run, where nothing moved, still checks the lines under follow-up.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bdue\b|\b(?:thirty|ninety|30|90)[\s-]+days?\b/i, /\bverdicts?\b|\bquestions?\b/i,
      (unit) => QUIET.test(unit) || /\bstill\b|\beven\b|\banyway\b/i.test(unit),
      (unit) => !skips.test(unit)).length > 0,
    `the grooming skill should say that in a quiet run a verdict or a question that falls due is still given.\n${shown(GROOMING, passage)}`,
  );
});

// ------------------------------------------------------------ obk-fleet-review

const REVIEW = 'obk-fleet-review';

test('F1: on the user\'s yes, the line goes into the file and the note into grooming\'s open findings, under follow-up, with where and when', async () => {
  const passage = await passageOf(REVIEW);
  assert.ok(
    saying(passage, /\bnote\b/i, /\bpropos|\boffer/i).length > 0,
    `the fleet review skill should say the note is for the proposal.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /\bnote\b/i, /\bopen findings\b/i, FOLLOW).length > 0,
    `the fleet review skill should say the note goes into grooming's open findings, under follow-up.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, YES, /\blines?\b|\bnote\b/i).length > 0,
    `the fleet review skill should say this happens on the user's yes.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /\b(?:day|date)\b/i, /\bwhere\b|\bfile\b|\bwhich (?:charter|unit)\b/i,
      /\bwent in\b|\bgoes in\b|\bgo in\b|\badopt|\badded\b|\bmade\b|\bin force\b|\btook effect\b/i).length > 0,
    `the fleet review skill should say the entry carries where the line is and the day it went in.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /\bopen findings\b|\bentry\b/i, (unit) => affirms(unit, WRITE),
      (unit) => !/\bgrooming (?:writes|adds|puts|records|enters|files|keeps)\b/i.test(unit)).length > 0,
    `the fleet review skill should say the management session writes the entry, as the one that made the change.\n${shown(REVIEW, passage)}`,
  );
});

test('F2: a line that did not hold, or one that met no case, goes to the user with the evidence; nothing is removed without a yes', async () => {
  const passage = await passageOf(REVIEW);
  assert.ok(
    saying(passage, DID_NOT_HOLD, USER, /\bput|\bask|\bpropos|\boffer|\bbring|\btake (?:it )?to\b|\bshow|\bpresent|\braise/i).length > 0,
    `the fleet review skill should say that a line grooming reports did not hold is put to the user.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, NO_CASE, /\bkeep|\bquestion|\bask|\bwhether\b/i).length > 0,
    `the fleet review skill should say that grooming's question whether to keep a line that met no case is put to the user too.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, (unit) => EVIDENCE.test(bare(unit)), (unit) => USER.test(unit) || /\bput|\bpropos|\boffer|\bshow|\bpresent/i.test(unit)).length > 0,
    `the fleet review skill should say it puts the line to the user with the evidence.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, REMOVE, YES, /\bwithout\b|\bonly (?:on|after|with|when|if)\b|\buntil\b|\bunless\b|\bbefore\b|\bwait/i,
      // The prohibition itself: a negation that governs the removal ("Nothing
      // is removed", "No line is taken out", "Do not remove"), or removal only
      // on a yes. "A line is removed without their yes" has neither.
      (unit) => new RegExp(`(?:\\b(?:nothing|none|no|not|never)\\b|n['’]t)\\s+(?:[\\w'’-]+\\s+){0,3}(?:${REMOVE.source})`, 'i').test(bare(unit))
        || /\bonly\s+(?:on|after|with|when|if|once)\b/i.test(unit)).length > 0,
    `the fleet review skill should say nothing is removed without the user's yes.\n${shown(REVIEW, passage)}`,
  );
});

test('F3: on a yes, the line comes out by the kit\'s road: obk bot change --charter with the whole charter, or the unit edited and obk rules build', async () => {
  const passage = await passageOf(REVIEW);
  assert.ok(
    saying(passage, /\bbot change\b/i, /--charter\b/).length > 0,
    `the fleet review skill should say a line comes out of a charter by obk bot change --charter.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /--charter\b|\bcharter\b/i, /\bwhole\b|\bentire\b|\ball of it\b|\bfull\b|\breplaces?\b/i).length > 0,
    `the fleet review skill should say --charter takes the whole charter.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /\brules build\b/i, /\bunits?\b|\bfiles?\b|\bedit/i).length > 0,
    `the fleet review skill should say a line comes out of a unit of the user's own rules by editing the file and running obk rules build.\n${shown(REVIEW, passage)}`,
  );
  // The roads are the ones the line comes out by, not only the ones a line goes
  // in by: the paragraph that names them also says the line is taken out.
  const paragraphs = passageParagraphs(passage);
  assert.ok(
    paragraphs.some((paragraph) => /\bbot change\b/i.test(paragraph) && REMOVE.test(paragraph))
      && paragraphs.some((paragraph) => /\brules build\b/i.test(paragraph) && REMOVE.test(paragraph)),
    `the fleet review skill should name these roads for taking the line out.\n${shown(REVIEW, passage)}`,
  );
});

test('F4: on a no, the line stays, and the answer is written in grooming\'s open findings so it is not asked again', async () => {
  const passage = await passageOf(REVIEW);
  const no = /\bon a no\b|\b(?:says?|said|answers?|answered)\s+no\b|\bthe user['’]s no\b|\bdeclin|\brefus|\bturns? (?:it )?down\b|\bwants? (?:to keep|it kept)\b/i;
  assert.ok(
    saying(passage, no, (unit) => affirms(unit, /\bstays?\b|\bremains?\b|\bkept\b|\bkeeps?\b|\bleave|\bleft\b|\bunchanged\b/i)
      || /\bnothing (?:[\w'’-]+\s+)?changes\b|\bchanges nothing\b/i.test(unit)).length > 0,
    `the fleet review skill should say that on a no, the line stays.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /\bopen findings\b/i, (unit) => affirms(unit, WRITE), (unit) => no.test(unit) || /\banswer\b|\bdecision\b|\bthe no\b/i.test(unit)).length > 0,
    `the fleet review skill should say that on a no, the answer is written in grooming's open findings.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, (unit) => denies(unit, /\bask|\boffer|\bpropos|\braise|\bput|\bcome up\b|\bbring/i),
      /\bagain\b|\btwice\b|\ba second time\b|\brepeat|\bre-?ask/i).length > 0,
    `the fleet review skill should say that after a no, it is not asked again.\n${shown(REVIEW, passage)}`,
  );
});
