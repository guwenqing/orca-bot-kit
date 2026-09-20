---
name: review
title: Review
applies: code
---

Work that changed behaviour gets read by someone who did not write it: a fresh
subagent or another session, given the requirement and the diff.

The reviewer comments and does not edit. Whoever wrote the code makes the change
and runs the check again.

The tests are part of what is reviewed: is there a test for what changed, and
would it fail if the code were wrong.

A finding names the line and the evidence for it. "No findings" is a real
result, and so is a review that only dismisses things.

Receiving one: check each point against the code before you act on it. Fix it,
or say why it does not hold and show the evidence. Ask when a point is unclear.
