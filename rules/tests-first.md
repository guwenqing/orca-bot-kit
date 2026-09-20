---
name: tests-first
title: Tests first
applies: code
---

A change in behaviour starts with a test that fails for the reason you expect.
Run it, read the failure, then write the code. A bug starts with a test that
reproduces it.

The test author is someone else: a subagent or another session, working from the
requirement and the public interface, not from your plan or your code. When you
can neither start one nor reach one, say so and ask before writing the tests
yourself.

A test that stands in your way goes back to its author with what you think is
wrong with it. It does not get weakened, skipped or deleted to reach green.

Before you call it done, break the logic you changed on purpose a few times and
see whether a test fails each time. Put back what you broke, and report it in
three lines. Skip this for docs, config, wiring, renames and throwaway code, and
say that you skipped it.
