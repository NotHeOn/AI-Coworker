export class ChatRecord {
  constructor({ id, title, pageUrl, pageTitle, messages = [], createdAt, updatedAt } = {}) {
    this.id        = id        ?? `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.title     = title     ?? "New conversation";
    this.pageUrl   = pageUrl   ?? "";
    this.pageTitle = pageTitle ?? "";
    this.messages  = messages; // [{ role, content, timestamp }]
    this.createdAt = createdAt ?? Date.now();
    this.updatedAt = updatedAt ?? this.createdAt;
  }

  push(role, content) {
    this.messages.push({ role, content, timestamp: Date.now() });
    this.updatedAt = Date.now();

    // Auto-title from the first user message
    if (role === "user" && this.messages.filter(m => m.role === "user").length === 1) {
      const raw = content.trim().replace(/\s+/g, " ");
      this.title = raw.length > 30 ? raw.slice(0, 30) + "…" : raw;
    }
  }

  truncateTo(n) {
    this.messages.splice(n);
    this.updatedAt = Date.now();
  }

  /** Strip timestamps — returns plain [{role,content}] for the API */
  getApiMessages() {
    return this.messages.map(({ role, content }) => ({ role, content }));
  }

  rename(title) {
    this.title = title;
    this.updatedAt = Date.now();
  }

  serialize() {
    return {
      id:        this.id,
      title:     this.title,
      pageUrl:   this.pageUrl,
      pageTitle: this.pageTitle,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messages:  this.messages
    };
  }

  static deserialize(obj) {
    return new ChatRecord(obj);
  }
}
