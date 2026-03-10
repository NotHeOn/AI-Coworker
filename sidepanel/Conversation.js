export class Conversation {
  constructor({ id, title, pageUrl, pageTitle, messages = [], createdAt, updatedAt } = {}) {
    this.id        = id        ?? `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.pageUrl   = pageUrl   ?? "";
    this.pageTitle = pageTitle ?? "";
    this.messages  = messages; // [{ role, content, timestamp }]
    this.createdAt = createdAt ?? Date.now();
    this.updatedAt = updatedAt ?? this.createdAt;
    // Use stored title for existing records; generate from pageTitle+time for new ones
    this.title     = title ?? _defaultTitle(this.pageTitle, this.createdAt);
  }

  push(role, content) {
    this.messages.push({ role, content, timestamp: Date.now() });
    this.updatedAt = Date.now();
  }

  truncateTo(n) {
    this.messages.splice(n);
    this.updatedAt = Date.now();
  }

  /** True if there are no completed messages (null-content slots are excluded) */
  isEmpty() {
    return this.messages.filter(m => m.content !== null).length === 0;
  }

  hasContent() {
    return !this.isEmpty();
  }

  /** Strip timestamps and null slots — returns plain [{role,content}] for the API */
  getApiMessages() {
    return this.messages
      .filter(m => m.content !== null)
      .map(({ role, content }) => ({ role, content }));
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
    return new Conversation(obj);
  }
}

/** Build default record title: "{pageTitle}_{HH:MM}", or just "{HH:MM}" if no title */
function _defaultTitle(pageTitle, ts) {
  const d    = new Date(ts);
  const hh   = String(d.getHours()).padStart(2, "0");
  const mm   = String(d.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;
  const p    = (pageTitle || "").trim();
  return p ? `${p}_${time}` : time;
}
