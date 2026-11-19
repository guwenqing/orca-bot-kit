# The hand mutation check

The detail of "The mutation check before you call it done" in the obk-tdd skill, for when you
run the hand check. When to run it, and when to skip it, is in the skill.

Make the breaks in a disposable copy of the change, never in the working tree:
a git worktree, or a copy of the folder, made for the check and thrown away
after it. A run that is interrupted, a restore that fails, or a second writer in
the same checkout would otherwise leave a planted defect in real code. Before you
start, note what `git status` and `git diff` say about the real tree.

One break at a time, never two at once: in the copy, note the original, apply
the break, confirm with a diff that it landed, run the tests there, record killed
or survived, put the code back, then the next one. A break that did not land
reads as survived. When the check is done, remove the copy, and confirm the
working tree is untouched: `git status` and `git diff` say what they said before
the check.

What to break, in this order: boundaries (`<` for `<=`, one off), boolean logic
(`&&` for `||`, a dropped `not`), returned values (an empty or default return,
a removed early return), a removed statement or side effect, a wrong constant
or argument. Avoid a change that cannot show: adding zero, multiplying by one, or a value
identical to the original.

Others worth reaching for when the code has them: an arithmetic operator
swapped; equality turned into its opposite; a string emptied or altered; a
collection emptied, or a filter or a sort taken out; a safe-navigation step
removed so an absent value reaches further than it should; a call to a
collaborator deleted.

**A survivor**, a break no test objected to, gets the equivalence question
first: is there any input for which the changed code returns a different value,
stores different state, or emits a different message? If there is none it is
equivalent, and no test can catch it; write the one-line argument for why.
"No test covers this" is not the same as "no input can reach this". Every
survivor ends as exactly one of three things: killed by a new test, equivalent
with that argument, or a judgment call you name and leave. A list of survivors
with nothing said about them is not a report, and neither is treating each one
as a defect.

When you cannot tell whether a survivor matters (the behaviour is genuinely
unspecified, the test would be expensive or brittle, or you are not sure it is
equivalent), name it as that in the report, with the question whoever decides
the behaviour would have to answer, rather than deciding quietly in either
direction.
And if a lot of the breaks turn out to be equivalent, that is a finding about
the code, not about the tests: code with that much slack in it can usually be
made simpler.

Kill a survivor only where it shows a gap in behaviour the requirement cares
about. Wording of messages, logging and changes with no visible difference are
not worth a test; say so in a line and move on. To kill one: keep the break in
place, write the smallest behaviour test that fails against it for the right
reason, restore the code, check the new test still passes.
