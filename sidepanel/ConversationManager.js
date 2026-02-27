export class ConversationManager {
  constructor() {
    // Per-tab history storage. Key = tabId (number), Value = { role, content }[]
    this._histories = new Map();
    this._activeTabId = null;
  }

  /**
   * Switch the active tab. Creates an empty history for new tabs.
   * Returns true if the tab already had history (caller can decide to re-render).
   */
  setActiveTab(tabId) {
    this._activeTabId = tabId;
    if (!this._histories.has(tabId)) {
      this._histories.set(tabId, []);
      return false; // no existing history
    }
    return this._histories.get(tabId).length > 0;
  }

  push(role, content) {
    this._activeHistory().push({ role, content });
  }

  /** Clear only the current tab's history */
  clear() {
    this._histories.set(this._activeTabId, []);
  }

  /** Keep only the first `keepCount` entries, discarding everything after */
  truncateTo(keepCount) {
    this._activeHistory().splice(keepCount);
  }

  /** Returns a shallow copy of the active tab's history */
  getHistory() {
    return this._activeHistory().slice();
  }

  /** True if the given tab (defaults to active) has at least one message */
  hasHistory(tabId) {
    const h = this._histories.get(tabId ?? this._activeTabId);
    return !!(h && h.length > 0);
  }

  _activeHistory() {
    if (!this._histories.has(this._activeTabId)) {
      this._histories.set(this._activeTabId, []);
    }
    return this._histories.get(this._activeTabId);
  }
}
