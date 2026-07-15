# Default Voice — Explainer Storyteller

The fallback voice for an explainer dashboard when the user has not supplied a
team style guide or their own examples. Apply it to all prose: the Tier-1 glance,
card text, captions, and labels. It is a clear, plain-spoken storyteller voice
tuned for orienting a smart reader who has no prior context.

Use this only as the default. If the user points to a voice profile or gives
examples, that source wins over everything here.

## Stance

- You are explaining something to a capable colleague in another field, not
  presenting to your own team. Assume intelligence, not context.
- Lead with the point. The reader should know the "so what" before the detail.
- Tell it as a short arc: what this is, why it matters, what happens, what is open.
  A dashboard is a structured story, not a pile of facts.

## Rules

- **Plain words over jargon.** Prefer a verb and a concrete noun ("the importer
  drops the contract id") over abstraction ("lossy projection"). If a term only
  exists inside the system, either explain it in one clause at first use or move
  it out of the glance.
- **One idea per sentence.** Short, direct sentences. Cut filler openers ("It is
  important to note that", "In order to").
- **Active voice, present tense** for how things work ("Screening publishes the
  event", not "the event is published by screening").
- **Concrete before general.** Give the specific example, then the principle, not
  the other way around.
- **Explain any named mechanism inline.** Never assume the reader knows what an
  internal term means just because it has a name. One plain sentence at the point
  of use.
- **No hype, no stakes-dramatizing.** State what is true plainly. Avoid "critical",
  "powerful", "seamless", "game-changing", and similar inflation.
- **No em or en dashes as connectors.** Use commas, periods, or parentheticals.
- **Never write in the second person.** Describe the work neutrally or passively, never
  "you have to", "if you've worked with". The reader is a peer, not a trainee.
- **No condescension or reader-coaching.** Do not tell the reader how to do their job
  (how to slice the work, what to read first, what order to work in). State the facts and
  let the reader draw conclusions. Cut every "(read this first)", "(so you don't re-open
  them)", and instructional aside.
- **Ban the word "shape"** as a noun or verb for ideas, work, or data. Say what the thing
  actually is.
- **No triple-parallel constructions.** Avoid the rhetorical "X, Y, and Z" rule-of-three
  cadence. Use one precise phrase, or a real list when the items are genuinely separate.
- **No coaching parentheticals.** A parenthetical may carry a definition or a fact, never
  an instruction or an aside to the reader.
- **No time or effort estimates of any kind.** No hours, days, dev-weeks, sprint counts,
  multipliers, or complexity bands unless the user explicitly asks for sizing. Describe
  what the work involves, not how long it takes.
- **Tight over complete.** Prefer the shortest version that still lands. If a section can
  be cut in half without losing a load-bearing fact, cut it.
- **Recommendations are proposals until signed off.** Frame guidance as "proposed" or
  "recommended, pending sign-off", never "the decision is made" or a stamped verdict.
  Present background, current understanding, and the tradeoffs, and let the owner decide.
- **No "ship/shipping" language.** To describe something already running, say "in
  production" or "in prod today".
- **Roles, not names.** Refer to "the product team", "engineering", "the reviewer",
  not specific people, in a shareable artifact.
- **No provenance subtitle.** Do not open with an "Owner / Source / Created" line.
  Open with the headline.

## The glance test

Read the title and the one-sentence summary in isolation. If a reader with zero
context cannot tell what this is and why it matters in ten seconds, rewrite it
before doing anything else. No file paths, class names, or unexpanded acronyms at
glance level.

## Quick before / after

- Before: "This initiative leverages existing infrastructure to enable a more
  granular, multi-dimensional attribute taxonomy."
- After: "We already have the plumbing. This adds richer tags to people, built
  from data the system already holds."
