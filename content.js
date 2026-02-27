// ── Anchor counter state (reset on each extraction) ─────────────────────────
let _tagCounters = {};

function resetCounters() { _tagCounters = {}; }

// Returns next sequential ID for a tag, e.g. nextId("p") → "p-1", "p-2", …
// N starts at 1; NodeList access uses index-1 (see ScrollController).
function nextId(tag) {
  _tagCounters[tag] = (_tagCounters[tag] || 0) + 1;
  return `${tag}-${_tagCounters[tag]}`;
}

// ── Noise detection ───────────────────────────────────────────────────────────

const NOISE_SELECTOR =
  "script, style, noscript, iframe, svg, canvas, " +
  "nav, header, footer, aside, " +
  "[role='banner'], [role='navigation'], [role='complementary'], [role='dialog'], " +
  "[aria-hidden='true'], " +
  ".ad, .ads, .advertisement, .cookie-banner, .popup, .modal, .sidebar";

function isNoise(el) {
  return el.matches?.(NOISE_SELECTOR) ?? false;
}

// ── PageExtractor ─────────────────────────────────────────────────────────────

function extractPageContent() {
  resetCounters();

  // Clear any stamps from a previous extraction
  document.querySelectorAll("[data-ai-anchor]").forEach(el => el.removeAttribute("data-ai-anchor"));

  // anchorMap is a plain object (NOT Map) so it JSON-serialises correctly.
  // Format: { "p-3": { tag: "p", index: 3, preview: "..." }, … }
  const anchorMap = {};

  // Pick best content root — work on the LIVE DOM so anchor stamps are queryable later
  const rootEl = document.querySelector("main, [role='main'], article") || document.body;
  console.log(`[AI Coworker] extractPageContent: root selector matched <${rootEl.tagName.toLowerCase()}>`);
  const root = rootEl; // live DOM — noise filtered per-element during traversal

  // Metadata header
  const meta = [`URL: ${window.location.href}`];
  const desc = document.querySelector('meta[name="description"]')?.content?.trim();
  if (desc) meta.push(`Description: ${desc}`);

  // Convert DOM → Markdown with anchor markers
  const bodyMarkdown = nodeToMarkdown(root, 0, anchorMap).trim();

  const output = `# ${document.title}\n${meta.join("\n")}\n\n---\n\n${bodyMarkdown}`;

  const anchorCount = Object.keys(anchorMap).length;
  console.log(`[AI Coworker] extractPageContent done: ${output.length} chars, ${anchorCount} anchors, url=${window.location.href}`);

  return { markdown: output, anchorMap, url: window.location.href, title: document.title };
}

// ── DOM → Markdown converter ──────────────────────────────────────────────────

function nodeToMarkdown(node, depth, anchorMap) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.replace(/\s+/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const tag = node.tagName.toLowerCase();

  // Skip noise subtrees (nav, header, footer, ads, etc.)
  if (isNoise(node)) return "";

  // Skip invisible elements
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return "";

  // Headings (h1–h6) — each gets an anchor ID stamped on the live element
  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1]);
    const text = node.textContent.trim();
    if (!text) return "";
    const anchorId = nextId(tag);
    node.dataset.aiAnchor = anchorId; // stamp live DOM for precise scroll targeting
    anchorMap[anchorId] = { tag, index: _tagCounters[tag], preview: text.slice(0, 60) };
    return `\n[§${anchorId}] ${"#".repeat(level)} ${text}\n`;
  }

  // Paragraphs — each gets an anchor ID stamped on the live element
  if (tag === "p") {
    const inner = childrenToMarkdown(node, depth, anchorMap);
    if (!inner.trim()) return "";
    const anchorId = nextId(tag);
    node.dataset.aiAnchor = anchorId;
    anchorMap[anchorId] = {
      tag,
      index: _tagCounters[tag],
      preview: inner.trim().replace(/\[§[^\]]+\]/g, "").slice(0, 60)
    };
    return `\n[§${anchorId}] ${inner.trim()}\n`;
  }

  // Block containers — no anchor, just recurse
  if (tag === "div" || tag === "section" || tag === "article") {
    const inner = childrenToMarkdown(node, depth, anchorMap);
    return inner.trim() ? `\n${inner.trim()}\n` : "";
  }

  // Unordered lists — each <li> gets an anchor stamped on the live element
  if (tag === "ul") {
    const lines = Array.from(node.children)
      .filter(el => el.tagName.toLowerCase() === "li")
      .map(li => {
        const text = childrenToMarkdown(li, depth + 1, anchorMap).trim();
        if (!text) return null;
        const anchorId = nextId("li");
        li.dataset.aiAnchor = anchorId;
        anchorMap[anchorId] = {
          tag: "li",
          index: _tagCounters["li"],
          preview: text.replace(/\[§[^\]]+\]/g, "").slice(0, 60)
        };
        return `${"  ".repeat(depth)}[§${anchorId}] - ${text}`;
      })
      .filter(Boolean);
    return lines.length ? "\n" + lines.join("\n") + "\n" : "";
  }

  // Ordered lists — each <li> gets an anchor stamped on the live element
  if (tag === "ol") {
    let ordinal = 0;
    const lines = Array.from(node.children)
      .filter(el => el.tagName.toLowerCase() === "li")
      .map(li => {
        const text = childrenToMarkdown(li, depth + 1, anchorMap).trim();
        if (!text) return null;
        ordinal++;
        const anchorId = nextId("li");
        li.dataset.aiAnchor = anchorId;
        anchorMap[anchorId] = {
          tag: "li",
          index: _tagCounters["li"],
          preview: text.replace(/\[§[^\]]+\]/g, "").slice(0, 60)
        };
        return `${"  ".repeat(depth)}[§${anchorId}] ${ordinal}. ${text}`;
      })
      .filter(Boolean);
    return lines.length ? "\n" + lines.join("\n") + "\n" : "";
  }

  // Tables
  if (tag === "table") return tableToMarkdown(node);

  // Inline formatting
  if (tag === "strong" || tag === "b") {
    const text = node.textContent.trim();
    return text ? `**${text}**` : "";
  }
  if (tag === "em" || tag === "i") {
    const text = node.textContent.trim();
    return text ? `*${text}*` : "";
  }
  if (tag === "code") {
    const text = node.textContent.trim();
    return text ? `\`${text}\`` : "";
  }
  if (tag === "pre") {
    const text = node.textContent.trim();
    return text ? `\n\`\`\`\n${text}\n\`\`\`\n` : "";
  }

  // Links
  if (tag === "a") {
    const text = node.textContent.trim();
    const href = node.getAttribute("href") || "";
    if (!text) return "";
    if (!href || href.startsWith("#") || href.startsWith("javascript")) return text;
    return `[${text}](${href})`;
  }

  if (tag === "br") return "\n";
  if (tag === "hr") return "\n---\n";

  if (tag === "blockquote") {
    const inner = childrenToMarkdown(node, depth, anchorMap).trim();
    return inner ? "\n" + inner.split("\n").map(l => `> ${l}`).join("\n") + "\n" : "";
  }

  return childrenToMarkdown(node, depth, anchorMap);
}

function childrenToMarkdown(node, depth, anchorMap) {
  return Array.from(node.childNodes)
    .map(child => nodeToMarkdown(child, depth, anchorMap))
    .join("");
}

function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return "";
  const parsed = rows
    .map(row => Array.from(row.querySelectorAll("th, td")).map(c => c.textContent.trim().replace(/\|/g, "\\|")))
    .filter(r => r.length > 0);
  if (!parsed.length) return "";

  const colCount = Math.max(...parsed.map(r => r.length));
  const pad = row => { while (row.length < colCount) row.push(""); return row; };
  const toRow = cols => `| ${cols.join(" | ")} |`;

  const header = pad(parsed[0]);
  const sep = header.map(() => "---");
  const body = parsed.slice(1).map(pad);
  return "\n" + [toRow(header), toRow(sep), ...body.map(toRow)].join("\n") + "\n";
}

// ── ScrollController ──────────────────────────────────────────────────────────

// Inject highlight style once into the page
(function injectHighlightStyle() {
  if (document.getElementById("ai-coworker-style")) return;
  const style = document.createElement("style");
  style.id = "ai-coworker-style";
  style.textContent = `
    .ai-coworker-highlight {
      outline: 2px solid #7c6aff !important;
      outline-offset: 3px !important;
      background: rgba(124, 106, 255, 0.12) !important;
      transition: outline 0.2s ease, background 0.2s ease !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
})();

function scrollToElement(anchorId) {
  // Find the exact element stamped during extraction — immune to DOM ordering differences
  const el = document.querySelector(`[data-ai-anchor="${anchorId}"]`);
  if (!el) {
    console.warn(`[AI Coworker] scrollToElement: no element found for anchor "${anchorId}"`);
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ai-coworker-highlight");
  setTimeout(() => el.classList.remove("ai-coworker-highlight"), 2000);
}

// ── NavigationWatcher (SPA route-change detection) ───────────────────────────

(function initNavigationWatcher() {
  let lastUrl = window.location.href;

  function notifyInvalidated() {
    console.log(`[AI Coworker] content.js CONTENT_INVALIDATED → ${window.location.href}`);
    chrome.runtime.sendMessage({ type: "CONTENT_INVALIDATED" }).catch(() => {});
  }

  // Intercept History API pushes (React Router, Vue Router, etc.)
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    origPushState(...args);
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      notifyInvalidated();
    }
  };

  history.replaceState = function (...args) {
    origReplaceState(...args);
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      notifyInvalidated();
    }
  };

  window.addEventListener("popstate", () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      notifyInvalidated();
    }
  });

  window.addEventListener("hashchange", () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      notifyInvalidated();
    }
  });
})();

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_CONTENT") {
    console.log("[AI Coworker] content.js received EXTRACT_CONTENT");
    sendResponse(extractPageContent());
    return false;
  }

  if (message.type === "SCROLL_TO_ELEMENT") {
    console.log(`[AI Coworker] content.js SCROLL_TO_ELEMENT anchorId=${message.anchorId}`);
    scrollToElement(message.anchorId);
    sendResponse({ ok: true });
    return false;
  }
});
