---
name: boring-way
title: The boring way
applies: code
---

When the standard library, the platform or a dependency the project already has
does the job — reading and writing YAML or JSON, paths, quoting, parsing
arguments, running processes, dates — use it.

Before writing something new, look at how this codebase already solves it, and
reuse that. Deleting code is a better answer than adding code when the behaviour
comes out the same.

A new dependency needs a job the standard library cannot do. Pin the version you
tried, and leave a release that is hours old until it has some miles on it.

When you find yourself listing the edge cases of a mechanism you invented,
replace the mechanism.
