import { Tab } from "./Tab.js";

export class TabRegistry {
  constructor() {
    this._tabs = new Map(); // tabId (number) → Tab
    this._activeTabId = null;
  }

  init() {
    chrome.tabs.onCreated.addListener((tab) => this._upsert(tab));
    chrome.tabs.onRemoved.addListener((tabId) => this._onRemove(tabId));
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => this._onUpdated(tabId, changeInfo, tab));
    chrome.tabs.onActivated.addListener(({ tabId }) => this._onActivated(tabId));

    // Seed all currently open tabs
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) this._upsert(tab);
    });

    // Seed active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) this._activeTabId = tabs[0].id;
    });
  }

  get(tabId) {
    return this._tabs.get(tabId) || null;
  }

  getActive() {
    return this._activeTabId !== null ? (this._tabs.get(this._activeTabId) || null) : null;
  }

  _upsert(chromeTab) {
    if (!this._tabs.has(chromeTab.id)) {
      this._tabs.set(chromeTab.id, new Tab(chromeTab.id));
    }
    this._tabs.get(chromeTab.id).updateFromChromeTab(chromeTab);
    return this._tabs.get(chromeTab.id);
  }

  _onRemove(tabId) {
    console.log(`[AI Coworker] TabRegistry: tab#${tabId} removed`);
    this._tabs.delete(tabId);
    if (this._activeTabId === tabId) this._activeTabId = null;
  }

  _onUpdated(tabId, changeInfo, tab) {
    const t = this._upsert(tab);
    // Invalidate content cache on navigation or reload
    if (changeInfo.url || changeInfo.status === "loading") {
      console.log(`[AI Coworker] TabRegistry: tab#${tabId} updated (url=${changeInfo.url ?? "-"}, status=${changeInfo.status ?? "-"}) → invalidating cache`);
      t.invalidate();
    }
  }

  _onActivated(tabId) {
    console.log(`[AI Coworker] TabRegistry: active tab → #${tabId}`);
    this._activeTabId = tabId;
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab) this._upsert(tab);
    });
  }
}
