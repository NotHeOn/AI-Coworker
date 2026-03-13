// Context Editor — inspect and edit the assembled AI context for a pending request.
// Now supports slot-level editing via GET_SLOTS / SET_SLOT messages.

const params = new URLSearchParams(location.search);
const itemId = params.get("itemId");
const root   = document.getElementById("root");

async function main() {
  if (!itemId) { showError("No itemId provided."); return; }

  // Fetch both the assembled context and individual slots
  let data, slotsRes;
  try {
    [data, slotsRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_CONTEXT", itemId }),
      chrome.runtime.sendMessage({ type: "GET_SLOTS", itemId }),
    ]);
  } catch (e) {
    showError("Could not reach background: " + e.message);
    return;
  }

  if (data?.error) { showError(data.error); return; }

  const slots = slotsRes?.slots ?? [];
  render(data, slots);
}

// ── Render ──────────────────────────────────────────────────────────────────

function render(ctx, slots) {
  const meta = ctx._meta ?? {};
  root.innerHTML = "";

  // Header
  const hdr = el("div", "page-header");
  hdr.innerHTML = `
    <div class="page-header-icon">\u270F\uFE0F</div>
    <div>
      <div class="page-title">${esc(meta.title || "Pending request")}</div>
      <div class="page-url">${esc(meta.url || "\u2014")}</div>
    </div>`;
  root.appendChild(hdr);

  // Stats
  const stats = el("div", "stats");
  stats.innerHTML = `
    <span class="chip">Page content <span class="chip-val">${meta.hasContent ? "included" : "none"}</span></span>
    <span class="chip">Characters <span class="chip-val">${(meta.charCount || 0).toLocaleString()}</span></span>
    <span class="chip">Anchors <span class="chip-val">${meta.anchorCount || 0}</span></span>
    ${meta.selectedText ? `<span class="chip">Selected text <span class="chip-val">yes</span></span>` : ""}
  `;
  root.appendChild(stats);

  // Banner
  const banner = el("div", "banner");
  banner.id = "statusBanner";
  banner.textContent = "You can edit individual slots or the assembled message before it is sent. Changes apply only to this request.";
  root.appendChild(banner);

  // System prompt (read-only, collapsed)
  root.appendChild(makeCollapsibleSection("System Prompt", buildPre(ctx.systemPrompt), true));

  // Slot cards (if slots available)
  if (slots.length > 0) {
    root.appendChild(makeSlotsSection(slots));
  }

  // Editable assembled user message (fallback)
  const lastUserMsg = [...ctx.messages].reverse().find(m => m.role === "user");
  root.appendChild(makeEditableSection(lastUserMsg?.content ?? "", ctx));
}

// ── Collapsible read-only section ────────────────────────────────────────────

function makeCollapsibleSection(title, contentNode, startCollapsed) {
  const section = el("div", "section");

  const header = el("div", "section-header");
  const titleEl = el("span", "section-title");
  titleEl.textContent = title;
  const toggle = el("span", "section-toggle");
  toggle.textContent = startCollapsed ? "\u25B6 show" : "\u25BC hide";
  header.appendChild(titleEl);
  header.appendChild(toggle);
  section.appendChild(header);

  const body = el("div", "section-body");
  if (startCollapsed) body.classList.add("hidden");
  body.appendChild(contentNode);
  section.appendChild(body);

  header.addEventListener("click", () => {
    const hidden = body.classList.toggle("hidden");
    toggle.textContent = hidden ? "\u25B6 show" : "\u25BC hide";
  });

  return section;
}

// ── Slot cards section ──────────────────────────────────────────────────────

function makeSlotsSection(slots) {
  const section = el("div", "section");

  const header = el("div", "section-header");
  header.innerHTML = `<span class="section-title">Context Slots</span>
    <span class="section-toggle">\u25BC hide</span>`;
  section.appendChild(header);

  const body = el("div", "section-body slots-body");

  for (const slot of slots) {
    body.appendChild(makeSlotCard(slot));
  }

  section.appendChild(body);

  header.addEventListener("click", () => {
    const hidden = body.classList.toggle("hidden");
    header.querySelector(".section-toggle").textContent = hidden ? "\u25B6 show" : "\u25BC hide";
  });

  return section;
}

function makeSlotCard(slot) {
  const card = el("div", `slot-card${slot.enabled ? "" : " slot-disabled"}`);

  // Card header with toggle
  const cardHeader = el("div", "slot-card-header");

  const nameEl = el("span", "slot-name");
  nameEl.textContent = slot.name;

  const orderEl = el("span", "slot-order");
  orderEl.textContent = `order: ${slot.order}`;

  const toggleLabel = el("label", "slot-toggle");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.checked = slot.enabled;
  const toggleText = el("span");
  toggleText.textContent = slot.enabled ? "on" : "off";
  toggleLabel.appendChild(checkbox);
  toggleLabel.appendChild(toggleText);

  cardHeader.appendChild(nameEl);
  cardHeader.appendChild(orderEl);
  cardHeader.appendChild(toggleLabel);
  card.appendChild(cardHeader);

  // Content textarea
  const textarea = el("textarea", "slot-textarea");
  textarea.value = slot.content || "";
  textarea.placeholder = `(empty ${slot.name} slot)`;
  if (!slot.enabled) textarea.disabled = true;

  const resize = () => { textarea.style.height = "auto"; textarea.style.height = Math.max(60, textarea.scrollHeight) + "px"; };
  textarea.addEventListener("input", resize);
  card.appendChild(textarea);
  setTimeout(resize, 0);

  // Apply button for this slot
  const toolbar = el("div", "slot-toolbar");
  const applyBtn = el("button", "slot-apply-btn");
  applyBtn.textContent = "Apply slot";
  applyBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({
      type: "SET_SLOT",
      itemId,
      name: slot.name,
      content: textarea.value,
      enabled: checkbox.checked,
    });
    applyBtn.textContent = "Applied \u2713";
    setTimeout(() => { applyBtn.textContent = "Apply slot"; }, 1500);
    setBanner(true);
  });
  toolbar.appendChild(applyBtn);
  card.appendChild(toolbar);

  // Toggle handler
  checkbox.addEventListener("change", () => {
    const on = checkbox.checked;
    toggleText.textContent = on ? "on" : "off";
    card.classList.toggle("slot-disabled", !on);
    textarea.disabled = !on;
  });

  return card;
}

// ── Editable message section ─────────────────────────────────────────────────

function makeEditableSection(originalContent, ctx) {
  const section = el("div", "section");

  const header = el("div", "section-header");
  header.innerHTML = `<span class="section-title">Assembled Message to AI</span>
    <span class="section-toggle">\u25B6 show</span>`;
  section.appendChild(header);

  const body = el("div", "section-body hidden");

  const textarea = el("textarea", "edit-textarea");
  textarea.value = originalContent;
  const resize = () => { textarea.style.height = "auto"; textarea.style.height = textarea.scrollHeight + "px"; };
  textarea.addEventListener("input", () => { resize(); syncResetBtn(); });
  body.appendChild(textarea);

  // Action bar
  const toolbar = el("div", "toolbar");

  const resetBtn = el("button", "toolbar-btn");
  resetBtn.textContent = "Reset";
  resetBtn.title = "Revert to original";
  resetBtn.disabled = true;
  resetBtn.addEventListener("click", () => {
    textarea.value = originalContent;
    resize();
    syncResetBtn();
    chrome.runtime.sendMessage({ type: "CLEAR_FINAL_CONTEXT", itemId }).catch(() => {});
    setBanner(false);
  });

  const spacer = el("span", "toolbar-spacer");

  const applyBtn = el("button", "apply-btn");
  applyBtn.textContent = "Apply";
  applyBtn.title = "Save edits \u2014 this request will use your version";
  applyBtn.addEventListener("click", async () => {
    const newMessages = ctx.messages.map((m, i) =>
      (m.role === "user" && i === ctx.messages.length - 1)
        ? { ...m, content: textarea.value }
        : m
    );
    await chrome.runtime.sendMessage({
      type: "SET_FINAL_CONTEXT",
      itemId,
      systemPrompt: ctx.systemPrompt,
      messages: newMessages,
    });
    applyBtn.textContent = "Applied \u2713";
    setTimeout(() => { applyBtn.textContent = "Apply"; }, 1500);
    setBanner(true);
  });

  toolbar.appendChild(resetBtn);
  toolbar.appendChild(spacer);
  toolbar.appendChild(applyBtn);
  body.appendChild(toolbar);
  section.appendChild(body);

  setTimeout(resize, 0);

  function syncResetBtn() {
    resetBtn.disabled = textarea.value === originalContent;
  }

  header.addEventListener("click", () => {
    const hidden = body.classList.toggle("hidden");
    header.querySelector(".section-toggle").textContent = hidden ? "\u25B6 show" : "\u25BC hide";
  });

  return section;
}

function setBanner(applied) {
  const banner = document.getElementById("statusBanner");
  if (!banner) return;
  if (applied) {
    banner.className = "banner applied";
    banner.textContent = "Edits applied \u2014 this request will use your version.";
  } else {
    banner.className = "banner";
    banner.textContent = "You can edit individual slots or the assembled message before it is sent. Changes apply only to this request.";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildPre(text) {
  const pre = el("pre");
  pre.textContent = text;
  return pre;
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showError(msg) {
  root.innerHTML = `<div class="state-msg error">\u26A0 ${esc(msg)}</div>`;
}

main();
