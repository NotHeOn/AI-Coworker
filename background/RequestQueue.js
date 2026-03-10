/**
 * RequestQueue — per-tab FIFO queue for AI stream requests.
 *
 * Each tab has its own independent queue so multiple tabs can stream
 * simultaneously, while same-tab messages are executed in order.
 *
 * executeItemFn: async (item) => void
 *   Provided by ExtensionController; responsible for running the stream
 *   and broadcasting STREAM_CHUNK / STREAM_DONE / STREAM_ABORTED / STREAM_ERROR.
 */
export class RequestQueue {
  constructor(executeItemFn) {
    this._executeItemFn = executeItemFn;
    this._queues = new Map(); // tabId → QueueItem[]
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Add a new item to the tail of this tab's queue and start executing
   * if nothing is currently running.
   *
   * QueueItem shape:
   *   { itemId, tabId, instruction, history, syncPage, selectedText, recordId }
   */
  enqueue(item) {
    if (!this._queues.has(item.tabId)) {
      this._queues.set(item.tabId, []);
    }
    this._queues.get(item.tabId).push({
      ...item,
      status:          "queued",
      abortController: null
    });
    this._broadcast(item.tabId);
    this._tryRun(item.tabId);
  }

  /**
   * Cancel a specific item.
   * - If running  → abort the stream (STREAM_ABORTED will arrive naturally).
   * - If queued   → splice from queue immediately and broadcast.
   * - itemId null → cancel whatever is currently running on this tab.
   */
  cancel(tabId, itemId) {
    const queue = this._queues.get(tabId);
    if (!queue) return;

    const target = itemId
      ? queue.find(i => i.itemId === itemId)
      : queue.find(i => i.status === "running");

    if (!target) return;

    if (target.status === "running") {
      target.abortController?.abort("user");
      // Removal happens in _executeItem's finally block after STREAM_ABORTED
    } else {
      const idx = queue.indexOf(target);
      queue.splice(idx, 1);
      this._broadcast(tabId);
    }
  }

  /** Cancel all items for a tab (e.g. tab closed). */
  cancelAll(tabId) {
    const queue = this._queues.get(tabId);
    if (!queue) return;
    for (const item of queue) {
      if (item.status === "running") item.abortController?.abort("tabClosed");
    }
    this._queues.delete(tabId);
    this._broadcast(tabId);
  }

  /** Return a sanitised snapshot of the queue for a tab (safe to send over postMessage). */
  getQueue(tabId) {
    return (this._queues.get(tabId) ?? []).map(({ itemId, status, instruction }) => ({
      itemId,
      status,
      instruction
    }));
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _tryRun(tabId) {
    const queue = this._queues.get(tabId);
    if (!queue || queue.length === 0) return;

    const head = queue[0];
    if (head.status === "running") return; // already in-flight

    head.status = "running";
    head.abortController = new AbortController();
    this._broadcast(tabId);

    this._executeItem(head);
  }

  async _executeItem(item) {
    try {
      await this._executeItemFn(item);
      item.status = "done";
    } catch (err) {
      item.status = "error";
    } finally {
      // Dequeue this item regardless of outcome
      const queue = this._queues.get(item.tabId);
      if (queue) {
        const idx = queue.findIndex(i => i.itemId === item.itemId);
        if (idx !== -1) queue.splice(idx, 1);
        if (queue.length === 0) this._queues.delete(item.tabId);
      }
      this._broadcast(item.tabId);
      this._tryRun(item.tabId);
    }
  }

  _broadcast(tabId) {
    chrome.runtime.sendMessage({
      type:  "QUEUE_UPDATED",
      tabId,
      items: this.getQueue(tabId)
    }).catch(() => {}); // sidepanel may not be open
  }
}
