import { ChatGroup } from "./ChatGroup.js";

const STORAGE_KEY = "chatGroups";
const SAVE_DEBOUNCE_MS = 200;

export class ChatGroupManager {
  constructor() {
    this._groups       = new Map();  // origin → ChatGroup
    this._activeOrigin = null;
    this._tabOriginMap = new Map();  // tabId → origin (transient)
    this._saveTimer    = null;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async load() {
    // Flush any pending debounced write so we don't lose recent messages
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      await this._save();
    }

    this._groups.clear();
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const raw  = data[STORAGE_KEY] ?? {};
    for (const [origin, obj] of Object.entries(raw)) {
      this._groups.set(origin, ChatGroup.deserialize({ ...obj, origin }));
    }
  }

  /**
   * Persist groups to storage.
   * Empty records (messages.length === 0) are intentionally excluded —
   * they represent pages the user opened but never chatted on.
   * Groups with no non-empty records are skipped entirely.
   */
  _save() {
    const obj = {};
    for (const [origin, group] of this._groups) {
      const ser = group.serialize();
      ser.records = ser.records.filter(r => r.messages && r.messages.length > 0);
      if (ser.records.length === 0) continue;
      // Fix activeRecordId if it pointed to a now-excluded empty record
      if (!ser.records.find(r => r.id === ser.activeRecordId)) {
        ser.activeRecordId = ser.records[ser.records.length - 1]?.id ?? null;
      }
      obj[origin] = ser;
    }
    return chrome.storage.local.set({ [STORAGE_KEY]: obj });
  }

  _debouncedSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), SAVE_DEBOUNCE_MS);
  }

  /** Public: schedule a debounced save (for pushing directly to a record object) */
  requestSave() {
    this._debouncedSave();
  }

  // ── Tab lifecycle ───────────────────────────────────────────────────────────

  /**
   * Call when the active tab changes or navigates.
   * - Non-http/https pages → { isDisabled: true }
   * - Cleans up empty records in the target group first (they have no value)
   * - Finds the most-recently-updated record whose URL matches (origin+path),
   *   or creates a fresh empty record if none exists for this URL
   * Returns { isDisabled, isNewRecord, group }
   */
  setActiveTab(tabId, tabUrl, tabTitle) {
    let origin;
    try {
      const u = new URL(tabUrl ?? "");
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        this._activeOrigin = null;
        return { isDisabled: true, isNewRecord: false, group: null };
      }
      origin = u.origin;
    } catch {
      this._activeOrigin = null;
      return { isDisabled: true, isNewRecord: false, group: null };
    }

    this._tabOriginMap.set(tabId, origin);
    this._activeOrigin = origin;

    if (!this._groups.has(origin)) {
      this._groups.set(origin, new ChatGroup({ origin }));
    }
    const group = this._groups.get(origin);

    // Drop all records that were never used (empty message list).
    // These are placeholder stubs from pages visited without chatting.
    const emptyIds = group.records.filter(r => r.messages.length === 0).map(r => r.id);
    for (const id of emptyIds) group.deleteRecord(id);

    // Find the most recently updated record whose pageUrl matches this URL
    // (origin + pathname only — query params and hash are ignored for matching)
    const key = pageKey(tabUrl);
    const match = group.records
      .filter(r => pageKey(r.pageUrl) === key)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    let isNewRecord;
    if (match) {
      group.setActive(match.id);
      isNewRecord = false;
    } else {
      // First visit to this URL — create a placeholder (saved only after first message)
      group.newRecord(tabUrl, tabTitle);
      isNewRecord = true;
    }

    // Persist: _save() filters out the new empty record automatically,
    // but we still call it so the cleanup of deleted empties reaches storage
    // and the updated activeRecordId is persisted.
    this._save();

    return { isDisabled: false, isNewRecord, group };
  }

  // ── Delegates to active record ─────────────────────────────────────────────

  push(role, content) {
    const rec = this.getActiveRecord();
    if (rec) {
      rec.push(role, content);
      this._debouncedSave();
    }
  }

  truncateTo(n) {
    const rec = this.getActiveRecord();
    if (rec) {
      rec.truncateTo(n);
      this._debouncedSave();
    }
  }

  getApiMessages() {
    return this.getActiveRecord()?.getApiMessages() ?? [];
  }

  // ── Record management ───────────────────────────────────────────────────────

  newRecord(pageUrl, pageTitle) {
    const group = this.getActiveGroup();
    if (!group) return null;
    const rec = group.newRecord(pageUrl, pageTitle);
    this._save();
    return rec;
  }

  setActiveRecord(recordId) {
    const group = this.getActiveGroup();
    if (!group) return;
    group.setActive(recordId);
    this._save();
  }

  getActiveRecord() {
    return this.getActiveGroup()?.getActive() ?? null;
  }

  getActiveGroup() {
    return this._activeOrigin ? (this._groups.get(this._activeOrigin) ?? null) : null;
  }

  getAllGroups() {
    return [...this._groups.values()];
  }

  // ── CRUD (called from Settings) ─────────────────────────────────────────────

  async renameRecord(origin, recordId, title) {
    const rec = this._groups.get(origin)?.records.find(r => r.id === recordId);
    if (rec) { rec.rename(title); await this._save(); }
  }

  async deleteRecord(origin, recordId) {
    const group = this._groups.get(origin);
    if (!group) return;
    group.deleteRecord(recordId);
    if (group.records.length === 0) this._groups.delete(origin);
    await this._save();
  }

  async deleteGroup(origin) {
    this._groups.delete(origin);
    if (this._activeOrigin === origin) this._activeOrigin = null;
    await this._save();
  }

  async renameGroup(origin, displayName) {
    const group = this._groups.get(origin);
    if (group) { group.displayName = displayName; await this._save(); }
  }
}

/**
 * Normalise a URL to origin+pathname for record matching.
 * Query parameters and hash fragments are ignored so that
 * "https://a.com/page?q=1" and "https://a.com/page?q=2" share one record.
 */
function pageKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}
