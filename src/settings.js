// What a running session really runs with, set beside what its bot.yaml asks for.
//
// A session can run on settings other than the ones bot.yaml asks for: it
// started before a change, a default of the user's own leaked in, or a flag was
// dropped. Each harness writes down what it used (tech notes, sections 2 and 3),
// so the two can be put side by side. Read only: these are the harness's files.
//
// Four answers, and only one of them is good news. A record that cannot be read,
// or that does not carry the setting, is not agreement: it is `unknown`. A
// setting the session never asked for is not a disagreement either, whatever the
// harness chose: it is `not-asked-for`.

import { DEFAULT_APPROVAL } from './launch.js';
import { lines } from './usage.js';

export const SETTINGS = ['model', 'effort', 'context', 'approval'];

/**
 * Each setting of `session` as `{ state, configured?, observed? }`, judged
 * against `file`, the harness's record of the conversation the session is in
 * now, from `since`, when the kit last started it. No file is no record, and
 * every setting asked for is then unknown.
 */
export function settingsInUse(harness, session, file, since) {
  const used = file === undefined ? {} : (harness === 'claude' ? fromClaude : fromCodex)(sinceStart(lines(file), since));
  return Object.fromEntries(SETTINGS.map((name) => [name, judged(harness, name, asked(session, name), used[name])]));
}

/**
 * What the record says since the kit last started the session. A start resumes
 * the conversation it had, so the file still holds what the process before it
 * wrote, and that says what that process ran with, not this one. Everything
 * from the first line written at or after the start counts, a line with no time
 * of its own included. With no start to go by, no line can be shown to be this
 * process's, so none counts.
 */
function sinceStart(entries, since) {
  const from = Date.parse(since ?? '');
  if (Number.isNaN(from)) return [];
  const first = entries.findIndex((entry) => Date.parse(entry.timestamp ?? '') >= from);
  return first === -1 ? [] : entries.slice(first);
}

/** What the session asks for, as bot.yaml has it, or undefined when it asks for nothing. */
function asked(session, name) {
  const value = session[name];
  const set = value !== undefined && value !== null && String(value).trim() !== '';
  // The kit puts an approval level on every launch line, so a session always
  // asks for one: the default, when it names none (ADR 0015).
  if (name === 'approval') return set ? String(value).trim() : DEFAULT_APPROVAL;
  return set ? String(value).trim() : undefined;
}

function judged(harness, name, configured, observed) {
  const shown = observed === undefined ? {} : { observed: said(name, observed) };
  if (configured === undefined) return { state: 'not-asked-for', ...shown };
  const verdict = same(harness, name, configured, observed);
  if (verdict === undefined) return { state: 'unknown', configured, ...shown };
  return { state: verdict ? 'match' : 'mismatch', configured, ...shown };
}

/** Whether the record says what was asked for; undefined when it cannot say. */
function same(harness, name, configured, observed) {
  if (observed === undefined) return undefined;
  if (name === 'model') return sameModel(configured, observed);
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
