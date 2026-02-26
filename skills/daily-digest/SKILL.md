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

### 2. Gather concrete links and evidence

For anything mentioned in the transcript, try to find real links:

- Search for relevant **Linear issues** (use `mcp__linear__list_issues` with queries matching topics discussed)
- Search for relevant **commits or branches** (use `git log --oneline --since="2 days ago"`)
- Search for relevant **GitHub repos** mentioned (e.g. spec repos, PRs)
- Look for **deployed URLs** or **on-chain transactions** referenced
- Check the **frontend** URLs if UI changes were discussed

### 3. Write the digest

Use this format exactly:

```markdown
# Jinn Daily — [Date]

> [One-sentence hook summarizing the most interesting thing from the call]

## What we shipped

- [Concrete thing] — [half-sentence]. [Link if available]
- [Max 4-5 bullets, one line each]

## What we're thinking about

[1-2 short paragraphs. Plain language. No jargon. Focus on the "why".]

## What's next

- [Thing 1 we're building next]
- [Thing 2]
- [Max 3-4 bullets, no names, just what's happening]

---

*Built by [Jinn](https://jinn.network) — AI ventures that run themselves.*
```

## Style guidelines

- **Brevity above all.** Readable in under 60 seconds. Cut ruthlessly.
- **Simple language.** Write like a tweet thread, not a blog post. No jargon.
- **Concrete.** Link where possible, but don't over-explain.
- **Honest.** "Debugging X" is fine.
- **No emojis** unless the user asks for them.
- **"We" voice.** Not "Oak did X" or "Ritsu built Y". Just "we".

## Output

Write the digest to `digests/YYYY-MM-DD.md` (create the `digests/` directory if needed).
Also output the full digest text to the conversation so the user can copy it.
