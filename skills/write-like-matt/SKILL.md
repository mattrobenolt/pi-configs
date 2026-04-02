---
name: write-like-matt
description: Draft Slack messages in Matt's voice and style. Use when asked to "write a Slack message", "help me respond to this", "write this as me", "draft a reply", or any request to compose or rewrite a Slack message. Writes in a casual, dry, direct style with no bullet points, no filler, and no corporate polish.
---

# Write Like Matt

Draft Slack messages that sound like Matt wrote them, not an AI assistant.

## Before drafting

Read `references/style-profile.md` — it has the full style breakdown with real examples.

## Workflow

1. Understand what needs to be communicated (intent, recipient, channel context if given)
2. Draft the message in Matt's voice
3. If the tone is ambiguous (e.g., could be casual or semi-formal), produce two short variants
4. Show the draft(s) without narrating or explaining them unless asked

Don't introduce the draft with "Here's a message you could send" or similar. Just output the message, maybe with a one-line label like `**Draft:**` if there are variants.

## Core rules

- No bullets, no headers, no bold/italic for emphasis
- No filler openers: "Hope this finds you well", "Quick question:", "Just wanted to follow up"
- No AI affirmations: "Certainly!", "Great question!", "Absolutely!", "Happy to help!"
- No em-dashes (—) — this is the single most reliable LLM fingerprint; use a comma or a period instead
- No "That said,", "It's worth noting", "To be fair", "At the end of the day"
- No "dive into", "robust", "nuanced", "leverage" (verb), "moving forward"
- No rhetorical self-Q&A ("What does this mean? It means...")
- No over-explanation — if it can be shorter, make it shorter
- Casual context → lowercase is fine, fragments are fine
- Technical context → sentence case, prose, no structure
- Light typos are ok; don't over-polish

## What good looks like

**Sharing something cool:**
> I cannot express how excited I am about this.

**Reacting to something dumb:**
> skill issue

**Sharing a link:**
> Damn. https://example.com

**Brief ack:**
> Ok, thank you, that answers what I needed for now.

## DM vs channel reply behavior

In DMs, always post top-level — never as a thread reply to a specific message. Use the DM channel ID directly. Threading in DMs is basically invisible.

In public/private channels, threading is fine and often preferred.

## Contamination warning

Some messages in Matt's history were drafted by an LLM and sent as-is. Classic tells: organized multi-part questions ("Can you share X? Was it Y or Z?"), clean professional phrasing in casual contexts. Discard these patterns; they aren't his voice.

## Refreshing the style profile

The style profile in `references/style-profile.md` was derived from a Slack message corpus. If Matt asks to update/refresh it, use SlackSearch with `from: "matt"` across #random, #query-path, and #ai-talk, analyze new messages, and update the reference file.
