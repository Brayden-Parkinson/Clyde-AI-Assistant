/**
 * Email ↔ GitHub username mapping utilities.
 *
 * Reads from chrome.storage.local key "emailToGithub" which is a
 * Record<string, string> mapping email addresses to GitHub logins.
 * Users configure this in Settings.
 */

/**
 * Build a map from Jira email → GitHub login.
 * Returns an empty map if no mapping is configured.
 */
export async function buildEmailToGithubMap(): Promise<Map<string, string>> {
  const result = await chrome.storage.local.get("emailToGithub");
  const raw = result.emailToGithub as Record<string, string> | undefined;
  if (!raw) return new Map();
  return new Map(Object.entries(raw));
}

/**
 * Build the reverse map: GitHub login → Jira email.
 * Returns an empty map if no mapping is configured.
 */
export async function buildGithubToEmailMap(): Promise<Map<string, string>> {
  const forward = await buildEmailToGithubMap();
  const reverse = new Map<string, string>();
  for (const [email, github] of forward) {
    reverse.set(github, email);
  }
  return reverse;
}
