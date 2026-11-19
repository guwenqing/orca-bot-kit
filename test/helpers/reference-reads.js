// The reading of a harness's own record of a conversation for the live check
// of #802 (test/system/skill-reference-files.test.js): what the user and the
// model said, the tool calls the session made and their results, and which of
// those calls opened a skill's reference file. Plain functions over parsed
// record lines, so test/reference-reads.test.js runs them on fixtures. See the
// system test's header for each record's shape and where it was read.
//
// A call counts as a read of the file only when it names a path that resolves
// to one of the given places AND its result holds a line of the file's own
// contents (#838's review): a call that only checks the file is there (`ls`,
// `test -f`, `stat`, `Path.exists()`) names the path and shows none of it.

import os from 'node:os';
import path from 'node:path';

/** What a failed call's result says, on any harness. */
const FAILED = /No such file or directory|File does not exist|ENOENT|Script failed|Rejected\(|policy forbids|Operation not permitted/i;

/** The text of a message's content: a string, or the text of its blocks of `types`. */
function textOf(content, types = ['text']) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => types.includes(block?.type) && typeof block.text === 'string').map((block) => block.text).join('\n');
}

/** The text of a tool's result: a string, a list of blocks, or an object holding either. */
function resultTextOf(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map((item) => (typeof item === 'string' ? item : item?.text ?? '')).join('\n');
  if (output !== null && typeof output === 'object') return resultTextOf(output.content ?? output.output ?? '');
  return '';
}

/**
 * What a record (`entries`, its lines parsed) holds, in its order, as plain
 * events: `{ index, kind: 'user' | 'reply', text }` for what the user and the
 * model said, `{ index, kind: 'call', id, tool, named, base, raw }` for a tool
 * call (`named` the text its paths are in, `base` the folder it ran in when
 * the call says), and `{ index, kind: 'result', id, failed, text }` for a
 * call's result. `cwd` is the session's folder, when the record names it.
 * `harness` is `claude`, `codex` or `pi`.
 */
export function eventsOf(harness, entries) {
  const events = [];
  let cwd;
  entries.forEach((entry, index) => {
    if (harness === 'claude') {
      if (typeof entry?.cwd === 'string') cwd ??= entry.cwd;
      const content = entry?.message?.content;
      if (entry?.type === 'user' && entry.isMeta !== true) {
        const text = textOf(content);
        if (text !== '') events.push({ index, kind: 'user', text });
        for (const block of Array.isArray(content) ? content : []) {
          if (block?.type === 'tool_result') events.push({ index, kind: 'result', id: block.tool_use_id, failed: block.is_error === true, text: resultTextOf(block.content) });
        }
      } else if (entry?.type === 'assistant') {
        const text = textOf(content);
        if (text !== '') events.push({ index, kind: 'reply', text });
        for (const block of Array.isArray(content) ? content : []) {
          if (block?.type !== 'tool_use') continue;
          const named = block.name === 'Read' ? block.input?.file_path : block.name === 'Bash' ? block.input?.command : undefined;
          events.push({ index, kind: 'call', id: block.id, tool: block.name, named: typeof named === 'string' ? named : undefined, raw: JSON.stringify(block.input ?? {}) });
        }
      }
      return;
    }
    if (harness === 'codex') {
      if (entry?.type === 'session_meta' && typeof entry.payload?.cwd === 'string') cwd ??= entry.payload.cwd;
      const item = entry?.type === 'response_item' ? entry.payload : undefined;
      if (item?.type === 'message' && item.role === 'user') events.push({ index, kind: 'user', text: textOf(item.content, ['input_text']) });
      else if (item?.type === 'message' && item.role === 'assistant') events.push({ index, kind: 'reply', text: textOf(item.content, ['output_text']) });
      else if (item?.type === 'function_call' || item?.type === 'custom_tool_call') {
        const named = String((item.type === 'function_call' ? item.arguments : item.input) ?? '');
        const workdir = /\bworkdir\\?"?\s*:\s*\\?["'`]([^"'`\\]+)/.exec(named)?.[1];
        events.push({ index, kind: 'call', id: item.call_id, tool: String(item.name), named, base: workdir, raw: named });
      } else if (item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output') {
        const text = resultTextOf(item.output);
        events.push({ index, kind: 'result', id: item.call_id, failed: FAILED.test(text), text });
      }
      return;
    }
    // Pi
    if (entry?.type === 'session' && typeof entry.cwd === 'string') cwd ??= entry.cwd;
    const message = entry?.type === 'message' ? entry.message : undefined;
    if (message?.role === 'user') events.push({ index, kind: 'user', text: textOf(message.content) });
    else if (message?.role === 'assistant') {
      const text = textOf(message.content);
      if (text !== '') events.push({ index, kind: 'reply', text });
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type !== 'toolCall') continue;
        const named = block.name === 'read' ? block.arguments?.path : block.name === 'bash' ? block.arguments?.command : undefined;
        events.push({ index, kind: 'call', id: block.id, tool: block.name, named: typeof named === 'string' ? named : undefined, raw: JSON.stringify(block.arguments ?? {}) });
      }
    } else if (message?.role === 'toolResult') {
      const text = resultTextOf(message.content);
      events.push({ index, kind: 'result', id: message.toolCallId, failed: message.isError === true || FAILED.test(text), text });
    }
  });
  return { events, cwd };
}

/** The events after the asked line: after the first user turn that holds `asked`, or undefined before there is one. */
export function afterTheAsk(events, asked) {
  const at = events.findIndex((one) => one.kind === 'user' && one.text.includes(asked));
  return at < 0 ? undefined : events.slice(at + 1);
}

/** A macOS temp path, with its `/private` taken off, so both spellings compare equal. */
const bare = (file) => file.replace(/^\/private(?=\/(?:var|tmp)\/)/, '');

/**
 * Every path a call names that ends in `name`, resolved: against the folder
 * of a `cd <folder>` before it in the same text, or the call's own folder, or
 * `cwd`.
 */
export function pathsNamedBy(call, cwd, name) {
  if (call.named === undefined) return [];
  const text = call.named;
  const word = new RegExp(`[^\\s'"\`;|&<>(){}\\\\,]*${name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
  return [...text.matchAll(word)].map((found) => {
    let base = call.base ?? cwd;
    for (const cd of text.slice(0, found.index).matchAll(/(?:^|[\s;&|("'`])cd\s+["']?([^\s;&|'"`]+)/g)) base = path.resolve(base, cd[1]);
    const named = found[0].startsWith('~/') ? path.join(os.homedir(), found[0].slice(2)) : found[0];
    return path.resolve(base, named);
  });
}

/**
 * The reads of a file among the events `after` the asked line: `{ call, file,
 * place, result }` for each call that names a path in one of `places` (an
 * object of place name to file path) whose result is not an error and holds
 * `holds`, a line of the file's own contents. `others` are the calls that name
 * the file's `name` and do not count, each with why. A path is resolved
 * against `cwd` when the call names no folder of its own.
 */
export function readsOf(after, { cwd, places, name, holds }) {
  const wanted = Object.entries(places).map(([place, file]) => ({ place, file: bare(file) }));
  const results = new Map(after.filter((one) => one.kind === 'result').map((one) => [one.id, one]));
  const reads = [];
  const others = [];
  for (const call of after.filter((one) => one.kind === 'call')) {
    for (const file of pathsNamedBy(call, cwd, name)) {
      const place = wanted.find((one) => one.file === bare(file))?.place;
      const result = results.get(call.id);
      const why = place === undefined
        ? `${file} is in none of the places a link can take it`
        : result === undefined ? 'the record holds no result for the call'
          : result.failed ? `its result is an error: ${result.text.slice(0, 300)}`
            : !result.text.includes(holds) ? `its result does not hold ${JSON.stringify(holds)}, so it did not show the file's contents: ${result.text.slice(0, 300)}`
              : undefined;
      if (why === undefined) reads.push({ call, file, place, result });
      else others.push({ call, file, why });
    }
  }
  return { reads, others };
}

/** The model's reply in `after`, all of it, as one text. */
export const replyIn = (after) => after.filter((one) => one.kind === 'reply').map((one) => one.text).join('\n');

/** Every tool call in `after`, short, for a message. */
export const callsIn = (after) => after.filter((one) => one.kind === 'call').map((one) => `${one.tool}: ${(one.named ?? one.raw ?? '').replaceAll('\n', ' ').slice(0, 300)}`);

/** The last events, short, for a failure message. */
export const tailOf = (events, count = 20) => events.slice(-count).map((one) => `${one.kind}${one.tool === undefined ? '' : ` ${one.tool}`}: ${(one.text ?? one.named ?? one.raw ?? '').replaceAll('\n', ' ').slice(0, 200)}`).join('\n  ');
