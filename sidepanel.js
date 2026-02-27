// ── State ──
let conversationHistory = []; // { role, content }[]
let isStreaming = false;
let currentPageContent = null;
let currentPageTitle = "";
let profiles = [];
let activeProfileId = null;

// ── DOM refs ──
const messagesEl = document.getElementById("messages");
const instructionEl = document.getElementById("instruction");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const settingsBtn = document.getElementById("settingsBtn");
const contextTextEl = document.getElementById("contextText");
const charCountEl = document.getElementById("charCount");
const profileSwitcher = document.getElementById("profileSwitcher");
const profileDropdown = document.getElementById("profileDropdown");

// ── Init ──
(async () => {
  await checkActiveProfile();
  await loadPageContent();
})();

// ── Profile Check ──
async function checkActiveProfile() {
  const data = await chrome.storage.local.get(["profiles", "activeProfileId"]);
  profiles = data.profiles || [];
  activeProfileId = data.activeProfileId || null;

  updateProfileBadge();

  if (!activeProfileId || profiles.length === 0) {
    showNoBanner();
  } else {
    removeNoBanner();
  }
}

function updateProfileBadge() {
  const active = profiles.find(p => p.id === activeProfileId);
  profileSwitcher.textContent = active ? active.name : "No profile";
}

function showNoBanner() {
  removeNoBanner(); // avoid duplicates
  const banner = document.createElement("div");
  banner.className = "no-key-banner";
  banner.id = "noKeyBanner";
  banner.innerHTML = `⚠️ No profile configured. <a id="goSettings">Open Settings</a> to add a model profile.`;
  document.querySelector(".header").after(banner);
  document.getElementById("goSettings").addEventListener("click", openSettings);
}

function removeNoBanner() {
  document.getElementById("noKeyBanner")?.remove();
}

// ── Load page content ──
async function loadPageContent() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT" });
    if (response?.content) {
      currentPageContent = response.content;
      currentPageTitle = response.title || response.url || "Current page";
      const shortTitle = currentPageTitle.length > 40
        ? currentPageTitle.slice(0, 37) + "…"
        : currentPageTitle;
      contextTextEl.textContent = shortTitle;
    } else {
      currentPageContent = null;
      contextTextEl.textContent = "Could not read page";
    }
  } catch {
    currentPageContent = null;
    contextTextEl.textContent = "Could not read page";
  }
}

// ── Listen for profile changes and tab switches ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PROFILE_UPDATED") {
    checkActiveProfile();
  }
  if (msg.type === "TAB_CHANGED") {
    loadPageContent();
  }
});

// ── Profile switcher dropdown ──
profileSwitcher.addEventListener("click", (e) => {
  e.stopPropagation();
  const isHidden = profileDropdown.classList.contains("hidden");
  if (isHidden) {
    renderDropdown();
    profileDropdown.classList.remove("hidden");
  } else {
    profileDropdown.classList.add("hidden");
  }
});

document.addEventListener("click", () => {
  profileDropdown.classList.add("hidden");
});

profileDropdown.addEventListener("click", (e) => e.stopPropagation());

function renderDropdown() {
  profileDropdown.innerHTML = "";

  if (profiles.length === 0) {
    profileDropdown.innerHTML = `<div class="dropdown-empty">No profiles. <a id="dropGoSettings">Open Settings</a></div>`;
    document.getElementById("dropGoSettings")?.addEventListener("click", openSettings);
    return;
  }

  for (const profile of profiles) {
    const row = document.createElement("button");
    row.className = `dropdown-row${profile.id === activeProfileId ? " dropdown-active" : ""}`;
    row.innerHTML = `
      ${profile.id === activeProfileId ? '<span class="dropdown-check">✓</span>' : '<span class="dropdown-check"></span>'}
      <span class="dropdown-name">${escHtml(profile.name)}</span>
      <span class="dropdown-model">${escHtml(profile.modelName)}</span>
    `;
    row.addEventListener("click", async () => {
      activeProfileId = profile.id;
      await chrome.storage.local.set({ activeProfileId });
      updateProfileBadge();
      removeNoBanner();
      profileDropdown.classList.add("hidden");
    });
    profileDropdown.appendChild(row);
  }

  const sep = document.createElement("div");
  sep.className = "dropdown-sep";
  profileDropdown.appendChild(sep);

  const settingsRow = document.createElement("button");
  settingsRow.className = "dropdown-row dropdown-settings-row";
  settingsRow.textContent = "Manage profiles…";
  settingsRow.addEventListener("click", openSettings);
  profileDropdown.appendChild(settingsRow);
}

// ── Helpers ──
function openSettings() {
  chrome.runtime.openOptionsPage();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMarkdown(text) {
  if (typeof marked !== "undefined") {
    return marked.parse(text);
  }
  // Fallback: escape HTML and preserve newlines
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addMessage(role, content, isLoading = false) {
  // Remove welcome screen on first message
  const welcome = messagesEl.querySelector(".welcome");
  if (welcome) welcome.remove();

  const msgEl = document.createElement("div");
  msgEl.className = `message ${role}`;

  const roleEl = document.createElement("div");
  roleEl.className = "message-role";
  roleEl.textContent = role === "user" ? "You" : "AI Coworker";

  const contentEl = document.createElement("div");
  contentEl.className = "message-content";

  if (isLoading) {
    contentEl.innerHTML = `<div class="loading-dots"><span></span><span></span><span></span></div>`;
  } else {
    contentEl.innerHTML = renderMarkdown(content);
  }

  msgEl.appendChild(roleEl);
  msgEl.appendChild(contentEl);
  messagesEl.appendChild(msgEl);
  scrollToBottom();
  return { msgEl, contentEl };
}

// ── Send ──
async function send() {
  const instruction = instructionEl.value.trim();
  if (!instruction || isStreaming) return;

  isStreaming = true;
  sendBtn.disabled = true;
  instructionEl.value = "";
  updateCharCount();

  // Show user message
  addMessage("user", instruction);

  // Show loading indicator
  const { contentEl } = addMessage("assistant", "", true);

  // Ask background to stream response
  chrome.runtime.sendMessage({
    type: "ANALYZE",
    instruction,
    pageContent: currentPageContent || null,
    conversationHistory: conversationHistory.slice() // shallow copy
  });

  let accumulated = "";

  // Listen for stream events
  function onMessage(msg) {
    if (msg.type === "STREAM_CHUNK") {
      accumulated += msg.chunk;
      contentEl.innerHTML = renderMarkdown(accumulated) + '<span class="cursor"></span>';
      scrollToBottom();
    } else if (msg.type === "STREAM_DONE") {
      contentEl.innerHTML = renderMarkdown(msg.fullText || accumulated);
      scrollToBottom();

      // Save to conversation history
      const userContent = currentPageContent
        ? `Here is the current page content:\n\n---\n${currentPageContent}\n---\n\nMy instruction: ${instruction}`
        : instruction;

      conversationHistory.push({ role: "user", content: userContent });
      conversationHistory.push({ role: "assistant", content: msg.fullText || accumulated });

      cleanup();
    } else if (msg.type === "STREAM_ERROR") {
      contentEl.innerHTML = `<span style="color:var(--error)">Error: ${msg.error}</span>`;
      scrollToBottom();
      cleanup();
    }
  }

  function cleanup() {
    chrome.runtime.onMessage.removeListener(onMessage);
    isStreaming = false;
    sendBtn.disabled = false;
    instructionEl.focus();
  }

  chrome.runtime.onMessage.addListener(onMessage);
}

// ── Event listeners ──
sendBtn.addEventListener("click", send);

instructionEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// Auto-resize textarea
instructionEl.addEventListener("input", () => {
  instructionEl.style.height = "auto";
  instructionEl.style.height = Math.min(instructionEl.scrollHeight, 120) + "px";
  updateCharCount();
});

function updateCharCount() {
  const len = instructionEl.value.length;
  charCountEl.textContent = `${len} / 2000`;
  charCountEl.style.color = len > 1800 ? "var(--error)" : "var(--text-muted)";
}

// Clear conversation
clearBtn.addEventListener("click", () => {
  conversationHistory = [];
  messagesEl.innerHTML = "";
  // Re-add welcome
  const welcome = document.createElement("div");
  welcome.className = "welcome";
  welcome.innerHTML = `
    <div class="welcome-icon">🤖</div>
    <h3>AI Coworker</h3>
    <p>I can read and analyze the current page for you. Ask me anything!</p>
    <div class="quick-prompts">
      <button class="quick-btn" data-prompt="Summarize this page in 3 bullet points.">Summarize</button>
      <button class="quick-btn" data-prompt="What are the key takeaways from this page?">Key Points</button>
      <button class="quick-btn" data-prompt="Extract all important facts and data from this page.">Extract Facts</button>
      <button class="quick-btn" data-prompt="What action should I take based on this page?">Next Steps</button>
    </div>
  `;
  messagesEl.appendChild(welcome);
  bindQuickPrompts();
});

// Settings
settingsBtn.addEventListener("click", openSettings);

// Quick prompt buttons (initial + after clear)
function bindQuickPrompts() {
  messagesEl.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      instructionEl.value = btn.dataset.prompt;
      updateCharCount();
      instructionEl.dispatchEvent(new Event("input"));
      send();
    });
  });
}

bindQuickPrompts();
