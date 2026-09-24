// Run by Orca's own binary as plain Node, the way Orca's `bin/orca` runs its
// CLI: `ELECTRON_RUN_AS_NODE=1 <Orca> orca-window.cjs <client> <projectId> <wait>`.
//
// It asks Orca's runtime, through Orca's own client, for `project.update` with
// no changes on one project. That is the call that makes Orca's window read its
// projects again, and Orca's CLI does not offer it (#224, ADR 0021). It exits 0
// only when the runtime took the call; anything else is a non-zero exit, and
// the kit reads every non-zero exit the same way.

'use strict';

const [client, projectId, wait] = process.argv.slice(2);

process.exitCode = 1;
const { RuntimeClient } = require(client);
new RuntimeClient(undefined, Number(wait))
  .call('project.update', { projectId, updates: {} })
  .then((answer) => {
    if (answer?.ok === true) process.exitCode = 0;
  }, () => {})
  .finally(() => process.exit());
