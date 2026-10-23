// TEMPORARY probe for #697, removed before review: what one call of the fake
// ps, lsof and kill costs on a CI runner, beside a bare node start and a sh
// start. It asserts nothing; it prints its times with t.diagnostic.

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { botHomeOf, createSandbox } from './helpers/cli.js';
import { PS_TABLE } from './helpers/fake-ps.js';

const timed = (file, args, env) => {
  const start = process.hrtime.bigint();
  spawnSync(file, args, { env, encoding: 'utf8' });
  return Number(process.hrtime.bigint() - start) / 1e6;
};

const summary = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(0);
  return `n=${sorted.length} min=${at(0)} median=${at(0.5)} p90=${at(0.9)} max=${at(1)} ms`;
};

test('probe #697: the cost of one fake call', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ processes: [{ pid: 51999, ppid: 1, pgid: 51999, cwd: box.home, command: 'node probe.js', ignoresTerm: true }] });
  const times = { sh: [], node: [], ps: [], lsof: [], kill: [] };
  for (let round = 0; round < 40; round += 1) {
    times.sh.push(timed('/bin/sh', ['-c', 'true'], box.env));
    times.node.push(timed(process.execPath, ['-e', ''], box.env));
    times.ps.push(timed(box.ps.cli, PS_TABLE, box.env));
    times.lsof.push(timed(box.lsof.cli, ['-a', '-d', 'cwd', '-u', String(process.getuid()), '-Fpn'], box.env));
    times.kill.push(timed(box.kill.cli, ['-s', 'TERM', '--', '51999'], box.env));
    await delay(250);
  }
  for (const [name, list] of Object.entries(times)) t.diagnostic(`probe-697 ${name}: ${summary(list)}`);
});

// The R3 late-child scenario, replayed: each run prints its timeline from the
// fakes' logs, in ms after the first signal. `old` starts the child 3.5 s after
// the first signal, `new` at the parent's KILL (4b2eddb).
const BOT = 'api-bot';
for (const fixture of ['old', 'new']) {
  test(`probe #697: the R3 late-child timeline on CI, ${fixture} fixture`, async (t) => {
    for (let run = 1; run <= 6; run += 1) {
      const box = await createSandbox(t);
      const ok = async (args) => {
        const result = await box.run(args);
        if (result.code !== 0) throw new Error(`obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
      };
      const setupStart = Date.now();
      await ok(['init', '--bots', 'bots', '--harness', 'claude']);
      await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
      await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'dev', '--work-dir', 'work/dev']);
      await ok(['up', '--bots', 'bots', '--bot', BOT]);
      const work = path.join(botHomeOf(box.path('bots'), BOT), 'work', 'dev');
      await mkdir(work, { recursive: true });
      const outside = await mkdtemp(path.join(box.tmp, 'obk-run-'));
      const setupMs = Date.now() - setupStart;
      const late = fixture === 'old' ? { appearsAfterMs: 3500 } : { appearsAfterKillOf: 51241 };
      await box.orca.set({ processes: [
        { pid: 51241, ppid: 1, pgid: 51241, cwd: work, command: 'node respawner.js', ignoresTerm: true, unkillable: true },
        { pid: 51242, ppid: 51241, pgid: 51241, cwd: outside, command: 'node late-worker.js', ignoresTerm: true, ...late },
      ] });
      const retireStart = Date.now();
      const result = await box.run(['retire', '--bots', 'bots', '--bot', BOT, '--session', 'dev', '--json']);
      const retireMs = Date.now() - retireStart;
      const kills = await box.kill.calls();
      const t0 = kills[0]?.at ?? retireStart;
      const reads = await box.ps.tableReads();
      const lsofs = await box.lsof.calls();
      const childTerm = kills.some((call) => call.args.join(' ') === '-s TERM -- 51242');
      t.diagnostic(`probe-697 ${fixture} run ${run}: real pids: test ${process.pid}, kit ${kills[0]?.caller}`);
      t.diagnostic(`probe-697 ${fixture} run ${run}: child TERM ${childTerm ? 'yes' : 'NO'}; setup ${setupMs} ms; retire ${retireMs} ms, first signal at +${t0 - retireStart} ms of it`);
      t.diagnostic(`probe-697 ${fixture} run ${run} kills: ${JSON.stringify(kills.map((call) => [call.args.slice(1).join(' ').replace('-- ', ''), call.at - t0]))}`);
      t.diagnostic(`probe-697 ${fixture} run ${run} reads: ${JSON.stringify(reads.map((read) => [read.at - t0, read.done - read.at]))}`);
      t.diagnostic(`probe-697 ${fixture} run ${run} lsof: ${JSON.stringify(lsofs.filter((call) => call.at !== undefined).map((call) => call.at - t0))}`);
      if (!childTerm) t.diagnostic(`probe-697 ${fixture} run ${run} answer: ${result.stdout.slice(0, 1500)}`);
    }
  });
}
