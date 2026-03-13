import { SiteHistory } from "./SiteHistory.js";

const STORAGE_KEY = "chatGroups";

/**
 * ConversationStore — read-only in-memory cache of chatGroups.
 *
 * All writes (fillSlot, truncate, etc.) are now handled by HistoryStore
 * in the background service worker. This store reloads from storage when
 * chrome.storage.onChanged fires.
 */
export class ConversationStore {
  constructor() {
    this._groups       = new Map();  // origin → SiteHistory
    this._activeOrigin = null;
    this._tabOriginMap = new Map();  // tabId → origin (transient)
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async load() {
    this._groups.clear();
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const raw  = data[STORAGE_KEY] ?? {};
    for (const [origin, obj] of Object.entries(raw)) {
      this._groups.set(origin, SiteHistory.deserialize({ ...obj, origin }));
    }
  }

  /**
   * Persist groups to storage.
   * Empty records (messages.length === 0) are intentionally excluded.
   * Groups with no non-empty records are skipped entirely.
   * Used only for local metadata operations (setActiveTab, newRecord, etc.).
   */
  _save() {
    const obj = {};
    for (const [origin, group] of this._groups) {
      const liveRecords = group.records.filter(r => r.hasContent());
      if (liveRecords.length === 0) continue;
      const ser = {
        origin:         group.origin,
        displayName:    group.displayName,
        activeRecordId: group.activeRecordId,
        records:        liveRecords.map(r => r.serialize())
      };
      if (!ser.records.find(r => r.id === ser.activeRecordId)) {
        ser.activeRecordId = ser.records[ser.records.length - 1]?.id ?? null;
      }
      obj[origin] = ser;
    }
    return chrome.storage.local.set({ [STORAGE_KEY]: obj });
  }

  // ── Tab lifecycle ───────────────────────────────────────────────────────────

  /**
   * Call when the active tab changes or navigates.
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
      this._groups.set(origin, new SiteHistory({ origin }));
    }
    const group = this._groups.get(origin);

    // Drop empty placeholder records
    const emptyIds = group.records.filter(r => r.isEmpty()).map(r => r.id);
    for (const id of emptyIds) group.deleteRecord(id);

    // Find most recently updated record matching this URL (origin+pathname)
    const key = pageKey(tabUrl);
    const match = group.records
      .filter(r => pageKey(r.pageUrl) === key)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    let isNewRecord;
    if (match) {
      group.setActive(match.id);
      isNewRecord = false;
    } else {
      group.newRecord(tabUrl, tabTitle);
      isNewRecord = true;
    }

    this._save();
    return { isDisabled: false, isNewRecord, group };
  }

  // ── Read-only accessors ─────────────────────────────────────────────────────

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
 */
function pageKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}
