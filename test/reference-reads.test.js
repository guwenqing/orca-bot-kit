// The reading that the live check of #802 makes of a harness's own record
// (test/helpers/reference-reads.js, used by
// test/system/skill-reference-files.test.js): which tool calls after the asked
// line opened a skill's reference file. A call counts only when it names a
// path in one of the given places and its result shows the file's own
// contents. A call that only checks the file is there does not count (the
// review of #838). The fixtures follow the record shapes that the system
// test's header names; they are not captured from a live run.

import assert from 'node:assert/strict';
import test from 'node:test';

import { afterTheAsk, eventsOf, readsOf, replyIn } from './helpers/reference-reads.js';

const HOME = '/private/var/folders/x/T/obk-system-skill-refs-abc/bots/arch-bot';
const FILE = `${HOME}/.agents/skills/obk-arch/decision-records.md`;
const CLAUDE_FILE = `${HOME}/.claude/skills/obk-arch/decision-records.md`;
const PLACES = {
  'the bot\'s own .claude/skills': CLAUDE_FILE,
  'the bot\'s own .agents/skills': FILE,
  'this checkout\'s skills/': '/work/repo/skills/obk-arch/decision-records.md',
};
const FIRST_LINE = '# ADR NNNN: <the decision, as a short phrase>';
const CONTENTS = `${FIRST_LINE}\n\nStatus: accepted\n`;
const ASKED = 'DONE-8042';
const ASK = `Use your obk-arch skill. Then end your reply with ${ASKED} in lower case.`;

/** What the reading finds in `entries` of `harness`: the counted reads by tool and file, and the others by tool and why. */
function found(harness, entries) {
  const { events, cwd } = eventsOf(harness, entries);
  const after = afterTheAsk(events, ASKED);
  assert.ok(after !== undefined, 'the fixture holds the asked line');
  const { reads, others } = readsOf(after, { cwd: cwd ?? HOME, places: PLACES, name: 'decision-records.md', holds: FIRST_LINE });
  return {
    reads: reads.map(({ call, file, place }) => ({ tool: call.tool, file, place })),
    others: others.map(({ call, why }) => ({ tool: call.tool, why: why.split(':')[0] })),
    reply: replyIn(after),
  };
}

// ------------------------------------------------------------- Claude Code

const claudeCall = (id, name, input) => ({ type: 'assistant', cwd: HOME, message: { content: [{ type: 'tool_use', id, name, input }] } });
const claudeResult = (id, content, isError = false) => ({ type: 'user', cwd: HOME, message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });

test('Claude Code: a Read whose result holds the first line counts; a check that the file is there, a failed read, a read before the ask and a path elsewhere do not', () => {
  const entries = [
    { type: 'user', cwd: HOME, message: { content: 'Reply now with ready.' } },
    claudeCall('t0', 'Read', { file_path: CLAUDE_FILE }),
    claudeResult('t0', `1\t${FIRST_LINE}`),
    { type: 'user', cwd: HOME, message: { content: ASK } },
    claudeCall('t1', 'Bash', { command: `python3 -c 'from pathlib import Path; print(Path(".claude/skills/obk-arch/decision-records.md").exists())'` }),
    claudeResult('t1', 'True'),
    claudeCall('t2', 'Bash', { command: 'ls -l .claude/skills/obk-arch/decision-records.md' }),
    claudeResult('t2', '-rw-r--r--  1 q  staff  2412 Nov 19 01:00 .claude/skills/obk-arch/decision-records.md'),
    claudeCall('t3', 'Read', { file_path: `${HOME}/decision-records.md` }),
    claudeResult('t3', `1\t${FIRST_LINE}`),
    claudeCall('t4', 'Read', { file_path: CLAUDE_FILE }),
    claudeResult('t4', '<tool_use_error>File does not exist.</tool_use_error>', true),
    claudeCall('t5', 'Read', { file_path: CLAUDE_FILE }),
    claudeResult('t5', [{ type: 'text', text: `     1\t${CONTENTS}` }]),
    { type: 'assistant', cwd: HOME, message: { content: [{ type: 'text', text: `${FIRST_LINE}\ndone-8042` }] } },
  ];
  assert.deepEqual(found('claude', entries), {
    reads: [{ tool: 'Read', file: CLAUDE_FILE, place: 'the bot\'s own .claude/skills' }],
    others: [
      { tool: 'Bash', why: 'its result does not hold "# ADR NNNN' },
      { tool: 'Bash', why: 'its result does not hold "# ADR NNNN' },
      { tool: 'Read', why: `${HOME}/decision-records.md is in none of the places a link can take it` },
      { tool: 'Read', why: 'its result is an error' },
    ],
    reply: `${FIRST_LINE}\ndone-8042`,
  });
});

// ------------------------------------------------------------- Codex

const codexLine = (payload) => ({ type: 'response_item', payload });

test('Codex: a shell read whose output holds the first line counts, in either call shape and through workdir; a test -f, a Path.exists() and a missing file do not', () => {
  const entries = [
    { type: 'session_meta', payload: { cwd: HOME } },
    codexLine({ type: 'message', role: 'user', content: [{ type: 'input_text', text: ASK }] }),
    codexLine({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: JSON.stringify({ cmd: 'test -f .agents/skills/obk-arch/decision-records.md && echo yes' }) }),
    codexLine({ type: 'function_call_output', call_id: 'c1', output: 'Process exited with code 0\nOutput:\nyes\n' }),
    codexLine({ type: 'custom_tool_call', name: 'exec', call_id: 'c2', input: 'const r = await tools.exec_command({ cmd: "python3 -c \'from pathlib import Path; print(Path(\\".agents/skills/obk-arch/decision-records.md\\").exists())\'" });\ntext(r);' }),
    codexLine({ type: 'custom_tool_call_output', call_id: 'c2', output: 'Script completed\nTrue\n' }),
    codexLine({ type: 'function_call', name: 'exec_command', call_id: 'c3', arguments: JSON.stringify({ cmd: 'cat decision-records.md', workdir: `${HOME}/.agents/skills/obk-arch` }) }),
    codexLine({ type: 'function_call_output', call_id: 'c3', output: 'cat: decision-records.md: No such file or directory\n' }),
    codexLine({ type: 'function_call', name: 'exec_command', call_id: 'c4', arguments: JSON.stringify({ cmd: 'sed -n 1,40p decision-records.md', workdir: `${HOME}/.agents/skills/obk-arch` }) }),
    codexLine({ type: 'function_call_output', call_id: 'c4', output: `Process exited with code 0\nOutput:\n${CONTENTS}` }),
    codexLine({ type: 'custom_tool_call', name: 'exec', call_id: 'c5', input: 'const r = await tools.exec_command({ cmd: "cd .agents/skills/obk-arch && head -5 decision-records.md" });\ntext(r);' }),
    codexLine({ type: 'custom_tool_call_output', call_id: 'c5', output: [{ type: 'input_text', text: `Script completed\n${CONTENTS}` }] }),
    codexLine({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `${FIRST_LINE}\ndone-8042` }] }),
  ];
  assert.deepEqual(found('codex', entries), {
    reads: [
      { tool: 'exec_command', file: FILE, place: 'the bot\'s own .agents/skills' },
      { tool: 'exec', file: FILE, place: 'the bot\'s own .agents/skills' },
    ],
    others: [
      { tool: 'exec_command', why: 'its result does not hold "# ADR NNNN' },
      { tool: 'exec', why: 'its result does not hold "# ADR NNNN' },
      { tool: 'exec_command', why: 'its result is an error' },
    ],
    reply: `${FIRST_LINE}\ndone-8042`,
  });
});

// ------------------------------------------------------------- Pi

const piMessage = (message) => ({ type: 'message', message });

test('Pi: a read whose result holds the first line counts; a bash stat, a read of only a later part and a failed read do not', () => {
  const entries = [
    { type: 'session', version: 3, id: 'p', cwd: HOME },
    piMessage({ role: 'user', content: [{ type: 'text', text: ASK }] }),
    piMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'p1', name: 'bash', arguments: { command: 'stat .agents/skills/obk-arch/decision-records.md' } }] }),
    piMessage({ role: 'toolResult', toolCallId: 'p1', toolName: 'bash', content: [{ type: 'text', text: '16777232 1234 -rw-r--r-- 1 q staff 2412 decision-records.md' }], isError: false }),
    piMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'p2', name: 'read', arguments: { path: FILE, offset: 20, limit: 10 } }] }),
    piMessage({ role: 'toolResult', toolCallId: 'p2', toolName: 'read', content: [{ type: 'text', text: '## History\n' }], isError: false }),
    piMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'p3', name: 'read', arguments: { path: FILE } }] }),
    piMessage({ role: 'toolResult', toolCallId: 'p3', toolName: 'read', content: [{ type: 'text', text: 'ENOENT: no such file or directory' }], isError: true }),
    piMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'p4', name: 'read', arguments: { path: '.agents/skills/obk-arch/decision-records.md' } }] }),
    piMessage({ role: 'toolResult', toolCallId: 'p4', toolName: 'read', content: [{ type: 'text', text: CONTENTS }], isError: false }),
    piMessage({ role: 'assistant', content: [{ type: 'text', text: `${FIRST_LINE}\ndone-8042` }] }),
  ];
  assert.deepEqual(found('pi', entries), {
    reads: [{ tool: 'read', file: FILE, place: 'the bot\'s own .agents/skills' }],
    others: [
      { tool: 'bash', why: 'its result does not hold "# ADR NNNN' },
      { tool: 'read', why: 'its result does not hold "# ADR NNNN' },
      { tool: 'read', why: 'its result is an error' },
    ],
    reply: `${FIRST_LINE}\ndone-8042`,
  });
});

test('no call counts when the record holds no read of the file at all, as on the tree before #802', () => {
  const entries = [
    { type: 'user', cwd: HOME, message: { content: ASK } },
    claudeCall('t1', 'Read', { file_path: `${HOME}/.claude/skills/obk-arch/SKILL.md` }),
    claudeResult('t1', `258\t${FIRST_LINE}`),
    { type: 'assistant', cwd: HOME, message: { content: [{ type: 'text', text: `${FIRST_LINE}\ndone-8042` }] } },
  ];
  assert.deepEqual(found('claude', entries), { reads: [], others: [], reply: `${FIRST_LINE}\ndone-8042` });
});
