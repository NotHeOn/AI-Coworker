import { PageUrl } from "./PageUrl.js";

/**
 * ChatViewController — manages the chat view lifecycle.
 *
 * Tab switching, record switching, history rendering, conversation navigation.
 */
export class ChatViewController {
  constructor({ ui, conversation }) {
    this._ui = ui;
    this._conversation = conversation;

    this._activeTabId    = null;
    this._activeTabUrl   = "";
    this._activeTabTitle = "";
    this._presets        = [];

    /** Set after construction to avoid circular dep with StreamSession. */
    this._onSend = null;
  }

  // ── State ──────────────────────────────────────────────────────────────────

  get activeTabId()    { return this._activeTabId; }
  get activeTabUrl()   { return this._activeTabUrl; }
  get activeTabTitle() { return this._activeTabTitle; }

  set onSend(fn) { this._onSend = fn; }

  // ── Tab lifecycle ──────────────────────────────────────────────────────────

  async setActiveTab(tabId, tabUrl, tabTitle) {
    this._activeTabId    = tabId;
    this._activeTabUrl   = tabUrl ?? "";
    this._activeTabTitle = tabTitle ?? "";

    const { isDisabled, group } = await this._conversation.setActiveTab(tabId, tabUrl, tabTitle);
    this._ui.setHistoryDisabled(isDisabled);

    // If history view is open when tab switches, update it for the new origin
    if (!isDisabled && this._ui.isHistoryViewVisible()) {
      this._ui.renderHistoryView(group);
    }
  }

  async onTabChanged(tabInfo) {
    const newTabId = tabInfo.id;
    this._activeTabId    = newTabId;
    this._activeTabUrl   = tabInfo.url ?? "";
    this._activeTabTitle = tabInfo.title ?? "";
    this._ui.updateTabStatus(tabInfo);

    await this.setActiveTab(newTabId, tabInfo.url, tabInfo.title);

    this.renderCurrentRecord();
  }

  // ── Record management ──────────────────────────────────────────────────────

  switchToRecord(recordId) {
    const group = this._conversation.getActiveGroup();
    const rec = group?.records.find(r => r.id === recordId);

    // If the record belongs to a different URL, ask the user what to do
    if (rec?.pageUrl && this._activeTabUrl && !new PageUrl(rec.pageUrl).matches(this._activeTabUrl)) {
      this._ui.showUrlMismatchDialog(
        rec,
        this._activeTabUrl,
        // onNew — create a fresh record for the current URL
        () => {
          this._conversation.newRecord(this._activeTabUrl, this._activeTabTitle);
          const welcome = this._ui.renderWelcome(this._presets);
          this.bindQuickPrompts(welcome);
        },
        // onLoad — import the record and turn on Sync Page
        () => {
          this._conversation.setActiveRecord(recordId);
          const loaded = this._conversation.getActiveRecord();
          if (loaded?.hasContent()) {
            this._ui.renderHistoryMessages(loaded.getApiMessages(), this._activeTabId);
          } else {
            const welcome = this._ui.renderWelcome(this._presets);
            this.bindQuickPrompts(welcome);
          }
          this._ui.setSyncPage(true);
        }
      );
      return;
    }

    // URLs match (or record has no URL stored) — switch normally
    this._conversation.setActiveRecord(recordId);
    const loaded = this._conversation.getActiveRecord();
    if (!loaded) return;

    if (loaded.hasContent()) {
      this._ui.renderHistoryMessages(loaded.getApiMessages(), this._activeTabId);
    } else {
      const welcome = this._ui.renderWelcome(this._presets);
      this.bindQuickPrompts(welcome);
    }
  }

  async deleteHistoryRecord(recordId) {
    const group = this._conversation.getActiveGroup();
    if (!group) return;
    const wasActive = group.activeRecordId === recordId;

    await this._conversation.deleteRecord(group.origin, recordId);

    // If we deleted the active record, re-render chat to reflect the new active one
    if (wasActive) {
      this.renderCurrentRecord();
    }

    // Re-render history view
    const updatedGroup = this._conversation.getActiveGroup();
    if (updatedGroup) {
      this._ui.renderHistoryView(updatedGroup);
    } else {
      this._ui.hideHistoryView();
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  setPresets(presets) {
    this._presets = presets;
  }

  renderCurrentRecord() {
    const rec = this._conversation.getActiveRecord();
    if (rec && rec.hasContent()) {
      this._ui.renderHistoryMessages(rec.getApiMessages(), this._activeTabId);
    } else {
      const welcome = this._ui.renderWelcome(this._presets);
      this.bindQuickPrompts(welcome);
    }
  }

  bindQuickPrompts(welcomeEl) {
    welcomeEl.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._ui.instructionEl.value = btn.dataset.prompt;
        this._ui.updateCharCount();
        this._ui.instructionEl.dispatchEvent(new Event("input"));
        if (this._onSend) this._onSend();
      });
    });
  }

  // ── External sync ──────────────────────────────────────────────────────────

  async onChatGroupsStorageChanged() {
    // setActiveTab() reloads from storage internally — no need for a separate load() here
    if (this._activeTabId) {
      await this._conversation.setActiveTab(this._activeTabId, this._activeTabUrl, this._activeTabTitle);
    }

    // Refresh the chat view to show updated messages
    const rec = this._conversation.getActiveRecord();
    if (rec && rec.hasContent()) {
      this._ui.renderHistoryMessages(rec.getApiMessages(), this._activeTabId);
    }

    if (this._ui.isHistoryViewVisible()) {
      const group = this._conversation.getActiveGroup();
      if (group) {
        this._ui.renderHistoryView(group);
      } else {
        this._ui.hideHistoryView();
      }
    }
  }
}

