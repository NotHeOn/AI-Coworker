/**
 * AnalyzePreparer — prepares an ANALYZE request before enqueue.
 *
 * Derives history, builds context entry, pre-fetches content, enqueues.
 * Owns selection tracking (moved from ExtensionController).
 */
export class AnalyzePreparer {
  constructor({ historyStore, contextSystem, tabRegistry, queue }) {
    this._historyStore = historyStore;
    this._contextSystem = contextSystem;
    this._tabRegistry = tabRegistry;
    this._queue = queue;
    this._selections = new Map(); // tabId → selected text
  }

  /** Enqueue an ANALYZE request — UI sends 5 lightweight fields, background derives the rest. */
  async prepare({ itemId, instruction, syncPage, tabId, recordId }, sendResponse) {
    sendResponse({ ok: true }); // Ack immediately; results come via broadcast messages

    const resolvedItemId = itemId ?? `qi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // 1. Derive history from storage using UI-snapshotted recordId
    const history = recordId
      ? await this._historyStore.getHistory(recordId)
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
      this._historyStore.reserveSlot(recordId, resolvedItemId, messageCount);
    }

    // 5. Start async page content fetch (non-blocking)
    const tab = tabId ? this._tabRegistry.get(tabId) : this._tabRegistry.getActive();
    const isFirstMessage = !history.length;
    const shouldFetch = (isFirstMessage || syncPage) && tab;
    const contentPromise = shouldFetch ? tab.getContent() : Promise.resolve(null);

    // 6. Enqueue — attach content promise on the queue item
    const queueItem = {
      itemId: resolvedItemId,
      tabId,
      instruction,
      syncPage: !!syncPage,
      recordId: recordId ?? null,
      _contentPromise: contentPromise,
    };
    this._queue.enqueue(queueItem);
  }

  /** Track text selection changes from content scripts. */
  handleSelectionChanged({ text }, sender) {
    if (!sender?.tab?.id) return;
    const tabId = sender.tab.id;
    if (text) {
      this._selections.set(tabId, text);
    } else {
      this._selections.delete(tabId);
    }
    chrome.runtime.sendMessage({ type: "SELECTION_CHANGED", text, tabId }).catch(() => {});
  }
}
