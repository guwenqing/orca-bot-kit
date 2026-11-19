// Origin sources (#774): the `Source:` line of each origin file names a place
// that a reader of the repo can open, such as an issue, a PR comment or a file
// in the repo. It never names a path on the machine of the session that
// recorded it: a reader cannot open such a path, and it puts one machine's
// layout into a public repo.
//
// An origin file is a snapshot that AssuredLoop's `al` wrote, under
// requests/<name>/origin/ or requests/archive/<name>/origin/: header lines,
// then a line that is exactly `---` or `--- signed text ---`, then the text.
// Only the `Source:` header line is read. The text below the separator is the
// owner's words and may hold anything.
//
// A machine path is an absolute POSIX path (`/...`), a home path (`~...`) or a
// Windows drive path (`C:\...` or `C:/...`). Every other value is allowed: a
// URL, or prose such as `standard input`. A URL is not required.

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const requestsDir = path.join(repoRoot, 'requests');

const SEPARATOR = /^---( signed text ---)?$/;
const MACHINE_PATH = /^(\/|~|[A-Za-z]:[\\/])/;

/** Every file in an `origin` folder under requests/, archive included. */
async function originFiles(dir, inOrigin = false) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await originFiles(full, inOrigin || entry.name === 'origin')));
    else if (inOrigin && entry.isFile()) found.push(full);
  }
  return found;
}

/** The value of the `Source:` line in the header, or undefined. */
function headerSource(text) {
  for (const line of text.split(/\r?\n/)) {
    if (SEPARATOR.test(line)) return undefined;
    const match = /^Source:(.*)$/.exec(line);
    if (match) return match[1].trim();
  }
  return undefined;
}

test('no origin file names a path on one machine as its Source', async () => {
  const files = await originFiles(requestsDir);
  assert.ok(files.length > 0, `found no origin files under ${requestsDir}`);

  const bad = [];
  let sources = 0;
  for (const file of files) {
    const source = headerSource(await readFile(file, 'utf8'));
    if (source === undefined) continue;
    sources += 1;
    if (MACHINE_PATH.test(source)) bad.push(`${path.relative(repoRoot, file)}: Source: ${source}`);
  }
  assert.ok(sources > 0, `read no Source line in the ${files.length} origin files`);
  assert.deepEqual(bad, [], `origin files whose Source is a path on one machine:\n${bad.join('\n')}`);
});
