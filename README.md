# AI Coworker — Chrome Extension

A Chrome side-panel extension that reads the current page and lets you chat with any AI model (Claude, OpenAI-compatible, or local) about it. Supports streaming responses, inline citations that scroll to the source paragraph, persistent chat history, and conversation branching via message editing.

---

## Features

- **Side panel UI** — stays open while you browse; no popup needed
- **Provider + Profile system** — define providers once (name, API type, base URL, API key); create lightweight profiles that reference a provider and pick a model; switch between them from the side panel dropdown
- **Auto model discovery** — click "Fetch Models" in Settings to pull the live model list from any provider and choose from a dropdown
- **Page-aware context** — automatically extracts the page's readable content and sends it with your message
- **Inline citations** — the AI can reference specific paragraphs (`[§p-3]`); clicking a citation scrolls the page to that element
- **Streaming responses** — token-by-token output with a stop button (Esc or click); messages sent while a response is streaming are queued and executed in order; a badge shows how many are waiting
- **Persistent chat history** — conversations are saved per URL and restored automatically when you return to a page; switching between `a.com/hello` and `a.com/pricing` keeps separate histories; records are named `{PageTitle}_{HH:MM}` by default
- **History view** — click the clock icon to browse, load, or delete past conversations for the current domain; **View All** opens the full history in Settings
- **Cross-page history import** — loading a record from a different URL prompts you to start a new conversation or import it directly (auto-enables Sync Page)
- **Safe link opening** — URLs in AI responses show a confirmation dialog before opening in a new tab
- **Message node editing** — hover any past user message, click the pencil icon, edit the text, and resend — the conversation branches from that point
- **SPA navigation awareness** — detects client-side route changes and invalidates the page content cache
- **Quick-prompt presets** — configurable one-click prompts on the welcome screen
- **Selected-text context** — select text on the page before asking a question; it's attached as context to your message
- **Content preview** — click the page title bar to open the raw extracted markdown in a new tab

---

## Installation (Developer Mode)

1. Clone or download this repository
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `Chrome Extension` folder
5. Click the extension icon in the toolbar → the side panel opens
6. Open **Settings** (gear icon) to add your first model profile

---

## Configuration

### Providers

A **Provider** holds the connection details for one API endpoint. Add it once, reuse it across many profiles.

| Field | Example |
|---|---|
| Name | `Anthropic` |
| API Type | `Anthropic` or `OpenAI-compatible` |
| Base URL | `https://api.anthropic.com/v1` |
| API Key | `sk-ant-...` |

Supported endpoints: Anthropic, OpenAI, **Ollama** (`http://localhost:11434/v1`), OpenRouter, Together AI, or any OpenAI-compatible host.

After saving a provider, click **Fetch Models** to pull the live model list and cache it locally.

### Model Profiles

A **Profile** references a provider and selects a specific model. This keeps credentials in one place while letting you switch models instantly.

| Field | Example |
|---|---|
| Name | `Claude Sonnet` |
| Provider | *(select from saved providers)* |
| Model | `claude-sonnet-4-6` *(dropdown or manual ID)* |

> **Backward compatibility** — profiles created before the Provider system (with a flat Base URL / Model Name / API Key) continue to work without any migration.

### Presets

Quick-prompt buttons on the welcome screen. Edit them in **Settings → Quick Prompt Presets**.

---

## Usage

1. Navigate to any webpage
2. Type a question in the input box (or click a preset)
3. Press **Enter** or click the send button
4. Click any `§` citation chip to scroll the page to the referenced paragraph
5. **Edit a past message**: hover it → click the pencil → edit → press Enter or click **Resend ↑**
6. **Browse history**: click the clock icon (top-right) to see all conversations for the current domain; click a record to resume it or trash it to delete; click **View All** to open the full history in Settings
7. **Load a record from another page**: if the record's URL differs from the current tab, choose to start a new conversation or import it (Sync Page is turned on automatically)
8. **New conversation**: click the pencil-square icon to start fresh on the current page

---

## Project Structure

```
Chrome Extension/
├── manifest.json
├── background.js              # Entry point (imports ExtensionController)
├── sidepanel.js               # Entry point (imports SidePanelController)
├── content.js                 # Page extractor, scroll controller, SPA watcher
├── sidepanel.html / .css
├── settings.html / settings.js
├── preview.html / preview.js  # Raw content viewer
├── background/
│   ├── AnthropicClient.js     # Streaming client for Anthropic API
│   ├── OpenAIClient.js        # Streaming client for OpenAI-compatible APIs
│   ├── ModelClientFactory.js  # Selects client based on provider.type
│   ├── ModelManager.js        # Resolves active profile → {profile, provider, modelId}
│   ├── ProviderManager.js     # CRUD for providers; fetchModels(); model list cache
│   ├── ProfileManager.js      # (legacy, superseded by ModelManager)
│   ├── PresetManager.js       # CRUD for quick-prompt presets
│   ├── RequestQueue.js        # Per-tab FIFO queue for AI requests; enables same-tab queuing and cross-tab parallelism
│   ├── SystemPromptBuilder.js # Builds system prompt with citation rules
│   ├── Tab.js                 # Tab state + lazy content cache
│   ├── TabManager.js          # Tracks open tabs
│   ├── ExtensionController.js # Central message router + stream orchestrator
│   └── sseParser.js           # Async generator for SSE streams
└── sidepanel/
    ├── Conversation.js        # Single conversation thread; title defaults to {pageTitle}_{HH:MM}
    ├── SiteHistory.js         # All conversations for one origin (domain)
    ├── ConversationStore.js   # Persistent store; URL-based record matching; queue write channel
    ├── RequestQueueView.js    # Read-only UI mirror of the background RequestQueue
    ├── CitationRenderer.js    # Parses [§id] anchors → clickable chips
    ├── SidePanelUI.js         # All DOM operations
    └── SidePanelController.js # Coordinates UI ↔ background messaging
```

---

## Tech Stack

- **Manifest V3** Chrome Extension
- Plain ES modules — no build step, no bundler
- [marked.js](https://marked.js.org/) for markdown rendering (loaded as classic script)

---

## Privacy

Your API key is stored locally in `chrome.storage.local` and is only ever sent directly to the model provider you configure. Page content is sent to that provider when you send a message. Chat history is stored locally in `chrome.storage.local` and never leaves your browser. Nothing is collected by this extension.
