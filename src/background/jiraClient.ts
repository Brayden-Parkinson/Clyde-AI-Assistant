/**
 * Thin Jira REST API client for Eng Stats.
 * Uses Basic Auth (email + API token) and the v3 search endpoint.
 */

import type { JiraTicket } from "@shared/types";

// ─── Jira API response shapes ───

interface JiraStatusCategory {
  key: string; // "new" | "indeterminate" | "done"
}

interface JiraStatus {
  name: string;
  statusCategory: JiraStatusCategory;
}

interface JiraIssueType {
  name: string;
}

interface JiraComponent {
  name: string;
}

interface JiraProject {
  key: string;
}

interface JiraIssueFields {
  summary: string;
  status: JiraStatus;
  issuetype: JiraIssueType;
  components: JiraComponent[];
  priority: { name: string } | null;
  project: JiraProject;
  parent?: { key: string } | null;
  created: string;
  updated: string;
  resolutiondate: string | null;
}

export interface JiraIssueResponse {
  key: string;
  fields: JiraIssueFields;
}

export interface JiraSearchResult {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssueResponse[];
}

// ─── Auth helper ───

function basicAuthHeader(email: string, token: string): string {
  return `Basic ${btoa(`${email}:${token}`)}`;
}

// ─── Search ───

/**
 * Search Jira issues using JQL with automatic pagination.
 * Returns all matching issues across pages.
 */
export async function searchJiraIssues(
  email: string,
  token: string,
  baseUrl: string,
  jql: string,
  onProgress?: (current: number, total: number) => void,
): Promise<JiraIssueResponse[]> {
  const allIssues: JiraIssueResponse[] = [];
  let nextPageToken: string | null = null;
  const maxResults = 100;
  const fields = "summary,status,issuetype,components,priority,project,parent,created,updated,resolutiondate";

  // Normalize baseUrl — remove trailing slash
  const base = baseUrl.replace(/\/+$/, "");

  while (true) {
    const params = new URLSearchParams({
      jql,
      maxResults: String(maxResults),
      fields,
    });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);

    const resp = await fetch(`${base}/rest/api/3/search/jql?${params}`, {
      headers: {
        Authorization: basicAuthHeader(email, token),
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Jira API ${resp.status}: ${text}`);
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const issues = (data.issues ?? []) as JiraIssueResponse[];
    allIssues.push(...issues);

    const isLast = data.isLast as boolean | undefined;
    onProgress?.(allIssues.length, allIssues.length);

    // Stop if this is the last page or no more results
    if (isLast !== false || issues.length === 0) break;

    nextPageToken = (data.nextPageToken as string) ?? null;
    if (!nextPageToken) break;
  }

  return allIssues;
}

// ─── Field mapping ───

/** Map raw Jira API issue to our JiraTicket shape (minus id and syncedAt) */
export function mapJiraFields(
  issue: JiraIssueResponse,
): Omit<JiraTicket, "id" | "syncedAt"> {
  const f = issue.fields;
  const catKey = f.status.statusCategory.key;

  return {
    key: issue.key,
    summary: f.summary,
    status: f.status.name,
    statusCategory:
      catKey === "done" ? "done" : catKey === "new" ? "todo" : "in_progress",
    issueType: f.issuetype.name,
    component: f.components.length > 0 ? f.components[0].name : null,
    priority: f.priority?.name ?? "Medium",
    epicKey: f.parent?.key ?? null,
    projectKey: f.project.key,
    createdAt: f.created,
    updatedAt: f.updated,
    resolvedAt: f.resolutiondate,
  };
}

// ─── Connection test ───

/** Test Jira connection by fetching /myself. Returns display name on success. */
export async function testJiraConnection(
  email: string,
  token: string,
  baseUrl: string,
): Promise<string> {
  const base = baseUrl.replace(/\/+$/, "");
  const resp = await fetch(`${base}/rest/api/3/myself`, {
    headers: {
      Authorization: basicAuthHeader(email, token),
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status}: ${text}`);
  }

  const data = (await resp.json()) as { displayName: string };
  return data.displayName;
}
