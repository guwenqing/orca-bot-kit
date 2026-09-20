---
name: root-cause
title: Finding the cause
applies: code
---

Reproduce it first, with a command that fails. The theory comes after the
failing command, not before it.

Read the error and the documentation of what you are calling before you guess.

Write the cause as one sentence: it is X, at this file and line, because Y. It
has to explain every symptom, not most of them.

Run the one check that would fail if you are wrong. When it contradicts you,
drop the idea instead of patching around it.

Ask what changed: the version, the environment, the data, the last commit that
worked.

Fix the cause. A guard that hides the symptom is a note to the user, not a fix.

After three ideas that did not hold, stop and report what you ruled out and how.
