// The kit's Pi extension (#662), src/pi-record.js, run the way Pi runs it,
// with a fake Pi around it. No test reaches the real `pi` or the real ~/.pi.
//
// Pi loads an extension as an ES module and calls its default export with
// its ExtensionAPI object, `pi`. The extension registers its handlers with
// `pi.on(event, handler)`. On a `session_start`, Pi calls `handler(event,
// ctx)` and awaits it, where
//
//   event  { type: 'session_start', reason: 'startup' | 'reload' | 'new' |
//            'resume' | 'fork', previousSessionFile?: string }
//   ctx    { cwd, sessionManager: { getSessionId() }, ... }
//
// The extension runs inside Pi's own process, and Pi is the harness the tab's
// shell started. The kit's `session record` believes a report only when its
// parent is the harness and the harness's parent is the shell that
// OBK_TAB_SHELL names (src/record.js, startedTheSession). So the stand-in for
// Pi here is a process of its own, the host below, started by a stand-in for
// the tab's shell that puts its own pid in OBK_TAB_SHELL, as the kit's launch
// line does:
//
//   tab-shell.cjs   sets OBK_TAB_SHELL to its pid, starts the host
//   host.mjs        Pi: imports the extension, calls its default export with
//                   a fake `pi`, calls the session_start handler with the
//                   event and ctx the test gives, and awaits it
//   (the extension's own child: the kit's CLI)
//
// The host is test code. It calls the default export and awaits the handler
// itself, and writes down what the extension did: the events it registered,
// each `pi.sendMessage` call (those made before the handler settled, and any
// made in the half second after), how the handler settled and how long it
// took, and any unhandled rejection or uncaught exception in the process.
//
// What the extension's child gets is Pi's environment: the host's, which is
// the sandbox's with ORCA_TAB_ID, OBK_TAB_SHELL and OBK_CLI added, as a Pi
// started by the kit's launch line in an Orca tab has them. `childImport`
// adds a module of the test's own to NODE_OPTIONS in the host, after the host
// has started, so that only the processes the extension starts load it: that
// is how a test makes the kit's CLI hang, fail or print what it likes,
// without a change to the kit.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { node, repoRoot } from './cli.js';

/** The kit's Pi extension, in this clone. */
export const PI_RECORD = path.join(repoRoot, 'src', 'pi-record.js');

const TAB_SHELL_STEP = `
const { spawnSync } = require('node:child_process');
const ran = spawnSync(process.execPath, [process.env.OBK_TEST_PI_HOST], {
  stdio: 'inherit',
  env: { ...process.env, OBK_TAB_SHELL: String(process.pid) },
});
process.exit(ran.status ?? 0);
`;

const HOST = `
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const plan = JSON.parse(process.env.OBK_TEST_PI_PLAN);
const report = { registered: [], others: [], sent: [], sentLate: [], unhandled: [] };
const done = () => { writeFileSync(plan.report, JSON.stringify(report)); process.exit(0); };
process.on('unhandledRejection', (error) => { report.unhandled.push(String(error && error.stack || error)); });
process.on('uncaughtException', (error) => { report.unhandled.push(String(error && error.stack || error)); });

if (plan.childImport !== undefined) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, '--import=' + plan.childImport].filter(Boolean).join(' ');
}

const handlers = [];
let settled = false;
const known = {
  on(event, handler) {
    report.registered.push(event);
    handlers.push([event, handler]);
  },
  sendMessage(...args) {
    let copy;
    try { copy = JSON.parse(JSON.stringify(args)); } catch { copy = ['(could not be copied)']; }
    (settled ? report.sentLate : report.sent).push(copy);
    if (plan.sendThrows) throw new Error('Pi could not take the message');
  },
};
// The rest of Pi's API, which the extension may touch: each a function that
// does nothing and is written down. Never a thenable.
const pi = new Proxy(known, {
  get(target, key) {
    if (Object.hasOwn(target, key)) return target[key];
    if (typeof key !== 'string' || key === 'then') return undefined;
    return (...args) => { report.others.push(key); return undefined; };
  },
});

let extension;
try {
  extension = await import(pathToFileURL(plan.extension).href);
} catch (error) {
  report.loadError = String(error && error.stack || error);
  done();
}
try {
  await extension.default(pi);
} catch (error) {
  report.factoryError = String(error && error.stack || error);
  done();
}

const starts = handlers.filter(([event]) => event === 'session_start').map(([, handler]) => handler);
if (starts.length === 0) done();

const event = { type: 'session_start', reason: plan.reason };
if (plan.previousSessionFile !== undefined) event.previousSessionFile = plan.previousSessionFile;
const ctx = {
  cwd: plan.cwd,
  hasUI: true,
  sessionManager: {
    getSessionId() {
      if (plan.idThrows) throw new Error('Pi has no session open');
      return plan.sessionId;
    },
  },
};

const started = Date.now();
let timer;
const limit = new Promise((resolve) => { timer = setTimeout(() => resolve('pending'), plan.limitMs); });
for (const handler of starts) {
  let result;
  try {
    result = handler(event, ctx);
  } catch (error) {
    report.outcome = 'threw';
    report.error = String(error && error.stack || error);
    break;
  }
  report.outcome = await Promise.race([
    Promise.resolve(result).then(() => 'resolved', (error) => {
      report.error = String(error && error.stack || error);
      return 'rejected';
    }),
    limit,
  ]);
  if (report.outcome !== 'resolved') break;
}
clearTimeout(timer);
report.ms = Date.now() - started;
settled = true;
setTimeout(done, 500);
`;

/** What `childImport` can make the kit's CLI do, as modules it loads before it runs. */
const CHILD_IMPORTS = {
  // Never answers, and never ends of itself while the Pi stand-in is there:
  // it goes once its parent has gone, or after a minute.
  hangs: `
const parent = process.ppid;
const started = Date.now();
await new Promise((resolve) => {
  const timer = setInterval(() => {
    if (process.ppid !== parent || Date.now() - started > 60000) { clearInterval(timer); resolve(); }
  }, 100);
});
process.exit(0);
`,
  // Answers with text that is no JSON, and exit 0.
  garbage: `
process.stdout.write('this is not the answer you are looking for {\\n');
process.exit(0);
`,
  // Answers with JSON that carries no additionalContext.
  'empty-json': `
process.stdout.write('{}\\n');
process.exit(0);
`,
  // Fails: a message on stderr, exit 1, nothing on stdout.
  fails: `
process.stderr.write('obk: something is broken\\n');
process.exit(1);
`,
};

/**
 * Run the kit's Pi extension once, as Pi runs it on a session_start, in `box`.
 *
 *   cwd          ctx.cwd: the folder Pi runs in
 *   sessionId    what ctx.sessionManager.getSessionId() answers
 *   reason       event.reason
 *   tab          ORCA_TAB_ID in Pi's environment; left out, none
 *   cli          'hangs' | 'garbage' | 'empty-json' | 'fails': what the kit's
 *                CLI does when the extension runs it; left out, the real CLI
 *   sendThrows   pi.sendMessage throws
 *   idThrows     ctx.sessionManager.getSessionId() throws
 *   limitMs      how long the host waits for the handler before it calls it
 *                pending (default 40 s)
 *   extension    the extension's file (default: this clone's src/pi-record.js)
 *
 * Returns the host's report: `{ registered, others, sent, sentLate,
 * unhandled, outcome, error, ms, loadError, factoryError }`, with each
 * `sent` entry the arguments of one sendMessage call, and the run's own
 * `{ code, stdout, stderr }` as `run`.
 */
export async function runPiExtension(box, {
  cwd,
  sessionId,
  reason,
  previousSessionFile,
  tab,
  cli,
  sendThrows = false,
  idThrows = false,
  limitMs = 40_000,
  extension = PI_RECORD,
} = {}) {
  const dir = path.join(box.root, 'pi-host');
  await mkdir(dir, { recursive: true });
  const tabShell = path.join(dir, 'tab-shell.cjs');
  const host = path.join(dir, 'host.mjs');
  await writeFile(tabShell, `${TAB_SHELL_STEP.trim()}\n`);
  await writeFile(host, `${HOST.trim()}\n`);

  let childImport;
  if (cli !== undefined) {
    if (!Object.hasOwn(CHILD_IMPORTS, cli)) throw new Error(`runPiExtension: no CLI behaviour called ${cli}`);
    const file = path.join(dir, `cli-${cli}.mjs`);
    await writeFile(file, `${CHILD_IMPORTS[cli].trim()}\n`);
    childImport = pathToFileURL(file).href;
  }

  const report = path.join(dir, `report-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const plan = { extension, cwd, sessionId, reason, previousSessionFile, sendThrows, idThrows, limitMs, childImport, report };
  const env = {
    ...box.env,
    OBK_CLI: box.cli,
    OBK_TEST_PI_HOST: host,
    OBK_TEST_PI_PLAN: JSON.stringify(plan),
    ...(tab === undefined ? {} : { ORCA_TAB_ID: tab }),
  };

  const run = await node([tabShell], { cwd: box.cwd, env });
  let text;
  try {
    text = await readFile(report, 'utf8');
  } catch (error) {
    throw new Error(`the Pi stand-in wrote no report (${error.code}): exit ${run.code}\n${run.stdout}${run.stderr}`);
  }
  return { ...JSON.parse(text), run };
}

/** The text of a sendMessage call's message: its content as a string, or its text blocks joined. */
export function sentText(args) {
  const content = args?.[0]?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((part) => part?.type === 'text').map((part) => part.text).join('');
  return undefined;
}
