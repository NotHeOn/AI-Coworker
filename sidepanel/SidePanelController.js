import { ChatGroupManager } from "./ChatGroupManager.js";
import { SidePanelUI } from "./SidePanelUI.js";

export class SidePanelController {
  constructor() {
    this._ui = new SidePanelUI();
    this._conversation = new ChatGroupManager();

    this._isStreaming = false;
    this._activeTabId = null;
    this._activeTabUrl = "";
    this._activeTabTitle = "";
    this._profiles = [];
    this._activeProfileId = null;
    this._presets = [];
    this._selectedText = "";
  }

  async init() {
    // Load persistent history first
    await this._conversation.load();

    // Fetch initial state in parallel
    const [tabInfo, presetsRes, profileRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB" }),
      chrome.runtime.sendMessage({ type: "GET_PRESETS" }),
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_PROFILE" })
    ]);

    // Apply tab info and seed conversation manager
    if (tabInfo && !tabInfo.error) {
      this._activeTabId = tabInfo.id;
      this._activeTabUrl = tabInfo.url ?? "";
      this._activeTabTitle = tabInfo.title ?? "";
      this._ui.updateTabStatus(tabInfo);
      this._setActiveTab(tabInfo.id, tabInfo.url, tabInfo.title);
    }

    // Apply presets, render initial welcome screen (if no existing messages)
    this._presets = presetsRes?.presets || [];
    const activeRec = this._conversation.getActiveRecord();
    if (activeRec && activeRec.messages.length > 0) {
      this._ui.renderHistoryMessages(activeRec.getApiMessages(), this._activeTabId);
    } else {
      const welcome = this._ui.renderWelcome(this._presets);
      this._bindQuickPrompts(welcome);
    }

    // Apply profile
    await this._applyProfileData(profileRes);

    // Wire up static event listeners
    this._bindEvents();

    // Listen for background broadcasts
    chrome.runtime.onMessage.addListener((msg) => this._onMessage(msg));

    // Sync when Settings page modifies chatGroups
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.chatGroups) return;
      this._onChatGroupsStorageChanged(changes.chatGroups.newValue ?? {});
    });

    // Dismiss chip on user click
    this._ui.selectionChipDismissEl.addEventListener("click", () => {
      this._selectedText = "";
      this._ui.hideSelectionChip();
    });
  }

  // ── Tab switching ──────────────────────────────────────────────────────────

  _setActiveTab(tabId, tabUrl, tabTitle) {
    const { isDisabled, group } = this._conversation.setActiveTab(tabId, tabUrl, tabTitle);
    this._ui.setHistoryDisabled(isDisabled);

    // If history view is open when tab switches, update it for the new origin
    if (!isDisabled && this._ui.isHistoryViewVisible()) {
      this._ui.renderHistoryView(group);
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  _bindEvents() {
    const ui = this._ui;

    ui.sendBtn.addEventListener("click", () => {
      if (this._isStreaming) {
        this._abortCurrentStream();
      } else {
        this.send();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this._isStreaming) {
        this._abortCurrentStream();
      }
    });

    ui.instructionEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    ui.instructionEl.addEventListener("input", () => {
      ui.instructionEl.style.height = "auto";
      ui.instructionEl.style.height = Math.min(ui.instructionEl.scrollHeight, 120) + "px";
      ui.updateCharCount();
    });

    ui.clearBtn.addEventListener("click", async () => {
      this._conversation.newRecord(this._activeTabUrl, this._activeTabTitle);
      const res = await chrome.runtime.sendMessage({ type: "GET_PRESETS" });
      this._presets = res?.presets || this._presets;
      const welcome = this._ui.renderWelcome(this._presets);
      this._bindQuickPrompts(welcome);
      // Close history view if open
      if (ui.isHistoryViewVisible()) ui.hideHistoryView();
    });

    ui.settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

    // History view toggle
    ui.historyBtn.addEventListener("click", async () => {
      if (ui.isHistoryViewVisible()) {
        ui.hideHistoryView();
      } else {
        // Reload from storage so changes made in Settings are reflected
        await this._conversation.load();
        const group = this._conversation.getActiveGroup();
        ui.showHistoryView(group);
      }
    });

    // Back button inside history view
    ui.historyBackBtn.addEventListener("click", () => ui.hideHistoryView());

    // View All — open Settings page at Chat History section
    ui.historyViewAllBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") + "#chatHistorySection" });
    });

    // New record button inside history view
    ui.historyNewBtn.addEventListener("click", async () => {
      this._conversation.newRecord(this._activeTabUrl, this._activeTabTitle);
      const res = await chrome.runtime.sendMessage({ type: "GET_PRESETS" });
      this._presets = res?.presets || this._presets;
      const welcome = this._ui.renderWelcome(this._presets);
      this._bindQuickPrompts(welcome);
      ui.hideHistoryView();
    });

    // History view list: load record or delete
    ui.historyViewList.addEventListener("click", (e) => {
      // Delete button takes priority
      const deleteBtn = e.target.closest(".history-delete-btn");
      if (deleteBtn) {
        const recordId = deleteBtn.dataset.deleteRecordId;
        if (recordId) this._deleteHistoryRecord(recordId);
        return;
      }

      const row = e.target.closest(".history-record-row");
      if (!row?.dataset.recordId) return;
      this._switchToRecord(row.dataset.recordId);
      ui.hideHistoryView();
    });

    // Profile switcher
    ui.profileSwitcher.addEventListener("click", (e) => {
      e.stopPropagation();
      const hidden = ui.profileDropdown.classList.contains("hidden");
      if (hidden) {
        ui.renderProfileDropdown(
          this._profiles,
          this._activeProfileId,
          (id) => this._selectProfile(id),
          () => chrome.runtime.openOptionsPage()
        );
        ui.profileDropdown.classList.remove("hidden");
      } else {
        ui.profileDropdown.classList.add("hidden");
      }
    });

    ui.contextTextEl.addEventListener("click", () => this._openContentPreview());

    document.addEventListener("click", () => ui.profileDropdown.classList.add("hidden"));
    ui.profileDropdown.addEventListener("click", (e) => e.stopPropagation());

    // Edit button delegation
    ui.messagesEl.addEventListener("click", (e) => {
      const editBtn = e.target.closest(".edit-msg-btn");
      if (!editBtn) return;
      const msgEl = editBtn.closest(".message.user");
      if (msgEl && !this._isStreaming) {
        this._handleEditMessage(msgEl);
      }
    });
  }

  // ── Record switching & deletion ───────────────────────────────────────────

  _switchToRecord(recordId) {
    // Look up the record before committing to the switch
    const group = this._conversation.getActiveGroup();
    const rec = group?.records.find(r => r.id === recordId);

    // If the record belongs to a different URL, ask the user what to do
    if (rec?.pageUrl && this._activeTabUrl && !_pageKeysMatch(rec.pageUrl, this._activeTabUrl)) {
      this._ui.showUrlMismatchDialog(
        rec,
        this._activeTabUrl,
        // onNew — create a fresh record for the current URL
        () => {
          this._conversation.newRecord(this._activeTabUrl, this._activeTabTitle);
          const welcome = this._ui.renderWelcome(this._presets);
          this._bindQuickPrompts(welcome);
        },
        // onLoad — import the record and turn on Sync Page
        () => {
          this._conversation.setActiveRecord(recordId);
          const loaded = this._conversation.getActiveRecord();
          if (loaded?.messages.length > 0) {
            this._ui.renderHistoryMessages(loaded.getApiMessages(), this._activeTabId);
          } else {
            const welcome = this._ui.renderWelcome(this._presets);
            this._bindQuickPrompts(welcome);
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

    if (loaded.messages.length > 0) {
      this._ui.renderHistoryMessages(loaded.getApiMessages(), this._activeTabId);
    } else {
      const welcome = this._ui.renderWelcome(this._presets);
      this._bindQuickPrompts(welcome);
    }
  }

  async _deleteHistoryRecord(recordId) {
    const group = this._conversation.getActiveGroup();
    if (!group) return;
    const wasActive = group.activeRecordId === recordId;

    await this._conversation.deleteRecord(group.origin, recordId);

    // If we deleted the active record, re-render chat to reflect the new active one
    if (wasActive) {
      const rec = this._conversation.getActiveRecord();
      if (rec && rec.messages.length > 0) {
        this._ui.renderHistoryMessages(rec.getApiMessages(), this._activeTabId);
      } else {
        const welcome = this._ui.renderWelcome(this._presets);
        this._bindQuickPrompts(welcome);
      }
    }

    // Re-render history view
    const updatedGroup = this._conversation.getActiveGroup();
    if (updatedGroup) {
      this._ui.renderHistoryView(updatedGroup);
    } else {
      // All records deleted — close history view
      this._ui.hideHistoryView();
    }
  }

  // ── Message editing ───────────────────────────────────────────────────────

  _handleEditMessage(msgEl) {
    this._ui.startEditMessage(
      msgEl,
      (newText) => this._resendFromEdit(msgEl, newText),
      () => this._ui.cancelEdit(msgEl)
    );
  }

  _resendFromEdit(msgEl, newText) {
    if (!newText || this._isStreaming) return;

    const allMessages = [...this._ui.messagesEl.querySelectorAll(".message")];
    const domIndex = allMessages.indexOf(msgEl);
    if (domIndex === -1) return;

    this._ui.removeMessagesFrom(domIndex);
    this._conversation.truncateTo(domIndex);

    this._ui.instructionEl.value = newText;
    this._ui.updateCharCount();
    this.send();
  }

  _bindQuickPrompts(welcomeEl) {
    welcomeEl.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._ui.instructionEl.value = btn.dataset.prompt;
        this._ui.updateCharCount();
        this._ui.instructionEl.dispatchEvent(new Event("input"));
        this.send();
      });
    });
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  async send() {
    const instruction = this._ui.instructionEl.value.trim();
    if (!instruction || this._isStreaming) return;

    const selectedText = this._selectedText;
    this._selectedText = "";
    this._ui.hideSelectionChip();

    this._isStreaming = true;
    this._ui.setStreaming(true);
    this._ui.instructionEl.value = "";
    this._ui.updateCharCount();

    const historySnapshot = this._conversation.getApiMessages();
    const syncPage = this._ui.getSyncPage();

    // Snapshot mutable references at send-time so tab switches during streaming
    // don't redirect save/render to the wrong record or tab.
    const sendRecord = this._conversation.getActiveRecord();
    const sendTabId  = this._activeTabId;

    this._ui.addMessage("user", instruction, false, 0, selectedText);
    const { contentEl } = this._ui.addMessage("assistant", "", true);

    let accumulated = "";

    const onStream = (msg) => {
      if (msg.type === "STREAM_CHUNK") {
        accumulated += msg.chunk;
        this._ui.setStreamingContent(contentEl, accumulated);
      } else if (msg.type === "STREAM_DONE") {
        const finalText = msg.fullText || accumulated;
        this._ui.setFinalContent(contentEl, finalText, sendTabId);

        sendRecord.push("user", instruction);
        sendRecord.push("assistant", finalText);
        this._conversation.requestSave();

        // If history view is open and still showing the same origin, keep it in sync
        if (this._ui.isHistoryViewVisible()) {
          const group = this._conversation.getActiveGroup();
          if (group) this._ui.renderHistoryView(group);
        }

        this._doneStreaming(onStream);
      } else if (msg.type === "STREAM_ABORTED") {
        const partialText = msg.partialText || accumulated;
        if (partialText) {
          this._ui.setFinalContent(contentEl, partialText, sendTabId);
          this._ui.appendAbortNote(contentEl, msg.reason);
          sendRecord.push("user", instruction);
          sendRecord.push("assistant", partialText);
          this._conversation.requestSave();
        } else {
          this._ui.setErrorContent(contentEl, msg.reason === "timeout" ? "Request timed out (2 min limit)." : "Request cancelled.");
        }
        this._doneStreaming(onStream);
      } else if (msg.type === "STREAM_ERROR") {
        this._ui.setErrorContent(contentEl, msg.error);
        this._doneStreaming(onStream);
      }
    };

    chrome.runtime.onMessage.addListener(onStream);

    chrome.runtime.sendMessage({
      type: "ANALYZE",
      tabId: this._activeTabId,
      instruction,
      history: historySnapshot,
      syncPage,
      selectedText
    });
  }

  _doneStreaming(listenerFn) {
    chrome.runtime.onMessage.removeListener(listenerFn);
    this._isStreaming = false;
    this._ui.setStreaming(false);
    this._ui.instructionEl.focus();
  }

  _abortCurrentStream() {
    chrome.runtime.sendMessage({ type: "ABORT_STREAM" }).catch(() => {});
  }

  _openContentPreview() {
    const url = chrome.runtime.getURL("preview.html") + (this._activeTabId ? `?tabId=${this._activeTabId}` : "");
    chrome.tabs.create({ url });
  }

  // ── Incoming messages ─────────────────────────────────────────────────────

  _onMessage(msg) {
    switch (msg.type) {
      case "TAB_CHANGED":
        this._onTabChanged(msg);
        break;
      case "CONTENT_UNAVAILABLE":
        this._ui.showContentUnavailable(msg.reason);
        break;
      case "SETTINGS_UPDATED":
        this._refreshSettings();
        break;
      case "SELECTION_CHANGED":
        if (msg.tabId === this._activeTabId) {
          this._selectedText = msg.text || "";
          if (this._selectedText) {
            this._ui.showSelectionChip(this._selectedText);
          } else {
            this._ui.hideSelectionChip();
          }
        }
        break;
    }
  }

  _onTabChanged(tabInfo) {
    const newTabId = tabInfo.id;
    this._activeTabId = newTabId;
    this._activeTabUrl = tabInfo.url ?? "";
    this._activeTabTitle = tabInfo.title ?? "";
    this._ui.updateTabStatus(tabInfo);

    this._selectedText = "";
    this._ui.hideSelectionChip();

    this._setActiveTab(newTabId, tabInfo.url, tabInfo.title);

    const rec = this._conversation.getActiveRecord();
    if (rec && rec.messages.length > 0) {
      this._ui.renderHistoryMessages(rec.getApiMessages(), newTabId);
    } else {
      const welcome = this._ui.renderWelcome(this._presets);
      this._bindQuickPrompts(welcome);
    }
  }

  async _refreshSettings() {
    const res = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_PROFILE" });
    await this._applyProfileData(res);
  }

  async _onChatGroupsStorageChanged(newValue) {
    // Reload in-memory groups from the new storage value
    await this._conversation.load();

    // If history view is open, re-render it so deletions from Settings are reflected
    if (this._ui.isHistoryViewVisible()) {
      const group = this._conversation.getActiveGroup();
      if (group) {
        this._ui.renderHistoryView(group);
      } else {
        this._ui.hideHistoryView();
      }
    }
  }

  // ── Profile helpers ───────────────────────────────────────────────────────

  async _applyProfileData(profileRes) {
    const profile = profileRes?.profile || null;

    const stored = await chrome.storage.local.get(["profiles", "activeProfileId"]);
    this._profiles = stored.profiles || [];
    this._activeProfileId = stored.activeProfileId || null;

    this._ui.updateProfileBadge(this._profiles, this._activeProfileId);

    if (!profile) {
      this._ui.showNoBanner(() => chrome.runtime.openOptionsPage());
    } else {
      this._ui.hideNoBanner();
    }
  }

  async _selectProfile(id) {
    this._activeProfileId = id;
    await chrome.storage.local.set({ activeProfileId: id });
    this._ui.updateProfileBadge(this._profiles, id);
    this._ui.hideNoBanner();
    this._ui.profileDropdown.classList.add("hidden");
  }
}

/** Compare two URLs by origin+pathname only (ignoring query/hash) */
function _pageKeysMatch(urlA, urlB) {
  const key = (url) => {
    try { const u = new URL(url); return u.origin + u.pathname; }
    catch { return url; }
  };
  return key(urlA) === key(urlB);
}
