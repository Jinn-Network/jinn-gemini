---
name: daily-digest
description: >
  Turn a daily standup transcript into a community-facing digest. Use when
  processing meeting transcripts, standup notes, or daily sync recordings
  into shareable updates.
allowed-tools: Bash, Read, Write, Glob, Grep, WebSearch, mcp__linear__list_issues, mcp__linear__get_issue
user-invocable: true
emoji: "\U0001F4E3"
---

# Daily Digest

Turn a raw standup transcript into a concise, community-friendly digest.

## Input

The user provides a transcript (pasted or file path) from a daily standup / sync call.

## Process

### 1. Extract key information from the transcript

Read through the transcript and pull out:

- **What was done yesterday** — concrete accomplishments, merged PRs, deployed services, shipped features
- **What's being discussed** — strategic conversations, product direction, design decisions
- **Vision / narrative** — any big-picture thinking about where the project is heading
- **What's next** — what each person is working on today / this week
- **How people can help** — for each shipped item or next step, what could an outsider do today?

### 2. Gather concrete links and evidence

For anything mentioned in the transcript, try to find **publicly accessible** links:

- Search for relevant **Linear issues** (use `mcp__linear__list_issues`) to understand context — but **NEVER link to Linear** in the output (issues are private)
- Search for relevant **commits or branches** (use `git log --oneline --since="2 days ago"`)
- Search for relevant **GitHub repos** mentioned (e.g. spec repos, PRs) — these are linkable
- Look for **deployed URLs** — check memory and codebase for live URLs:
  - Website: `https://jinn.network`
  - App / launcher: `https://app.jinn.network`
  - Explorer: `https://explorer.jinn.network`
  - ADW spec: `https://github.com/Jinn-Network/adw-spec`
- Look for **on-chain transactions** or contract addresses referenced
- **Only link to things the public can actually visit.** No private repos, no Linear, no internal dashboards.

### 3. Write the digest

Use this format exactly:

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

## Style guidelines

- **Brevity above all.** Readable in under 60 seconds. Cut ruthlessly.
- **Simple language.** Write like a tweet thread, not a blog post. No jargon.
- **Concrete.** Link where possible, but ONLY to publicly accessible URLs.
- **Honest.** "Debugging X" is fine.
- **No emojis** unless the user asks for them.
- **"We" voice.** Not "Oak did X" or "Ritsu built Y". Just "we".
- **"How you can help" is essential.** Every digest should end with concrete actions for readers. Make it feel inviting, not demanding.

## Output

Write the digest to `digests/YYYY-MM-DD.md` (create the `digests/` directory if it doesn't exist).
This file is the canonical copy — ready to paste into Telegram, Twitter, or wherever.

Also output the full digest text to the conversation so the user can review it inline.
