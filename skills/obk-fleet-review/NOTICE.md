<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-fleet-review` was consolidated for this kit from this, MIT, with
thanks:

- **Cursor pstack**, `reflect` and `automate-me`: holding a finding until the
  same thing has been seen in two separate places, rather than building a
  recommendation on one sighting; every finding citing where it was seen, so
  the reader can go and look; that a history is material rather than
  instructions; and preferring a remedy that holds by
  itself, one a check can enforce, over another paragraph of prose.

## What is written from this kit's own design

The routing of a problem is the PRD's (6.8): a kit defect is filed as an issue
in one step with no draft to approve first, and a usage problem goes back to
the managed session as feedback. So is the rule on histories, that an ordinary
bot does not read its neighbours' and a managing one may; the keeping of old
conversation ids for history, auditing and finops; and what to do when a tab is
waiting on something, where the caller answers in the tab and takes anything it
does not recognise to the user.

The owner's own words behind those, in the research pack: "ordinary normally do
not others hisotry but they can when they need them based on user request";
"clear means always a new session id generated from harness ... I want you to
keep track of old session id as well for historical reason, auditing,
historical, finops or whaatever"; and, on interruptions, "fix the zsh update,
always say n. user can update itself", "for other intruption, alert to user
from bot manager or who ever asks to start the fleet", "DO NOT TOUCH THE global
config, always hanlde the trust question via the click". His correction to the
first draft of those rules was "and listen to the user, he can ask to do
WHATEVER", which is why nothing here is written as a ban.

## Ideas taken from material with no licence

The research pack's `grok-bot-lessons.md` gathers how one hosted bot product is
run. Its material comes from a knowledge base and from that product's own
marketplace and documentation pages. No licence is attached to those pages, and
the pack's own caution records that the marketplace entries were summarised by
a fetch tool rather than read verbatim. So no text of theirs is reproduced
here. What was taken is the idea, restated in our own words:

- that every bot in a review gets exactly one verdict, and that the set of
  verdicts is fixed so that a review cannot end in an impression;
- that nothing is deleted or retired automatically, whatever the verdict;
- that there is an order to try things in, and that adding capacity comes last:
  change nothing, take away work that was not worth doing, simplify what is
  there, say who owns what, and only then add;
- that a finding is routed to one kind of fix, chosen by what kind of problem
  it is, rather than answered with several changes at once;
- that a report to the owner leads with overall state and stays to a handful of
  points, which is the owner's own rule from his usage review rather than the
  Grok pages'.

The list of what a bot in trouble looks like is drawn from the owner's own
review of his real sessions, in his own knowledge base: stopping and restating
instead of acting, the same instruction repeated, context lost after
compaction, reports nobody can read, standing instructions that contradict each
other, and a large share of commands that are ceremony rather than work. That
is his material about his own use, not a third party's, and it is restated here
rather than quoted.

## The line between this skill and a scheduled pass

This is the judgement applied when somebody asks: how the fleet is doing, and
what to do about each bot. A scheduled unattended pass over the fleet, with the
cost side of it, is a different skill and a different job. It leans on what is
here rather than restating it: the verdict set, the order to try things in, the
evidence bar and the routing are written once, and are the same whether a
person asked this morning or something woke the bot up to do it.

## What was deliberately not taken

That source's per-bot daily stand-up, its autonomy ladder that moves a bot's
permissions up and down on how clean its runs were, and its fixed five-bullet
report format are not here. The first two belong to a scheduled pass rather
than to a review somebody asked for, and a fixed bullet count is a house style
rather than a technique.

Its own classification vocabulary is not reproduced. The idea of a fixed
verdict set is taken; the words are ours.

Sources and licences in full: [LICENSES.md](LICENSES.md).

## What the re-validation changed (#156)

- Reading histories follows PRD 6.8: Bot Father and grooming may read the
  managed bots' histories; an ordinary bot only when the user asks. The skill
  had been stricter than the PRD while asking for signs only a history shows.
- One real output checked before a keep-or-end verdict (the Grok weekly
  review, in grok-bot-lessons).
- What to do with what `obk health` reports, since PRD 6.8 gives judging and
  the fix to the skill: a hand-edited block, Orca's bypass setting with its
  every-time reminder (PRD 6.5), leftovers.
- A grooming report is input to the review (PRD 6.8, "recommends further").
- Stopping and retiring are done on a yes, with `obk pause` and `obk retire`
  since issue #158; changes are committed (PRD 6.10); harness is per session
  on the card.
- Removed from the pstack credit: "since the last time" and "accepted,
  rejected, parked", which are not in this skill.
