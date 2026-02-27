# AI Coworker — Chrome Extension

A Chrome side-panel extension that reads the current page and lets you chat with any AI model (Claude, OpenAI-compatible, or local) about it. Supports streaming responses, inline citations that scroll to the source paragraph, and conversation branching via message editing.

---

## Features

- **Side panel UI** — stays open while you browse; no popup needed
- **Multi-provider profiles** — add as many model profiles as you like (Anthropic Claude, OpenAI, Ollama, or any OpenAI-compatible endpoint)
- **Page-aware context** — automatically extracts the page's readable content and sends it with your message
- **Inline citations** — the AI can reference specific paragraphs (`[§p-3]`); clicking a citation scrolls the page to that element
- **Streaming responses** — token-by-token output with a stop button (Esc or click)
- **Per-tab conversation history** — each browser tab keeps its own chat; switching tabs restores the previous conversation
- **Message node editing** — hover any past user message, click the pencil icon, edit the text, and resend — the conversation branches from that point
- **SPA navigation awareness** — detects client-side route changes and invalidates the page content cache
- **Quick-prompt presets** — configurable one-click prompts on the welcome screen
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

### Model Profiles

Each profile needs:

| Field | Example |
|---|---|
| Name | `Claude Sonnet` |
| Base URL | `https://api.anthropic.com` |
| Model name | `claude-sonnet-4-5` |
| API key | `sk-ant-...` |

The API type is detected automatically:
- URL contains `anthropic.com` → Anthropic Messages API
- Anything else → OpenAI-compatible (`/chat/completions`)

This means you can point it at **Ollama** (`http://localhost:11434`), **OpenRouter**, **Together AI**, or any other OpenAI-compatible host.

### Presets

Quick-prompt buttons on the welcome screen. Edit them in Settings → Presets.

---

## Usage

1. Navigate to any webpage
2. Type a question in the input box (or click a preset)
3. Press **Enter** or click the send button
4. Click any `§` citation chip to scroll the page to the referenced paragraph
5. **Edit a past message**: hover it → click the pencil → edit → press Enter or click **Resend ↑**

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
│   ├── ModelClientFactory.js  # Selects client based on profile baseUrl
│   ├── ProfileManager.js      # CRUD for model profiles in chrome.storage
│   ├── PresetManager.js       # CRUD for quick-prompt presets
│   ├── SystemPromptBuilder.js # Builds system prompt with citation rules
│   ├── Tab.js                 # Tab state + lazy content cache
│   ├── TabManager.js          # Tracks open tabs
│   ├── ExtensionController.js # Central message router
│   └── sseParser.js           # Async generator for SSE streams
└── sidepanel/
    ├── ConversationManager.js # Per-tab history storage
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

Your API key is stored locally in `chrome.storage.local` and is only ever sent directly to the model provider you configure. Page content is sent to that provider when you send a message. Nothing is collected by this extension.
