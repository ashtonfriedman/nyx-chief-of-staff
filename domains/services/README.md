# Services

Service notes track the technical architecture of services your team owns.
For PMs, this is read-only reference context — engineers maintain the details.

## When to Create a Service Note

- Your team owns the service and you need to understand its boundaries
- You're explaining service behavior to stakeholders
- Cross-team dependencies involve this service

## Template

```markdown
# {Service Name}

## Purpose
What does this service do in one sentence?

## Key Behaviors
- {Behavior 1}: {description and why it matters}
- {Behavior 2}: {description}

## Consumers
- Who calls this service?
- What data do they expect?

## Dependencies
- What does this service depend on? (databases, other services, external APIs)

## Cloud Environments
- Public / Gov / RX / EX — which ones, any differences?

## Known Issues
- {Issue}: {impact and status}
```

## Naming Convention

`{service-name}.md` — lowercase, hyphenated. Example: `services/groups-service.md`
