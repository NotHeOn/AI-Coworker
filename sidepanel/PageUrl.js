/**
 * PageUrl — canonical URL value object for conversation record matching.
 *
 * Single source of truth for all URL parsing, identity comparison,
 * and display formatting used by the sidepanel storage layer.
 *
 * Matching key is `origin + pathname` — query string and hash are ignored
 * so "https://example.com/page?tab=2#section" and "https://example.com/page"
 * resolve to the same conversation record.
 */
export class PageUrl {
  constructor(raw) {
    this._raw = raw ?? "";
    try {
      this._u = new URL(this._raw);
    } catch {
      this._u = null;
    }
  }

  /** True for http/https pages; false for chrome://, about:, file://, etc. */
  get isHttp() {
    return this._u?.protocol === "http:" || this._u?.protocol === "https:";
  }

  /** Origin string (scheme + host + port) — used as the SiteHistory group key. */
  get origin() {
    return this._u?.origin ?? "";
  }

  /** Bare hostname — used for SiteHistory.displayName. */
  get hostname() {
    return this._u?.hostname ?? this._raw;
  }

  /**
   * Canonical record-matching key: origin + pathname.
   * Falls back to the raw string for unparseable URLs.
   */
  get key() {
    if (!this._u) return this._raw;
    return this._u.origin + this._u.pathname;
  }

  /** Full original URL string — for storage and tooltip title= attributes. */
  get href() {
    return this._raw;
  }

  /** Short display label: hostname + pathname only (no query string or hash). */
  get label() {
    if (!this._u) return this._raw;
    const path = this._u.pathname.length > 1 ? this._u.pathname : "";
    return this._u.hostname + path;
  }

  /** Longer display label: hostname + pathname + query string (no hash). */
  get display() {
    if (!this._u) return this._raw;
    const path = this._u.pathname.length > 1 ? this._u.pathname : "";
    return this._u.hostname + path + (this._u.search || "");
  }

  /**
   * True if this URL maps to the same conversation record as `other`.
   * Accepts either a PageUrl instance or a raw URL string.
   */
  matches(other) {
    const otherKey = other instanceof PageUrl ? other.key : new PageUrl(String(other ?? "")).key;
    return this.key === otherKey;
  }

  toString() {
    return this._raw;
  }
}
