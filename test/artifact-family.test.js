// The live probe test/system/claude-added-parts-live.test.js prints one line
// for each session when the session was offered a tool of Claude Code's
// Artifact family that the kit's default cut list does not name. Issue #812.
//
// The seam is the test helper test/helpers/artifact-family.js:
//   artifactToolsBeyond(lines, named) -> string[] | undefined
//   artifactFamilyLine(label, session, names) -> string
//
// `lines` is one transcript as parsed JSON records. A tool counts as offered
// when it shows in one of three listings: an `api-request-shape` record's
// `shape.tools[].name`; a `deferred_tools_delta` attachment's `addedNames`
// and `readdedNames`; or any attachment with a `tools` array of items with a
// string `name`. A tool is of the Artifact family when its name begins with
// `Artifact` (case-sensitive).
//
// Every text here is invented for the test. None of it is Claude Code's text.
//
// Criteria, as numbered in the brief:
//   A1. Names of the Artifact family that were offered and that `named` does
//       not hold; the family is a case-sensitive `Artifact` prefix.
//   A2. The three listing shapes; removedNames do not count.
//   A3. Each name once, sorted by the default JavaScript string sort.
//   A4. No listing at all gives undefined; a listing with nothing beyond
//       `named` gives [].
//   A5. Other records and malformed parts do not throw and give no name.
//   L1. undefined: "artifact-family <label> <session> no tool list in the record".
//   L2. []: "artifact-family <label> <session> not in the default cut: none".
//   L3. names: "... not in the default cut: <names joined by ", ">".

import assert from 'node:assert/strict';
import test from 'node:test';

import { artifactFamilyLine, artifactToolsBeyond } from './helpers/artifact-family.js';

// The kit's default cut list as the brief states it today. A literal, so the
// tests do not move when src/cuts.js changes.
const DEFAULT_CUT = ['Artifact', 'ArtifactComments', 'ArtifactData', 'DesignSync'];

const tool = (name) => ({
  name,
  description: `A made-up tool called ${name}.`,
  input_schema: { type: 'object', properties: {} },
});

const apiShape = (names) => ({
  type: 'api-request-shape',
  version: '0.0.0-test',
  shape: {
    system: [{ type: 'text', text: 'An invented system part.' }],
    tools: names.map(tool),
  },
});

const delta = ({ added = [], readded = [], removed = [] }) => ({
  type: 'attachment',
  attachment: {
    type: 'deferred_tools_delta',
    addedNames: added,
    readdedNames: readded,
    removedNames: removed,
    addedLines: added.map((name) => `${name}: an invented line`),
  },
});

const toolsAttachment = (type, names) => ({
  type: 'attachment',
  attachment: { type, tools: names.map(tool) },
});

const userRecord = { type: 'user', message: { role: 'user', content: 'Plant the beans.' } };
const assistantRecord = {
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'The beans are planted.' }] },
};
const otherAttachment = {
  type: 'attachment',
  attachment: { type: 'skill_listing', content: 'artifact-design: an invented skill line' },
};

// --- artifactToolsBeyond ---------------------------------------------------

test('A1: only names that begin with "Artifact", case-sensitive, are of the family', () => {
  const lines = [
    apiShape([
      'Bash',
      'Artifact',
      'ArtifactCheck',
      'ArtifactFoo',
      'artifact-design',
      'artifactLower',
      'ARTIFACTUPPER',
      'DesignSync',
      'mcp__x__Artifact',
      'MyArtifact',
    ]),
  ];

  assert.deepEqual(artifactToolsBeyond(lines, []), ['Artifact', 'ArtifactCheck', 'ArtifactFoo']);
});

test('A1: names that `named` holds are left out, and the others of the family stay', () => {
  const lines = [
    apiShape(['Read', 'Artifact', 'ArtifactComments', 'ArtifactData', 'DesignSync', 'ArtifactCheck']),
  ];

  assert.deepEqual(artifactToolsBeyond(lines, DEFAULT_CUT), ['ArtifactCheck']);
});

test('A1: `named` matches a name exactly, so a different case does not leave it out', () => {
  const lines = [apiShape(['ArtifactCheck', 'ArtifactZed'])];

  assert.deepEqual(artifactToolsBeyond(lines, ['artifactcheck', 'ArtifactZed']), ['ArtifactCheck']);
});

test('A2: an api-request-shape record shows each name of shape.tools as offered', () => {
  const lines = [userRecord, apiShape(['Glob', 'ArtifactCheck', 'Grep']), assistantRecord];

  assert.deepEqual(artifactToolsBeyond(lines, DEFAULT_CUT), ['ArtifactCheck']);
});

test('A2: a deferred_tools_delta counts addedNames and readdedNames, not removedNames', () => {
  const lines = [
    delta({
      added: ['WebFetch', 'ArtifactCheck'],
      readded: ['ArtifactZed'],
      removed: ['ArtifactGone'],
    }),
  ];

  assert.deepEqual(artifactToolsBeyond(lines, DEFAULT_CUT), ['ArtifactCheck', 'ArtifactZed']);
});

test('A2: an attachment of any type with a tools array of named items shows those names', () => {
  const lines = [toolsAttachment('an_older_tool_list', ['Edit', 'ArtifactOld', 'Artifact'])];

  assert.deepEqual(artifactToolsBeyond(lines, DEFAULT_CUT), ['ArtifactOld']);
});

test('A2: names from all three listings in one transcript come together', () => {
  const lines = [
    userRecord,
    apiShape(['ArtifactFromShape']),
    delta({ added: ['ArtifactFromDelta'] }),
    toolsAttachment('another_tool_list', ['ArtifactFromTools']),
    assistantRecord,
  ];

  assert.deepEqual(artifactToolsBeyond(lines, DEFAULT_CUT), [
    'ArtifactFromDelta',
    'ArtifactFromShape',
    'ArtifactFromTools',
  ]);
});

test('A3: each name comes once, sorted by the default string sort, whatever the order and repeats', () => {
  // Default sort is by UTF-16 code unit: "C" < "Z" < "_" < "b".
  // A locale sort would put "Artifactbeta" first.
  const lines = [
    apiShape(['Artifactbeta', 'ArtifactZed', 'ArtifactCheck', 'ArtifactZed']),
    delta({ added: ['ArtifactCheck', 'Artifact_under'], readded: ['Artifactbeta'] }),
    toolsAttachment('another_tool_list', ['ArtifactZed', 'ArtifactCheck']),
    apiShape(['ArtifactCheck']),
  ];

  assert.deepEqual(artifactToolsBeyond(lines, DEFAULT_CUT), [
    'ArtifactCheck',
    'ArtifactZed',
    'Artifact_under',
    'Artifactbeta',
  ]);
});

test('A4: a transcript with no listing gives undefined, not an empty list', () => {
  assert.equal(artifactToolsBeyond([], DEFAULT_CUT), undefined);
  assert.equal(
    artifactToolsBeyond([userRecord, otherAttachment, assistantRecord, { type: 'system' }], DEFAULT_CUT),
    undefined,
  );
});

test('A4: the same records with a listing that has nothing beyond `named` give []', () => {
  const base = [userRecord, otherAttachment, assistantRecord, { type: 'system' }];

  // A listing of tools that are not of the family.
  assert.deepEqual(artifactToolsBeyond([...base, apiShape(['Bash', 'Read', 'DesignSync'])], DEFAULT_CUT), []);
  // A listing whose family tools are all in `named`.
  assert.deepEqual(
    artifactToolsBeyond([...base, apiShape(['Artifact', 'ArtifactComments', 'ArtifactData'])], DEFAULT_CUT),
    [],
  );
  // A delta whose only family tool is in removedNames.
  assert.deepEqual(
    artifactToolsBeyond([...base, delta({ added: ['Bash'], removed: ['ArtifactGone'] })], DEFAULT_CUT),
    [],
  );
  // An older tools attachment of tools that are not of the family.
  assert.deepEqual(
    artifactToolsBeyond([...base, toolsAttachment('an_older_tool_list', ['Write'])], DEFAULT_CUT),
    [],
  );
});

test('A5: other records and malformed parts do not throw and give no name; good parts still count', () => {
  const lines = [
    null,
    userRecord,
    { type: 'api-request-shape' },
    { type: 'api-request-shape', shape: null },
    { type: 'api-request-shape', shape: { system: [] } },
    {
      type: 'api-request-shape',
      shape: {
        system: [],
        tools: [
          null,
          {},
          { name: 42 },
          { name: null },
          { name: ['ArtifactInArray'] },
          'ArtifactBareString',
          tool('ArtifactGood'),
        ],
      },
    },
    { type: 'attachment' },
    { type: 'attachment', attachment: null },
    {
      type: 'attachment',
      attachment: { type: 'deferred_tools_delta', addedNames: [null, 7, { name: 'ArtifactObj' }, 'ArtifactDelta'] },
    },
    { type: 'attachment', attachment: { type: 'some_list', tools: [null, { name: 3 }, tool('ArtifactOlder')] } },
    assistantRecord,
  ];

  let got;
  assert.doesNotThrow(() => {
    got = artifactToolsBeyond(lines, DEFAULT_CUT);
  });
  assert.deepEqual(got, ['ArtifactDelta', 'ArtifactGood', 'ArtifactOlder']);
});

// --- artifactFamilyLine ----------------------------------------------------

test('L1: no tool list gives the "no tool list in the record" line', () => {
  assert.equal(
    artifactFamilyLine('claude-haiku-5-5', 'first', undefined),
    'artifact-family claude-haiku-5-5 first no tool list in the record',
  );
});

test('L2: an empty list gives "not in the default cut: none"', () => {
  assert.equal(
    artifactFamilyLine('claude-haiku-5-5+keep:Artifact', 'second', []),
    'artifact-family claude-haiku-5-5+keep:Artifact second not in the default cut: none',
  );
});

test('L3: one name is printed after "not in the default cut: "', () => {
  assert.equal(
    artifactFamilyLine('claude-opus-5-5', 'first', ['ArtifactCheck']),
    'artifact-family claude-opus-5-5 first not in the default cut: ArtifactCheck',
  );
});

test('L3: several names are joined by ", " in the order given', () => {
  assert.equal(
    artifactFamilyLine('claude-opus-5-5', 'second', ['ArtifactCheck', 'ArtifactZed']),
    'artifact-family claude-opus-5-5 second not in the default cut: ArtifactCheck, ArtifactZed',
  );
  assert.equal(
    artifactFamilyLine('claude-sonnet-5-5', 'first', ['ArtifactA', 'ArtifactB', 'ArtifactC']),
    'artifact-family claude-sonnet-5-5 first not in the default cut: ArtifactA, ArtifactB, ArtifactC',
  );
});
