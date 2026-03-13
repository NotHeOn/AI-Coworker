// Default preset prompts shown in the welcome screen.
// Keep in sync with the inline copy in settings.js.
export const DEFAULT_PRESETS = [
  {
    id: "preset-summarize",
    label: "Summarize",
    prompt: "Summarize this page in 3 bullet points."
  },
  {
    id: "preset-keypoints",
    label: "Key Points",
    prompt: "What are the key takeaways from this page?"
  },
  {
    id: "preset-facts",
    label: "Extract Facts",
    prompt: "Extract all important facts and data from this page."
  },
  {
    id: "preset-nextsteps",
    label: "Next Steps",
    prompt: "What action should I take based on this page?"
  }
];

export class PresetStore {
  /** Returns custom presets from storage, or DEFAULT_PRESETS if none saved (no write-on-read) */
  async getAll() {
    const { presets } = await chrome.storage.local.get("presets");
    return presets || DEFAULT_PRESETS;
  }

  async save(presets) {
    await chrome.storage.local.set({ presets });
  }

  async reset() {
    await chrome.storage.local.remove("presets");
    return DEFAULT_PRESETS;
  }
}
