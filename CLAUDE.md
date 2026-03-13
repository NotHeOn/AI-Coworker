# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- Keep modules small and single-responsibility.
- Do not introduce external dependencies without discussion.
- Prefer `chrome.storage.local` for persistence; never log or transmit API keys.

## Architecture

### Process Boundary

The extension has two isolated JS contexts that can only communicate via `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`:

- **Background service worker** (`background.js` → `background/MessageRouter.js`) — routes messages; delegates to `AnalyzePreparer` (request prep + enqueue), `StreamRunner` (stream execution), and existing managers.
- **Side panel** (`sidepanel.js` → `sidepanel/SidePanelController.js`) — thin coordinator; delegates to `ChatViewController` (tab/record/history rendering) and `StreamSession` (send/stream/edit lifecycle). `QueueMirror` provides a read-only projection of the background queue.

`content.js` runs in the page context and handles page extraction and scrolling; the background calls it via `chrome.tabs.sendMessage`.

### Request Lifecycle

1. User sends a message → `StreamSession.send()` shows optimistic UI, then sends `ANALYZE` to the background.
2. Background `AnalyzePreparer.prepare()` derives history, builds context entry, pre-fetches content, and enqueues to `RequestQueue` (per-tab FIFO). Cross-tab requests run in parallel; same-tab requests are serialized.
3. When the item runs, `StreamRunner.run()` waits for content, assembles context via `ContextSystem`, then streams from the AI client. It broadcasts `STREAM_CHUNK` / `STREAM_DONE` / `STREAM_ERROR` / `STREAM_ABORTED`.
4. Side panel receives chunks → appends to DOM → on `STREAM_DONE`, calls `ConversationStore.fillSlot(itemId, userMsg, asstMsg)` which splices at the reserved index (preserving order even if items complete out of order).
5. On error/cancel: `ConversationStore.cancelSlot(itemId)` discards the reservation with no partial write.

### Storage Schema

```js
chrome.storage.local = {
  providers: [{ id, name, type: 'anthropic'|'openai', baseUrl, apiKey }],
  providerModels: { [providerId]: [{ modelId, displayName }] },
  profiles: [{ id, name, providerId, modelId }],
  activeProfileId: string,
  presets: [...],
  chatGroups: [...]   // key intentionally unchanged for backward compat
}
```

Legacy profiles (pre-provider system) have a flat `baseUrl` / `apiKey` on the profile object. `ModelStore.getActive()` synthesises a temporary provider object so the rest of the code sees the same shape.

### Key Conventions

- **`anchorMap` is a plain object** (`{ 'p-1': true, ... }`), not a `Map`, so it JSON-serialises through `chrome.tabs.sendMessage`.
- **Anchor IDs**: `{tag}-{N}` where N starts at 1. NodeList access uses `[index - 1]` (0-based).
- **CitationRenderer** replaces `[§id]` with `QQCITE{n}QQ` placeholders before calling `marked.parse`, then substitutes chip HTML afterward, so marked doesn't corrupt them.
- **Empty `Conversation` records are never written to storage** — `ConversationStore._save()` filters via `record.hasContent()`. They exist in memory only as placeholders until the first message is filled.
- **`ConversationStore.load()`** flushes any pending debounce save before reloading from storage.
- **URL matching** for record lookup uses `origin + pathname` (ignores query string and hash).
- `background/ProfileManager.js`, `background/ModelManager.js`, `background/ProviderManager.js`, `background/PresetManager.js`, `background/HistoryManager.js`, `background/TabManager.js`, `background/ExtensionController.js`, `sidepanel/ConversationManager.js`, and `sidepanel/RequestQueueView.js` are superseded but kept on disk — do not import them in new code.

### Message Protocol (summary)

Sidepanel → background: `GET_ACTIVE_TAB`, `GET_PRESETS`, `GET_ACTIVE_PROFILE`, `GET_PROVIDERS`, `ANALYZE { tabId, itemId, instruction, history, syncPage, selectedText, recordId }`, `ABORT_STREAM { tabId, itemId? }`, `GET_QUEUE_STATE { tabId }`, `SCROLL_TO_ANCHOR { tabId, anchorId }`

Background → content: `EXTRACT_CONTENT` → `{ markdown, anchorMap, url, title }`, `SCROLL_TO_ELEMENT { tag, index }` (index is 1-based)

Background → sidepanel (broadcast): `TAB_CHANGED`, `STREAM_CHUNK`, `STREAM_DONE`, `STREAM_ERROR`, `STREAM_ABORTED`, `QUEUE_UPDATED`, `SETTINGS_UPDATED`

### AI Client Differences

| | Anthropic | OpenAI-compatible |
|---|---|---|
| Endpoint | `POST /messages` | `POST /chat/completions` |
| Auth header | `x-api-key` + `anthropic-version` | `Authorization: Bearer` |
| SSE delta path | `content_block_delta.text_delta` | `choices[0].delta.content` |

`ModelClientFactory.create({provider, modelId})` selects the client based on `provider.type`.

## Naming Conventions

Name classes by **what they do**, not by structural role. Avoid generic suffixes when a precise one exists.

| Suffix | Implies | Use when |
|--------|---------|----------|
| `Router` / `Dispatcher` | Receives input, delegates to others, does no business logic itself | Message routing layers |
| `Runner` / `Executor` | Runs a complete task end-to-end | Stream execution, job processing |
| `Builder` / `Assembler` | Constructs an output step-by-step | Context/prompt assembly |
| `Preparer` | Gathers inputs and hands off to a runner/queue | Pre-processing before enqueue |
| `Store` | Owns state, provides read/write | Persistent or in-memory data |
| `Mirror` | Read-only projection of state owned elsewhere | Cross-process state copies |
| `Factory` | Creates instances based on conditions | Client selection |
| `Renderer` | Transforms data into visual output | Markdown/HTML conversion |

**Avoid** `Manager`, `Handler`, `Service`, `Processor` as default choices — they describe everything and nothing. Use them only when nothing more specific fits.

**Avoid** prefixing the directory name onto the class (e.g. `background/BackgroundRouter.js`) — the directory already provides context. Exception: if the class is imported cross-directory and the bare name would be ambiguous.

**Consistency rule**: match existing project style for similar modules. New modules should use precise names; existing modules keep their names unless being refactored.

## Commit Style

- Short imperative subject line (`Add citation chip hover state`).
- Body explains *why*, not *what*, when non-obvious.
