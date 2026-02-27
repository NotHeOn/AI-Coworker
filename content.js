// Listen for content extraction requests from the background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_CONTENT") {
    sendResponse({ content: extractPageContent(), url: window.location.href, title: document.title });
  }
});

function extractPageContent() {
  // Remove elements that are not useful (scripts, styles, nav, ads, etc.)
  const cloned = document.body.cloneNode(true);

  const unwanted = cloned.querySelectorAll(
    "script, style, noscript, iframe, svg, canvas, " +
    "nav, header, footer, aside, [role='banner'], [role='navigation'], " +
    "[role='complementary'], [aria-hidden='true'], .ad, .ads, .advertisement"
  );
  unwanted.forEach((el) => el.remove());

  // Extract text content
  let text = cloned.innerText || cloned.textContent || "";

  // Normalize whitespace: collapse multiple blank lines and trim
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n")
    .trim();

  // Cap at ~15,000 characters to avoid excessive token usage
  const MAX_CHARS = 15000;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n\n[Content truncated — page is very long]";
  }

  return text;
}
