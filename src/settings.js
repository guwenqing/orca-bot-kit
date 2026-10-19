// What a running session really runs with, set beside what its bot.yaml asks for.
//
// A session can run on settings other than the ones bot.yaml asks for: it
// started before a change, a default of the user's own leaked in, or a flag was
// dropped. Each harness writes down what it used (tech notes, sections 2, 3 and 6),
// so the two can be put side by side. Read only: these are the harness's files.
//
// Four answers, and only one of them is good news. A record that cannot be read,
// or that does not carry the setting, is not agreement: it is `unknown`. A
// setting the session never asked for is not a disagreement either, whatever the
// harness chose: it is `not-asked-for`.

import { defaultApproval } from './launch.js';
import { withoutThinking } from './pi.js';
import { lines } from './usage.js';

export const SETTINGS = ['model', 'effort', 'context', 'approval'];

/**
 * Each setting of `session` as `{ state, configured?, observed? }`, judged
 * against `file`, the harness's record of the conversation the session is in
 * now, from `since`, when the kit last started it. No file is no record, and
 * every setting asked for is then unknown.
 */
export function settingsInUse(harness, session, file, since) {
  const entries = file === undefined ? [] : lines(file);
  const start = startOf(entries, since);
  // Pi's reader also looks before the start, for the selection a reply follows.
  const used = harness === 'pi' ? fromPi(entries, start)
    : (harness === 'claude' ? fromClaude : fromCodex)(start === -1 ? [] : entries.slice(start));
  return Object.fromEntries(SETTINGS.map((name) => [name, judged(harness, name, asked(harness, session, name), used[name])]));
}

/**
 * Where the record since the kit last started the session begins, or -1. A
 * start resumes the conversation it had, so the file still holds what the
 * process before it wrote, and that says what that process ran with, not this
 * one. Everything
 * from the first line written at or after the start counts, a line with no time
 * of its own included. With no start to go by, no line can be shown to be this
 * process's, so none counts.
 */
function startOf(entries, since) {
  const from = Date.parse(since ?? '');
  if (Number.isNaN(from)) return -1;
  return entries.findIndex((entry) => Date.parse(entry.timestamp ?? '') >= from);
}

/** What the session asks for, as bot.yaml has it, or undefined when it asks for nothing. */
function asked(harness, session, name) {
  const value = session[name];
  const set = value !== undefined && value !== null && String(value).trim() !== '';
  // The kit puts an approval level on every launch line, so a session always
  // asks for one: its harness's default, when it names none (ADR 0015). Pi
  // has one level (#547).
  if (name === 'approval') return set ? String(value).trim() : defaultApproval(harness);
  return set ? String(value).trim() : undefined;
}

function judged(harness, name, configured, observed) {
  // A Pi reply can stand for two values (see fromPi); the first is its own.
  const choices = observed?.choices ?? [observed];
  const shown = choices[0] === undefined ? {} : { observed: said(name, choices[0]) };
  if (configured === undefined) return { state: 'not-asked-for', ...shown };
  const verdicts = choices.map((choice) => same(harness, name, configured, choice));
  const matched = verdicts.indexOf(true);
  if (matched !== -1) return { state: 'match', configured, observed: said(name, choices[matched]) };
  if (verdicts.includes(undefined)) return { state: 'unknown', configured, ...shown };
  return { state: 'mismatch', configured, ...shown };
}

/** Whether the record says what was asked for; undefined when it cannot say. */
function same(harness, name, configured, observed) {
  if (observed === undefined) return undefined;
  if (name === 'model') return harness === 'pi' ? samePiModel(configured, observed) : sameModel(configured, observed);
  // Codex reports the window it was given at 95%, rounded down (tech notes,
  // section 3): 200000 comes back as 190000.
  if (name === 'context') return Number(observed) === Math.floor(Number(configured) * 0.95);
  if (name === 'approval') return harness === 'claude' ? observed === CLAUDE_MODES[configured] : sameCodexApproval(configured, observed);
  return observed === configured;
}

/**
 * A model named without a dash is an alias, `sonnet`, and the harness writes the
 * id it stands for, `claude-sonnet-5`: it matches an id it is one part of. A
 * model with a dash is an id already, and has to be the one that ran. The
 * context window Claude Code carries on the model name, `sonnet[1m]`, is not
 * part of what it writes down.
 */
function sameModel(configured, observed) {
  const model = configured.replace(/\[[^\]]*\]$/, '');
  return model.includes('-') ? observed === model : observed.split('-').includes(model);
}

/**
 * A Pi model as bot.yaml names it, `openai/gpt-6-luna` or `gpt-6-luna`, maybe
 * with a trailing `:<thinking level>`, against the `<provider>/<model>` Pi
 * wrote down: it matches either whole, in any case, as Pi does. Pi also takes
 * a pattern that is part of a model's id, and which model it then chose
 * depends on what else it lists, so such a pattern cannot be judged (Pi 1.3.0,
 * resolveModelReference). Pi matches a display name too, which the record
 * does not hold: such a pattern shows as a mismatch.
 */
function samePiModel(configured, observed) {
  const model = withoutThinking(configured).toLowerCase();
  const ran = observed.toLowerCase();
  const provider = ran.slice(0, ran.indexOf('/'));
  const id = ran.slice(ran.indexOf('/') + 1);
  if (model === ran || model === id) return true;
  const slash = model.indexOf('/');
  const part = slash === -1 ? id.includes(model) : model.slice(0, slash) === provider && id.includes(model.slice(slash + 1));
  return part ? undefined : false;
}

/** The permission mode Claude Code records for each level (tech notes, section 2). */
const CLAUDE_MODES = { auto: 'auto', ask: 'default', 'dangerously-skip': 'bypassPermissions' };

/**
 * What Codex records for each level, and only the words that level decides: at
 * `ask` the kit passes only the approval policy, so the sandbox is the user's
 * own (ADR 0015), and at `dangerously-skip` nothing is reviewed (tech notes,
 * section 3).
 */
const CODEX_WORDS = {
  auto: { policy: 'on-request', reviewer: 'auto_review', sandbox: 'workspace-write' },
  ask: { policy: 'on-request', reviewer: 'user' },
  'dangerously-skip': { policy: 'never', sandbox: 'danger-full-access' },
};

function sameCodexApproval(configured, observed) {
  const wanted = CODEX_WORDS[configured];
  if (wanted === undefined) return false;
  const pairs = Object.entries(wanted);
  // A word the level decides and the record does not carry leaves it unsaid.
  if (pairs.some(([key]) => observed[key] === undefined)) return undefined;
  return pairs.every(([key, word]) => observed[key] === word);
}

/** A value the record carried, as the report shows it. */
function said(name, observed) {
  if (name !== 'approval' || typeof observed === 'string') return String(observed);
  return [
    `approval_policy ${observed.policy}`,
    ...(observed.reviewer === undefined ? [] : [`approvals_reviewer ${observed.reviewer}`]),
    ...(observed.sandbox === undefined ? [] : [`sandbox ${observed.sandbox}`]),
  ].join(', ');
}

/**
 * What a Claude Code transcript says it runs with, the latest of each: the
 * model and effort on its replies, the permission mode wherever it is noted.
 * Claude Code writes nothing that shows the context window.
 */
function fromClaude(entries) {
  const used = {};
  for (const entry of entries) {
    if (entry.type === 'assistant' && entry.isSidechain !== true) {
      const model = entry.message?.model;
      if (typeof model === 'string' && model !== '<synthetic>') used.model = model;
      if (typeof entry.effort === 'string') used.effort = entry.effort;
    }
    if (typeof entry.permissionMode === 'string') used.approval = entry.permissionMode;
  }
  return used;
}

/**
 * What a Pi record says it runs with, from `start` on: the model, as
 * `<provider>/<model>`, and the thinking level (tech notes, section 6). Pi
 * writes nothing about approval.
 *
 * The latest line that names one decides. A `model_change` or
 * `thinking_level_change` line decides alone. A reply gives two choices: its
 * own value, or the last change before it, before the start too. Pi follows
 * that selection, and when it is a virtual model, such as `router/auto`, its
 * replies name the model it routed to (Pi 1.3.0, getBranchSelection).
 */
function fromPi(entries, start) {
  const named = (provider, model) => (typeof provider === 'string' && typeof model === 'string' ? `${provider}/${model}` : undefined);
  const reply = (entry) => (entry.type === 'message' && entry.message?.role === 'assistant' ? entry.message : {});
  const latest = (change, changed, replied) => {
    const changeAt = (at) => (entries[at].type === change ? changed(entries[at]) : undefined);
    if (start === -1) return undefined;
    for (let at = entries.length - 1; at >= start; at -= 1) {
      const set = changeAt(at);
      if (set !== undefined) return set;
      const own = replied(reply(entries[at]));
      if (own === undefined) continue;
      for (let before = at - 1; before >= 0; before -= 1) {
        const earlier = changeAt(before);
        if (earlier !== undefined) return earlier === own ? own : { choices: [own, earlier] };
      }
      return own;
    }
    return undefined;
  };
  const text = (value) => (typeof value === 'string' ? value : undefined);
  return {
    model: latest('model_change', (entry) => named(entry.provider, entry.modelId), (message) => named(message.provider, message.model)),
    effort: latest('thinking_level_change', (entry) => text(entry.thinkingLevel), (message) => text(message.thinkingLevel)),
  };
}

/** What a Codex rollout says it runs with: its latest turn, and its latest count. */
function fromCodex(entries) {
  const used = {};
  for (const entry of entries) {
    const payload = entry.payload;
    if (payload === null || typeof payload !== 'object') continue;
    if (entry.type === 'turn_context') {
      if (typeof payload.model === 'string') used.model = payload.model;
      if (typeof payload.effort === 'string') used.effort = payload.effort;
      if (typeof payload.approval_policy === 'string') {
        used.approval = {
          policy: payload.approval_policy,
          reviewer: typeof payload.approvals_reviewer === 'string' ? payload.approvals_reviewer : undefined,
          sandbox: typeof payload.sandbox_policy?.type === 'string' ? payload.sandbox_policy.type : undefined,
        };
      }
    }
    const window = payload.info?.model_context_window;
    if (entry.type === 'event_msg' && payload.type === 'token_count' && typeof window === 'number') used.context = window;
  }
  return used;
}
