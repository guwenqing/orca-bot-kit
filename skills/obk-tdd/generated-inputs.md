# Generated inputs

The detail of "Generated inputs" in the obk-tdd skill, for code where the inputs are many
and a rule holds for all of them.

State the property first, as a sentence true of every input: decoding what was
encoded gives the input back; the output is sorted and holds the same elements;
running it twice gives what running it once gave; it agrees with a slow, obvious
version of itself. A property that restates the implementation proves nothing.

Generate the inputs with a small loop and a seeded generator. No library is
needed, and none should become a dependency for this. Weight them towards the
edges (empty, one element, the largest, odd characters, the boundaries the
requirement names), bound the count and the time, and print the seed, so a
failure can be run again exactly.

When one fails, make the input as small as it will go while it still fails, and
keep it as an ordinary example test: red first, then the fix. The generated test
stays too, but the example is what guards that bug from now on.

Report what was generated, how many, the seed, and the property. Say what failed
and which example tests it became. "Two thousand inputs, seed 7, no failure" is
evidence for those inputs, not a proof, so say it that way.
