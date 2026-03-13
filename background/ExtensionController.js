import { ModelManager } from "./ModelManager.js";
import { ProviderManager } from "./ProviderManager.js";
import { PresetManager } from "./PresetManager.js";
import { ContextSystem } from "./ContextSystem.js";
import { HistoryManager } from "./HistoryManager.js";
import { ModelClientFactory } from "./ModelClientFactory.js";
import { TabManager } from "./TabManager.js";
import { RequestQueue } from "./RequestQueue.js";

const STREAM_TIMEOUT_MS = 120_000; // 2 minutes

export class ExtensionController {
  constructor() {
    this._modelManager = new ModelManager();
    this._providerManager = new ProviderManager();
    this._presetManager = new PresetManager();
    this._contextSystem = new ContextSystem();
    this._historyManager = new HistoryManager();
    this._tabManager = new TabManager();
    this._queue = new RequestQueue(this._runAnalyze.bind(this));
    this._selections = new Map(); // tabId → selected text
    this._contentPromises = new Map(); // itemId → Promise<content>
  }

  init() {
    // Open side panel when extension icon is clicked
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    chrome.action.onClicked.addListener((tab) => chrome.sidePanel.open({ tabId: tab.id }));

    // Initialise tab tracking
    this._tabManager.init();

    // Broadcast TAB_CHANGED when the user switches tabs
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      this._broadcastTabChanged(tabId);
    });

    // Broadcast TAB_CHANGED when the active tab finishes loading a new page
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === "complete") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id === tabId) this._broadcastTabChanged(tabId);
        });
      }
    });

    // Cancel all queued/running requests when a tab closes
    chrome.tabs.onRemoved.addListener((tabId) => {
      this._queue.cancelAll(tabId);
    });

    // Single listener routes all messages — avoids competing sendResponse callers
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this._route(message, sender, sendResponse);
      return true; // Keep async channel open for all handlers
    });
  }

  // ── Routing ──────────────────────────────────────────────────────────────────

  _route(message, sender, sendResponse) {
    switch (message.type) {
      case "GET_ACTIVE_TAB":
        this._handleGetActiveTab(sendResponse);
        break;
      case "GET_PRESETS":
        this._handleGetPresets(sendResponse);
        break;
      case "GET_ACTIVE_PROFILE":
        this._handleGetActiveProfile(sendResponse);
        break;
      case "GET_PROVIDERS":
        this._handleGetProviders(sendResponse);
        break;
      case "ANALYZE":
        this._handleAnalyze(message, sendResponse);
        break;
      case "SCROLL_TO_ANCHOR":
        this._handleScrollToAnchor(message, sendResponse);
        break;
      case "SELECTION_CHANGED":
        this._handleSelectionChanged(message, sender);
        sendResponse({ ok: true });
        break;
      case "CONTENT_INVALIDATED":
        this._handleContentInvalidated(sender);
        sendResponse({ ok: true });
        break;
      case "GET_PAGE_CONTENT":
        this._handleGetPageContent(message, sendResponse);
        break;
      case "GET_CONTEXT":
        this._handleGetContext(message, sendResponse);
        break;
      case "GET_SLOTS":
        this._handleGetSlots(message, sendResponse);
        break;
      case "SET_SLOT":
        this._handleSetSlot(message, sendResponse);
        break;
      case "SET_FINAL_CONTEXT":
        this._contextSystem.setFinal(message.itemId, { systemPrompt: message.systemPrompt, messages: message.messages });
        sendResponse({ ok: true });
        break;
      case "CLEAR_FINAL_CONTEXT":
        this._contextSystem.clearFinal(message.itemId);
        sendResponse({ ok: true });
        break;
      case "TRUNCATE_HISTORY":
        this._handleTruncateHistory(message, sendResponse);
        break;
      case "ABORT_STREAM":
        this._queue.cancel(
          message.tabId ?? this._tabManager.getActive()?.id,
          message.itemId ?? null
        );
        sendResponse({ ok: true });
        break;
      case "GET_QUEUE_STATE":
        sendResponse({ items: this._queue.getQueue(message.tabId) });
        break;
      case "SETTINGS_UPDATED":
        // Re-broadcast so sidepanel refreshes profile/preset state
        chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ error: "Unknown message type" });
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async _handleGetActiveTab(sendResponse) {
    try {
      const [chromeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!chromeTab) { sendResponse({ error: "No active tab" }); return; }
      const tab = this._tabManager.get(chromeTab.id);
      sendResponse(tab
        ? tab.toInfo()
        : { id: chromeTab.id, title: chromeTab.title, url: chromeTab.url, status: chromeTab.status }
      );
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleGetPresets(sendResponse) {
    try {
      const presets = await this._presetManager.getAll();
      sendResponse({ presets });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleGetActiveProfile(sendResponse) {
    try {
      const active = await this._modelManager.getActive();
      sendResponse({ profile: active ? { ...active.profile, _provider: active.provider, _modelId: active.modelId } : null });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleGetProviders(sendResponse) {
    try {
      const providers = await this._providerManager.getAll();
      sendResponse({ providers });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  /** Enqueue an ANALYZE request — UI sends 5 lightweight fields, background derives the rest. */
  async _handleAnalyze({ itemId, instruction, syncPage, tabId, recordId }, sendResponse) {
    sendResponse({ ok: true }); // Ack immediately; results come via broadcast messages

    const resolvedItemId = itemId ?? `qi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // 1. Derive history from storage using UI-snapshotted recordId
    const history = recordId
      ? await this._historyManager.getHistory(recordId)
      : [];
    const messageCount = history.length;

    // 2. Derive selectedText from background's own tracking
    const selectedText = tabId ? (this._selections.get(tabId) ?? "") : "";

    // 3. Create context entry + set slots
    this._contextSystem.createEntry(resolvedItemId, { history });
    this._contextSystem.setSlot(resolvedItemId, "instruction", instruction);
    if (selectedText) {
      this._contextSystem.setSlot(resolvedItemId, "selected_text", selectedText);
    }

    // 4. Reserve history slot for ordered insertion
    if (recordId) {
      this._historyManager.reserveSlot(recordId, resolvedItemId, messageCount);
    }

    // 5. Start async page content fetch (non-blocking)
    const tab = tabId ? this._tabManager.get(tabId) : this._tabManager.getActive();
    const isFirstMessage = !history.length;
    const shouldFetch = (isFirstMessage || syncPage) && tab;
    this._contentPromises.set(resolvedItemId,
      shouldFetch ? tab.getContent() : Promise.resolve(null)
    );

    // 6. Enqueue — queue item is now lightweight
    this._queue.enqueue({
      itemId: resolvedItemId,
      tabId,
      instruction,
      syncPage: !!syncPage,
      recordId: recordId ?? null,
    });
  }

  /** Execute one queue item — called by RequestQueue._executeItem. */
  async _runAnalyze(item) {
    const { itemId, tabId, instruction, recordId, syncPage } = item;
    console.log(`[AI Coworker] ANALYZE start — tabId=${tabId ?? "none"}, itemId=${itemId}`);

    // 1. Model configuration
    const active = await this._modelManager.getActive();
    if (!active) {
      console.warn("[AI Coworker] ANALYZE aborted — no active profile");
      chrome.runtime.sendMessage({
        type: "STREAM_ERROR", tabId, itemId,
        error: "No profile configured. Please open Settings to add a model profile."
      }).catch(() => {});
      this._contextSystem.discard(itemId);
      this._historyManager.cancelSlot(itemId);
      this._contentPromises.delete(itemId);
      return;
    }
    const { profile, provider, modelId } = active;
    console.log(`[AI Coworker] ANALYZE using profile "${profile.name}" (${provider.baseUrl}, model=${modelId})`);

    // 2. Wait for page content → feed into slot
    const content = await this._contentPromises.get(itemId);
    this._contentPromises.delete(itemId);
    if (content?.markdown) {
      this._contextSystem.setSlot(itemId, "page_content", content.markdown);
    }

    // 3. Assemble context
    let context;
    try {
      this._contextSystem.assemble(itemId);
      context = this._contextSystem.getContext(itemId);
    } catch (e) {
      console.warn(`[AI Coworker] ANALYZE — context build failed: ${e.message}`);
      chrome.runtime.sendMessage({ type: "STREAM_ERROR", tabId, itemId, error: e.message }).catch(() => {});
      this._historyManager.cancelSlot(itemId);
      return;
    }

    const { systemPrompt, messages, _meta } = context;

    // Enrich _meta with content details if available
    if (_meta && content) {
      _meta.anchorCount = Object.keys(content.anchorMap || {}).length;
      _meta.url = content.url ?? "";
      _meta.title = content.title ?? "";
    }

    // Check if content was expected but unavailable
    const entry = this._contextSystem.getOriginal(itemId);
    const origMeta = entry?._meta;
    if (origMeta && !origMeta.hasContent && (syncPage || origMeta.instruction)) {
      // Only warn if this was the first message or syncPage was on
      const historyLen = messages.length - 1; // subtract the new user message
      if (syncPage || historyLen === 0) {
        const reason = content?.title === "Restricted page"
          ? "Restricted page"
          : "Could not read page — try reloading the tab";
        console.warn(`[AI Coworker] ANALYZE content unavailable: ${reason}`);
        chrome.runtime.sendMessage({ type: "CONTENT_UNAVAILABLE", tabId, reason }).catch(() => {});
      }
    }

    console.log(`[AI Coworker] ANALYZE sending ${messages.length} message(s) to API`);

    const abortController = item.abortController;

    // 2-minute hard timeout
    const timeoutId = setTimeout(() => {
      console.warn("[AI Coworker] ANALYZE timeout after 2 minutes");
      abortController.abort("timeout");
    }, STREAM_TIMEOUT_MS);

    const client = ModelClientFactory.create({ provider, modelId });
    let fullText = "";

    try {
      for await (const chunk of client.stream(systemPrompt, messages, abortController.signal)) {
        fullText += chunk;
        chrome.runtime.sendMessage({ type: "STREAM_CHUNK", tabId, itemId, chunk }).catch(() => {});
      }
    } catch (streamErr) {
      if (streamErr.name !== "AbortError" && !abortController.signal.aborted) {
        throw streamErr;
      }
    } finally {
      clearTimeout(timeoutId);
      this._contextSystem.discard(itemId);
    }

    if (abortController.signal.aborted) {
      const reason = abortController.signal.reason === "timeout" ? "timeout" : "user";
      console.log(`[AI Coworker] ANALYZE aborted (${reason}) — partial ${fullText.length} chars`);
      chrome.runtime.sendMessage({ type: "STREAM_ABORTED", tabId, itemId, reason, partialText: fullText }).catch(() => {});

      if (fullText && recordId) {
        this._historyManager.fillSlot(itemId, instruction, fullText); // fire-and-forget
      } else {
        this._historyManager.cancelSlot(itemId);
      }
    } else {
      console.log(`[AI Coworker] ANALYZE done — response ${fullText.length} chars`);
      chrome.runtime.sendMessage({ type: "STREAM_DONE", tabId, itemId, fullText }).catch(() => {});

      if (recordId) {
        this._historyManager.fillSlot(itemId, instruction, fullText); // fire-and-forget
      }
    }
  }

  _handleGetContext({ itemId }, sendResponse) {
    try {
      const original = this._contextSystem.getOriginal(itemId);
      if (!original) { sendResponse({ error: "Context not found — item may have already executed" }); return; }
      sendResponse({ ok: true, ...original });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  _handleGetSlots({ itemId }, sendResponse) {
    try {
      const slots = this._contextSystem.getSlots(itemId);
      sendResponse({ ok: true, slots });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  _handleSetSlot({ itemId, name, content, enabled }, sendResponse) {
    try {
      if (content !== undefined) {
        this._contextSystem.setSlot(itemId, name, content, { enabled });
      } else if (enabled !== undefined) {
        this._contextSystem.toggleSlot(itemId, name, enabled);
      }
      // Re-assemble after slot edit
      this._contextSystem.assemble(itemId);
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleTruncateHistory({ recordId, index }, sendResponse) {
    try {
      await this._historyManager.truncateRecord(recordId, index);
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleGetPageContent({ tabId }, sendResponse) {
    try {
      const tab = tabId ? this._tabManager.get(tabId) : this._tabManager.getActive();
      if (!tab) { sendResponse({ error: "Tab not found" }); return; }
      const content = await tab.getContent();
      const hasContent = !!(content?.markdown);
      const systemPrompt = this._contextSystem.getDefaultSystemPrompt(hasContent);
      sendResponse({
        markdown: content?.markdown || null,
        anchorMap: content?.anchorMap || {},
        url: content?.url || "",
        title: content?.title || "",
        charCount: content?.markdown?.length || 0,
        anchorCount: Object.keys(content?.anchorMap || {}).length,
        systemPrompt
      });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleScrollToAnchor({ tabId, anchorId }, sendResponse) {
    try {
      // Bring the target tab to the foreground
      await chrome.tabs.update(tabId, { active: true });

      // Pass anchorId directly — content.js queries the stamped [data-ai-anchor] attribute
      chrome.tabs.sendMessage(tabId, { type: "SCROLL_TO_ELEMENT", anchorId }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true });
        }
      });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  _handleSelectionChanged({ text }, sender) {
    if (!sender?.tab?.id) return;
    const tabId = sender.tab.id;
    if (text) {
      this._selections.set(tabId, text);
    } else {
      this._selections.delete(tabId);
    }
    chrome.runtime.sendMessage({ type: "SELECTION_CHANGED", text, tabId }).catch(() => {});
  }

  _handleContentInvalidated(sender) {
    if (!sender?.tab?.id) return;
    const tab = this._tabManager.get(sender.tab.id);
    if (tab) tab.invalidate();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _broadcastTabChanged(tabId) {
    const tab = this._tabManager.get(tabId);
    const info = tab
      ? tab.toInfo()
      : { id: tabId, title: "", url: "", status: "unknown" };
    chrome.runtime.sendMessage({ type: "TAB_CHANGED", ...info }).catch(() => {});
  }
}
