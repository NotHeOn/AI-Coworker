/**
 * RequestQueueView — read-only UI mirror of the background RequestQueue.
 *
 * Updated by SidePanelController whenever a QUEUE_UPDATED message arrives.
 * Contains no Chrome API calls and no async logic.
 */
export class RequestQueueView {
  constructor() {
    this._items = []; // [{ itemId, status, instruction }]
  }

  /** Called by SidePanelController on every QUEUE_UPDATED broadcast. */
  onQueueUpdated(items) {
    this._items = items ?? [];
  }

  getItems() {
    return this._items;
  }

  isRunning() {
    return this._items.some(i => i.status === "running");
  }

  getQueuedCount() {
    return this._items.filter(i => i.status === "queued").length;
  }

  /** Returns the itemId of the currently running item, or null. */
  getRunningItemId() {
    return this._items.find(i => i.status === "running")?.itemId ?? null;
  }
}
