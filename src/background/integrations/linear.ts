/**
 * integrations/linear.ts
 * Linear GraphQL API integration.
 *
 * Reads linearApiKey from chrome.storage.local — never logs it.
 * API endpoint: https://api.linear.app/graphql
 */

import { API_TIMEOUT_MS } from "@shared/constants";

const LINEAR_API_URL = "https://api.linear.app/graphql";

// ─── Types ───

export interface LinearTaskInput {
  title: string;
  description: string;
  teamId: string;
  priority: 0 | 1 | 2 | 3 | 4;
}

export interface LinearTaskResult {
  ok: boolean;
  issueId: string | null;
  issueUrl: string | null;
  issueIdentifier: string | null;
  error: string | null;
}

export interface LinearTeam {
  id: string;
  name: string;
}

export interface LinearConnectionResult {
  connected: boolean;
  workspaceName: string | null;
  error: string | null;
}

// ─── GraphQL Helper ───

async function linearQuery<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": apiKey,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Linear API HTTP error: ${response.status}`);
  }

  const data = await response.json() as { data?: T; errors?: Array<{ message: string }> };

  if (data.errors && data.errors.length > 0) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data) {
    throw new Error("Linear API returned no data");
  }

  return data.data;
}

// ─── Public API ───

/** Create a Linear issue from a commitment. */
export async function createLinearTask(input: LinearTaskInput): Promise<LinearTaskResult> {
  const stored = await chrome.storage.local.get(["linearApiKey", "linearTeamId"]);
  const apiKey = stored.linearApiKey as string | undefined;
  const defaultTeamId = stored.linearTeamId as string | undefined;
  const teamId = input.teamId || defaultTeamId;

  if (!apiKey) {
    return { ok: false, issueId: null, issueUrl: null, issueIdentifier: null, error: "Linear API key not configured — add it in Settings → Integrations" };
  }
  if (!teamId) {
    return { ok: false, issueId: null, issueUrl: null, issueIdentifier: null, error: "No Linear team selected — configure in Settings → Integrations" };
  }

  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          url
          identifier
        }
      }
    }
  `;

  try {
    const result = await linearQuery<{
      issueCreate: {
        success: boolean;
        issue: { id: string; url: string; identifier: string };
      };
    }>(apiKey, mutation, {
      input: {
        title: input.title,
        description: input.description,
        teamId,
        priority: input.priority,
      },
    });

    if (!result.issueCreate.success) {
      return { ok: false, issueId: null, issueUrl: null, issueIdentifier: null, error: "Linear issue creation returned success=false" };
    }

    const { id, url, identifier } = result.issueCreate.issue;
    return { ok: true, issueId: id, issueUrl: url, issueIdentifier: identifier, error: null };
  } catch (err) {
    return {
      ok: false, issueId: null, issueUrl: null, issueIdentifier: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Fetch available teams for the authenticated workspace. */
export async function getLinearTeams(): Promise<LinearTeam[]> {
  const stored = await chrome.storage.local.get("linearApiKey");
  const apiKey = stored.linearApiKey as string | undefined;
  if (!apiKey) return [];

  const query = `
    query {
      teams {
        nodes { id name }
      }
    }
  `;

  try {
    const result = await linearQuery<{ teams: { nodes: LinearTeam[] } }>(apiKey, query);
    return result.teams.nodes;
  } catch {
    return [];
  }
}

/** Check if the Linear API key is valid. */
export async function checkLinearConnection(): Promise<LinearConnectionResult> {
  const stored = await chrome.storage.local.get("linearApiKey");
  const apiKey = stored.linearApiKey as string | undefined;

  if (!apiKey) {
    return { connected: false, workspaceName: null, error: "No Linear API key configured" };
  }

  const query = `query { organization { name } }`;

  try {
    const result = await linearQuery<{ organization: { name: string } }>(apiKey, query);
    return { connected: true, workspaceName: result.organization.name, error: null };
  } catch (err) {
    return {
      connected: false, workspaceName: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
