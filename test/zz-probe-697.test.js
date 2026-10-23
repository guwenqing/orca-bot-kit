// TEMPORARY probe for #697, removed before review: what one call of the fake
// ps, lsof and kill costs on a CI runner, beside a bare node start and a sh
// start. It asserts nothing; it prints its times with t.diagnostic.

import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createSandbox } from './helpers/cli.js';
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
