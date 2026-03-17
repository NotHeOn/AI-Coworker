/**
 * HistoryManager — owns all stream-related persistence of chatGroups.
 *
 * Provides:
 *   - getHistory(recordId)        — read history for context assembly
 *   - reserveSlot / fillSlot / cancelSlot  — ordered message insertion
 *   - truncateRecord              — edit-resend support
 */
const STORAGE_KEY = "chatGroups";

export class HistoryManager {
  constructor() {
    this._pendingSlots = new Map(); // itemId → { recordId, index }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Read a record's message history from storage.
   * Filters null slots, returns plain [{role, content}] for the API.
   */
  async getHistory(recordId) {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const record = this._findRecord(data[STORAGE_KEY] ?? {}, recordId);
    if (!record) return [];
    return (record.messages ?? [])
      .filter(m => m.content !== null)
      .map(({ role, content }) => ({ role, content }));
  }

  // ── Write: slot-based ordered insertion ─────────────────────────────────────

  /**
   * Reserve insertion positions for an in-flight queue item.
   * @param {string} recordId
   * @param {string} itemId
   * @param {number} messageCount — current message count (from getHistory().length)
   */
  reserveSlot(recordId, itemId, messageCount) {
    const pendingPairs = [...this._pendingSlots.values()]
      .filter(s => s.recordId === recordId).length;
    this._pendingSlots.set(itemId, {
      recordId,
      index: messageCount + pendingPairs * 2,
    });
  }

  /**
   * Fill a reserved slot once the stream completes.
   * Splices user + assistant messages at the pre-reserved index.
   */
  async fillSlot(itemId, userText, assistantText) {
    const slot = this._pendingSlots.get(itemId);
    if (!slot) return;
    this._pendingSlots.delete(itemId);

    const data = await chrome.storage.local.get(STORAGE_KEY);
    const groups = data[STORAGE_KEY] ?? {};
    const record = this._findRecord(groups, slot.recordId);
    if (!record) return;

    const now = Date.now();
    record.messages.splice(slot.index, 0,
      { role: "user",      content: userText,      timestamp: now },
      { role: "assistant", content: assistantText, timestamp: now }
    );
    record.updatedAt = now;
    await chrome.storage.local.set({ [STORAGE_KEY]: groups });
  }

  /**
   * Discard a reserved slot without writing (stream cancelled before any text).
   */
  cancelSlot(itemId) {
    this._pendingSlots.delete(itemId);
  }

  // ── Edit-resend: truncate a record ──────────────────────────────────────────

  /**
   * Truncate a record's messages from a given index and clear related pending slots.
   */
  async truncateRecord(recordId, index) {
    // Clear pending slots at or beyond the cut point
    for (const [itemId, slot] of this._pendingSlots) {
      if (slot.recordId === recordId && slot.index >= index) {
        this._pendingSlots.delete(itemId);
      }
    }

    const data = await chrome.storage.local.get(STORAGE_KEY);
    const groups = data[STORAGE_KEY] ?? {};
    const record = this._findRecord(groups, recordId);
    if (!record) return;

    record.messages.splice(index);
    record.updatedAt = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEY]: groups });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _findRecord(groups, recordId) {
    for (const group of Object.values(groups)) {
      const rec = (group.records ?? []).find(r => r.id === recordId);
      if (rec) return rec;
    }
    return null;
  }
}
