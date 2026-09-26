// Run by Orca's own binary as plain Node, the way Orca's `bin/orca` runs its
// CLI: `ELECTRON_RUN_AS_NODE=1 <Orca> orca-runtime.cjs <client> <method> <params> <wait>`.
//
// It makes one call to Orca's runtime, through Orca's own client, for a method
// Orca's CLI does not offer (ADR 0024): `project.update`, which makes Orca's
// window read its projects again (#224), and `terminal.inspectProcess`, which
// says who is in front of a tab where `ps` cannot (#298). `params` is JSON. It
// prints the runtime's answer as JSON and exits 0 only when the runtime took
// the call; anything else is a non-zero exit, and the kit reads every non-zero
// exit the same way.

'use strict';

const [client, method, params, wait] = process.argv.slice(2);

process.exitCode = 1;
const { RuntimeClient } = require(client);
new RuntimeClient(undefined, Number(wait))
  .call(method, JSON.parse(params))
  // A write to a pipe is not done when it returns on macOS, so the exit waits
  // for it: an answer cut short would read as no answer.
  .then((answer) => answer?.ok === true && new Promise((done) => {
    process.stdout.write(JSON.stringify(answer), () => {
      process.exitCode = 0;
      done();
    });
  }), () => {})
  .finally(() => process.exit());
