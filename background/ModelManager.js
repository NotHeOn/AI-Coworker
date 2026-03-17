export class ModelManager {
  async getAll() {
    const data = await chrome.storage.local.get(["profiles", "providers", "activeProfileId"]);
    return {
      profiles: data.profiles || [],
      providers: data.providers || [],
      activeProfileId: data.activeProfileId || null
    };
  }

  /**
   * Returns { profile, provider, modelId } for the active profile, or null.
   * Backward-compatible: if profile has a `baseUrl` field (legacy format),
   * a synthetic provider is constructed so no migration is needed.
   */
  async getActive() {
    const { profiles, providers, activeProfileId } = await this.getAll();
    const profile = profiles?.find(p => p.id === activeProfileId) || null;
    if (!profile) return null;

    // Legacy profile: flat {id, name, baseUrl, modelName, apiKey}
    if (profile.baseUrl) {
      const provider = {
        id: `_legacy_${profile.id}`,
        name: profile.name,
        type: profile.baseUrl.includes("anthropic.com") ? "anthropic" : "openai",
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey || ""
      };
      return { profile, provider, modelId: profile.modelName };
    }

    // New profile: {id, name, providerId, modelId}
    const provider = providers?.find(p => p.id === profile.providerId) || null;
    if (!provider) return null;
    return { profile, provider, modelId: profile.modelId };
  }

  async saveProfiles(profiles, activeId) {
    await chrome.storage.local.set({ profiles, activeProfileId: activeId });
  }
}
