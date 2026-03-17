import { ModelStore } from "./ModelStore.js";
import { ProviderStore } from "./ProviderStore.js";
import { PresetStore } from "./PresetStore.js";
import { ContextSystem } from "./ContextSystem.js";
import { HistoryStore } from "./HistoryStore.js";
import { TabRegistry } from "./TabRegistry.js";
import { RequestQueue } from "./RequestQueue.js";
import { StreamRunner } from "./StreamRunner.js";
import { AnalyzePreparer } from "./AnalyzePreparer.js";

/**
 * MessageRouter — routes all Chrome runtime messages to the appropriate handler.
 *
 * Owns Chrome event setup and simple delegation. Complex logic lives in
 * StreamRunner (stream execution) and AnalyzePreparer (request preparation).
 */
export class MessageRouter {
  constructor() {
    this._modelStore = new ModelStore();
    this._providerStore = new ProviderStore();
    this._presetStore = new PresetStore();
    this._contextSystem = new ContextSystem();
    this._historyStore = new HistoryStore();
    this._tabRegistry = new TabRegistry();

    this._streamRunner = new StreamRunner({
      modelStore: this._modelStore,
      contextSystem: this._contextSystem,
      historyStore: this._historyStore,
    });

    this._queue = new RequestQueue((item) => this._streamRunner.run(item));

    this._preparer = new AnalyzePreparer({
      historyStore: this._historyStore,
      contextSystem: this._contextSystem,
      tabRegistry: this._tabRegistry,
      queue: this._queue,
    });
  }

  init() {
    // Open side panel when extension icon is clicked
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    chrome.action.onClicked.addListener((tab) => chrome.sidePanel.open({ tabId: tab.id }));

    // Initialise tab tracking
    this._tabRegistry.init();

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
      this._dispatch(message, sender, sendResponse);
      return true; // Keep async channel open for all handlers
    });
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────────

  _dispatch(message, sender, sendResponse) {
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
      case "FETCH_MODELS":
        this._handleFetchModels(message, sendResponse);
        break;
      case "ANALYZE":
        this._preparer.prepare(message, sendResponse);
        break;
      case "SCROLL_TO_ANCHOR":
        this._handleScrollToAnchor(message, sendResponse);
        break;
      case "SELECTION_CHANGED":
        this._preparer.handleSelectionChanged(message, sender);
        sendResponse({ ok: true });
        break;
      case "CONTENT_INVALIDATED":
        this._handleContentInvalidated(sender);
        sendResponse({ ok: true });
        break;
      case "GET_PAGE_CONTENT":
        this._handleGetPageContent(message, sendResponse);
        break;
      case "TRUNCATE_HISTORY":
        this._handleTruncateHistory(message, sendResponse);
        break;
      case "ABORT_STREAM":
        this._queue.cancel(
          message.tabId ?? this._tabRegistry.getActive()?.id,
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
      const tab = this._tabRegistry.get(chromeTab.id);
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
      const presets = await this._presetStore.getAll();
      sendResponse({ presets });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleGetActiveProfile(sendResponse) {
    try {
      const active = await this._modelStore.getActive();
      sendResponse({ profile: active ? { ...active.profile, _provider: active.provider, _modelId: active.modelId } : null });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleGetProviders(sendResponse) {
    try {
      const providers = await this._providerStore.getAll();
      sendResponse({ providers });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleFetchModels({ providerId }, sendResponse) {
    try {
      const providers = await this._providerStore.getAll();
      const provider = providers.find(p => p.id === providerId);
      if (!provider) { sendResponse({ error: "Provider not found" }); return; }
      const models = await this._providerStore.fetchModels(provider);
      await this._providerStore.cacheModels(providerId, models);
      sendResponse({ models });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleTruncateHistory({ recordId, index }, sendResponse) {
    try {
      await this._historyStore.truncateRecord(recordId, index);
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  }

  async _handleGetPageContent({ tabId }, sendResponse) {
    try {
      const tab = tabId ? this._tabRegistry.get(tabId) : this._tabRegistry.getActive();
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

  _handleContentInvalidated(sender) {
    if (!sender?.tab?.id) return;
    const tab = this._tabRegistry.get(sender.tab.id);
    if (tab) tab.invalidate();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _broadcastTabChanged(tabId) {
    const tab = this._tabRegistry.get(tabId);
    const info = tab
      ? tab.toInfo()
      : { id: tabId, title: "", url: "", status: "unknown" };
    chrome.runtime.sendMessage({ type: "TAB_CHANGED", ...info }).catch(() => {});
  }
}
