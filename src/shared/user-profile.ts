export interface UserProfile {
  userName: string;
  userTitle: string;
  userCompany: string;
  timezone: string;
}

export const USER_PROFILE_DEFAULTS: UserProfile = {
  userName: "",
  userTitle: "",
  userCompany: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export async function getUserProfile(): Promise<UserProfile> {
  const result = await chrome.storage.local.get([
    "userName",
    "userTitle",
    "userCompany",
    "timezone",
  ]);
  return {
    userName: result.userName || USER_PROFILE_DEFAULTS.userName,
    userTitle: result.userTitle || USER_PROFILE_DEFAULTS.userTitle,
    userCompany: result.userCompany || USER_PROFILE_DEFAULTS.userCompany,
    timezone: result.timezone || USER_PROFILE_DEFAULTS.timezone,
  };
}
