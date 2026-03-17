/**
 * StreamSession — manages one stream's full lifecycle.
 *
 * Send request, listen for chunks, handle completion/error/abort.
 * Also handles edit-resend and content preview.
 */
export class StreamSession {
  constructor({ ui, conversation, queueMirror }) {
    this._ui = ui;
    this._conversation = conversation;
    this._queueMirror = queueMirror;
    this._selectedText = "";
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  get selectedText() { return this._selectedText; }

  setSelectedText(text) {
    this._selectedText = text;
    if (text) {
      this._ui.showSelectionChip(text);
    } else {
      this._ui.hideSelectionChip();
    }
  }

  clearSelectedText() {
    this._selectedText = "";
    this._ui.hideSelectionChip();
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async send(tabId, presetItemId = null) {
    const instruction = this._ui.instructionEl.value.trim();
    if (!instruction) return;

    const syncPage = this._ui.getSyncPage();
    const itemId = presetItemId ?? `qi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Snapshot tab and record identifiers (guard against tab-switch race)
    const sendTabId  = tabId;
    const sendRecord = this._conversation.getActiveRecord();

    this._ui.instructionEl.value = "";
    this._ui.updateCharCount();
    this._ui.hideSelectionChip();

    // Optimistic UI — show bubbles immediately
    this._ui.addMessage("user", instruction, false, 0, this._selectedText);
    const { contentEl } = this._ui.addMessage("assistant", "", true, sendTabId, "", itemId);
    this._selectedText = "";

    // Register stream listener scoped to this item
    let accumulated = "";

    const onStream = (msg) => {
      // Ignore messages for other tabs
      if (msg.tabId !== sendTabId) return;

      // Detect cancellation of a queued (not-yet-running) item
      if (msg.type === "QUEUE_UPDATED") {
        if (!msg.items.some(i => i.itemId === itemId)) {
          chrome.runtime.onMessage.removeListener(onStream);
          this._ui.setErrorContent(contentEl, "Request cancelled.");
        }
        return;
      }

      if (msg.itemId && msg.itemId !== itemId) return;

      if (msg.type === "STREAM_CHUNK") {
        accumulated += msg.chunk;
        this._ui.setStreamingContent(contentEl, accumulated);

      } else if (msg.type === "STREAM_DONE") {
        const finalText = msg.fullText || accumulated;
        this._ui.setFinalContent(contentEl, finalText, sendTabId);

        if (this._ui.isHistoryViewVisible()) {
          const group = this._conversation.getActiveGroup();
          if (group) this._ui.renderHistoryView(group);
        }

        chrome.runtime.onMessage.removeListener(onStream);

      } else if (msg.type === "STREAM_ABORTED") {
        const partialText = msg.partialText || accumulated;
        if (partialText) {
          this._ui.setFinalContent(contentEl, partialText, sendTabId);
          this._ui.appendAbortNote(contentEl, msg.reason);
        } else {
          this._ui.setErrorContent(contentEl, msg.reason === "timeout"
            ? "Request timed out (2 min limit)."
            : "Request cancelled.");
        }
        chrome.runtime.onMessage.removeListener(onStream);

      } else if (msg.type === "STREAM_ERROR") {
        this._ui.setErrorContent(contentEl, msg.error);
        chrome.runtime.onMessage.removeListener(onStream);
      }
    };

    chrome.runtime.onMessage.addListener(onStream);

    // Send lightweight fields — background derives history + selectedText
    chrome.runtime.sendMessage({
      type: "ANALYZE",
      itemId,
      instruction,
      syncPage,
      tabId: sendTabId,
      recordId:    sendRecord?.id ?? null,
      pageUrl:     sendRecord?.pageUrl ?? "",
      pageTitle:   sendRecord?.pageTitle ?? "",
      recordTitle: sendRecord?.title ?? "",
    });
  }

  // ── Abort ──────────────────────────────────────────────────────────────────

  abortCurrentStream(tabId) {
    chrome.runtime.sendMessage({
      type:   "ABORT_STREAM",
      tabId,
      itemId: this._queueMirror.getRunningItemId()
    }).catch(() => {});
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  openContentPreview(tabId) {
    const url = chrome.runtime.getURL("preview.html") + (tabId ? `?tabId=${tabId}` : "");
    chrome.tabs.create({ url });
  }
}
