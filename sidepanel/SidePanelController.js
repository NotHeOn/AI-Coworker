import { ConversationStore } from "./ConversationStore.js";
import { SidePanelUI } from "./SidePanelUI.js";
import { QueueMirror } from "./QueueMirror.js";
import { ChatViewController } from "./ChatViewController.js";
import { StreamSession } from "./StreamSession.js";

export class SidePanelController {
  constructor() {
    this._ui           = new SidePanelUI();
    this._conversation = new ConversationStore();
    this._queueMirror  = new QueueMirror();
    this._chatView     = new ChatViewController({ ui: this._ui, conversation: this._conversation });
    this._session      = new StreamSession({ ui: this._ui, conversation: this._conversation, queueMirror: this._queueMirror });

    // Wire cross-reference (avoids circular constructor dep)
    this._chatView.onSend = () => this._session.send(this._chatView.activeTabId);

    this._profiles       = [];
    this._activeProfileId = null;
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
      this._ui.updateTabStatus(tabInfo);
      this._chatView.setActiveTab(tabInfo.id, tabInfo.url, tabInfo.title);
    }

    // Restore queue state in case the sidepanel was rebuilt while items were queued
    if (this._chatView.activeTabId) {
      const queueRes = await chrome.runtime.sendMessage({
        type: "GET_QUEUE_STATE",
        tabId: this._chatView.activeTabId
      });
      this._queueMirror.onQueueUpdated(queueRes?.items ?? []);
      this._ui.updateQueueState(this._queueMirror);
    }

    // Apply presets, render initial welcome screen (if no existing messages)
    this._chatView.setPresets(presetsRes?.presets || []);
    this._chatView.renderCurrentRecord();

    // Apply profile
    await this._applyProfileData(profileRes);

    // Wire up static event listeners
    this._bindEvents();

    // Listen for background broadcasts
    chrome.runtime.onMessage.addListener((msg) => this._onMessage(msg));

    // Sync when background writes chatGroups (HistoryStore fillSlot, etc.)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.chatGroups) return;
      this._chatView.onChatGroupsStorageChanged();
    });

    // Dismiss chip on user click
    this._ui.selectionChipDismissEl.addEventListener("click", () => {
      this._session.clearSelectedText();
    });
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  _bindEvents() {
    const ui = this._ui;

    ui.sendBtn.addEventListener("click", () => {
      if (this._queueMirror.isRunning()) {
        this._session.abortCurrentStream(this._chatView.activeTabId);
      } else {
        this._session.send(this._chatView.activeTabId);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this._queueMirror.isRunning()) {
        this._session.abortCurrentStream(this._chatView.activeTabId);
      }
    });

    ui.instructionEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this._session.send(this._chatView.activeTabId);
      }
    });

    ui.instructionEl.addEventListener("input", () => {
      ui.instructionEl.style.height = "auto";
      ui.instructionEl.style.height = Math.min(ui.instructionEl.scrollHeight, 120) + "px";
      ui.updateCharCount();
    });

    ui.clearBtn.addEventListener("click", async () => {
      this._conversation.newRecord(this._chatView.activeTabUrl, this._chatView.activeTabTitle);
      const res = await chrome.runtime.sendMessage({ type: "GET_PRESETS" });
      this._chatView.setPresets(res?.presets || []);
      this._chatView.renderCurrentRecord();
      if (ui.isHistoryViewVisible()) ui.hideHistoryView();
    });

    ui.settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

    // History view toggle
    ui.historyBtn.addEventListener("click", async () => {
      if (ui.isHistoryViewVisible()) {
        ui.hideHistoryView();
      } else {
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
      this._conversation.newRecord(this._chatView.activeTabUrl, this._chatView.activeTabTitle);
      const res = await chrome.runtime.sendMessage({ type: "GET_PRESETS" });
      this._chatView.setPresets(res?.presets || []);
      this._chatView.renderCurrentRecord();
      ui.hideHistoryView();
    });

    // History view list: load record or delete
    ui.historyViewList.addEventListener("click", (e) => {
      const deleteBtn = e.target.closest(".history-delete-btn");
      if (deleteBtn) {
        const recordId = deleteBtn.dataset.deleteRecordId;
        if (recordId) this._chatView.deleteHistoryRecord(recordId);
        return;
      }

      const row = e.target.closest(".history-record-row");
      if (!row?.dataset.recordId) return;
      this._chatView.switchToRecord(row.dataset.recordId);
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

    ui.contextTextEl.addEventListener("click", () => this._session.openContentPreview(this._chatView.activeTabId));

    document.addEventListener("click", () => ui.profileDropdown.classList.add("hidden"));
    ui.profileDropdown.addEventListener("click", (e) => e.stopPropagation());

    // Edit button delegation
    ui.messagesEl.addEventListener("click", (e) => {
      const editBtn = e.target.closest(".edit-msg-btn");
      if (!editBtn) return;
      const msgEl = editBtn.closest(".message.user");
      if (msgEl && !this._queueMirror.isRunning()) {
        this._handleEditMessage(msgEl);
      }
    });
  }

  // ── Message editing (wiring layer) ─────────────────────────────────────────

  _handleEditMessage(msgEl) {
    this._ui.startEditMessage(
      msgEl,
      (newText) => this._resendFromEdit(msgEl, newText),
      () => this._ui.cancelEdit(msgEl)
    );
  }

  async _resendFromEdit(msgEl, newText) {
    if (!newText || this._queueMirror.isRunning()) return;

    const allMessages = [...this._ui.messagesEl.querySelectorAll(".message")];
    const domIndex = allMessages.indexOf(msgEl);
    if (domIndex === -1) return;

    // Remove from DOM
    this._ui.removeMessagesFrom(domIndex);

    // Truncate history in background storage
    const sendRecord = this._conversation.getActiveRecord();
    if (sendRecord) {
      await chrome.runtime.sendMessage({
        type: "TRUNCATE_HISTORY",
        recordId: sendRecord.id,
        index: domIndex,
      });
      await this._conversation.load();
      this._conversation.setActiveTab(this._chatView.activeTabId, this._chatView.activeTabUrl, this._chatView.activeTabTitle);
    }

    this._ui.instructionEl.value = newText;
    this._ui.updateCharCount();
    this._session.send(this._chatView.activeTabId);
  }

  // ── Incoming messages ─────────────────────────────────────────────────────

  _onMessage(msg) {
    switch (msg.type) {
      case "TAB_CHANGED":
        this._session.clearSelectedText();
        this._chatView.onTabChanged(msg);
        // Reset queue view for the new tab
        chrome.runtime.sendMessage({ type: "GET_QUEUE_STATE", tabId: msg.id })
          .then(res => {
            this._queueMirror.onQueueUpdated(res?.items ?? []);
            this._ui.updateQueueState(this._queueMirror);
          }).catch(() => {});
        break;
      case "CONTENT_UNAVAILABLE":
        this._ui.showContentUnavailable(msg.reason);
        break;
      case "SETTINGS_UPDATED":
        this._refreshSettings();
        break;
      case "SELECTION_CHANGED":
        if (msg.tabId === this._chatView.activeTabId) {
          this._session.setSelectedText(msg.text || "");
        }
        break;
      case "QUEUE_UPDATED":
        if (msg.tabId === this._chatView.activeTabId) {
          this._queueMirror.onQueueUpdated(msg.items);
          this._ui.updateQueueState(this._queueMirror);
        }
        break;
    }
  }

  // ── Profile helpers ───────────────────────────────────────────────────────

  async _refreshSettings() {
    const res = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_PROFILE" });
    await this._applyProfileData(res);
  }

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
