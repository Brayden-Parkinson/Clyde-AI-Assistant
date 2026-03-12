import { GOOGLE_OAUTH } from "@shared/constants";
import type { GoogleAuthTokens } from "@shared/types";
import { db } from "@shared/db";
import { logStatus } from "@shared/status";

/**
 * Initiate Google OAuth2 flow via chrome.identity.launchWebAuthFlow.
 * Exchanges the auth code for tokens and stores them in chrome.storage.local.
 */
export async function initiateGoogleOAuth(): Promise<void> {
  const result = await chrome.storage.local.get("googleClientId");
  const clientId = result.googleClientId as string | undefined;
  if (!clientId) {
    throw new Error("Google Client ID not configured — set it in Settings first");
  }

  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;

  const authUrl = new URL(GOOGLE_OAUTH.AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_OAUTH.SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  await logStatus("info", "calendar", "Starting Google OAuth flow...");

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  if (!responseUrl) {
    throw new Error("OAuth flow was cancelled or returned no URL");
  }

  const url = new URL(responseUrl);
  const code = url.searchParams.get("code");
  if (!code) {
    const error = url.searchParams.get("error") ?? "unknown";
    throw new Error(`OAuth failed: ${error}`);
  }

  // Exchange auth code for tokens
  const tokenResponse = await fetch(GOOGLE_OAUTH.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${errorText.slice(0, 200)}`);
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  if (!tokenData.access_token) {
    throw new Error("Token response missing access_token");
  }

  const tokens: GoogleAuthTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? "",
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    scope: tokenData.scope,
  };

  await chrome.storage.local.set({ googleAuthTokens: tokens });
  await logStatus("success", "calendar", "Google Calendar connected successfully");
}

/**
 * Get a valid access token, refreshing if needed.
 * Returns the access token string or throws if not connected.
 */
export async function getValidAccessToken(): Promise<string> {
  const result = await chrome.storage.local.get(["googleAuthTokens", "googleClientId"]);
  const tokens = result.googleAuthTokens as GoogleAuthTokens | undefined;
  if (!tokens?.accessToken) {
    throw new Error("Google Calendar not connected");
  }

  // Check if token is still valid (with 60s buffer)
  if (tokens.expiresAt > Date.now() + 60_000) {
    return tokens.accessToken;
  }

  // Need to refresh
  if (!tokens.refreshToken) {
    throw new Error("No refresh token available — please reconnect Google Calendar");
  }

  const clientId = result.googleClientId as string | undefined;
  if (!clientId) {
    throw new Error("Google Client ID not configured");
  }

  await logStatus("info", "calendar", "Refreshing Google access token...");

  const refreshResponse = await fetch(GOOGLE_OAUTH.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: clientId,
      grant_type: "refresh_token",
    }),
  });

  if (!refreshResponse.ok) {
    const errorText = await refreshResponse.text();
    // If refresh fails with 400/401, tokens are revoked
    if (refreshResponse.status === 400 || refreshResponse.status === 401) {
      await chrome.storage.local.remove("googleAuthTokens");
      throw new Error("Google token expired — please reconnect in Settings");
    }
    throw new Error(`Token refresh failed (${refreshResponse.status}): ${errorText.slice(0, 200)}`);
  }

  const refreshData = await refreshResponse.json() as {
    access_token: string;
    expires_in: number;
    scope: string;
  };

  const updatedTokens: GoogleAuthTokens = {
    ...tokens,
    accessToken: refreshData.access_token,
    expiresAt: Date.now() + refreshData.expires_in * 1000,
    scope: refreshData.scope ?? tokens.scope,
  };

  await chrome.storage.local.set({ googleAuthTokens: updatedTokens });
  await logStatus("info", "calendar", "Access token refreshed");

  return updatedTokens.accessToken;
}

/**
 * Check if Google Calendar is connected (tokens exist and aren't permanently expired).
 */
export async function isGoogleConnected(): Promise<boolean> {
  const result = await chrome.storage.local.get("googleAuthTokens");
  const tokens = result.googleAuthTokens as GoogleAuthTokens | undefined;
  if (!tokens?.accessToken) return false;
  // If we have a refresh token, we can always refresh — consider connected
  if (tokens.refreshToken) return true;
  // No refresh token — only connected if access token hasn't expired
  return tokens.expiresAt > Date.now();
}

/**
 * Disconnect Google Calendar — remove tokens and clear cached events.
 */
export async function disconnectGoogle(): Promise<void> {
  await chrome.storage.local.remove("googleAuthTokens");
  await db.calendar_cache.clear();
  await logStatus("info", "calendar", "Google Calendar disconnected");
}
