// ── DOM refs ──
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

// ── Preset configs ──
const PRESETS = {
  claude: {
    name: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    modelName: "claude-opus-4-6"
  },
  openai: {
    name: "OpenAI GPT-4o",
    baseUrl: "https://api.openai.com/v1",
    modelName: "gpt-4o"
  },
  ollama: {
    name: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    modelName: "llama3"
  }
};

// ── State ──
let profiles = [];
let activeProfileId = null;

// ── Init ──
async function init() {
  const data = await chrome.storage.local.get(["profiles", "activeProfileId"]);
  profiles = data.profiles || [];
  activeProfileId = data.activeProfileId || null;
  renderProfiles();
}

init();

// ── Render profiles list ──
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

  // Bind action buttons
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

// ── Set active ──
async function setActive(id) {
  activeProfileId = id;
  await chrome.storage.local.set({ activeProfileId });
  renderProfiles();
  chrome.runtime.sendMessage({ type: "PROFILE_UPDATED" }).catch(() => {});
}

// ── Start editing a profile ──
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

// ── Cancel edit ──
cancelEditBtn.addEventListener("click", () => {
  clearForm();
});

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

// ── Delete ──
async function deleteProfile(id) {
  profiles = profiles.filter(p => p.id !== id);
  if (activeProfileId === id) {
    activeProfileId = profiles[0]?.id || null;
  }
  await chrome.storage.local.set({ profiles, activeProfileId });
  renderProfiles();
  chrome.runtime.sendMessage({ type: "PROFILE_UPDATED" }).catch(() => {});

  // If we were editing this profile, clear the form
  if (editingIdInput.value === id) clearForm();
}

// ── Save (add or update) ──
saveBtn.addEventListener("click", async () => {
  const name = profileNameInput.value.trim();
  const baseUrl = baseUrlInput.value.trim().replace(/\/$/, ""); // strip trailing slash
  const modelName = modelNameInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!name) { showStatus("Profile name is required.", "error"); return; }
  if (!baseUrl) { showStatus("Base URL is required.", "error"); return; }
  if (!modelName) { showStatus("Model name is required.", "error"); return; }

  const editingId = editingIdInput.value;

  if (editingId) {
    // Update existing
    profiles = profiles.map(p =>
      p.id === editingId ? { ...p, name, baseUrl, modelName, apiKey } : p
    );
    activeProfileId = editingId;
  } else {
    // Add new
    const newProfile = {
      id: crypto.randomUUID(),
      name,
      baseUrl,
      modelName,
      apiKey
    };
    profiles.push(newProfile);
    activeProfileId = newProfile.id;
  }

  await chrome.storage.local.set({ profiles, activeProfileId });
  renderProfiles();
  clearForm();
  showStatus("Profile saved and activated!", "success");
  chrome.runtime.sendMessage({ type: "PROFILE_UPDATED" }).catch(() => {});
});

// ── Toggle API key visibility ──
toggleBtn.addEventListener("click", () => {
  if (apiKeyInput.type === "password") {
    apiKeyInput.type = "text";
    toggleBtn.textContent = "Hide";
  } else {
    apiKeyInput.type = "password";
    toggleBtn.textContent = "Show";
  }
});

// ── Preset quick-fill ──
document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    profileNameInput.value = preset.name;
    baseUrlInput.value = preset.baseUrl;
    modelNameInput.value = preset.modelName;
    // Don't overwrite apiKey — user fills that
    profileNameInput.focus();
  });
});

// ── Helpers ──
function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "status";
  }, 3000);
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
