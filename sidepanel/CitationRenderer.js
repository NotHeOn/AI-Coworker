/**
 * CitationRenderer
 *
 * Converts model output containing [§tag-N] anchor refs into HTML with
 * clickable <cite> chips, while safely passing the rest through marked.
 *
 * Strategy:
 *  1. Replace [§tag-N] with opaque placeholders that marked won't touch.
 *  2. Run marked.parse on the placeholder-substituted text.
 *  3. Replace placeholders in the HTML output with <cite> chip elements.
 *
 * This avoids marked interpreting brackets as link syntax.
 */
export class CitationRenderer {
  /**
   * Parse rawText and return HTML with citation chips embedded.
   * @param {string} rawText - Model output (may contain [§p-3] style refs)
   * @param {number} tabId   - Tab the citations belong to
   */
  parse(rawText, tabId) {
    const citations = []; // { anchorId }[]

    // Step 1: Replace [§tag-N] with placeholders that look like identifiers
    // "QQCITE0QQ" is unlikely to appear naturally and survives marked.parse()
    const withPlaceholders = rawText.replace(/\[§([a-z][a-z0-9]*-\d+)\]/g, (_, anchorId) => {
      const idx = citations.length;
      citations.push({ anchorId });
      return `QQCITE${idx}QQ`;
    });

    // Step 2: Render markdown (placeholders pass through as plain text)
    let html;
    if (typeof window.marked !== "undefined") {
      html = window.marked.parse(withPlaceholders);
    } else {
      // Fallback: basic HTML escape + newline preservation
      html = withPlaceholders
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
    }

    // Step 3: Replace placeholders with <cite> chip elements
    if (citations.length > 0) {
      html = html.replace(/QQCITE(\d+)QQ/g, (_, idxStr) => {
        const { anchorId } = citations[parseInt(idxStr, 10)];
        return `<cite class="citation-chip" data-anchor="${anchorId}" data-tab="${tabId}" title="Jump to §${anchorId}">[§${anchorId}]</cite>`;
      });
    }

    return html;
  }

  /**
   * Attach click handlers to all .citation-chip elements inside el.
   * Sends SCROLL_TO_ANCHOR to background when clicked.
   */
  bindClicks(el) {
    el.querySelectorAll("cite.citation-chip").forEach((cite) => {
      cite.addEventListener("click", () => {
        const anchorId = cite.dataset.anchor;
        const tabId = parseInt(cite.dataset.tab, 10);
        chrome.runtime.sendMessage({ type: "SCROLL_TO_ANCHOR", tabId, anchorId });
      });
    });
  }
}
