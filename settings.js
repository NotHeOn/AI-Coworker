// ── DOM refs — Profiles ──
const profileListEl = document.getElementById("profileList");
const formPanelTitle = document.getElementById("formPanelTitle");
const profileNameInput = document.getElementById("profileName");
const baseUrlInput = document.getElementById("baseUrl");
const modelNameInput = document.getElementById("modelName");
const apiKeyInput = document.getElementById("apiKey");
const toggleBtn = document.getElementById("toggleVisibility");
const saveBtn = document.getElementById("saveBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editingIdInput = document.getElementById("editingId");
const statusEl = document.getElementById("status");

// ── DOM refs — Presets ──
const presetListEl = document.getElementById("presetList");
const presetLabelInput = document.getElementById("presetLabel");
const presetPromptInput = document.getElementById("presetPrompt");
const presetSaveBtn = document.getElementById("presetSaveBtn");
const presetCancelBtn = document.getElementById("presetCancelBtn");
const presetResetBtn = document.getElementById("presetResetBtn");
const presetEditingIdInput = document.getElementById("presetEditingId");
const presetStatusEl = document.getElementById("presetStatus");

// ── Preset quick-fill configs ──
const PROVIDER_PRESETS = {
  claude: { name: "Claude", baseUrl: "https://api.anthropic.com/v1", modelName: "claude-opus-4-6" },
  openai: { name: "OpenAI GPT-4o", baseUrl: "https://api.openai.com/v1", modelName: "gpt-4o" },
  ollama: { name: "Ollama (local)", baseUrl: "http://localhost:11434/v1", modelName: "llama3" }
};

// Default prompt presets — keep in sync with background/PresetStore.js
const DEFAULT_PRESETS = [
  { id: "preset-summarize", label: "Summarize", prompt: "Summarize this page in 3 bullet points." },
  { id: "preset-keypoints", label: "Key Points", prompt: "What are the key takeaways from this page?" },
  { id: "preset-facts", label: "Extract Facts", prompt: "Extract all important facts and data from this page." },
  { id: "preset-nextsteps", label: "Next Steps", prompt: "What action should I take based on this page?" }
];

// ── State ──
let profiles = [];
let activeProfileId = null;
let presets = [];

// ── Init ──
async function init() {
  const data = await chrome.storage.local.get(["profiles", "activeProfileId", "presets"]);
  profiles = data.profiles || [];
  activeProfileId = data.activeProfileId || null;
  presets = data.presets || DEFAULT_PRESETS.map(p => ({ ...p }));
  renderProfiles();
  renderPresets();
  await loadChatHistory();
}

init();

// ── Profiles ─────────────────────────────────────────────────────────────────

function renderProfiles() {
  profileListEl.innerHTML = "";

  if (profiles.length === 0) {
    profileListEl.innerHTML = `
      <div class="empty-state">
        No profiles yet.<br />Use the form to add your first model profile.
      </div>`;
    return;
  }

  for (const profile of profiles) {
    const isActive = profile.id === activeProfileId;
    const card = document.createElement("div");
    card.className = `profile-card${isActive ? " active" : ""}`;
    card.innerHTML = `
      <div class="profile-card-header">
        <span class="profile-name">${escHtml(profile.name)}</span>
        ${isActive ? '<span class="active-badge">Active</span>' : ""}
      </div>
      <div class="profile-meta" title="${escHtml(profile.baseUrl)}">${escHtml(profile.modelName)} &middot; ${escHtml(shortUrl(profile.baseUrl))}</div>
      <div class="profile-actions">
        ${!isActive ? `<button class="btn-sm activate" data-id="${profile.id}">Set Active</button>` : ""}
        <button class="btn-sm" data-edit="${profile.id}">Edit</button>
        <button class="btn-sm danger" data-delete="${profile.id}">Delete</button>
      </div>
    `;
    profileListEl.appendChild(card);
  }

  profileListEl.querySelectorAll("[data-id]").forEach(btn => {
    btn.addEventListener("click", () => setActive(btn.dataset.id));
  });
  profileListEl.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => startEdit(btn.dataset.edit));
  });
  profileListEl.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteProfile(btn.dataset.delete));
  });
}

async function setActive(id) {
  activeProfileId = id;
  await chrome.storage.local.set({ activeProfileId });
  renderProfiles();
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
}

function startEdit(id) {
  const profile = profiles.find(p => p.id === id);
  if (!profile) return;
  editingIdInput.value = id;
  profileNameInput.value = profile.name;
  baseUrlInput.value = profile.baseUrl;
  modelNameInput.value = profile.modelName;
  apiKeyInput.value = profile.apiKey || "";
  apiKeyInput.type = "password";
  toggleBtn.textContent = "Show";
  formPanelTitle.textContent = "Edit Profile";
  saveBtn.textContent = "Save & Activate Profile";
  cancelEditBtn.style.display = "";
}

cancelEditBtn.addEventListener("click", () => clearForm());

function clearForm() {
  editingIdInput.value = "";
  profileNameInput.value = "";
  baseUrlInput.value = "";
  modelNameInput.value = "";
  apiKeyInput.value = "";
  apiKeyInput.type = "password";
  toggleBtn.textContent = "Show";
  formPanelTitle.textContent = "Add Profile";
  saveBtn.textContent = "Save & Activate Profile";
  cancelEditBtn.style.display = "none";
  statusEl.textContent = "";
  statusEl.className = "status";
}

async function deleteProfile(id) {
  profiles = profiles.filter(p => p.id !== id);
  if (activeProfileId === id) activeProfileId = profiles[0]?.id || null;
  await chrome.storage.local.set({ profiles, activeProfileId });
  renderProfiles();
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
  if (editingIdInput.value === id) clearForm();
}

saveBtn.addEventListener("click", async () => {
  const name = profileNameInput.value.trim();
  const baseUrl = baseUrlInput.value.trim().replace(/\/$/, "");
  const modelName = modelNameInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!name) { showStatus("Profile name is required.", "error"); return; }
  if (!baseUrl) { showStatus("Base URL is required.", "error"); return; }
  if (!modelName) { showStatus("Model name is required.", "error"); return; }

  const editingId = editingIdInput.value;
  if (editingId) {
    profiles = profiles.map(p => p.id === editingId ? { ...p, name, baseUrl, modelName, apiKey } : p);
    activeProfileId = editingId;
  } else {
    const newProfile = { id: crypto.randomUUID(), name, baseUrl, modelName, apiKey };
    profiles.push(newProfile);
    activeProfileId = newProfile.id;
  }

  await chrome.storage.local.set({ profiles, activeProfileId });
  renderProfiles();
  clearForm();
  showStatus("Profile saved and activated!", "success");
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
});

toggleBtn.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  toggleBtn.textContent = apiKeyInput.type === "password" ? "Show" : "Hide";
});

document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const preset = PROVIDER_PRESETS[btn.dataset.preset];
    if (!preset) return;
    profileNameInput.value = preset.name;
    baseUrlInput.value = preset.baseUrl;
    modelNameInput.value = preset.modelName;
    profileNameInput.focus();
  });
});

// ── Presets ───────────────────────────────────────────────────────────────────

function renderPresets() {
  presetListEl.innerHTML = "";

  if (presets.length === 0) {
    presetListEl.innerHTML = `<div class="empty-state">No presets. Add one using the form.</div>`;
    return;
  }

  presets.forEach((preset, idx) => {
    const row = document.createElement("div");
    row.className = "preset-row";
    row.innerHTML = `
      <div class="preset-row-info">
        <span class="preset-row-label">${escHtml(preset.label)}</span>
        <span class="preset-row-preview">${escHtml(preset.prompt.slice(0, 60))}${preset.prompt.length > 60 ? "…" : ""}</span>
      </div>
      <div class="preset-row-actions">
        <button class="btn-sm" data-up="${idx}" ${idx === 0 ? "disabled" : ""}>↑</button>
        <button class="btn-sm" data-down="${idx}" ${idx === presets.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn-sm" data-edit-preset="${idx}">Edit</button>
        <button class="btn-sm danger" data-del-preset="${idx}">Delete</button>
      </div>
    `;
    presetListEl.appendChild(row);
  });

  presetListEl.querySelectorAll("[data-up]").forEach(btn => {
    btn.addEventListener("click", () => movePreset(parseInt(btn.dataset.up), -1));
  });
  presetListEl.querySelectorAll("[data-down]").forEach(btn => {
    btn.addEventListener("click", () => movePreset(parseInt(btn.dataset.down), 1));
  });
  presetListEl.querySelectorAll("[data-edit-preset]").forEach(btn => {
    btn.addEventListener("click", () => startPresetEdit(parseInt(btn.dataset.editPreset)));
  });
  presetListEl.querySelectorAll("[data-del-preset]").forEach(btn => {
    btn.addEventListener("click", () => deletePreset(parseInt(btn.dataset.delPreset)));
  });
}

function startPresetEdit(idx) {
  const preset = presets[idx];
  if (!preset) return;
  presetEditingIdInput.value = String(idx);
  presetLabelInput.value = preset.label;
  presetPromptInput.value = preset.prompt;
  presetSaveBtn.textContent = "Save Preset";
  presetCancelBtn.style.display = "";
}

function clearPresetForm() {
  presetEditingIdInput.value = "";
  presetLabelInput.value = "";
  presetPromptInput.value = "";
  presetSaveBtn.textContent = "Add Preset";
  presetCancelBtn.style.display = "none";
  presetStatusEl.textContent = "";
  presetStatusEl.className = "status";
}

presetCancelBtn.addEventListener("click", clearPresetForm);

presetSaveBtn.addEventListener("click", async () => {
  const label = presetLabelInput.value.trim();
  const prompt = presetPromptInput.value.trim();
  if (!label) { showPresetStatus("Label is required.", "error"); return; }
  if (!prompt) { showPresetStatus("Prompt is required.", "error"); return; }

  const editIdx = presetEditingIdInput.value;
  if (editIdx !== "") {
    presets[parseInt(editIdx)] = { ...presets[parseInt(editIdx)], label, prompt };
  } else {
    presets.push({ id: crypto.randomUUID(), label, prompt });
  }

  await savePresets();
  renderPresets();
  clearPresetForm();
  showPresetStatus("Preset saved!", "success");
});

presetResetBtn.addEventListener("click", async () => {
  if (!confirm("Reset presets to defaults? This cannot be undone.")) return;
  presets = DEFAULT_PRESETS.map(p => ({ ...p }));
  await savePresets();
  renderPresets();
  clearPresetForm();
  showPresetStatus("Presets reset to defaults.", "success");
});

async function deletePreset(idx) {
  presets.splice(idx, 1);
  await savePresets();
  renderPresets();
  clearPresetForm();
}

async function movePreset(idx, direction) {
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= presets.length) return;
  [presets[idx], presets[newIdx]] = [presets[newIdx], presets[idx]];
  await savePresets();
  renderPresets();
}

async function savePresets() {
  await chrome.storage.local.set({ presets });
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  setTimeout(() => { statusEl.textContent = ""; statusEl.className = "status"; }, 3000);
}

function showPresetStatus(msg, type) {
  presetStatusEl.textContent = msg;
  presetStatusEl.className = `status ${type}`;
  setTimeout(() => { presetStatusEl.textContent = ""; presetStatusEl.className = "status"; }, 3000);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.port ? `:${u.port}` : "");
  } catch {
    return url;
  }
}

// ── Chat History ──────────────────────────────────────────────────────────────

const chatHistorySectionEl = document.getElementById("chatHistorySection");
const chatHistoryEmptyEl   = document.getElementById("chatHistoryEmpty");

async function loadChatHistory() {
  const data = await chrome.storage.local.get("chatGroups");
  const groups = data.chatGroups ?? {};
  renderChatHistory(groups);
}

function renderChatHistory(groups) {
  // Remove previously rendered group cards (keep the empty-state div)
  chatHistorySectionEl.querySelectorAll(".history-group").forEach(el => el.remove());

  const origins = Object.keys(groups);
  chatHistoryEmptyEl.style.display = origins.length === 0 ? "" : "none";

  for (const origin of origins) {
    const group = groups[origin];
    const records = group.records ?? [];
    const displayName = group.displayName || origin;

    const card = document.createElement("div");
    card.className = "history-group";

    card.innerHTML = `
      <div class="history-group-header">
        <span class="history-group-chevron">▶</span>
        <span class="history-group-name" title="${escHtml(origin)}">${escHtml(displayName)}</span>
        <span class="history-group-meta">${records.length} conversation${records.length !== 1 ? "s" : ""}</span>
        <div class="history-group-actions">
          <button class="btn-sm danger" data-delete-group="${escHtml(origin)}">Delete All</button>
        </div>
      </div>
      <div class="history-group-records">
        ${records.length === 0 ? '<div style="padding:10px 16px;font-size:12px;color:var(--text-muted)">No conversations.</div>' :
          records.map(rec => `
            <div class="history-rec-row">
              <span class="history-rec-title" title="${escHtml(rec.title)}">${escHtml(rec.title)}</span>
              <span class="history-rec-url" title="${escHtml(rec.pageUrl)}">${escHtml(shortUrl(rec.pageUrl))}</span>
              <span class="history-rec-date">${fmtDate(rec.updatedAt)}</span>
              <div class="history-group-actions">
                <button class="btn-sm danger" data-delete-record="${escHtml(origin)}" data-record-id="${escHtml(rec.id)}">Delete</button>
              </div>
            </div>
          `).join("")
        }
      </div>
    `;

    // Toggle collapse
    const header = card.querySelector(".history-group-header");
    const chevron = card.querySelector(".history-group-chevron");
    const recordsEl = card.querySelector(".history-group-records");
    header.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // don't toggle when clicking action buttons
      const isOpen = recordsEl.classList.contains("open");
      recordsEl.classList.toggle("open", !isOpen);
      chevron.classList.toggle("open", !isOpen);
    });

    // Delete group
    card.querySelector("[data-delete-group]")?.addEventListener("click", async () => {
      if (!confirm(`Delete all chat history for ${displayName}?`)) return;
      await deleteChatGroup(origin);
    });

    // Delete individual records
    card.querySelectorAll("[data-delete-record]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const recordId = btn.dataset.recordId;
        await deleteChatRecord(origin, recordId);
      });
    });

    chatHistorySectionEl.appendChild(card);
  }
}

async function deleteChatGroup(origin) {
  const data = await chrome.storage.local.get("chatGroups");
  const groups = data.chatGroups ?? {};
  delete groups[origin];
  await chrome.storage.local.set({ chatGroups: groups });
  renderChatHistory(groups);
}

async function deleteChatRecord(origin, recordId) {
  const data = await chrome.storage.local.get("chatGroups");
  const groups = data.chatGroups ?? {};
  if (!groups[origin]) return;
  groups[origin].records = (groups[origin].records ?? []).filter(r => r.id !== recordId);
  if (groups[origin].records.length === 0) {
    delete groups[origin];
  } else if (groups[origin].activeRecordId === recordId) {
    groups[origin].activeRecordId = groups[origin].records[groups[origin].records.length - 1]?.id ?? null;
  }
  await chrome.storage.local.set({ chatGroups: groups });
  renderChatHistory(groups);
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}
