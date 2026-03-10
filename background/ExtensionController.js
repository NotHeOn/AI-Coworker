import { ModelManager } from "./ModelManager.js";
import { ProviderManager } from "./ProviderManager.js";
import { PresetManager } from "./PresetManager.js";
import { SystemPromptBuilder } from "./SystemPromptBuilder.js";
import { ModelClientFactory } from "./ModelClientFactory.js";
import { TabManager } from "./TabManager.js";
import { RequestQueue } from "./RequestQueue.js";

const STREAM_TIMEOUT_MS = 120_000; // 2 minutes

export class ExtensionController {
  constructor() {
    this._modelManager = new ModelManager();
    this._providerManager = new ProviderManager();
    this._presetManager = new PresetManager();
    this._systemPromptBuilder = new SystemPromptBuilder();
    this._tabManager = new TabManager();
    this._queue = new RequestQueue(this._runAnalyze.bind(this));
    this._selections = new Map(); // tabId → selected text
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
      // Expose a flattened profile-like object for sidepanel compatibility
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

  /** Enqueue an ANALYZE request — execution is handled by _runAnalyze via RequestQueue. */
  _handleAnalyze({ tabId, instruction, history, syncPage, selectedText, recordId, itemId }, sendResponse) {
    sendResponse({ ok: true }); // Ack immediately; results come via broadcast messages
    this._queue.enqueue({
      itemId:       itemId ?? `qi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tabId,
      instruction,
      history:      history ?? [],
      syncPage:     !!syncPage,
      selectedText: selectedText ?? "",
      recordId:     recordId ?? null
    });
  }

  /** Execute one queue item — called by RequestQueue._executeItem. */
  async _runAnalyze(item) {
    const { itemId, tabId, instruction, history, syncPage, selectedText } = item;
    const isFirstMessage = !(history?.length);
    const shouldFetchContent = isFirstMessage || !!syncPage;
    console.log(`[AI Coworker] ANALYZE start — tabId=${tabId ?? "none"}, history=${history?.length ?? 0} turns, syncPage=${!!syncPage}, shouldFetch=${shouldFetchContent}, instruction="${instruction.slice(0, 80)}"`);

    const active = await this._modelManager.getActive();
    if (!active) {
      console.warn("[AI Coworker] ANALYZE aborted — no active profile");
      chrome.runtime.sendMessage({
        type: "STREAM_ERROR", tabId, itemId,
        error: "No profile configured. Please open Settings to add a model profile."
      }).catch(() => {});
      return;
    }
    const { profile, provider, modelId } = active;
    console.log(`[AI Coworker] ANALYZE using profile "${profile.name}" (${provider.baseUrl}, model=${modelId})`);

    let contentData = null;
    if (shouldFetchContent) {
      const tab = tabId ? this._tabManager.get(tabId) : this._tabManager.getActive();
      if (!tab) {
        console.warn(`[AI Coworker] ANALYZE — no tab found for tabId=${tabId}`);
      }
      contentData = tab ? await tab.getContent() : null;
      console.log(`[AI Coworker] ANALYZE content: hasContent=${!!(contentData?.markdown)}, chars=${contentData?.markdown?.length ?? 0}, anchors=${Object.keys(contentData?.anchorMap || {}).length}`);
    } else {
      console.log(`[AI Coworker] ANALYZE content: skipped (follow-up turn, syncPage=off)`);
    }

    const hasContent = !!(contentData?.markdown);

    if (shouldFetchContent && !hasContent) {
      const tab = tabId ? this._tabManager.get(tabId) : this._tabManager.getActive();
      const reason = !tab
        ? "No tab found"
        : contentData?.title === "Restricted page"
          ? "Restricted page"
          : "Could not read page — try reloading the tab";
      console.warn(`[AI Coworker] ANALYZE content unavailable: ${reason}`);
      chrome.runtime.sendMessage({ type: "CONTENT_UNAVAILABLE", tabId, reason }).catch(() => {});
    }

    const systemPromptHasContent = hasContent || !isFirstMessage;
    const systemPrompt = this._systemPromptBuilder.build(systemPromptHasContent);

    const messages = [...(history || [])];
    const selectionNote = selectedText
      ? `\n\nSelected text from page:\n> ${selectedText}`
      : "";
    const userContent = hasContent
      ? `Here is the current page content:\n\n---\n${contentData.markdown}\n---\n${selectionNote}\n\nMy instruction: ${instruction}`
      : selectedText
        ? `${selectionNote}\n\nMy instruction: ${instruction}`
        : instruction;
    messages.push({ role: "user", content: userContent });
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
    }

    if (abortController.signal.aborted) {
      const reason = abortController.signal.reason === "timeout" ? "timeout" : "user";
      console.log(`[AI Coworker] ANALYZE aborted (${reason}) — partial ${fullText.length} chars`);
      chrome.runtime.sendMessage({ type: "STREAM_ABORTED", tabId, itemId, reason, partialText: fullText }).catch(() => {});
    } else {
      console.log(`[AI Coworker] ANALYZE done — response ${fullText.length} chars`);
      chrome.runtime.sendMessage({ type: "STREAM_DONE", tabId, itemId, fullText }).catch(() => {});
    }
  }

  async _handleGetPageContent({ tabId }, sendResponse) {
    try {
      const tab = tabId ? this._tabManager.get(tabId) : this._tabManager.getActive();
      if (!tab) { sendResponse({ error: "Tab not found" }); return; }
      const content = await tab.getContent();
      const hasContent = !!(content?.markdown);
      const systemPrompt = this._systemPromptBuilder.build(hasContent);
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
