/**
 * ContextSystem — slot-based context assembly for AI requests.
 *
 * Replaces ContextBuilder + SystemPromptBuilder. Pure assembler —
 * receives all data from the Controller, never fetches anything itself.
 *
 * Lifecycle per request:
 *   createEntry(itemId, { history })
 *   setSlot(itemId, name, content, opts?)   — called 0-N times
 *   assemble(itemId)                        — builds messages array
 *   getContext(itemId)                       — returns final ?? original
 *   setFinal / clearFinal                   — preview edits
 *   discard(itemId)                         — cleanup
 */
export class ContextSystem {
  constructor() {
    this._entries = new Map(); // itemId → Entry
  }

  // ── System prompt ──────────────────────────────────────────────────────────

  /**
   * Build the default system prompt.
   * Absorbs the old SystemPromptBuilder logic.
   */
  getDefaultSystemPrompt(hasPageContent) {
    let prompt = "You are a helpful AI coworker embedded in a Chrome extension. ";

    if (hasPageContent) {
      prompt += "The user is currently viewing a web page. You have access to the page content and will help analyze, summarize, or answer questions about it based on the user's instructions. ";
      prompt += "\n\nThe page content includes paragraph anchors in the format [§tag-N] (e.g. [§p-3], [§h2-1], [§li-5]). ";
      prompt += "When referencing a specific part of the page in your response, include the anchor tag exactly as it appears (e.g. [§p-3]) so the user can click to jump to that section. ";
      prompt += "Only cite anchors that genuinely appear in the provided content. Do not invent anchor IDs. ";
    } else {
      prompt += "The user does not have a readable web page loaded, or the page content could not be extracted. Answer based on your general knowledge. ";
    }

    prompt += "Be concise and helpful. Format your responses using markdown when appropriate.";
    return prompt;
  }

  // ── Entry lifecycle ────────────────────────────────────────────────────────

  /**
   * Create a new context entry for a queue item.
   * @param {string} itemId
   * @param {{ history: Array, systemPromptOverride?: string }} opts
   */
  createEntry(itemId, { history, systemPromptOverride } = {}) {
    this._entries.set(itemId, {
      history: history ?? [],
      systemPromptOverride: systemPromptOverride ?? null,
      slots: new Map(),
      original: null,
      final: null,
    });
  }

  // ── Slot management ────────────────────────────────────────────────────────

  /** Built-in slot defaults */
  static SLOT_DEFAULTS = {
    page_content:  { order: 10, wrapper: "Here is the current page content:\n\n---\n{content}\n---" },
    selected_text: { order: 20, wrapper: "\n\nSelected text from page:\n> {content}" },
    instruction:   { order: 30, wrapper: "\n\nMy instruction: {content}" },
  };

  /**
   * Set (or overwrite) a named slot.
   */
  setSlot(itemId, name, content, { order, wrapper, enabled } = {}) {
    const entry = this._entries.get(itemId);
    if (!entry) return;

    const defaults = ContextSystem.SLOT_DEFAULTS[name] ?? { order: 50, wrapper: null };
    entry.slots.set(name, {
      name,
      content,
      enabled: enabled ?? true,
      order: order ?? defaults.order,
      wrapper: wrapper !== undefined ? wrapper : defaults.wrapper,
    });
  }

  removeSlot(itemId, name) {
    const entry = this._entries.get(itemId);
    if (entry) entry.slots.delete(name);
  }

  toggleSlot(itemId, name, enabled) {
    const entry = this._entries.get(itemId);
    if (!entry) return;
    const slot = entry.slots.get(name);
    if (slot) slot.enabled = enabled;
  }

  getSlots(itemId) {
    const entry = this._entries.get(itemId);
    if (!entry) return [];
    return [...entry.slots.values()].sort((a, b) => a.order - b.order);
  }

  // ── Assembly ───────────────────────────────────────────────────────────────

  /**
   * Assemble slots into the final messages array. Stores the result in entry.original.
   * Returns the assembled context.
   */
  assemble(itemId) {
    const entry = this._entries.get(itemId);
    if (!entry) throw new Error(`ContextSystem: no entry for itemId=${itemId}`);

    const enabledSlots = [...entry.slots.values()]
      .filter(s => s.enabled && s.content)
      .sort((a, b) => a.order - b.order);

    // Build the user content string from slots
    let userContent;
    if (enabledSlots.length === 1 && enabledSlots[0].name === "instruction") {
      // Only instruction, no page content or selection — use plain text
      userContent = enabledSlots[0].content;
    } else {
      const parts = enabledSlots.map(slot => {
        if (slot.wrapper) {
          return slot.wrapper.replace("{content}", slot.content);
        }
        return slot.content;
      });
      userContent = parts.join("");
    }

    // Derive metadata from slot state
    const pageSlot = entry.slots.get("page_content");
    const hasContent = !!(pageSlot?.enabled && pageSlot?.content);

    // For follow-up messages, keep the "has content" system prompt even though
    // we're not re-sending the page — the model already has it from turn 1.
    const isFollowUp = entry.history.length > 0;
    const systemPrompt = entry.systemPromptOverride
      ?? this.getDefaultSystemPrompt(hasContent || isFollowUp);

    const messages = [...entry.history, { role: "user", content: userContent }];

    const instructionSlot = entry.slots.get("instruction");
    const selectedSlot = entry.slots.get("selected_text");

    const _meta = {
      hasContent,
      pageContent:  pageSlot?.content ?? null,
      selectedText: selectedSlot?.content ?? "",
      instruction:  instructionSlot?.content ?? "",
      charCount:    pageSlot?.content?.length ?? 0,
      anchorCount:  0, // filled by controller if needed
      url: "",
      title: "",
    };

    const result = { systemPrompt, messages, _meta };
    entry.original = result;
    return result;
  }

  // ── Context retrieval ──────────────────────────────────────────────────────

  /** Returns final context if user edited, otherwise the assembled original. */
  getContext(itemId) {
    const entry = this._entries.get(itemId);
    if (!entry) throw new Error(`ContextSystem: no entry for itemId=${itemId}`);
    return entry.final ?? entry.original;
  }

  /** Returns the auto-assembled original context (for preview). */
  getOriginal(itemId) {
    const entry = this._entries.get(itemId);
    if (!entry) return null;
    return entry.original;
  }

  // ── Preview edits ──────────────────────────────────────────────────────────

  setFinal(itemId, { systemPrompt, messages }) {
    const entry = this._entries.get(itemId);
    if (entry) entry.final = { systemPrompt, messages };
  }

  clearFinal(itemId) {
    const entry = this._entries.get(itemId);
    if (entry) entry.final = null;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  discard(itemId) {
    this._entries.delete(itemId);
  }
}
