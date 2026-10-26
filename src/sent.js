// `obk session sent`: what the kit's PostToolUse hook says after a session's
// native message (#451, ADR 0032).
//
// Claude Code's own messaging reaches every Claude session on the machine, not
// only the sessions of one bots folder. After a send to another session, this
// looks at where it went: to a session address none of the fleet's books name,
// the session is told so, with the road the kit would have given it. The send
// has gone either way. Nothing here decides anything about it, and anything it
// cannot read is silence (ADR 0022: a hook never disturbs the session).
//
// It reads the send from its fields, never from its wording. Seen in the
// transcripts of Claude Code 2.1.281 to 2.1.310 (#705): a send to another
// session that went answers with a `msg_id` and with neither `routing` nor
// `pin`. A send to a subagent or teammate inside the process has `routing` or
// `pin`, or no `msg_id`. The transcript also has a `display`, but the copy the
// model reads does not, and the hook may get either. The input's `to` names
// the target, as a session's name with an optional ` [xxxxxx]` reference, or
// as a `uds:` socket path when answering a message, which no book can map.

import { readBook } from './book.js';
import { botDir, botNames } from './bot.js';
import { isAddressOf, ownCli, shellWord } from './launch.js';
import { lookUp } from './message.js';
import { TAB_ENV } from './record.js';

/**
 * The warning for a send the hook was told about, or undefined when there is
 * nothing to say. `said` is what Claude Code handed the hook.
 */
export function sentWarning(bots, said) {
  if (said?.tool_name !== 'SendMessage') return undefined;
  const to = said.tool_input?.to;
  if (typeof to !== 'string') return undefined;
  // A subagent or teammate in the same session, or a send that did not go: not this.
  if (!wentToAnotherSession(resultOf(said))) return undefined;
  if (/^(uds|bridge):/.test(to)) return undefined;

  const name = to.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  if (name === '') return undefined;
  const fleet = addressesIn(bots);
  if (fleet === undefined || fleet.all.has(name)) return undefined;

  const meant = fleet.byName.get(name.split('.').slice(0, 2).join('.'));
  const ask = (to) => `\`${shellWord(ownCli())} message to --bots ${shellWord(bots)} --to ${to}\``;
  const road = meant === undefined
    ? `${ask('<bot>/<session>')} gives the road to a session of this fleet.`
    : roadTo(bots, meant, ask(`${meant.bot}/${meant.session}`));
  return `That message went to ${name}, which is not one of the sessions of your bots folder, ${bots}: Claude Code's messaging reaches every session on this machine. ${road} Check before you send to it again.`;
}

/**
 * The road to the session the sender probably meant, as `obk message to` would
 * answer it from the sender's own tab: native to its address only between
 * sessions of one approval class, the kit's mailbox otherwise (PRD 6.9). Where
 * the sender cannot be told by its tab, the session's address and the question
 * to ask, without claiming the address is the answer (#451 review).
 */
function roadTo(bots, meant, ask) {
  let found;
  try {
    found = lookUp(bots, { to: `${meant.bot}/${meant.session}`, tab: process.env[TAB_ENV] });
  } catch {
    found = undefined;
  }
  const who = `${meant.bot}/${meant.session}`;
  if (found?.transport === 'native' && typeof found.address === 'string') {
    return `If you meant ${who}, ${ask} gives the road from your session: write to ${found.address} with your own messaging.`;
  }
  if (found?.transport === 'orca' && typeof found.address === 'string') {
    return `If you meant ${who}, ${ask} gives the road from your session: its mailbox, ${found.address}, by \`${shellWord(ownCli())} message send\`, not your own messaging.`;
  }
  return `If you meant ${who}, its session address is ${meant.address}; ${ask} says which road to take from your session.`;
}

/** Whether the send answered as one that went to another session. */
function wentToAnotherSession(result) {
  return result !== undefined && result.success === true && 'msg_id' in result
    && !('routing' in result) && !('pin' in result);
}

/** What the send answered, as an object: Claude Code hands it over as one, or as its JSON. */
function resultOf(said) {
  const raw = said.tool_output ?? said.tool_response;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every session address the fleet's books name, retired sessions' included, and
 * each live one by `<bot>.<session>`: `{ all, byName }`. Undefined when a book
 * cannot be read, since an address missing from it would be warned about wrongly.
 */
function addressesIn(bots) {
  const all = new Set();
  const byName = new Map();
  try {
    for (const bot of botNames(bots)) {
      const book = readBook(botDir(bots, bot));
      for (const [session, entry] of Object.entries(book.sessions ?? {})) {
        const address = entry?.address;
        if (typeof address !== 'string') continue;
        all.add(address);
        if (isAddressOf(bot, session, address)) byName.set(`${bot}.${session}`, { bot, session, address });
      }
      for (const entry of Array.isArray(book.retired) ? book.retired : []) {
        if (typeof entry?.address === 'string') all.add(entry.address);
      }
    }
  } catch {
    return undefined;
  }
  return { all, byName };
}
