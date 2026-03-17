import { ModelClientFactory } from "./ModelClientFactory.js";

const STREAM_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * StreamRunner — runs one AI stream request end-to-end.
 *
 * Get model → wait for content → assemble context → stream → broadcast results.
 * Called by RequestQueue._executeItem for each queue item.
 */
export class StreamRunner {
  constructor({ modelStore, contextSystem, historyStore }) {
    this._modelStore = modelStore;
    this._contextSystem = contextSystem;
    this._historyStore = historyStore;
  }

  /** Execute one queue item — called by RequestQueue._executeItem. */
  async run(item) {
    const { itemId, tabId, instruction, recordId, syncPage } = item;
    console.log(`[AI Coworker] ANALYZE start — tabId=${tabId ?? "none"}, itemId=${itemId}`);

    // 1. Model configuration
    const active = await this._modelStore.getActive();
    if (!active) {
      console.warn("[AI Coworker] ANALYZE aborted — no active profile");
      chrome.runtime.sendMessage({
        type: "STREAM_ERROR", tabId, itemId,
        error: "No profile configured. Please open Settings to add a model profile."
      }).catch(() => {});
      this._contextSystem.discard(itemId);
      this._historyStore.cancelSlot(itemId);
      if (item._contentPromise) item._contentPromise = null;
      return;
    }
    const { profile, provider, modelId } = active;
    console.log(`[AI Coworker] ANALYZE using profile "${profile.name}" (${provider.baseUrl}, model=${modelId})`);

    // 2. Wait for page content → feed into slot
    const content = await item._contentPromise;
    item._contentPromise = null;
    if (content?.markdown) {
      this._contextSystem.setSlot(itemId, "page_content", content.markdown);
    }

    // 3. Assemble context
    let context;
    try {
      this._contextSystem.assemble(itemId);
      context = this._contextSystem.getContext(itemId);
    } catch (e) {
      console.warn(`[AI Coworker] ANALYZE — context build failed: ${e.message}`);
      chrome.runtime.sendMessage({ type: "STREAM_ERROR", tabId, itemId, error: e.message }).catch(() => {});
      this._historyStore.cancelSlot(itemId);
      return;
    }

    const { systemPrompt, messages, _meta } = context;

    // Enrich _meta with content details if available
    if (_meta && content) {
      _meta.anchorCount = Object.keys(content.anchorMap || {}).length;
      _meta.url = content.url ?? "";
      _meta.title = content.title ?? "";
    }

    // Check if content was expected but unavailable
    const entry = this._contextSystem.getOriginal(itemId);
    const origMeta = entry?._meta;
    if (origMeta && !origMeta.hasContent && (syncPage || origMeta.instruction)) {
      const historyLen = messages.length - 1;
      if (syncPage || historyLen === 0) {
        const reason = content?.title === "Restricted page"
          ? "Restricted page"
          : "Could not read page — try reloading the tab";
        console.warn(`[AI Coworker] ANALYZE content unavailable: ${reason}`);
        chrome.runtime.sendMessage({ type: "CONTENT_UNAVAILABLE", tabId, reason }).catch(() => {});
      }
    }

    console.log(`[AI Coworker] ANALYZE sending ${messages.length} message(s) to API`);

    const abortController = item.abortController;

    // 2-minute hard timeout
    const timeoutId = setTimeout(() => {
      console.warn("[AI Coworker] ANALYZE timeout after 2 minutes");
      abortController.abort("timeout");
    }, STREAM_TIMEOUT_MS);

    const client = ModelClientFactory.create({ provider, modelId });
    let fullText = "";

    try {
      for await (const chunk of client.stream(systemPrompt, messages, abortController.signal)) {
        fullText += chunk;
        chrome.runtime.sendMessage({ type: "STREAM_CHUNK", tabId, itemId, chunk }).catch(() => {});
      }
    } catch (streamErr) {
      if (streamErr.name !== "AbortError" && !abortController.signal.aborted) {
        throw streamErr;
      }
    } finally {
      clearTimeout(timeoutId);
      this._contextSystem.discard(itemId);
    }

    if (abortController.signal.aborted) {
      const reason = abortController.signal.reason === "timeout" ? "timeout" : "user";
      console.log(`[AI Coworker] ANALYZE aborted (${reason}) — partial ${fullText.length} chars`);
      chrome.runtime.sendMessage({ type: "STREAM_ABORTED", tabId, itemId, reason, partialText: fullText }).catch(() => {});

      if (fullText && recordId) {
        this._historyStore.fillSlot(itemId, instruction, fullText);
      } else {
        this._historyStore.cancelSlot(itemId);
      }
    } else {
      console.log(`[AI Coworker] ANALYZE done — response ${fullText.length} chars`);
      chrome.runtime.sendMessage({ type: "STREAM_DONE", tabId, itemId, fullText }).catch(() => {});

      if (recordId) {
        this._historyStore.fillSlot(itemId, instruction, fullText);
      }
    }
  }
}
