import { Conversation } from "./Conversation.js";

export class SiteHistory {
  constructor({ origin, displayName, records = [], activeRecordId = null } = {}) {
    this.origin        = origin;
    this.displayName   = displayName ?? (() => { try { return new URL(origin).hostname; } catch { return origin; } })();
    this.records       = records.map(r => r instanceof Conversation ? r : Conversation.deserialize(r));
    this.activeRecordId = activeRecordId ?? (this.records[this.records.length - 1]?.id ?? null);
  }

  getActive() {
    return this.records.find(r => r.id === this.activeRecordId) ?? null;
  }

  newRecord(pageUrl, pageTitle) {
    const rec = new Conversation({ pageUrl, pageTitle });
    this.records.push(rec);
    this.activeRecordId = rec.id;
    return rec;
  }

  setActive(recordId) {
    if (this.records.some(r => r.id === recordId)) {
      this.activeRecordId = recordId;
    }
  }

  deleteRecord(recordId) {
    const idx = this.records.findIndex(r => r.id === recordId);
    if (idx === -1) return;
    this.records.splice(idx, 1);

    if (this.activeRecordId === recordId) {
      this.activeRecordId = this.records[this.records.length - 1]?.id ?? null;
    }
  }

  serialize() {
    return {
      origin:         this.origin,
      displayName:    this.displayName,
      activeRecordId: this.activeRecordId,
      records:        this.records.map(r => r.serialize())
    };
  }

  static deserialize(obj) {
    return new SiteHistory(obj);
  }
}
