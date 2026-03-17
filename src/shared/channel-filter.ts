import type { ChannelIgnoreEntry } from "./types";

/** Returns true if the given channel name matches an ignore-list entry. */
export function isChannelIgnored(channel: string, ignoreList: ChannelIgnoreEntry[]): boolean {
  if (!channel || ignoreList.length === 0) return false;
  const name = channel.toLowerCase();
  return ignoreList.some((entry) => {
    if (entry.type === "exact") {
      return name === entry.value.toLowerCase();
    }
    // Pattern: support simple glob with leading/trailing *
    const pattern = entry.value.toLowerCase();
    if (pattern.startsWith("*") && pattern.endsWith("*")) {
      return name.includes(pattern.slice(1, -1));
    }
    if (pattern.startsWith("*")) {
      return name.endsWith(pattern.slice(1));
    }
    if (pattern.endsWith("*")) {
      return name.startsWith(pattern.slice(0, -1));
    }
    return name === pattern;
  });
}

/**
 * Migrates the channel filter from legacy format to the current ChannelIgnoreEntry[] format.
 * Legacy format was a plain string[]. Runs once on startup.
 */
export async function migrateChannelFilter(): Promise<void> {
  const result = await chrome.storage.local.get("slackChannelIgnoreList");
  const raw = result.slackChannelIgnoreList;
  if (!Array.isArray(raw) || raw.length === 0) return;

  // If already in new format, nothing to do
  if (raw[0] && typeof raw[0] === "object" && "type" in raw[0]) return;

  // Legacy: plain string array → convert to ChannelIgnoreEntry[]
  const migrated: ChannelIgnoreEntry[] = (raw as string[]).map((value) => ({
    type: "exact",
    value,
  }));
  await chrome.storage.local.set({ slackChannelIgnoreList: migrated });
}
