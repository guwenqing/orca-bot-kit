# Stand-ins

The detail of the part on stand-ins in the obk-tdd skill, for when a test stands in for
something real. The order of substitutes is in the skill.

What settles this for a system outside your code is not who owns it but
whether you can have one to yourself. A database you start for the test, a
repository you create in a temporary directory, a server you run and throw
away: those are the real thing, isolated, and they are what the order above
asks for; a stand-in there would hide exactly the incompatibility you want to
find. What rules the real one out is sharing it: other people's work in it,
state you cannot reset, or simply not having permission to touch it. Then an
author works against a stand-in, and the project's rules usually name which
systems those are.

Four things about a stand-in, when you do need one. Learn what the real thing
does before you replace it, and stand in at the slow or external level below
what the test depends on, so you do not swallow an effect the test was there to
see. Mirror the real shape completely, not only the fields this test reads: a
partial one passes while the real thing breaks on a field it left out. Assert
the real behaviour, never the stand-in itself. An assertion that the stand-in
is present passes because it is present and says nothing about your code. And
when the setup grows past the test it serves, or you cannot say why it is
there, drop it and test against the real components.
