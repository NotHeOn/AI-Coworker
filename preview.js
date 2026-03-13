// Standalone preview page — shows the raw page content that would be sent to the AI.

const params  = new URLSearchParams(location.search);
const tabId   = parseInt(params.get("tabId"), 10) || null;
const root    = document.getElementById("root");

async function main() {
  let data;
  try {
    data = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT", tabId });
  } catch (e) {
    showError("Could not reach background: " + e.message);
    return;
  }

  if (data?.error) { showError(data.error); return; }

  render(data);
}

// ── Render ─────────────────────────────────────────────────────────────────

function render({ title, url, charCount, anchorCount, systemPrompt, markdown }) {
  const hasContent = !!markdown;

  root.innerHTML = "";

  // ── Page header ──────────────────────────────────────────────────────────
  const hdr = el("div", "page-header");
  hdr.innerHTML = `
    <div class="page-header-icon">📄</div>
    <div>
      <div class="page-title">${esc(title || "Untitled page")}</div>
      <div class="page-url">${esc(url || "—")}</div>
    </div>`;
  root.appendChild(hdr);

  // ── Stat chips ───────────────────────────────────────────────────────────
  const stats = el("div", "stats");
  stats.innerHTML = `
    <span class="chip">Content <span class="chip-val">${hasContent ? "available" : "unavailable"}</span></span>
    <span class="chip">Characters <span class="chip-val">${charCount.toLocaleString()}</span></span>
    <span class="chip">Anchor markers <span class="chip-val">${anchorCount}</span></span>`;
  root.appendChild(stats);

  // ── System prompt section ─────────────────────────────────────────────────
  root.appendChild(makeSection("System Prompt", buildSystemPromptContent(systemPrompt), true /* collapsed */));

  // ── Page content section ─────────────────────────────────────────────────
  if (hasContent) {
    root.appendChild(makeSection("Page Content sent to AI", buildContentView(markdown), false));
  } else {
    const sec = makeSection("Page Content", null, false);
    const body = sec.querySelector(".section-body");
    body.innerHTML = `<div class="state-msg" style="padding:20px 0">No content available for this page.</div>`;
    root.appendChild(sec);
  }
}

// ── Section factory ─────────────────────────────────────────────────────────

function makeSection(title, contentNode, startCollapsed) {
  const section = el("div", "section");

  const header = el("div", "section-header");
  const titleEl = el("span", "section-title");
  titleEl.textContent = title;
  const toggle = el("span", "section-toggle");
  toggle.textContent = startCollapsed ? "▶ show" : "▼ hide";
  header.appendChild(titleEl);
  header.appendChild(toggle);
  section.appendChild(header);

  const body = el("div", "section-body");
  if (startCollapsed) body.classList.add("hidden");
  if (contentNode) body.appendChild(contentNode);
  section.appendChild(body);

  header.addEventListener("click", () => {
    const hidden = body.classList.toggle("hidden");
    toggle.textContent = hidden ? "▶ show" : "▼ hide";
  });

  return section;
}

// ── System prompt view ──────────────────────────────────────────────────────

function buildSystemPromptContent(text) {
  const wrap = el("div");
  const pre = el("pre");
  pre.textContent = text;
  wrap.appendChild(pre);
  return wrap;
}

// ── Content view ─────────────────────────────────────────────────────────────

function buildContentView(markdown) {
  const wrap = el("div");

  // Toolbar: raw vs highlighted view toggle + copy button
  const toolbar = el("div", "toolbar");

  const rawBtn  = el("button", "toolbar-btn active");
  rawBtn.textContent  = "Raw";
  const hlBtn   = el("button", "toolbar-btn");
  hlBtn.textContent   = "Highlight anchors";

  const spacer = el("span", "toolbar-spacer");

  const copyBtn = el("button", "copy-btn");
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(markdown).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
    });
  });

  toolbar.appendChild(rawBtn);
  toolbar.appendChild(hlBtn);
  toolbar.appendChild(spacer);
  toolbar.appendChild(copyBtn);
  wrap.appendChild(toolbar);

  // Content pane
  const pane = el("pre");
  pane.textContent = markdown; // raw view default
  wrap.appendChild(pane);

  // Toggle logic
  rawBtn.addEventListener("click", () => {
    rawBtn.classList.add("active");
    hlBtn.classList.remove("active");
    pane.textContent = markdown;
  });
  hlBtn.addEventListener("click", () => {
    hlBtn.classList.add("active");
    rawBtn.classList.remove("active");
    pane.innerHTML = highlightAnchors(markdown);
  });

  return wrap;
}

// Replace [§tag-N] markers with styled spans for the "highlight" view
function highlightAnchors(text) {
  return esc(text).replace(
    /\[§([a-z][a-z0-9]*-\d+)\]/g,
    (_m, id) => `<span class="anchor-marker">[§${id}]</span>`
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  root.innerHTML = `<div class="state-msg error">⚠ ${esc(msg)}</div>`;
}

main();
