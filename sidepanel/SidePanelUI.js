import { CitationRenderer } from "./CitationRenderer.js";
import { PageUrl } from "./PageUrl.js";

export class SidePanelUI {
  constructor() {
    this._citations = new CitationRenderer();

    // DOM refs
    this.messagesEl      = document.getElementById("messages");
    this._bindLinkInterception();
    this.instructionEl   = document.getElementById("instruction");
    this.sendBtn         = document.getElementById("sendBtn");
    this.clearBtn        = document.getElementById("clearBtn");
    this.settingsBtn     = document.getElementById("settingsBtn");
    this.contextTextEl   = document.getElementById("contextText");
    this.charCountEl     = document.getElementById("charCount");
    this.profileSwitcher = document.getElementById("profileSwitcher");
    this.profileDropdown = document.getElementById("profileDropdown");
    this.syncPageToggle          = document.getElementById("syncPageToggle");
    this.selectionChipEl         = document.getElementById("selectionChip");
    this.selectionChipTextEl     = document.getElementById("selectionChipText");
    this.selectionChipDismissEl  = document.getElementById("selectionChipDismiss");

    // History view refs
    this.historyBtn        = document.getElementById("historyBtn");
    this.historyView       = document.getElementById("historyView");
    this.historyViewList   = document.getElementById("historyViewList");
    this.historyBackBtn    = document.getElementById("historyBackBtn");
    this.historyNewBtn     = document.getElementById("historyNewBtn");
    this.historyViewAllBtn = document.getElementById("historyViewAllBtn");
    this.historyViewOrigin = document.getElementById("historyViewOrigin");

    // Queue badge
    this.queueBadgeEl = document.getElementById("queueBadge");
  }

  // ── Selection chip ────────────────────────────────────────────────────────

  showSelectionChip(text) {
    const MAX = 60;
    const label = text.length > MAX ? text.slice(0, MAX) + "…" : text;
    this.selectionChipTextEl.textContent = label;
    this.selectionChipEl.classList.remove("hidden");
  }

  hideSelectionChip() {
    this.selectionChipEl.classList.add("hidden");
    this.selectionChipTextEl.textContent = "";
  }

  // ── Welcome screen ────────────────────────────────────────────────────────

  renderWelcome(presets) {
    const btnHtml = presets
      .map(p => `<button class="quick-btn" data-prompt="${escHtml(p.prompt)}">${escHtml(p.label)}</button>`)
      .join("");

    const welcome = document.createElement("div");
    welcome.className = "welcome";
    welcome.innerHTML = `
      <div class="welcome-icon">🤖</div>
      <h3>AI Coworker</h3>
      <p>I can read and analyze the current page for you. Ask me anything!</p>
      <div class="quick-prompts">${btnHtml}</div>
    `;
    this.messagesEl.innerHTML = "";
    this.messagesEl.appendChild(welcome);
    return welcome;
  }

  /**
   * Re-render a saved conversation history into the messages panel.
   * Called when switching back to a tab that already has messages.
   * @param {{ role: string, content: string }[]} history
   * @param {number} tabId  — used to bind citation chips to the correct tab
   */
  renderHistoryMessages(history, tabId) {
    this.messagesEl.innerHTML = "";
    for (const entry of history) {
      // tabId only matters for assistant messages (citations); user messages have none
      this.addMessage(entry.role, entry.content, false, entry.role === "assistant" ? tabId : 0);
    }
  }

  // ── Tab status bar ────────────────────────────────────────────────────────

  updateTabStatus(tabInfo) {
    if (!tabInfo) {
      this.contextTextEl.textContent = "No page loaded";
      this.contextTextEl.className = "context-text";
      return;
    }

    if (tabInfo.status === "restricted") {
      this.contextTextEl.textContent = "Restricted page";
      this.contextTextEl.className = "context-text status-restricted";
      return;
    }

    if (tabInfo.status === "loading") {
      const label = tabInfo.title || tabInfo.url || "Loading…";
      this.contextTextEl.textContent = shorten(label, 40);
      this.contextTextEl.className = "context-text status-loading";
      return;
    }

    const label = tabInfo.title || tabInfo.url || "Current page";
    this.contextTextEl.textContent = shorten(label, 40);
    this.contextTextEl.className = "context-text";
  }

  /** Show a warning inside the context bar when content extraction failed */
  showContentUnavailable(reason) {
    this.contextTextEl.textContent = `⚠ ${reason}`;
    this.contextTextEl.className = "context-text status-restricted";
  }

  // ── Sync-page toggle ──────────────────────────────────────────────────────

  /** Returns true if the user wants page content re-sent on every message */
  getSyncPage() {
    return this.syncPageToggle?.checked ?? false;
  }

  /** Programmatically set the Sync Page toggle */
  setSyncPage(val) {
    if (this.syncPageToggle) this.syncPageToggle.checked = val;
  }

  // ── URL mismatch dialog ───────────────────────────────────────────────────

  /**
   * Show a modal asking the user what to do when the selected history record
   * belongs to a different URL than the current tab.
   * @param {import("./Conversation.js").Conversation} rec
   * @param {string} currentUrl
   * @param {function} onNew   — user chose "New conversation"
   * @param {function} onLoad  — user chose "Load anyway"
   */
  showUrlMismatchDialog(rec, currentUrl, onNew, onLoad) {
    document.getElementById("urlMismatchDialog")?.remove();

    const recLabel  = shorten(new PageUrl(rec.pageUrl).label, 50);
    const curLabel  = shorten(new PageUrl(currentUrl).label, 50);

    const overlay = document.createElement("div");
    overlay.id = "urlMismatchDialog";
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
      <div class="dialog-box">
        <div class="dialog-title">⚠ 页面不同</div>
        <div class="dialog-body">
          <div class="dialog-row">
            <span class="dialog-label">历史记录页面</span>
            <span class="dialog-url" title="${escHtml(rec.pageUrl)}">${escHtml(recLabel)}</span>
          </div>
          <div class="dialog-row">
            <span class="dialog-label">当前页面</span>
            <span class="dialog-url" title="${escHtml(currentUrl)}">${escHtml(curLabel)}</span>
          </div>
          <p class="dialog-hint">该对话来自不同的页面。是否新建对话，或直接导入历史记录并开启 Sync Page？</p>
        </div>
        <div class="dialog-actions">
          <button class="dialog-btn dialog-btn-ghost" id="dialogBtnCancel">取消</button>
          <button class="dialog-btn dialog-btn-secondary" id="dialogBtnNew">新建对话</button>
          <button class="dialog-btn dialog-btn-primary" id="dialogBtnLoad">直接导入</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("dialogBtnCancel").addEventListener("click", () => overlay.remove());
    document.getElementById("dialogBtnNew").addEventListener("click", () => {
      overlay.remove();
      onNew();
    });
    document.getElementById("dialogBtnLoad").addEventListener("click", () => {
      overlay.remove();
      onLoad();
    });

    // Clicking the backdrop also cancels
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ── Profile badge & dropdown ──────────────────────────────────────────────

  updateProfileBadge(profiles, activeProfileId) {
    const active = profiles.find(p => p.id === activeProfileId);
    this.profileSwitcher.textContent = active ? active.name : "No profile";
  }

  renderProfileDropdown(profiles, activeProfileId, onSelect, onOpenSettings) {
    this.profileDropdown.innerHTML = "";

    if (profiles.length === 0) {
      this.profileDropdown.innerHTML = `<div class="dropdown-empty">No profiles. <a id="dropGoSettings">Open Settings</a></div>`;
      document.getElementById("dropGoSettings")?.addEventListener("click", onOpenSettings);
      return;
    }

    for (const profile of profiles) {
      const row = document.createElement("button");
      row.className = `dropdown-row${profile.id === activeProfileId ? " dropdown-active" : ""}`;
      row.innerHTML = `
        ${profile.id === activeProfileId ? '<span class="dropdown-check">✓</span>' : '<span class="dropdown-check"></span>'}
        <span class="dropdown-name">${escHtml(profile.name)}</span>
        <span class="dropdown-model">${escHtml(profile.modelId || profile.modelName || "")}</span>
      `;
      row.addEventListener("click", () => onSelect(profile.id));
      this.profileDropdown.appendChild(row);
    }

    const sep = document.createElement("div");
    sep.className = "dropdown-sep";
    this.profileDropdown.appendChild(sep);

    const settingsRow = document.createElement("button");
    settingsRow.className = "dropdown-row dropdown-settings-row";
    settingsRow.textContent = "Manage profiles…";
    settingsRow.addEventListener("click", onOpenSettings);
    this.profileDropdown.appendChild(settingsRow);
  }

  // ── No-profile banner ─────────────────────────────────────────────────────

  showNoBanner(onOpenSettings) {
    this.hideNoBanner();
    const banner = document.createElement("div");
    banner.className = "no-key-banner";
    banner.id = "noKeyBanner";
    banner.innerHTML = `⚠️ No profile configured. <a id="goSettings">Open Settings</a> to add a model profile.`;
    document.querySelector(".header").after(banner);
    document.getElementById("goSettings").addEventListener("click", onOpenSettings);
  }

  hideNoBanner() {
    document.getElementById("noKeyBanner")?.remove();
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  /**
   * @param {string} role          "user" | "assistant"
   * @param {string} content       raw text (markdown + optional [§id] anchors)
   * @param {boolean} isLoading    show spinner instead of content
   * @param {number}  tabId        used to bind citation chip clicks (0 = no citations)
   * @param {string}  selectedText optional selected text attached to a user message
   */
  addMessage(role, content, isLoading = false, tabId = 0, selectedText = "", itemId = null) {
    // Remove welcome screen on first real message
    this.messagesEl.querySelector(".welcome")?.remove();

    const msgEl = document.createElement("div");
    msgEl.className = `message ${role}`;

    // Tag assistant bubbles with itemId so stream chunks can target the right element
    if (role === "assistant" && itemId) {
      msgEl.dataset.itemId = itemId;
    }

    if (role === "user") {
      // Store raw text for edit feature
      msgEl.dataset.raw = content;

      const headerEl = document.createElement("div");
      headerEl.className = "message-header";

      const roleEl = document.createElement("div");
      roleEl.className = "message-role";
      roleEl.textContent = "You";

      const editBtn = document.createElement("button");
      editBtn.className = "edit-msg-btn";
      editBtn.title = "Edit & resend";
      editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 1l4 4L5 15H1v-4z"/></svg>`;

      headerEl.appendChild(roleEl);
      headerEl.appendChild(editBtn);
      msgEl.appendChild(headerEl);
    } else {
      const roleEl = document.createElement("div");
      roleEl.className = "message-role";
      roleEl.textContent = "AI Coworker";
      msgEl.appendChild(roleEl);
    }

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";

    if (isLoading) {
      contentEl.innerHTML = `<div class="loading-dots"><span></span><span></span><span></span></div>`;
    } else {
      contentEl.innerHTML = this._citations.parse(content, tabId);
      this._citations.bindClicks(contentEl);
    }

    msgEl.appendChild(contentEl);

    // Attach selected-text badge to user messages that included a selection
    if (role === "user" && selectedText) {
      const MAX = 80;
      const preview = selectedText.length > MAX ? selectedText.slice(0, MAX) + "…" : selectedText;
      const badge = document.createElement("div");
      badge.className = "selected-text-badge";
      badge.title = selectedText;
      badge.innerHTML = `<span class="selected-text-badge-icon">✂</span><span class="selected-text-badge-label">${escHtml(preview)}</span>`;
      msgEl.appendChild(badge);
    }

    this.messagesEl.appendChild(msgEl);
    this._scrollToBottom();
    return { msgEl, contentEl };
  }

  // ── Inline message editing ─────────────────────────────────────────────────

  /**
   * Replace a user message bubble's content with an inline textarea editor.
   * @param {HTMLElement} msgEl
   * @param {function(string)} onResend  called with the new trimmed text
   * @param {function}         onCancel
   */
  startEditMessage(msgEl, onResend, onCancel) {
    const rawText = msgEl.dataset.raw ?? "";
    const contentEl = msgEl.querySelector(".message-content");

    // Stash original HTML to restore on cancel
    msgEl.dataset.originalHtml = contentEl.innerHTML;

    const textarea = document.createElement("textarea");
    textarea.className = "edit-textarea";
    textarea.value = rawText;

    const actionsEl = document.createElement("div");
    actionsEl.className = "edit-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "edit-cancel-btn";
    cancelBtn.textContent = "Cancel";

    const resendBtn = document.createElement("button");
    resendBtn.className = "edit-resend-btn";
    resendBtn.innerHTML = `Resend <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="14" x2="8" y2="2"/><polyline points="3,7 8,2 13,7"/></svg>`;

    actionsEl.appendChild(cancelBtn);
    actionsEl.appendChild(resendBtn);

    contentEl.innerHTML = "";
    contentEl.appendChild(textarea);
    contentEl.appendChild(actionsEl);

    // Auto-resize textarea
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    };
    resize();
    textarea.addEventListener("input", resize);

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const doResend = () => {
      const text = textarea.value.trim();
      if (text) onResend(text);
    };

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doResend(); }
      else if (e.key === "Escape") { onCancel(); }
    });

    cancelBtn.addEventListener("click", onCancel);
    resendBtn.addEventListener("click", doResend);

    this._scrollToBottom();
  }

  /** Restore a user message bubble to its original rendered content */
  cancelEdit(msgEl) {
    const contentEl = msgEl.querySelector(".message-content");
    contentEl.innerHTML = msgEl.dataset.originalHtml ?? "";
    delete msgEl.dataset.originalHtml;
  }

  /** Remove all .message DOM elements starting at domIndex */
  removeMessagesFrom(domIndex) {
    const all = [...this.messagesEl.querySelectorAll(".message")];
    for (let i = domIndex; i < all.length; i++) {
      all[i].remove();
    }
  }

  /** Update content element during streaming (raw text, no citations yet) */
  setStreamingContent(contentEl, rawText) {
    let html;
    if (typeof window.marked !== "undefined") {
      html = window.marked.parse(rawText);
    } else {
      html = escHtml(rawText).replace(/\n/g, "<br>");
    }
    contentEl.innerHTML = html + '<span class="cursor"></span>';
    this._scrollToBottom();
  }

  /** Finalise message when stream is done — parse citations with correct tabId */
  setFinalContent(contentEl, rawText, tabId) {
    contentEl.innerHTML = this._citations.parse(rawText, tabId);
    this._citations.bindClicks(contentEl);
    this._scrollToBottom();
  }

  setErrorContent(contentEl, error) {
    contentEl.innerHTML = `<span style="color:var(--error)">Error: ${escHtml(error)}</span>`;
    this._scrollToBottom();
  }

  // ── Queue state ───────────────────────────────────────────────────────────

  /** Update the send button and queue badge to reflect current queue state. */
  updateQueueState(queueView) {
    const queued  = queueView.getQueuedCount();
    const running = queueView.isRunning();

    this.setStreaming(running);

    if (this.queueBadgeEl) {
      this.queueBadgeEl.textContent = queued > 0 ? `${queued} queued` : "";
      this.queueBadgeEl.classList.toggle("hidden", queued === 0);
    }
  }

  // ── Input controls ────────────────────────────────────────────────────────

  setStreaming(isStreaming) {
    if (isStreaming) {
      this.sendBtn.classList.add("stop-mode");
      this.sendBtn.title = "Stop (Esc)";
      this.sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="3" y="3" width="10" height="10" rx="2"/>
      </svg>`;
    } else {
      this.sendBtn.classList.remove("stop-mode");
      this.sendBtn.title = "";
      this.sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="14" x2="8" y2="2"/><polyline points="3,7 8,2 13,7"/>
      </svg>`;
    }
  }

  /** Append a small "stopped" note below streaming content */
  appendAbortNote(contentEl, reason) {
    const note = document.createElement("div");
    note.className = "stream-stopped";
    note.textContent = reason === "timeout" ? "⏱ Response stopped: 2-minute timeout reached." : "⏹ Response stopped by user.";
    contentEl.appendChild(note);
    this._scrollToBottom();
  }

  updateCharCount() {
    const len = this.instructionEl.value.length;
    this.charCountEl.textContent = `${len} / 2000`;
    this.charCountEl.style.color = len > 1800 ? "var(--error)" : "var(--text-muted)";
  }

  // ── History view ──────────────────────────────────────────────────────────

  showHistoryView(group) {
    this.messagesEl.classList.add("hidden");
    this.historyView.classList.remove("hidden");
    this.historyBtn.classList.add("active");
    if (group) this.renderHistoryView(group);
  }

  hideHistoryView() {
    this.historyView.classList.add("hidden");
    this.messagesEl.classList.remove("hidden");
    this.historyBtn.classList.remove("active");
  }

  isHistoryViewVisible() {
    return !this.historyView.classList.contains("hidden");
  }

  renderHistoryView(group) {
    if (!group) return;
    this.historyViewOrigin.textContent = group.displayName;
    this.historyViewList.innerHTML = "";

    if (group.records.length === 0) {
      this.historyViewList.innerHTML = `<div style="padding:20px 14px;font-size:12px;color:var(--text-muted);text-align:center">No conversations yet.</div>`;
      return;
    }

    const sorted = [...group.records].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const rec of sorted) {
      const isActive = rec.id === group.activeRecordId;
      const row = document.createElement("div");
      row.className = `history-record-row${isActive ? " history-record-active" : ""}`;
      row.dataset.recordId = rec.id;

      const infoEl = document.createElement("div");
      infoEl.className = "history-record-info";

      const titleEl = document.createElement("span");
      titleEl.className = "history-record-title";
      titleEl.textContent = rec.title;

      const msgCount = rec.messages.filter(m => m.content !== null).length;
      const metaEl = document.createElement("span");
      metaEl.className = "history-record-meta";
      metaEl.textContent = `${Math.floor(msgCount / 2)} message${Math.floor(msgCount / 2) !== 1 ? "s" : ""}`;

      infoEl.appendChild(titleEl);
      infoEl.appendChild(metaEl);

      const dateEl = document.createElement("span");
      dateEl.className = "history-record-date";
      dateEl.textContent = relativeDate(rec.updatedAt);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "history-delete-btn";
      deleteBtn.dataset.deleteRecordId = rec.id;
      deleteBtn.title = "Delete conversation";
      deleteBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>`;

      row.appendChild(infoEl);
      row.appendChild(dateEl);
      row.appendChild(deleteBtn);
      this.historyViewList.appendChild(row);
    }
  }

  setHistoryDisabled(disabled) {
    if (disabled) {
      this.historyBtn.classList.add("hidden");
      // Close history view if it was open
      this.hideHistoryView();
    } else {
      this.historyBtn.classList.remove("hidden");
    }
  }

  // ── Link interception ────────────────────────────────────────────────────

  _bindLinkInterception() {
    // messagesEl is not yet in the DOM at this point — use document-level
    // delegation and filter by ancestry later, OR wire up after DOM is ready.
    // We defer to the next microtask so the constructor finishes first.
    document.addEventListener("click", (e) => {
      const anchor = e.target.closest("a[href]");
      if (!anchor) return;
      // Only intercept links inside the messages panel
      if (!this.messagesEl?.contains(anchor)) return;

      const href = anchor.getAttribute("href");
      if (!href || !/^https?:\/\//i.test(href)) return;

      e.preventDefault();
      e.stopPropagation();

      this.showLinkConfirmDialog(href, () => {
        chrome.tabs.create({ url: href });
      });
    });
  }

  /**
   * Show a confirmation dialog before opening an external URL.
   * @param {string}   url
   * @param {function} onConfirm
   */
  showLinkConfirmDialog(url, onConfirm) {
    document.getElementById("linkConfirmDialog")?.remove();

    const displayUrl = shorten(new PageUrl(url).display, 60);

    const overlay = document.createElement("div");
    overlay.id = "linkConfirmDialog";
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
      <div class="dialog-box">
        <div class="dialog-title">🔗 即将打开链接</div>
        <div class="dialog-body">
          <div class="dialog-row">
            <span class="dialog-label">目标地址</span>
            <span class="dialog-url" title="${escHtml(url)}">${escHtml(displayUrl)}</span>
          </div>
          <p class="dialog-hint">该链接来自 AI 回复，将在新标签页中打开。</p>
        </div>
        <div class="dialog-actions">
          <button class="dialog-btn dialog-btn-secondary" id="linkBtnCancel">取消</button>
          <button class="dialog-btn dialog-btn-primary" id="linkBtnOpen">打开</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("linkBtnCancel").addEventListener("click", () => overlay.remove());
    document.getElementById("linkBtnOpen").addEventListener("click", () => {
      overlay.remove();
      onConfirm();
    });

    // Clicking the backdrop also cancels
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shorten(str, maxLen) {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}


function relativeDate(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)   return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
