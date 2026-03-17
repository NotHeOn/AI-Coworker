// ── State ──
let providers     = [];
let profiles      = [];
let activeProfileId = null;
let presets       = [];

// ── Preset quick-fill configs (provider) ──
const PROVIDER_PRESETS = {
  claude: { name: "Anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
  openai: { name: "OpenAI",    type: "openai",    baseUrl: "https://api.openai.com/v1"    },
  ollama: { name: "Ollama",    type: "openai",    baseUrl: "http://localhost:11434/v1"    }
};

// Default prompt presets — keep in sync with background/PresetStore.js
const DEFAULT_PRESETS = [
  { id: "preset-summarize", label: "Summarize",     prompt: "Summarize this page in 3 bullet points." },
  { id: "preset-keypoints", label: "Key Points",    prompt: "What are the key takeaways from this page?" },
  { id: "preset-facts",     label: "Extract Facts", prompt: "Extract all important facts and data from this page." },
  { id: "preset-nextsteps", label: "Next Steps",    prompt: "What action should I take based on this page?" }
];

// ── Init ──
async function init() {
  const data = await chrome.storage.local.get(["providers", "profiles", "activeProfileId", "presets"]);
  providers       = data.providers       || [];
  profiles        = data.profiles        || [];
  activeProfileId = data.activeProfileId || null;
  presets         = data.presets         || DEFAULT_PRESETS.map(p => ({ ...p }));

  renderProviders();
  renderProfiles();
  renderPresets();
  await loadChatHistory();
}

init();

// ══════════════════════════════════════════════════════════════════
// Providers
// ══════════════════════════════════════════════════════════════════

const providerListEl        = document.getElementById("providerList");
const providerFormTitleEl   = document.getElementById("providerFormTitle");
const providerNameInput     = document.getElementById("providerName");
const providerTypeSelect    = document.getElementById("providerType");
const providerBaseUrlInput  = document.getElementById("providerBaseUrl");
const providerApiKeyInput   = document.getElementById("providerApiKey");
const providerToggleBtn     = document.getElementById("providerToggleVisibility");
const providerSaveBtn       = document.getElementById("providerSaveBtn");
const providerCancelBtn     = document.getElementById("providerCancelBtn");
const providerEditingIdInput = document.getElementById("providerEditingId");
const providerStatusEl      = document.getElementById("providerStatus");

function renderProviders() {
  providerListEl.innerHTML = "";

  if (providers.length === 0) {
    providerListEl.innerHTML = `
      <div class="empty-state">
        No providers yet.<br />Use the form to add your first AI provider.
      </div>`;
    return;
  }

  for (const prov of providers) {
    const usedByCount = profiles.filter(p => p.providerId === prov.id).length;
    const card = document.createElement("div");
    card.className = "profile-card";
    card.innerHTML = `
      <div class="profile-card-header">
        <span class="profile-name">${escHtml(prov.name)}</span>
        <span class="type-badge type-${escHtml(prov.type)}">${escHtml(prov.type)}</span>
      </div>
      <div class="profile-meta" title="${escHtml(prov.baseUrl)}">${escHtml(shortUrl(prov.baseUrl))}</div>
      ${usedByCount > 0 ? `<div class="provider-usage">${usedByCount} profile${usedByCount !== 1 ? "s" : ""}</div>` : ""}
      <div class="profile-actions">
        <button class="btn-sm" data-edit-prov="${prov.id}">Edit</button>
        <button class="btn-sm danger" data-delete-prov="${prov.id}">Delete</button>
      </div>
    `;
    providerListEl.appendChild(card);
  }

  providerListEl.querySelectorAll("[data-edit-prov]").forEach(btn => {
    btn.addEventListener("click", () => startProviderEdit(btn.dataset.editProv));
  });
  providerListEl.querySelectorAll("[data-delete-prov]").forEach(btn => {
    btn.addEventListener("click", () => deleteProvider(btn.dataset.deleteProv));
  });
}

function startProviderEdit(id) {
  const prov = providers.find(p => p.id === id);
  if (!prov) return;
  providerEditingIdInput.value  = id;
  providerNameInput.value       = prov.name;
  providerTypeSelect.value      = prov.type;
  providerBaseUrlInput.value    = prov.baseUrl;
  providerApiKeyInput.value     = prov.apiKey || "";
  providerApiKeyInput.type      = "password";
  providerToggleBtn.textContent = "Show";
  providerFormTitleEl.textContent = "Edit Provider";
  providerSaveBtn.textContent   = "Save Provider";
  providerCancelBtn.style.display = "";
}

function clearProviderForm() {
  providerEditingIdInput.value  = "";
  providerNameInput.value       = "";
  providerTypeSelect.value      = "anthropic";
  providerBaseUrlInput.value    = "";
  providerApiKeyInput.value     = "";
  providerApiKeyInput.type      = "password";
  providerToggleBtn.textContent = "Show";
  providerFormTitleEl.textContent = "Add Provider";
  providerSaveBtn.textContent   = "Save Provider";
  providerCancelBtn.style.display = "none";
  providerStatusEl.textContent  = "";
  providerStatusEl.className    = "status";
}

providerCancelBtn.addEventListener("click", clearProviderForm);

providerToggleBtn.addEventListener("click", () => {
  providerApiKeyInput.type = providerApiKeyInput.type === "password" ? "text" : "password";
  providerToggleBtn.textContent = providerApiKeyInput.type === "password" ? "Show" : "Hide";
});

document.querySelectorAll(".provider-preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const preset = PROVIDER_PRESETS[btn.dataset.provPreset];
    if (!preset) return;
    providerNameInput.value    = preset.name;
    providerTypeSelect.value   = preset.type;
    providerBaseUrlInput.value = preset.baseUrl;
    providerNameInput.focus();
  });
});

providerSaveBtn.addEventListener("click", async () => {
  const name    = providerNameInput.value.trim();
  const type    = providerTypeSelect.value;
  const baseUrl = providerBaseUrlInput.value.trim().replace(/\/$/, "");
  const apiKey  = providerApiKeyInput.value.trim();

  if (!name)    { showProviderStatus("Provider name is required.", "error"); return; }
  if (!baseUrl) { showProviderStatus("Base URL is required.", "error"); return; }

  const editingId = providerEditingIdInput.value;
  if (editingId) {
    providers = providers.map(p => p.id === editingId ? { ...p, name, type, baseUrl, apiKey } : p);
  } else {
    providers.push({ id: crypto.randomUUID(), name, type, baseUrl, apiKey });
  }

  await chrome.storage.local.set({ providers });
  renderProviders();
  renderProfiles();   // refresh profile list (provider names may have changed)
  clearProviderForm();
  showProviderStatus("Provider saved!", "success");
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
});

async function deleteProvider(id) {
  const depCount = profiles.filter(p => p.providerId === id).length;
  if (depCount > 0) {
    if (!confirm(`${depCount} profile${depCount !== 1 ? "s" : ""} use this provider. Delete them too?`)) return;
    profiles = profiles.filter(p => p.providerId !== id);
    if (!profiles.find(p => p.id === activeProfileId)) {
      activeProfileId = profiles[0]?.id || null;
    }
    await chrome.storage.local.set({ profiles, activeProfileId });
  }
  providers = providers.filter(p => p.id !== id);
  await chrome.storage.local.set({ providers });
  renderProviders();
  renderProfiles();
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
  if (providerEditingIdInput.value === id) clearProviderForm();
}

function showProviderStatus(msg, type) {
  providerStatusEl.textContent = msg;
  providerStatusEl.className   = `status ${type}`;
  setTimeout(() => { providerStatusEl.textContent = ""; providerStatusEl.className = "status"; }, 3000);
}

// ══════════════════════════════════════════════════════════════════
// Profiles
// ══════════════════════════════════════════════════════════════════

const profileListEl         = document.getElementById("profileList");
const profileFormTitleEl    = document.getElementById("profileFormTitle");
const profileNameInput      = document.getElementById("profileName");
const profileProviderSel    = document.getElementById("profileProvider");
const profileModelInput     = document.getElementById("profileModelId");
const profileSaveBtn        = document.getElementById("profileSaveBtn");
const profileCancelBtn      = document.getElementById("profileCancelBtn");
const profileEditingIdInput = document.getElementById("profileEditingId");
const profileStatusEl       = document.getElementById("profileStatus");
const fetchModelsBtn        = document.getElementById("fetchModelsBtn");
const modelSuggestionsEl    = document.getElementById("modelSuggestions");
const fetchModelsHelperEl   = document.getElementById("fetchModelsHelper");

function renderProfiles() {
  profileListEl.innerHTML = "";

  // Populate provider dropdown
  profileProviderSel.innerHTML = `<option value="">— select a provider —</option>`;
  for (const prov of providers) {
    const opt = document.createElement("option");
    opt.value       = prov.id;
    opt.textContent = `${prov.name} (${prov.type})`;
    profileProviderSel.appendChild(opt);
  }

  if (profiles.length === 0) {
    profileListEl.innerHTML = `
      <div class="empty-state">
        No profiles yet.<br />Use the form to add your first model profile.
      </div>`;
    return;
  }

  for (const profile of profiles) {
    const isActive = profile.id === activeProfileId;
    const prov     = providers.find(p => p.id === profile.providerId);

    // Support legacy flat profiles in the list display
    const modelLabel    = profile.modelId || profile.modelName || "";
    const providerLabel = prov ? prov.name : (profile.baseUrl ? `${shortUrl(profile.baseUrl)} (legacy)` : "—");

    const card = document.createElement("div");
    card.className = `profile-card${isActive ? " active" : ""}`;
    card.innerHTML = `
      <div class="profile-card-header">
        <span class="profile-name">${escHtml(profile.name)}</span>
        ${isActive ? '<span class="active-badge">Active</span>' : ""}
      </div>
      <div class="profile-meta">${escHtml(modelLabel)} &middot; ${escHtml(providerLabel)}</div>
      <div class="profile-actions">
        ${!isActive ? `<button class="btn-sm activate" data-activate="${profile.id}">Set Active</button>` : ""}
        <button class="btn-sm" data-edit-profile="${profile.id}">Edit</button>
        <button class="btn-sm danger" data-delete-profile="${profile.id}">Delete</button>
      </div>
    `;
    profileListEl.appendChild(card);
  }

  profileListEl.querySelectorAll("[data-activate]").forEach(btn => {
    btn.addEventListener("click", () => setActiveProfile(btn.dataset.activate));
  });
  profileListEl.querySelectorAll("[data-edit-profile]").forEach(btn => {
    btn.addEventListener("click", () => startProfileEdit(btn.dataset.editProfile));
  });
  profileListEl.querySelectorAll("[data-delete-profile]").forEach(btn => {
    btn.addEventListener("click", () => deleteProfile(btn.dataset.deleteProfile));
  });
}

async function startProfileEdit(id) {
  const profile = profiles.find(p => p.id === id);
  if (!profile) return;
  profileEditingIdInput.value    = id;
  profileNameInput.value         = profile.name;
  profileProviderSel.value       = profile.providerId || "";
  profileModelInput.value        = profile.modelId || profile.modelName || "";
  profileFormTitleEl.textContent = "Edit Profile";
  profileSaveBtn.textContent     = "Save Profile";
  profileCancelBtn.style.display = "";

  // Enable Fetch button and pre-load cached models if available
  fetchModelsBtn.disabled = !profile.providerId;
  if (profile.providerId) {
    const data = await chrome.storage.local.get("providerModels");
    const cached = (data.providerModels || {})[profile.providerId] || [];
    populateModelSuggestions(cached);
  }
}

function clearProfileForm() {
  profileEditingIdInput.value    = "";
  profileNameInput.value         = "";
  profileProviderSel.value       = "";
  profileModelInput.value        = "";
  profileFormTitleEl.textContent = "Add Profile";
  profileSaveBtn.textContent     = "Save & Activate Profile";
  profileCancelBtn.style.display = "none";
  profileStatusEl.textContent    = "";
  profileStatusEl.className      = "status";
  fetchModelsBtn.disabled        = true;
  fetchModelsBtn.textContent     = "Fetch";
  modelSuggestionsEl.innerHTML   = "";
  fetchModelsHelperEl.textContent = "Select a provider, then click Fetch to load available models.";
}

profileCancelBtn.addEventListener("click", clearProfileForm);

// Enable/disable Fetch button when provider selection changes
profileProviderSel.addEventListener("change", () => {
  fetchModelsBtn.disabled = !profileProviderSel.value;
  modelSuggestionsEl.innerHTML = "";
  fetchModelsHelperEl.textContent = profileProviderSel.value
    ? "Click Fetch to load available models from this provider."
    : "Select a provider, then click Fetch to load available models.";
});

fetchModelsBtn.addEventListener("click", async () => {
  const providerId = profileProviderSel.value;
  if (!providerId) return;

  fetchModelsBtn.disabled = true;
  fetchModelsBtn.textContent = "…";
  fetchModelsHelperEl.textContent = "Fetching models…";
  modelSuggestionsEl.innerHTML = "";

  try {
    const res = await chrome.runtime.sendMessage({ type: "FETCH_MODELS", providerId });
    if (res?.error) throw new Error(res.error);

    const models = res?.models ?? [];
    populateModelSuggestions(models);
    fetchModelsHelperEl.textContent = models.length > 0
      ? `${models.length} model${models.length !== 1 ? "s" : ""} loaded — click the field to pick one.`
      : "No models returned by the API.";
  } catch (e) {
    fetchModelsHelperEl.textContent = `Fetch failed: ${e.message}`;
  } finally {
    fetchModelsBtn.disabled = false;
    fetchModelsBtn.textContent = "Fetch";
  }
});

profileSaveBtn.addEventListener("click", async () => {
  const name       = profileNameInput.value.trim();
  const providerId = profileProviderSel.value;
  const modelId    = profileModelInput.value.trim();

  if (!name)       { showProfileStatus("Profile name is required.", "error"); return; }
  if (!providerId) { showProfileStatus("Select a provider.", "error"); return; }
  if (!modelId)    { showProfileStatus("Model ID is required.", "error"); return; }

  const editingId = profileEditingIdInput.value;
  if (editingId) {
    profiles = profiles.map(p => p.id === editingId
      ? { id: p.id, name, providerId, modelId }
      : p);
    activeProfileId = editingId;
  } else {
    const newProfile = { id: crypto.randomUUID(), name, providerId, modelId };
    profiles.push(newProfile);
    activeProfileId = newProfile.id;
  }

  await chrome.storage.local.set({ profiles, activeProfileId });
  renderProfiles();
  clearProfileForm();
  showProfileStatus("Profile saved and activated!", "success");
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
});

async function setActiveProfile(id) {
  activeProfileId = id;
  await chrome.storage.local.set({ activeProfileId });
  renderProfiles();
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
}

async function deleteProfile(id) {
  profiles = profiles.filter(p => p.id !== id);
  if (activeProfileId === id) activeProfileId = profiles[0]?.id || null;
  await chrome.storage.local.set({ profiles, activeProfileId });
  renderProfiles();
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
  if (profileEditingIdInput.value === id) clearProfileForm();
}

function populateModelSuggestions(models) {
  modelSuggestionsEl.innerHTML = "";
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.modelId;
    opt.label = m.displayName || m.modelId;
    modelSuggestionsEl.appendChild(opt);
  }
}

function showProfileStatus(msg, type) {
  profileStatusEl.textContent = msg;
  profileStatusEl.className   = `status ${type}`;
  setTimeout(() => { profileStatusEl.textContent = ""; profileStatusEl.className = "status"; }, 3000);
}

// ══════════════════════════════════════════════════════════════════
// Presets
// ══════════════════════════════════════════════════════════════════

const presetListEl       = document.getElementById("presetList");
const presetLabelInput   = document.getElementById("presetLabel");
const presetPromptInput  = document.getElementById("presetPrompt");
const presetSaveBtn      = document.getElementById("presetSaveBtn");
const presetCancelBtn    = document.getElementById("presetCancelBtn");
const presetResetBtn     = document.getElementById("presetResetBtn");
const presetEditingIdInput = document.getElementById("presetEditingId");
const presetStatusEl     = document.getElementById("presetStatus");

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
  presetEditingIdInput.value   = String(idx);
  presetLabelInput.value       = preset.label;
  presetPromptInput.value      = preset.prompt;
  presetSaveBtn.textContent    = "Save Preset";
  presetCancelBtn.style.display = "";
}

function clearPresetForm() {
  presetEditingIdInput.value   = "";
  presetLabelInput.value       = "";
  presetPromptInput.value      = "";
  presetSaveBtn.textContent    = "Add Preset";
  presetCancelBtn.style.display = "none";
  presetStatusEl.textContent   = "";
  presetStatusEl.className     = "status";
}

presetCancelBtn.addEventListener("click", clearPresetForm);

presetSaveBtn.addEventListener("click", async () => {
  const label  = presetLabelInput.value.trim();
  const prompt = presetPromptInput.value.trim();
  if (!label)  { showPresetStatus("Label is required.", "error"); return; }
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

function showPresetStatus(msg, type) {
  presetStatusEl.textContent = msg;
  presetStatusEl.className   = `status ${type}`;
  setTimeout(() => { presetStatusEl.textContent = ""; presetStatusEl.className = "status"; }, 3000);
}

// ══════════════════════════════════════════════════════════════════
// Chat History
// ══════════════════════════════════════════════════════════════════

const chatHistorySectionEl = document.getElementById("chatHistorySection");
const chatHistoryEmptyEl   = document.getElementById("chatHistoryEmpty");

async function loadChatHistory() {
  const data   = await chrome.storage.local.get("chatGroups");
  const groups = data.chatGroups ?? {};
  renderChatHistory(groups);
}

function renderChatHistory(groups) {
  chatHistorySectionEl.querySelectorAll(".history-group").forEach(el => el.remove());

  const origins = Object.keys(groups);
  chatHistoryEmptyEl.style.display = origins.length === 0 ? "" : "none";

  for (const origin of origins) {
    const group      = groups[origin];
    const records    = group.records ?? [];
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
        ${records.length === 0
          ? '<div style="padding:10px 16px;font-size:12px;color:var(--text-muted)">No conversations.</div>'
          : records.map(rec => `
              <div class="history-rec-row">
                <span class="history-rec-title" title="${escHtml(rec.title)}">${escHtml(rec.title)}</span>
                <span class="history-rec-url" title="${escHtml(rec.pageUrl)}">${escHtml(shortUrl(rec.pageUrl))}</span>
                <span class="history-rec-date">${fmtDate(rec.updatedAt)}</span>
                <div class="history-group-actions">
                  <button class="btn-sm danger" data-delete-record="${escHtml(origin)}" data-record-id="${escHtml(rec.id)}">Delete</button>
                </div>
              </div>`).join("")
        }
      </div>
    `;

    const header    = card.querySelector(".history-group-header");
    const chevron   = card.querySelector(".history-group-chevron");
    const recordsEl = card.querySelector(".history-group-records");
    header.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const isOpen = recordsEl.classList.contains("open");
      recordsEl.classList.toggle("open", !isOpen);
      chevron.classList.toggle("open", !isOpen);
    });

    card.querySelector("[data-delete-group]")?.addEventListener("click", async () => {
      if (!confirm(`Delete all chat history for ${displayName}?`)) return;
      await deleteChatGroup(origin);
    });

    card.querySelectorAll("[data-delete-record]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await deleteChatRecord(origin, btn.dataset.recordId);
      });
    });

    chatHistorySectionEl.appendChild(card);
  }
}

async function deleteChatGroup(origin) {
  const data   = await chrome.storage.local.get("chatGroups");
  const groups = data.chatGroups ?? {};
  delete groups[origin];
  await chrome.storage.local.set({ chatGroups: groups });
  renderChatHistory(groups);
}

async function deleteChatRecord(origin, recordId) {
  const data   = await chrome.storage.local.get("chatGroups");
  const groups = data.chatGroups ?? {};
  if (!groups[origin]) return;
  groups[origin].records = (groups[origin].records ?? []).filter(r => r.id !== recordId);
  if (groups[origin].records.length === 0) {
    delete groups[origin];
  } else if (groups[origin].activeRecordId === recordId) {
    groups[origin].activeRecordId = groups[origin].records.at(-1)?.id ?? null;
  }
  await chrome.storage.local.set({ chatGroups: groups });
  renderChatHistory(groups);
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

function escHtml(str) {
  return String(str || "")
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
