---
name: conversation-processor
description: >
  Process conversation transcripts (standups, planning sessions, brainstorms)
  to extract actionable work items, sync with Linear, and produce community-facing
  digests. Use when given a meeting transcript, audio transcription, or conversation
  log that needs to be turned into tracked work and/or a shareable update.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, ToolSearch, Task, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__update_issue
user-invocable: true
---

# Conversation Processor

Extracts workstreams, decisions, and action items from conversation transcripts. Two output modes: **Linear sync** (internal) and **daily digest** (external).

## Workflow

1. **Parse transcript** — identify speakers, topics, decisions, and action items
2. **Extract workstreams** — group related topics into discrete workstreams (existing or new)
3. **Match against Linear** — query Linear for overlapping issues, projects, and cycles
4. **Generate outputs** — based on what the user asks for:
   - **Linear proposals** — create/update/close proposals for review, then execute on approval
   - **Daily digest** — community-facing summary written to `digests/YYYY-MM-DD.md`
   - **Both** — do Linear sync first (for context gathering), then write the digest

## Available References

- `references/work-extraction-linear.md` — Detailed guide for extracting workstreams and mapping them to Linear issues

## Conversation Types

| Type | Focus |
|------|-------|
| Daily standup | Status updates, blockers, quick decisions |
| Planning session | Sprint/cycle planning, priority setting |
| Brainstorm | Open-ended ideation, strategic direction |
| Debrief | Retrospective, lessons learned |

---

## Output: Linear Proposals

Proposals should be structured as:

```
### [ACTION] JINN-XXX: Title
- **Action**: Create / Update / Close / Defer
- **Rationale**: Why this change
- **Details**: Description, assignee, priority, project
```

## Tips for Linear extraction

- Look for implicit workstreams (topics discussed at length but not explicitly called "work")
- Flag strategic/future ideas separately from immediate action items
- Match speaker names to Linear user handles for assignment
- Cross-reference with existing projects to avoid duplication
- Distinguish between "we should do X" (future) and "I did X / I'm doing X" (active)

---

## Output: Daily Digest

A concise, community-friendly update ready to paste into Telegram, Twitter, or wherever.

### Gathering links

For anything mentioned in the transcript, find **publicly accessible** links:

- Use `mcp__linear__list_issues` to understand context — but **NEVER link to Linear** in the digest (issues are private)
- Search for commits/branches via `git log --oneline --since="2 days ago"`
- Search for GitHub repos mentioned (spec repos, PRs) — these are linkable
- Check deployed URLs from memory and codebase:
  - Website: `https://jinn.network`
  - App / launcher: `https://app.jinn.network`
  - Explorer: `https://explorer.jinn.network`
  - ADW spec: `https://github.com/Jinn-Network/adw-spec`
  - jinn-node: `https://github.com/Jinn-Network/jinn-node`
- Look for on-chain transactions or contract addresses referenced
- **Only link to things the public can actually visit.** No private repos, no Linear, no internal dashboards.

### Digest format

```markdown
# Jinn Daily — [Date]

> [One-sentence hook summarizing the most interesting thing from the call]

## What we shipped

- [Concrete thing] — [half-sentence]. [Public link if available]
- [Max 4-5 bullets, one line each]

## What we're thinking about

[1-2 SHORT paragraphs. Plain language. No jargon. Focus on the "why".
Keep this tight — 3-4 sentences max per paragraph.]

## What's next

- [Thing 1 we're building next]
- [Thing 2]
- [Max 3-4 bullets, no names, just what's happening]

## How you can help

- [Concrete action 1 — what someone could do RIGHT NOW]
- [Concrete action 2]
- [Include a way to get in touch — e.g. DM, Telegram, etc.]
```

### Style guidelines

- **Brevity above all.** Readable in under 60 seconds. Cut ruthlessly.
- **Simple language.** Write like a tweet thread, not a blog post. No jargon.
- **Concrete.** Link where possible, but ONLY to publicly accessible URLs.
- **Honest.** "Debugging X" is fine.
- **No emojis** unless the user asks for them.
- **"We" voice.** Not "Oak did X" or "Ritsu built Y". Just "we".
- **"How you can help" is essential.** Every digest should end with concrete actions for readers. Make it feel inviting, not demanding.

### Digest output

Write the digest to `digests/YYYY-MM-DD.md` (create the `digests/` directory if it doesn't exist).
This file is the canonical copy — ready to paste into Telegram, Twitter, or wherever.

Also output the full digest text to the conversation so the user can review it inline.
