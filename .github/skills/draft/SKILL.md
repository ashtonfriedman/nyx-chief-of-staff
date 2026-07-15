---
name: draft
type: protocol
description: Governs how the agent drafts documents, business cases, meeting notes, and any prose artifact that will be read by humans. Eliminates known AI writing tells (em dash addiction, triple-parallel constructions, MBA-speak, meta-commentary) and enforces direct, specific, credibility-preserving prose. Invoke BEFORE drafting any human-facing document.
---

# Draft

Procedural guardrails for drafting human-facing prose. This skill exists because the agent's default writing output carries obvious AI fingerprints that undermine credibility.

## Origin

This skill was created after pervasive AI writing patterns were identified in a business case doc the agent drafted. The patterns included em dashes used as a universal connector (20+ instances in one doc), triple-parallel structures, formulaic bolded openers, and MBA vocabulary. The doc "sounded like crappy AI wrote it." This skill prevents that.

## When to Invoke

Invoke this skill BEFORE drafting any document that will be read by humans. This includes:

- Business cases, value prop docs, strategy docs
- Meeting notes and summaries
- Initiative specs and design docs
- Leadership-facing artifacts
- Prep docs and talking points
- Any prose longer than a paragraph

## When NOT to Invoke

- Working memory entries (log.md, rules.md)
- Code comments
- Commit messages
- Quick responses in conversation

## Pre-Draft Checklist

Before writing, answer these three questions:

1. Who reads this? (Role, not name.)
2. What do they need to decide or understand after reading?
3. What is the one thing they should remember?

## Voice Integration

If a voice profile exists for the author — a hand-maintained note capturing the author's actual writing patterns — read it before drafting. Use it to calibrate register and vocabulary.

If no voice profile exists yet, use these baseline observations:

- Strong written prose sequences well: gap, then pain, then solution, then architecture. Narrative drafts are good references.
- Prefer direct, specific language over abstract framing.
- Use quotes from technical partners effectively in written artifacts.
- Push back on language that sounds corporate or performative.

---

## Anti-Pattern Catalog

These are the specific patterns to avoid. Each one is a known AI writing tell.

### Structural Patterns

**1. Em dash addiction.**
Do not use em dashes as connectors, asides, or list separators. Use periods to separate thoughts. Use commas for light pauses. Use colons to introduce. Restructure if needed. Use zero. If the user explicitly requests an em dash in a specific place, add it. Otherwise, zero.

**2. Triple-parallel constructions.**
"Without X, without Y, and without Z." This is the AI equivalent of a verbal tic. Break parallels into separate sentences or use two items instead of three.

**3. Bolded leading phrases as paragraph openers.**
"**The core problem:**" followed by explanation. Once or twice in a doc is fine for structure. When every section starts this way, it reads like a template was filled in.

**4. "Here's what/where/how" openers.**
Lazy transitional phrase. Just state the thing.

**5. Formulaic section transitions.**
"Let's look at...", "Now let's turn to...", "With that established..." Delete them. The heading already tells the reader what comes next.

### Vocabulary Patterns

**6. MBA-speak.**
"The competitive moat." "Inaction has a compounding cost." "This is a genuine competitive differentiator." If it sounds like a McKinsey deck, rewrite it.

**7. Meta-commentary.**
"Not a feature comparison bullet." "This is not hypothetical." The prose should make that obvious without the author stating it explicitly.

**8. Superlative claims.**
"The only model that..." "No other platform offers..." These may be true, but state them flatly without the dramatic framing. "AWS and GCP don't have this" beats "This is a genuine competitive differentiator, not a feature comparison bullet."

**9. Filler affirmations.**
"This is a joint effort." "The engineering is straightforward." These add no information. Delete or replace with specifics.

### Audience Patterns

**10. Naming people in shareable doc headers.**
Never put specific names in Audience or Purpose fields of docs that will be shared. Use role descriptions: "PM leadership", "business stakeholders", "partner team PMs." People's names in a header make the doc look like a homework assignment directed at specific individuals.

**11. Quoting meeting transcripts as attribution for doc purpose.**
Don't say "This doc exists because Jennifer said she was struggling." The doc exists because there is a gap. The meeting quote belongs in meeting notes, not in the doc's framing.

**12. Internal jargon in external-facing artifacts.**
When the audience is customers or partners with little context, strip internal names and acronyms they won't know. Examples from a customer one-pager: dropped "Core" (they don't know the service topology), spelled out "Policy Enforcement Point (PEP)" instead of assuming it. Also cut self-evident qualifiers ("set per environment" added nothing). Name the audience's knowledge level before drafting, then write to it.

---

## What Good Looks Like

### Sentence Construction

- Short sentences for impact. Longer sentences when the thought genuinely requires it. Vary the rhythm.
- Subject-verb-object. Don't bury the point in subordinate clauses.
- Specific over abstract. "5,000 PIDs per user causes throttling" beats "attribute volume at scale presents challenges."

### Document Structure

- Pain before plumbing. Start with what is broken, not how you fix it.
- One concept per section. If a section covers two ideas, split it.
- Tables for structured comparisons. Dash-indented blocks (not tables) for pain/ask/solution patterns where the reader needs to breathe between items.
- Mermaid diagrams for architecture and flow. Label nodes with actual resource and system names, not abstractions.

### Tone

- Direct. Not aggressive, not passive. State things.
- Let the facts do the persuading. If the data is strong, the prose does not need to shout.
- Quotes from real people (partners, engineers, customers) are powerful when used sparingly and placed at the top of a section to set context. They work because they are someone else's voice, not yours.

---

## Post-Draft Checklist

After writing, scan for:

- [ ] Zero em dashes (user-requested exceptions only)
- [ ] No triple-parallel constructions
- [ ] No "here's what/where/how" openers
- [ ] No MBA vocabulary ("competitive moat", "compounding cost", "differentiator")
- [ ] No meta-commentary ("not hypothetical", "not a bullet point")
- [ ] No people named in header fields
- [ ] Pain before plumbing (customer problem appears before architecture)
- [ ] Specific language over abstract ("5,000 PIDs" not "attribute volume")

---

## Enforcement Loop

The post-draft checklist is a gate, not guidance. Follow this loop every time:

1. Draft the document.
2. Self-scan against the anti-pattern catalog and post-draft checklist.
3. Rewrite any flagged lines.
4. Final scan. If any items still fail, rewrite again.
5. Only deliver when the checklist passes clean.

Do not present a draft to the user until it clears the checklist. A draft that fails the scan is not a draft. It is a work-in-progress.

---

## Related

- `.github/skills/anti-sycophancy/SKILL.md` : sycophancy defense for comparisons and evaluations (activates alongside draft when the response evaluates or compares work)