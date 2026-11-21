# Away from code

The detail of "Away from code" in the obk-tdd skill, for configuration, data, text written
for a model, and a decision that cannot be driven locally.

They apply where there is something that can be wrong and a check that can be
seen to fail: a configuration that decides who gets what, a transformation over
data. The skip rule is the same as for code.

Prose written for people is checked by review, not by a test: a test that matches
its text buys nothing. Text written for a model, a prompt included, is checked the
same way, with one addition: where the requirement is how the model behaves, a
representative use earns its place, and it is the whole check, without the three
moves above. A prompt that must hold an action until it is approved is exercised
once with the approval and once without. Neither needs a manufactured red, and no
wording edit needs a test of its own.

A decision that cannot be driven locally, such as a CI workflow or a setting in
someone else's service, is checked in two parts: its parsed structure and
whatever of it can be executed, then the real run when that is authorised.
Publishing, spending money or changing someone else's settings is never a
mandatory step of a check. A real run put off for later names who triggers it and
says what stays unverified until then.
