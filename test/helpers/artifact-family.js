// The tools of Claude Code's Artifact family that a session was offered and
// that the kit's default cut list does not name, for the line that
// test/system/claude-added-parts-live.test.js prints for each session (#812).
// It is here, and not in that file, so a unit test can load it: loading a
// system test runs it against the real Orca. It reads only tool names, and
// gives only tool names.

/** A tool of the Artifact family: its name begins with `Artifact`. */
const ofFamily = (name) => typeof name === 'string' && name.startsWith('Artifact');

/** The names of a list of tools, each a `{ name }`; none for anything else. */
const namesOfTools = (tools) => tools.map((tool) => tool?.name);

/**
 * The tool names one record of a transcript shows a session was offered, or
 * undefined when the record lists no tools: an `api-request-shape` record's
 * tools, a `deferred_tools_delta`'s added and readded names, or an
 * attachment's own list of named tools.
 */
function offeredIn(record) {
  if (record?.type === 'api-request-shape' && Array.isArray(record.shape?.tools)) return namesOfTools(record.shape.tools);
  const attachment = record?.type === 'attachment' ? record.attachment : undefined;
  if (attachment?.type === 'deferred_tools_delta') return [...(Array.isArray(attachment.addedNames) ? attachment.addedNames : []), ...(Array.isArray(attachment.readdedNames) ? attachment.readdedNames : [])];
  if (Array.isArray(attachment?.tools)) return namesOfTools(attachment.tools);
  return undefined;
}

/**
 * The names of the Artifact family's tools that the transcript `lines` shows
 * the session was offered and that `named` does not hold, each once and
 * sorted; undefined when no record of `lines` lists tools.
 */
export function artifactToolsBeyond(lines, named) {
  const listed = lines.map(offeredIn).filter((names) => names !== undefined);
  if (listed.length === 0) return undefined;
  return [...new Set(listed.flat().filter((name) => ofFamily(name) && !named.includes(name)))].sort();
}

/** The probe's line for one session of the bot `label`. */
export function artifactFamilyLine(label, session, names) {
  if (names === undefined) return `artifact-family ${label} ${session} no tool list in the record`;
  return `artifact-family ${label} ${session} not in the default cut: ${names.length === 0 ? 'none' : names.join(', ')}`;
}
