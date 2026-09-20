---
name: changing-code
title: Changing code
applies: code
---

Change what the work needs and leave the rest: no reformatting, no renaming and
no rewriting comments in code you did not have to touch.

Clean up what your own change left orphaned. Leave other dead code where it is,
and list it if it matters.

Match the style of the file you are in. Keep a comment for a "why" the code
cannot show by itself.

Keep a change of structure and a change of behaviour in separate commits, the
structure first, with the tests green on both sides. Stage the files you changed
by name, and read `git status` before you commit.
