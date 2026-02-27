import { ConversationManager } from "./ConversationManager.js";
import { SidePanelUI } from "./SidePanelUI.js";

export class SidePanelController {
  constructor() {
    this._ui = new SidePanelUI();
    this._conversation = new ConversationManager();

    this._isStreaming = false;
    this._activeTabId = null;
    this._profiles = [];
    this._activeProfileId = null;
    this._presets = [];
  }

  async init() {
    // Fetch initial state in parallel
    const [tabInfo, presetsRes, profileRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB" }),
      chrome.runtime.sendMessage({ type: "GET_PRESETS" }),
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_PROFILE" })
    ]);

    // Apply tab info and seed conversation manager
    if (tabInfo && !tabInfo.error) {
      this._activeTabId = tabInfo.id;
      this._ui.updateTabStatus(tabInfo);
      this._conversation.setActiveTab(tabInfo.id); // registers the tab (no existing history)
    }

    // Apply presets, render initial welcome screen
    this._presets = presetsRes?.presets || [];
    const welcome = this._ui.renderWelcome(this._presets);
    this._bindQuickPrompts(welcome);

    // Apply profile
    await this._applyProfileData(profileRes);

    // Wire up static event listeners
    this._bindEvents();

    // Listen for background broadcasts
    chrome.runtime.onMessage.addListener((msg) => this._onMessage(msg));
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
      this._conversation.clear();
      // Refresh presets in case they changed since last load
      const res = await chrome.runtime.sendMessage({ type: "GET_PRESETS" });
      this._presets = res?.presets || this._presets;
      const welcome = this._ui.renderWelcome(this._presets);
      this._bindQuickPrompts(welcome);
    });

    ui.settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

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

    // Edit button delegation — works for all messages regardless of when they were added
    ui.messagesEl.addEventListener("click", (e) => {
      const editBtn = e.target.closest(".edit-msg-btn");
      if (!editBtn) return;
      const msgEl = editBtn.closest(".message.user");
      if (msgEl && !this._isStreaming) {
        this._handleEditMessage(msgEl);
      }
    });
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

    // domIndex == historyIndex because each .message element = one history entry
    const allMessages = [...this._ui.messagesEl.querySelectorAll(".message")];
    const domIndex = allMessages.indexOf(msgEl);
    if (domIndex === -1) return;

    // Remove this message and everything after it from DOM
    this._ui.removeMessagesFrom(domIndex);

    // Truncate conversation history to match
    this._conversation.truncateTo(domIndex);

    // Put the edited text into the input and send
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

    this._isStreaming = true;
    this._ui.setStreaming(true);
    this._ui.instructionEl.value = "";
    this._ui.updateCharCount();

    // Snapshot the current history before pushing the new user turn
    const historySnapshot = this._conversation.getHistory();
    const syncPage = this._ui.getSyncPage();

    this._ui.addMessage("user", instruction);
    const { contentEl } = this._ui.addMessage("assistant", "", true);

    let accumulated = "";

    // Temporary per-send listener for stream events
    const onStream = (msg) => {
      if (msg.type === "STREAM_CHUNK") {
        accumulated += msg.chunk;
        this._ui.setStreamingContent(contentEl, accumulated);
      } else if (msg.type === "STREAM_DONE") {
        const finalText = msg.fullText || accumulated;
        this._ui.setFinalContent(contentEl, finalText, this._activeTabId);

        // Persist both turns into this tab's history
        this._conversation.push("user", instruction);
        this._conversation.push("assistant", finalText);

        this._doneStreaming(onStream);
      } else if (msg.type === "STREAM_ABORTED") {
        const partialText = msg.partialText || accumulated;
        if (partialText) {
          this._ui.setFinalContent(contentEl, partialText, this._activeTabId);
          this._ui.appendAbortNote(contentEl, msg.reason);
          // Persist partial response so context isn't lost
          this._conversation.push("user", instruction);
          this._conversation.push("assistant", partialText);
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
      history: historySnapshot, // previous turns only; background adds current turn
      syncPage                  // if true, background re-fetches content even mid-conversation
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
    }
  }

  _onTabChanged(tabInfo) {
    const newTabId = tabInfo.id;
    this._activeTabId = newTabId;
    this._ui.updateTabStatus(tabInfo);

    // Switch conversation to the new tab
    const hadHistory = this._conversation.setActiveTab(newTabId);

    if (hadHistory) {
      // Re-render the existing history for this tab
      this._ui.renderHistoryMessages(this._conversation.getHistory(), newTabId);
    } else {
      // Fresh tab — show welcome screen with quick prompts
      const welcome = this._ui.renderWelcome(this._presets);
      this._bindQuickPrompts(welcome);
    }
  }

  async _refreshSettings() {
    const res = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_PROFILE" });
    await this._applyProfileData(res);
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
