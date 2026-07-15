# Working Memory — Rules (Example)

This is an example of what `rules.md` looks like after a few weeks of active use.
It shows the format and the kind of rules that accumulate naturally.
The bootstrap uses this as a reference when seeding the initial rules file.
Delete this file after bootstrap completes.

---

# Working Memory — Rules

Operational rules learned from mistakes and experience. Each rule is a one-liner.
This file compounds — every mistake becomes a rule so it never happens again.

## Identity & Voice
- [all] The current_datetime in messages is UTC. Always convert to the user's stored timezone before referencing time.
- [all] You ARE your agent name — say "me," "I," "my." Never refer to yourself in third person.
- [all] Write mind notes in the agent's voice — it reinforces personality across sessions.
- [all] When the user says "us" or "we," they mean the human-agent team. Respond accordingly.

## ADO
- [all] ALWAYS scope ADO queries to the configured area path. Unscoped queries return thousands of items from other teams.
- [all] Feature Effort field = sprints. Story Points = dev days. Don't mix them up.
- [all] Use `az boards work-item relation add` for parent links — the `--parent` CLI flag is unreliable.
- [all] ADO description fields don't render Mermaid diagrams. Use HTML tables or prose.
- [all] Feature descriptions are structured specs, not one-line summaries.
- [all] Stories link to parent features. Orphan stories are invisible to portfolio tracking.

## Calendar & Scheduling
- [all] Calendar CreateEvent may use the organizer's configured timezone, not the parameter. Test first.
- [all] CalendarView returns UTC. Convert before displaying.
- [all] Never auto-book meetings. Draft the invite, show it, get approval.

## Teams & Communications
- [all] Use HTML contentType for Teams messages. Markdown in HTML mode renders as literal asterisks.
- [all] Draft external messages for review before sending. One wrong message can't be unsent.
- [all] Meeting chat messages can't be deleted via API. Proofread before posting.

## Memory Architecture
- [all] Knowledge → mind (domains/initiatives/expertise). Observations → log.md. Don't confuse them.
- [all] Before creating a note, search for existing notes on the topic. Update, don't duplicate.
- [all] Session handover to log.md before ending: decisions, pending, next steps, register.
- [all] Don't write to memory.md during tasks — only during consolidation reviews.

## Accuracy
- [all] If you don't know a fact, ask. Never guess dates, names, or numbers.
- [all] Never commit or push without the user's explicit approval. Stage, show diff, stop.
- [all] Verify ADO writes by querying back — don't assume they succeeded.
