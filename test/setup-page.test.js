// SETUP.md and the line in the README that sends an assistant to it. The page
// is followed literally, by a machine, on someone else's computer, and nobody
// here ever runs it: everything on it can go stale without a single test going
// red. What is held here is what a machine trips over — a command the CLI no
// longer has, a version floor that drifted from the one the package promises, a
// page that is not in the installed kit, a pointer to something that is not
// there. The prose around them is written for a reader and is not tested.
//
// What is deliberately left alone: the Orca CLI path, the harness names in step
// 1 and the key sequences in step 5's table. Those are facts about other
// people's software, recorded in docs/tech-notes.md and proven live, and there
// is nothing here to check them against.

import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, repoRoot } from './helpers/cli.js';

const pageAt = (name) => readFile(path.join(repoRoot, name), 'utf8');
const readPackage = async () => JSON.parse(await pageAt('package.json'));

/** A version with any range operator dropped: `>=24.21.0` and `24.21.0` are the same version. */
const versionOf = (value) => String(value).replace(/^[^0-9]*/, '');

const exists = (file) => stat(file).then(() => true, () => false);

/** The lines inside a page's fenced code blocks: what it tells the assistant to run. */
function fencedLines(page) {
  const lines = [];
  let inside = false;
  for (const line of page.split('\n')) {
    if (line.startsWith('```')) inside = !inside;
    else if (inside) lines.push(line);
  }
  return lines;
}

/**
 * Every `obk` command line the page gives, in the order it gives them, each
 * once. A trailing `# comment` is the page talking to its reader, not part of
 * the command.
 */
function obkCommands(page) {
  const found = fencedLines(page)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line.startsWith('obk '));
  return [...new Set(found)];
}

/**
 * What the page's placeholders stand for, each as a single word so that a value
 * with a space in it stays one argument. A placeholder that is not here is a
 * line the test cannot run, and it says so rather than running something else.
 */
const STANDS_FOR = new Map([['<their path>', '{bots}']]);

/** What those words are worth in one sandbox. The page asks for an absolute path, so that is what it gets. */
const valuesIn = (box) => new Map([['{bots}', box.path('bots')]]);

/**
 * The commands whose exit code says what they found rather than whether they
 * ran. `obk health` exits 1 when it has findings, and SETUP.md tells the
 * assistant so itself; everything else the page runs has to come back 0.
 */
const REPORTS = new Set(['health']);

/** A choice the page offers, as `claude|codex`: the command must work either way. */
const CHOICE = /[\w-]+(?:\|[\w-]+)+/g;

/** How many ways one line can be taken. */
const waysIn = (line) => Math.max(1, ...(line.match(CHOICE) ?? []).map((choice) => choice.split('|').length));

/** One line taken the given way, with its placeholders filled in: arguments to run the CLI with. */
function argvFor(line, way, values) {
  let text = line.replace(CHOICE, (choice) => {
    const options = choice.split('|');
    return options[Math.min(way, options.length - 1)];
  });
  for (const [placeholder, word] of STANDS_FOR) text = text.replaceAll(placeholder, word);

  assert.ok(
    !text.includes('<'),
    `SETUP.md tells the assistant to run \`${line}\`, and this test does not know what to put in its place;`
    + ' add it to STANDS_FOR in this file',
  );
  return text.split(/\s+/).slice(1).map((word) => values.get(word) ?? word);
}

/**
 * Everything in a piece of markdown that names a file of this repo: the target
 * of a relative link, and a page named in plain words, as the line the README
 * hands out names SETUP.md. A name after a slash belongs to a path that is
 * already covered as a link.
 */
function repoFilesNamedIn(text) {
  const linked = [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
  const spoken = [...text.matchAll(/(?<![\w/.-])[\w-]+\.md\b/g)].map((match) => match[0]);
  return [...new Set([...linked, ...spoken])]
    .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#'));
}

/** The section of the README that holds the line a new user pastes. */
function startHere(readme) {
  const match = /^## Start here\n([\s\S]*?)(?=^## )/m.exec(readme);
  assert.notEqual(match, null, 'the README should have a "Start here" section holding the line a new user pastes');
  return match[1];
}

/** Every repository the text sends someone to, without the punctuation of the sentence around it. */
const reposNamedIn = (text) => [...new Set(
  [...text.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g)].map((match) => match[0].replace(/[.,]+$/, '')),
)].sort();

test('every obk command SETUP.md gives is one the CLI runs', async (t) => {
  // The page is a sequence, so its commands are run in the order it gives them,
  // in a sandbox, against the fake Orca. A command or a flag that was renamed
  // leaves the page telling an assistant to run something that does not exist,
  // and the CLI says so on stderr and stops.
  //
  // Every refusal the CLI makes goes to stderr behind `obk: ` — an unknown
  // command, an unknown flag, a missing one, a bad value, a folder that is not
  // there, an Orca that is down — so an empty stderr is the CLI saying it took
  // the line. But a command that has findings exits 1 with a clean stderr and
  // prints them on stdout, which is not a failure and is what the page tells
  // the assistant about `obk health`. So the code is checked too, and only the
  // commands whose code reports findings are let off it.
  const lines = obkCommands(await pageAt('SETUP.md'));
  assert.ok(lines.length > 0, 'SETUP.md should give the assistant obk commands to run, and none were found in it');

  const ways = Math.max(...lines.map(waysIn));
  for (let way = 0; way < ways; way += 1) {
    const box = await createSandbox(t);
    const values = valuesIn(box);
    for (const line of lines) {
      const argv = argvFor(line, way, values);

      const result = await box.run(argv);

      assert.equal(
        result.stderr,
        '',
        `SETUP.md tells the assistant to run \`${line}\`; run as \`obk ${argv.join(' ')}\` the CLI answered: ${result.stderr}`,
      );
      if (!REPORTS.has(argv[0])) {
        assert.equal(
          result.code,
          0,
          `SETUP.md tells the assistant to run \`${line}\`; run as \`obk ${argv.join(' ')}\` it exited ${result.code}`
          + ` and said nothing about why: ${result.stdout}`,
        );
      }
    }
  }
});

test('the Node floor SETUP.md has the assistant check is the one the package promises', async () => {
  // Step 1 is the only place a user's machine is turned away, and the page
  // carries the number by hand. Two places saying a version is two places to
  // forget: a floor raised in engines.node and left here lets a machine the kit
  // cannot run on through, and lowered here turns one away for nothing.
  const floor = versionOf((await readPackage()).engines.node);
  const page = await pageAt('SETUP.md');

  const named = page.split('\n')
    .filter((line) => /\bnode\b/i.test(line))
    .flatMap((line) => (line.match(/\d+\.\d+\.\d+/g) ?? []).map((version) => ({ version, line: line.trim() })));

  assert.ok(named.length > 0, `SETUP.md should tell the assistant which Node to check for, and it names none (floor ${floor})`);
  for (const { version, line } of named) {
    assert.equal(version, floor, `SETUP.md says Node ${version} and package.json promises ${floor}: ${line}`);
  }
});

test('SETUP.md ships with the package, as the README does', async () => {
  // It is the page someone is sent to after installing the kit, and left out of
  // `files` it exists in this repo and nowhere they can reach.
  const pkg = await readPackage();

  assert.ok(
    pkg.files.includes('SETUP.md'),
    `package.json files should include SETUP.md, got: ${pkg.files.join(', ')}`,
  );
});

test('the pages the README sends a new user to, and the ones SETUP.md names, are there', async () => {
  // The line in the README names SETUP.md in plain words, inside a sentence a
  // machine will follow; renaming the page leaves that line pointing at nothing
  // and the setup stops at its first step.
  //
  // Only the README half of this can fail today: SETUP.md names no file of this
  // repo at all, so its half is wired up and asleep, and the emptiness check
  // below is satisfied by the README alone. It wakes on the page's first link.
  const named = [
    ...repoFilesNamedIn(startHere(await pageAt('README.md'))).map((file) => ({ file, page: 'the README\'s Start here' })),
    ...repoFilesNamedIn(await pageAt('SETUP.md')).map((file) => ({ file, page: 'SETUP.md' })),
  ];
  assert.ok(named.length > 0, 'the line the README hands out should name the page to follow, and no page is named');

  for (const { file, page } of named) {
    assert.ok(
      !file.startsWith('/'),
      `${page} names ${JSON.stringify(file)}, which is a path on the machine rather than a file of this repo`,
    );
    assert.ok(await exists(path.join(repoRoot, file)), `${page} names ${JSON.stringify(file)}, which is not in this repo`);
  }
});

test('the README and SETUP.md send the assistant to the same repository', async () => {
  // The pasted line says where to get the kit and SETUP.md says what to clone.
  // If the repository moves and only one of them is changed, the assistant
  // fetches one thing and clones another, or clones nothing at all.
  const handedOut = reposNamedIn(startHere(await pageAt('README.md')));
  const cloned = reposNamedIn(await pageAt('SETUP.md'));

  assert.equal(handedOut.length, 1, `the line the README hands out should name one repository, got: ${handedOut.join(', ')}`);
  assert.deepEqual(cloned, handedOut, 'SETUP.md should clone the repository the README hands out');
});
