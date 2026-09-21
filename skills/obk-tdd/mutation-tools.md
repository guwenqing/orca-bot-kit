# Mutation tools, by stack

For the occasional audit described in the skill. No project needs one of these,
and the hand check is the everyday method; this page exists so that a run, when
there is a reason for one, is scoped to what changed instead of the whole repo.

How far to trust each line. The StrykerJS flags below — `--incremental`,
`--force` and `-m`/`--mutate` — were checked against `stryker run --help` on
version 10.0.0 on 2026-09-20. Everything else on this page, the line-range form
included, was read from each tool's own documentation on 2026-09-19 and has not
been run. Flags change: check the version the project actually has before
trusting a line here, and prefer a command the project already ships over one
from this page.

**JavaScript, TypeScript — StrykerJS** (Apache-2.0)

```sh
npx stryker run --incremental
npx stryker run --mutate src/x.ts          # one file
npx stryker run --mutate src/x.ts:10-40    # one range
```

**C# — Stryker.NET** (Apache-2.0): `dotnet stryker --since:main`

**Rust — cargo-mutants** (MIT)

```sh
git diff origin/main.. > git.diff && cargo mutants --in-diff git.diff
```

**Go — gremlins** (Apache-2.0): `gremlins unleash --diff origin/main`, with the
full history fetched.

**Python — mutmut 3** (BSD-3-Clause): `mutmut run "module.function*"`;
incremental by default; `mutmut browse` to work through the survivors.

**Python — Cosmic Ray** (MIT): `cosmic-ray init`, then `cr-filter-git`, then
`cosmic-ray exec`, then `cr-report`.

**Java — PIT** (Apache-2.0):
`mvn -DwithHistory test-compile org.pitest:pitest-maven:mutationCoverage`, with
`targetClasses` and `targetTests` globs.

**Anything else** — shell, SQL, configuration, prompts, a language with no such
tool: the hand check in the skill is the method, and it is the same method,
including the rule about when to skip it. Something with no logic in it does
not get broken on purpose just because no tool would have run anyway.

## Four things that older advice gets wrong

- PIT's `scmMutationCoverage` goal was deprecated in 1.17.1 and removed in
  1.18.0. Diff scoping in PIT now comes from a commercial plugin; with the free
  one, scope with the globs above and `-DwithHistory`.
- mutmut 3 has no `--paths-to-mutate`. Scope it in the config (`only_mutate`,
  `do_not_mutate`, `mutate_only_covered_lines = true`) or with a positional
  glob.
- `cargo mutants --in-diff` takes a diff file, not a git ref: write the diff
  out first.
- StrykerJS has no git-diff flag; feed it the changed files yourself.

## Two caveats that apply to all of them

- A diff-scoped run matches the diff against the code under test, not the test
  code. A change that only weakens a test produces no mutants at all and comes
  back clean. When test files change, mutate the code those tests cover.
- A run that picks its targets from a committed diff sees only committed work,
  so on a dirty tree it reports on the wrong code: commit first, or name the
  files yourself instead. Naming them is the better answer when the point is to
  check work that is not committed yet — do not make someone stash the code
  they asked about.
- Whatever selects the targets, a run that dies in the middle can leave a
  mutant in the working copy. Look at the tree afterwards.
