# People

Notes on the people you work with. One file per person.

## Template

```markdown
# {Name}

## Role
- Title:
- Team:
- Reports to:

## Working Style
- Communication preference:
- Decision-making style:
- Availability patterns:

## Areas of Ownership
- Primary:
- Secondary:

## Notes
(Context from 1:1s, meetings, interactions)
```

## Structure

People are grouped by relationship so the agent (and the knowledge graph) can reason
about your org, not just a flat list:

```
domains/people/
  directs/{first-last}/{first-last}.md     # your direct reports
  peers/{first-last}/{first-last}.md       # peers / cross-team counterparts
  hierarchy/{first-last}/{first-last}.md   # your manager, skip-level, leadership
  {first-last}/{first-last}.md             # ungrouped — anyone who doesn't fit above
```

The knowledge graph indexer understands this nesting: every person folder under a group
is registered as a Person node tagged with its `category` (`directs` / `peers` /
`hierarchy`), and ungrouped folders directly under `people/` still register as people.
You do **not** have to flatten — put each person in the group that matches your
relationship to them.

## Conventions

- Group folder: `directs/`, `peers/`, or `hierarchy/` — or place ungrouped people directly under `people/`
- Person folder + file: `{first-last}/{first-last}.md` (lowercase, hyphenated)
- Always confirm pronouns before using them in notes or communications
- Update after every meaningful interaction
- Link to initiatives they contribute to: `[[initiative-name]]`
