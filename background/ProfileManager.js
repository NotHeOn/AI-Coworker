export class ProfileManager {
  /** Returns the active profile object, or null if none */
  async getActive() {
    const { profiles, activeProfileId } = await chrome.storage.local.get(["profiles", "activeProfileId"]);
    return profiles?.find(p => p.id === activeProfileId) || null;
  }

  /** Returns all profiles and the active ID */
  async getAll() {
    const { profiles, activeProfileId } = await chrome.storage.local.get(["profiles", "activeProfileId"]);
    return { profiles: profiles || [], activeProfileId: activeProfileId || null };
  }

  async save(profiles, activeId) {
    await chrome.storage.local.set({ profiles, activeProfileId: activeId });
  }
}
