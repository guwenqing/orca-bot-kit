// TEMPORARY probe for #697, removed before review: the R3 late-child scenario
// replayed 50 times on a CI shard, beside the other test files. Each run
// prints one line; a run where the child gets no TERM also prints the kit's
// answer and its timeline, in ms after the first signal. It asserts nothing.

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { botHomeOf, createSandbox } from './helpers/cli.js';

const BOT = 'api-bot';
const RUNS = 50;

test('probe #697: the R3 late-child scenario, 50 runs', async (t) => {
  let missed = 0;
  for (let run = 1; run <= RUNS; run += 1) {
    const box = await createSandbox(t);
    const ok = async (args) => {
      const result = await box.run(args);
      if (result.code !== 0) throw new Error(`obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
    };
    await ok(['init', '--bots', 'bots', '--harness', 'claude']);
    await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
    await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'dev', '--work-dir', 'work/dev']);
    await ok(['up', '--bots', 'bots', '--bot', BOT]);
    const work = path.join(botHomeOf(box.path('bots'), BOT), 'work', 'dev');
    await mkdir(work, { recursive: true });
    const outside = await mkdtemp(path.join(box.tmp, 'obk-run-'));
    await box.orca.set({ processes: [
      { pid: 51241, ppid: 1, pgid: 51241, cwd: work, command: 'node respawner.js', ignoresTerm: true, unkillable: true },
      { pid: 51242, ppid: 51241, pgid: 51241, cwd: outside, command: 'node late-worker.js', ignoresTerm: true, appearsAfterKillOf: 51241 },
    ] });
    const retireStart = Date.now();
    const result = await box.run(['retire', '--bots', 'bots', '--bot', BOT, '--session', 'dev', '--json']);
    const retireMs = Date.now() - retireStart;
    const kills = await box.kill.calls();
    const t0 = kills[0]?.at ?? retireStart;
    const childTerm = kills.find((call) => call.args.join(' ') === '-s TERM -- 51242');
    const parentKill = kills.find((call) => call.args.join(' ') === '-s KILL -- 51241');
    t.diagnostic(`probe-697 run ${run}: child TERM ${childTerm ? `at ${childTerm.at - t0}` : 'NO'}; parent KILL ${parentKill ? `at ${parentKill.at - t0}` : 'NO'}; retire ${retireMs} ms; exit ${result.code}; pids test ${process.pid}, kit ${kills[0]?.caller}`);
    if (!childTerm) {
      missed += 1;
      const reads = await box.ps.tableReads();
      t.diagnostic(`probe-697 run ${run} MISSED kills: ${JSON.stringify(kills.map((call) => [call.args.slice(1).join(' ').replace('-- ', ''), call.at - t0]))}`);
      t.diagnostic(`probe-697 run ${run} MISSED reads: ${JSON.stringify(reads.map((read) => [read.at - t0, read.done - read.at]))}`);
      t.diagnostic(`probe-697 run ${run} MISSED answer: ${result.stdout}${result.stderr}`.slice(0, 4000));
    }
  }
  t.diagnostic(`probe-697 total: ${RUNS} runs, ${missed} without the child's TERM`);
});
