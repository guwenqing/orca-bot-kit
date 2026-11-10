// The two kinds of Orca the kit's mail must work on (#729), as the fake models
// them through its `orcaVersion` (helpers/fake-orca.js):
//
//   1.4.255  answers every orchestration command short unless `--full` is
//            given, and a plain `check` acknowledges what it hands over. The
//            owner's Orca since 2026-11-09; 1.4.246 to 1.4.255 answer alike.
//   1.4.245  knows `--full` on `inbox` alone, and refuses it on every other
//            orchestration command with nothing done. 1.4.245 and older.
//
// And what a test needs to count the calls Orca took: on 1.4.245 a call
// refused for its `--full` did nothing, so a kit may ask again without it.

import { orcaCommand } from './cli.js';

/** The newest Orca the kit meets, and the last one before short answers. */
export const ORCA_SHORT = '1.4.255';
export const ORCA_NO_FULL = '1.4.245';

/** Both, for a test that must hold on each. */
export const ORCA_MODELS = [ORCA_SHORT, ORCA_NO_FULL];

/** From now on, the fake answers as Orca `version` does. */
export const modelOrca = (box, version) => box.orca.set({ orcaVersion: version });

/**
 * Whether Orca `version` refused this call for its `--full` before it did
 * anything: only on 1.4.245, and never for `inbox`.
 */
export const refusedForFull = (version, call) => version === ORCA_NO_FULL
  && call.args.includes('--full')
  && orcaCommand(call).startsWith('orchestration ')
  && orcaCommand(call) !== 'orchestration inbox';

/** The calls of `command` among `calls` that reached Orca's runtime: every one but those refused for `--full`. */
export const takenCallsOf = (version, calls, command) => calls
  .filter((call) => orcaCommand(call) === command && !refusedForFull(version, call));

/** The `check` calls among those that take mail: neither a peek nor an acknowledgement. */
export const consumingChecks = (version, calls) => takenCallsOf(version, calls, 'orchestration check')
  .filter((call) => !call.args.includes('--peek') && !call.args.includes('--ack'));

/** The `check --ack` calls among those that reached Orca's runtime. */
export const acksOf = (version, calls) => takenCallsOf(version, calls, 'orchestration check')
  .filter((call) => call.args.includes('--ack'));

/** Each call as one line, for a failure message. */
export const shownCalls = (calls) => calls.map((call) => call.args.join(' ')).join('\n');
