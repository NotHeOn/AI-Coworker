export class ProviderStore {
  async getAll() {
    const { providers } = await chrome.storage.local.get("providers");
    return providers || [];
  }

  async save(providers) {
    await chrome.storage.local.set({ providers });
  }

  /**
   * Fetch the model list from a provider's API.
   * Returns [{ modelId, displayName }]
   */
  async fetchModels(provider) {
    const { type, baseUrl, apiKey } = provider;
    const headers = { "Content-Type": "application/json" };

    if (type === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}/models`, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const items = data.data || [];

    if (type === "anthropic") {
      return items.map(m => ({ modelId: m.id, displayName: m.display_name || m.id }));
    }
    return items.map(m => ({ modelId: m.id, displayName: m.id }));
  }

  async getCachedModels(providerId) {
    const { providerModels } = await chrome.storage.local.get("providerModels");
    return (providerModels || {})[providerId] || null;
  }

  async cacheModels(providerId, models) {
    const { providerModels } = await chrome.storage.local.get("providerModels");
    const updated = { ...(providerModels || {}), [providerId]: models };
    await chrome.storage.local.set({ providerModels: updated });
  }
}
