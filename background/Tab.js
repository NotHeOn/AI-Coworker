export class Tab {
  constructor(tabId) {
    this.id = tabId;
    this.status = "unknown"; // "loading" | "complete" | "restricted" | "error" | "unknown"
    this._content = null;    // cached { markdown, anchorMap, url, title }
    this._fetching = null;   // Promise guard against concurrent fetches
    this._chromeTab = null;  // latest chrome tab info
  }

  updateFromChromeTab(chromeTab) {
    this._chromeTab = chromeTab;
    if (this._isRestrictedUrl(chromeTab.url)) {
      this.status = "restricted";
    } else {
      this.status = chromeTab.status === "complete" ? "complete" : "loading";
    }
    console.log(`[AI Coworker] Tab#${this.id} status="${this.status}" url=${chromeTab.url}`);
  }

  _isRestrictedUrl(url) {
    if (!url) return true;
    return (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("about:") ||
      url.startsWith("edge://") ||
      url.startsWith("devtools://")
    );
  }

  /** Discard cached content (called on navigation or page reload) */
  invalidate() {
    console.log(`[AI Coworker] Tab#${this.id} cache invalidated`);
    this._content = null;
    this._fetching = null;
  }

  /**
   * Lazily fetch and cache page content.
   * Concurrent calls share the same in-flight promise.
   * @returns {{ markdown: string|null, anchorMap: object, url: string, title: string }}
   */
  async getContent() {
    if (this._content) {
      console.log(`[AI Coworker] Tab#${this.id} getContent() → cache hit (${this._content.markdown?.length ?? 0} chars)`);
      return this._content;
    }
    if (this._fetching) {
      console.log(`[AI Coworker] Tab#${this.id} getContent() → joining in-flight fetch`);
      return this._fetching;
    }

    if (this.status === "restricted") {
      console.log(`[AI Coworker] Tab#${this.id} getContent() → restricted page, skipping`);
      return {
        markdown: null,
        anchorMap: {},
        url: this._chromeTab?.url || "",
        title: "Restricted page"
      };
    }

    console.log(`[AI Coworker] Tab#${this.id} getContent() → cache miss, fetching from content script…`);
    this._fetching = this._fetchContent();
    try {
      this._content = await this._fetching;
      const chars = this._content.markdown?.length ?? 0;
      const anchors = Object.keys(this._content.anchorMap || {}).length;
      console.log(`[AI Coworker] Tab#${this.id} getContent() ✓ ${chars} chars, ${anchors} anchors, title="${this._content.title}"`);
      return this._content;
    } finally {
      this._fetching = null;
    }
  }

  async _fetchContent() {
    console.log(`[AI Coworker] Tab#${this.id} sending EXTRACT_CONTENT to content script`);
    const result = await this._sendExtractContent();

    if (result !== null) return result;

    // Content script not reachable — most likely the tab was open before the extension
    // was loaded/reloaded and the script was never injected.
    // Attempt programmatic injection via scripting API, then retry once.
    console.warn(`[AI Coworker] Tab#${this.id} content script unreachable — attempting scripting.executeScript injection`);
    try {
      await chrome.scripting.executeScript({ target: { tabId: this.id }, files: ["content.js"] });
      console.log(`[AI Coworker] Tab#${this.id} injection succeeded, retrying EXTRACT_CONTENT`);
      const retry = await this._sendExtractContent();
      if (retry !== null) return retry;
      console.warn(`[AI Coworker] Tab#${this.id} retry after injection still failed`);
    } catch (injectErr) {
      console.warn(`[AI Coworker] Tab#${this.id} scripting.executeScript failed:`, injectErr.message);
    }

    return { markdown: null, anchorMap: {}, url: this._chromeTab?.url || "", title: "Could not read page" };
  }

  /** Sends EXTRACT_CONTENT and returns the response, or null on any failure. */
  _sendExtractContent() {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(this.id, { type: "EXTRACT_CONTENT" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(`[AI Coworker] Tab#${this.id} sendMessage error: ${chrome.runtime.lastError.message}`);
          resolve(null);
        } else if (!response) {
          console.warn(`[AI Coworker] Tab#${this.id} EXTRACT_CONTENT got empty response`);
          resolve(null);
        } else {
          console.log(`[AI Coworker] Tab#${this.id} EXTRACT_CONTENT ok, url=${response.url}`);
          resolve(response);
        }
      });
    });
  }

  /** Serialisable summary for sidepanel TAB_CHANGED messages */
  toInfo() {
    return {
      id: this.id,
      title: this._chromeTab?.title || this._content?.title || "",
      url: this._chromeTab?.url || this._content?.url || "",
      status: this.status
    };
  }
}
