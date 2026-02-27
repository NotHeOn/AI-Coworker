# CLAUDE.md — AI Coworker

Guidelines for Claude when working on this repository.

## Project Overview

AI Coworker is a Chrome Manifest V3 side-panel extension that lets users chat with AI models (Anthropic Claude, OpenAI-compatible, or local) about the current browser page. No build step — plain ES modules throughout.

## Branch Strategy

**Before making any changes, ask: does this work belong on a new branch?**

- **Yes, create a new branch** when the change is a distinct feature, bug fix, or experiment that could be reviewed or reverted independently.
- **No, stay on the current branch** only if the change is a trivial fix directly related to the ongoing work on that branch.

Branch naming: `claude/<short-description>-<sessionId>`

Never push directly to `master` without explicit permission.

## Development Guidelines

- No build step — edit source files directly; reload the unpacked extension in `chrome://extensions/` to test.
- Keep modules small and single-responsibility (see project structure in `README.md`).
- Do not introduce external dependencies without discussion.
- Prefer `chrome.storage.local` for persistence; never log or transmit API keys.

## Commit Style

- Short imperative subject line (`Add citation chip hover state`).
- Body explains *why*, not *what*, when non-obvious.
