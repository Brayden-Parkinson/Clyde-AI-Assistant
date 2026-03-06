/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

import React, { useState, useRef, useEffect, useCallback } from "react";
import { OS } from "@shared/tokens";
import { db } from "@shared/db";
import type { Commitment, Urgency, CommitmentDirection, CommitmentStatus } from "@shared/types";
import {
  CLAUDE_MODEL_FAST,
  API_TIMEOUT_MS,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
} from "@shared/constants";
import { computeHash } from "../../background/dedup";
import { IconMic, IconStop, IconChat, IconX, IconSend } from "./Icons";

// ─── Types ───

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: object;
}

// ─── Tool Definitions ───

const TOOLS: ToolDefinition[] = [
  {
    name: "create_commitment",
    description:
      "Create a new task/commitment. Use this whenever the user wants to add, create, or remember a task.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Brief actionable description of the task" },
        urgency: { type: "string", enum: ["high", "medium", "low"], description: "Urgency level. Default medium if unclear." },
        deadline: { type: "string", nullable: true, description: "ISO 8601 deadline if mentioned, null otherwise" },
        direction: { type: "string", enum: ["by_me", "assigned_to_me"], description: "Who owns this. Default by_me." },
        context: { type: "string", description: "Source context like channel name or 'chat'. Default 'chat'." },
        source_type: { type: "string", enum: ["voice", "slack", "meeting", "gdoc"], description: "How it was captured. Use 'voice' for dictated tasks." },
      },
      required: ["text"],
    },
  },
  {
    name: "search_commitments",
    description:
      "Search/query commitments by text, status, urgency, source, direction, context, or deadline range. Returns up to 15 matching items.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text substring to search for" },
        status: { type: "string", enum: ["new", "snoozed", "actioned", "done", "dismissed"] },
        urgency: { type: "string", enum: ["high", "medium", "low"] },
        source_type: { type: "string", enum: ["voice", "slack", "meeting", "gdoc"] },
        direction: { type: "string", enum: ["by_me", "assigned_to_me"] },
        context: { type: "string", description: "Channel or meeting name to filter by" },
        deadline_before: { type: "string", description: "ISO date — items due before this" },
        deadline_after: { type: "string", description: "ISO date — items due after this" },
      },
    },
  },
  {
    name: "update_commitment",
    description: "Update a single commitment by ID. Can change status, urgency, deadline, text, or direction.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Commitment ID" },
        status: { type: "string", enum: ["new", "snoozed", "actioned", "done", "dismissed"] },
        urgency: { type: "string", enum: ["high", "medium", "low"] },
        deadline: { type: "string", nullable: true },
        text: { type: "string" },
        direction: { type: "string", enum: ["by_me", "assigned_to_me"] },
      },
      required: ["id"],
    },
  },
  {
    name: "bulk_update",
    description:
      "Update multiple commitments matching filter criteria. Use for bulk status or urgency changes.",
    input_schema: {
      type: "object",
      properties: {
        filter_status: { type: "string", enum: ["new", "snoozed", "actioned", "done", "dismissed"] },
        filter_urgency: { type: "string", enum: ["high", "medium", "low"] },
        filter_source: { type: "string", enum: ["voice", "slack", "meeting", "gdoc"] },
        filter_context: { type: "string" },
        filter_query: { type: "string", description: "Text substring filter" },
        set_status: { type: "string", enum: ["new", "snoozed", "actioned", "done", "dismissed"] },
        set_urgency: { type: "string", enum: ["high", "medium", "low"] },
      },
    },
  },
  {
    name: "move_to_column",
    description:
      "Move a commitment to a kanban column. Maps: todo=new, in_progress=actioned, done=done. Also handles custom columns.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Commitment ID" },
        column: { type: "string", description: "Column name: 'todo', 'in_progress', 'done', or a custom column name" },
      },
      required: ["id", "column"],
    },
  },
  {
    name: "get_summary",
    description:
      "Get a summary of the user's commitments: counts by status, urgency breakdown, overdue count, items due today/this week.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "update_setting",
    description:
      "Change a chrome.storage.local setting. Keys: confidenceThreshold (number 0-1), slackScanFrequencyMin (number), morningDigestHour (number 0-23).",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Setting key name" },
        value: { type: ["string", "number", "boolean"], description: "New value" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "create_columns",
    description:
      "Create one or more new kanban columns. Use this when the user agrees to organize their board with new columns.",
    input_schema: {
      type: "object",
      properties: {
        columns: {
          type: "array",
          items: { type: "string" },
          description: "Array of column labels to create, e.g. ['This Week', 'Blocked', 'Waiting On']",
        },
      },
      required: ["columns"],
    },
  },
];

// ─── Tool Executors ───

async function executeCreateCommitment(input: {
  text: string;
  urgency?: Urgency;
  deadline?: string | null;
  direction?: CommitmentDirection;
  context?: string;
  source_type?: "voice" | "slack" | "meeting" | "gdoc";
}): Promise<string> {
  const now = new Date().toISOString();
  const sourceType = input.source_type ?? "voice";
  const context = input.context ?? "chat";
  const hash = await computeHash(input.text, sourceType, context);

  await db.commitments.add({
    hash,
    text: input.text,
    original_quote: input.text,
    deadline: input.deadline ?? null,
    urgency: input.urgency ?? "medium",
    context,
    source_type: sourceType,
    confidence: 1.0,
    status: "new",
    direction: input.direction ?? "by_me",
    likely_completed: false,
    completion_signal: null,
    message_timestamp: now,
    snooze_until: null,
    context_summary: null,
    conversation_messages: [],
    slack_link: null,
    triggered: false,
    sensitive: false,
    createdAt: now,
  });

  return JSON.stringify({ success: true, text: input.text, urgency: input.urgency ?? "medium" });
}

async function executeSearchCommitments(input: {
  query?: string;
  status?: CommitmentStatus;
  urgency?: Urgency;
  source_type?: string;
  direction?: CommitmentDirection;
  context?: string;
  deadline_before?: string;
  deadline_after?: string;
}): Promise<string> {
  let results: Commitment[];

  if (input.status) {
    results = await db.commitments.where("status").equals(input.status).toArray();
  } else {
    results = await db.commitments
      .where("status")
      .anyOf("new", "snoozed", "actioned")
      .toArray();
  }

  if (input.urgency) results = results.filter((c) => c.urgency === input.urgency);
  if (input.source_type) results = results.filter((c) => c.source_type === input.source_type);
  if (input.direction) results = results.filter((c) => c.direction === input.direction);
  if (input.context) {
    const ctx = input.context.toLowerCase().replace(/^#/, "");
    results = results.filter((c) => c.context.toLowerCase().replace(/^#/, "").includes(ctx));
  }
  if (input.query) {
    const q = input.query.toLowerCase();
    results = results.filter((c) => c.text.toLowerCase().includes(q) || c.original_quote.toLowerCase().includes(q));
  }
  if (input.deadline_before) {
    results = results.filter((c) => c.deadline && c.deadline <= input.deadline_before!);
  }
  if (input.deadline_after) {
    results = results.filter((c) => c.deadline && c.deadline >= input.deadline_after!);
  }

  const capped = results.slice(0, 15);
  return JSON.stringify(
    capped.map((c) => ({
      id: c.id,
      text: c.text,
      status: c.status,
      urgency: c.urgency,
      context: c.context,
      deadline: c.deadline,
      direction: c.direction,
      source_type: c.source_type,
    })),
  );
}

async function executeUpdateCommitment(input: {
  id: number;
  status?: CommitmentStatus;
  urgency?: Urgency;
  deadline?: string | null;
  text?: string;
  direction?: CommitmentDirection;
}): Promise<string> {
  const existing = await db.commitments.get(input.id);
  if (!existing) return JSON.stringify({ error: "Commitment not found" });

  const updates: Partial<Commitment> = {};
  if (input.status) updates.status = input.status;
  if (input.urgency) updates.urgency = input.urgency;
  if (input.deadline !== undefined) updates.deadline = input.deadline;
  if (input.text) updates.text = input.text;
  if (input.direction) updates.direction = input.direction;

  await db.commitments.update(input.id, updates);

  // Log action for status changes
  if (input.status) {
    const actionMap: Record<string, string> = {
      done: "done",
      dismissed: "dismissed",
      actioned: "started",
    };
    const action = actionMap[input.status];
    if (action) {
      await db.action_log.add({
        commitmentId: input.id,
        action: action as "done" | "dismissed" | "started",
        createdAt: new Date().toISOString(),
      });
    }
  }

  return JSON.stringify({ success: true, id: input.id, updated: Object.keys(updates) });
}

async function executeBulkUpdate(input: {
  filter_status?: CommitmentStatus;
  filter_urgency?: Urgency;
  filter_source?: string;
  filter_context?: string;
  filter_query?: string;
  set_status?: CommitmentStatus;
  set_urgency?: Urgency;
}): Promise<string> {
  let items: Commitment[];

  if (input.filter_status) {
    items = await db.commitments.where("status").equals(input.filter_status).toArray();
  } else {
    items = await db.commitments.where("status").anyOf("new", "snoozed", "actioned").toArray();
  }

  if (input.filter_urgency) items = items.filter((c) => c.urgency === input.filter_urgency);
  if (input.filter_source) items = items.filter((c) => c.source_type === input.filter_source);
  if (input.filter_context) {
    const ctx = input.filter_context.toLowerCase().replace(/^#/, "");
    items = items.filter((c) => c.context.toLowerCase().replace(/^#/, "").includes(ctx));
  }
  if (input.filter_query) {
    const q = input.filter_query.toLowerCase();
    items = items.filter((c) => c.text.toLowerCase().includes(q));
  }

  const updates: Partial<Commitment> = {};
  if (input.set_status) updates.status = input.set_status;
  if (input.set_urgency) updates.urgency = input.set_urgency;

  const now = new Date().toISOString();
  for (const item of items) {
    if (item.id != null) {
      await db.commitments.update(item.id, updates);
      if (input.set_status) {
        const actionMap: Record<string, string> = { done: "done", dismissed: "dismissed", actioned: "started" };
        const action = actionMap[input.set_status];
        if (action) {
          await db.action_log.add({
            commitmentId: item.id,
            action: action as "done" | "dismissed" | "started",
            createdAt: now,
          });
        }
      }
    }
  }

  return JSON.stringify({ success: true, count: items.length, updated: Object.keys(updates) });
}

async function executeMoveToColumn(input: { id: number; column: string }): Promise<string> {
  const existing = await db.commitments.get(input.id);
  if (!existing) return JSON.stringify({ error: "Commitment not found" });

  const columnMap: Record<string, CommitmentStatus> = {
    todo: "new",
    in_progress: "actioned",
    done: "done",
  };

  const normalizedCol = input.column.toLowerCase().replace(/\s+/g, "_");
  const statusVal = columnMap[normalizedCol];

  if (statusVal) {
    await db.commitments.update(input.id, { status: statusVal });
    const actionMap: Record<string, string> = { done: "done", actioned: "started" };
    const action = actionMap[statusVal];
    if (action) {
      await db.action_log.add({
        commitmentId: input.id,
        action: action as "done" | "started",
        createdAt: new Date().toISOString(),
      });
    }
  } else {
    // Custom column — look it up
    const columns = await db.kanban_columns.toArray();
    const match = columns.find(
      (col) => col.label.toLowerCase().replace(/\s+/g, "_") === normalizedCol || col.id === input.column,
    );
    if (match) {
      await db.kanban_assignments.put({ commitment_id: input.id, column_id: match.id });
    } else {
      return JSON.stringify({ error: `Unknown column: ${input.column}` });
    }
  }

  return JSON.stringify({ success: true, id: input.id, column: input.column });
}

async function executeGetSummary(): Promise<string> {
  const all = await db.commitments.toArray();
  const active = all.filter((c) => ["new", "snoozed", "actioned"].includes(c.status));
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const overdue = active.filter((c) => c.deadline && c.deadline < now.toISOString());
  const dueToday = active.filter((c) => c.deadline && c.deadline <= todayEnd && c.deadline >= now.toISOString());
  const dueThisWeek = active.filter((c) => c.deadline && c.deadline <= weekEnd && c.deadline >= now.toISOString());

  return JSON.stringify({
    total_active: active.length,
    by_status: {
      new: all.filter((c) => c.status === "new").length,
      actioned: all.filter((c) => c.status === "actioned").length,
      snoozed: all.filter((c) => c.status === "snoozed").length,
      done: all.filter((c) => c.status === "done").length,
      dismissed: all.filter((c) => c.status === "dismissed").length,
    },
    by_urgency: {
      high: active.filter((c) => c.urgency === "high").length,
      medium: active.filter((c) => c.urgency === "medium").length,
      low: active.filter((c) => c.urgency === "low").length,
    },
    overdue: overdue.length,
    due_today: dueToday.length,
    due_this_week: dueThisWeek.length,
  });
}

async function executeUpdateSetting(input: { key: string; value: string | number | boolean }): Promise<string> {
  await chrome.storage.local.set({ [input.key]: input.value });
  return JSON.stringify({ success: true, key: input.key, value: input.value });
}

async function executeCreateColumns(input: { columns: string[] }): Promise<string> {
  const existing = await db.kanban_columns.toArray();
  const maxPos = existing.length > 0 ? Math.max(...existing.map((c) => c.position)) : 0;
  const created: string[] = [];

  for (let i = 0; i < input.columns.length; i++) {
    const label = input.columns[i].trim();
    if (!label) continue;
    // Skip if a column with this label already exists
    const exists = existing.some((c) => c.label.toLowerCase() === label.toLowerCase());
    if (exists) continue;
    const id = label.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now() + "_" + i;
    await db.kanban_columns.add({ id, label, position: maxPos + 1 + i });
    created.push(label);
  }

  return JSON.stringify({ success: true, created, count: created.length });
}

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "create_commitment":
      return executeCreateCommitment(input as Parameters<typeof executeCreateCommitment>[0]);
    case "search_commitments":
      return executeSearchCommitments(input as Parameters<typeof executeSearchCommitments>[0]);
    case "update_commitment":
      return executeUpdateCommitment(input as Parameters<typeof executeUpdateCommitment>[0]);
    case "bulk_update":
      return executeBulkUpdate(input as Parameters<typeof executeBulkUpdate>[0]);
    case "move_to_column":
      return executeMoveToColumn(input as Parameters<typeof executeMoveToColumn>[0]);
    case "get_summary":
      return executeGetSummary();
    case "update_setting":
      return executeUpdateSetting(input as Parameters<typeof executeUpdateSetting>[0]);
    case "create_columns":
      return executeCreateColumns(input as Parameters<typeof executeCreateColumns>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Claude API ───

const SYSTEM_PROMPT = `You are Clyde, a concise task assistant. You help users create, find, and manage their commitments (tasks).

Rules:
- Always use tools for actions — never just describe what you'd do
- For task creation, extract text, urgency, and deadline from natural language
- Interpret relative dates (e.g. "by Friday" = next Friday, "tomorrow" = next day, "end of week" = Friday)
- Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
- Be concise — 1-2 sentences max for responses
- When voice input is ambiguous, lean toward creating a task
- For search results, format as a numbered list with key details`;

async function buildContextMessage(): Promise<string> {
  const active = await db.commitments
    .where("status")
    .anyOf("new", "snoozed", "actioned")
    .toArray();

  const columns = await db.kanban_columns.toArray();
  const colNames = columns.length > 0
    ? `\nKanban columns: ${columns.map((c) => c.label).join(", ")}`
    : "";

  if (active.length === 0) return `No active commitments.${colNames}`;

  const capped = active.slice(0, 30);
  const items = capped
    .map((c) => {
      const parts = [`[${c.id}] ${c.text.slice(0, 50)}`];
      parts.push(c.status);
      parts.push(c.urgency);
      if (c.context) parts.push(c.context);
      if (c.deadline) parts.push(`due:${c.deadline.slice(0, 10)}`);
      return parts.join(" | ");
    })
    .join("\n");

  return `Active commitments (${active.length} total${active.length > 30 ? ", showing 30" : ""}):\n${items}${colNames}`;
}

async function callClaude(
  messages: Array<{ role: string; content: string | object[] }>,
): Promise<{ text: string; toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> }> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = result.anthropicApiKey as string | undefined;
  if (!apiKey) throw new Error("No API key configured. Go to Settings to add your Anthropic API key.");

  for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL_FAST,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (response.status === 429 && attempt < API_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, API_RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) throw new Error("Invalid API key. Check your Anthropic API key in Settings.");
        throw new Error(`API error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      let text = "";
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for (const block of data.content) {
        if (block.type === "text") text += block.text;
        if (block.type === "tool_use") {
          toolCalls.push({ id: block.id, name: block.name, input: block.input });
        }
      }

      return { text, toolCalls };
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (attempt < API_MAX_RETRIES) continue;
        throw new Error("Request timed out. Please try again.");
      }
      throw err;
    }
  }
  throw new Error("Failed after retries");
}

// Run the full tool-use loop: call Claude, execute tools, call Claude again with results
async function runConversation(
  chatHistory: Array<{ role: string; content: string | object[] }>,
): Promise<string> {
  const messages = [...chatHistory];
  let finalText = "";

  // Allow up to 5 tool-use rounds to prevent infinite loops
  for (let round = 0; round < 5; round++) {
    const { text, toolCalls } = await callClaude(messages);

    if (toolCalls.length === 0) {
      finalText = text;
      break;
    }

    // Add assistant response with tool calls to history
    const assistantContent: object[] = [];
    if (text) assistantContent.push({ type: "text", text });
    for (const tc of toolCalls) {
      assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
    messages.push({ role: "assistant", content: assistantContent });

    // Execute all tools and add results
    const toolResults: object[] = [];
    for (const tc of toolCalls) {
      const result = await executeTool(tc.name, tc.input);
      toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });

    // If this was the last round, we need to get the final text
    if (round === 4) {
      const final = await callClaude(messages);
      finalText = final.text;
    }
  }

  return finalText || "Done.";
}

// ─── Voice Hook ───

function useVoice(onResult: (transcript: string) => void, onInterim?: (transcript: string) => void) {
  const recognitionRef = useRef<any>(null);
  const [listening, setListening] = useState(false);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      onResult("");
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = !!onInterim;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      if (interimTranscript && onInterim) onInterim(interimTranscript);
      if (finalTranscript) onResult(finalTranscript);
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [onResult, onInterim]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  return { listening, start, stop };
}

// ─── Component ───

export function ClydeChat({ showToast, sidePanelOpen, proactiveMessage, onProactiveHandled }: {
  showToast: (msg: string, variant?: "success" | "error" | "warning" | "info") => void;
  sidePanelOpen?: boolean;
  proactiveMessage?: string | null;
  onProactiveHandled?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [interimVoice, setInterimVoice] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendMessageRef = useRef<(text: string) => void>(() => {});

  // Handle proactive messages (e.g. column suggestions)
  useEffect(() => {
    if (proactiveMessage && !loading) {
      setOpen(true);
      onProactiveHandled?.();
      // Small delay to let sendMessage ref be populated
      setTimeout(() => {
        sendMessageRef.current(proactiveMessage);
      }, 150);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proactiveMessage]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const userMsg: ChatMessage = { role: "user", content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setInterimVoice("");
      setLoading(true);

      try {
        // Build API messages: context + conversation history (last 20) + new message
        const contextSnapshot = await buildContextMessage();
        const recentMessages = [...messages, userMsg].slice(-20);

        const apiMessages: Array<{ role: string; content: string | object[] }> = [
          { role: "user", content: `[Context]\n${contextSnapshot}\n\n[User message]\n${recentMessages[0].content}` },
        ];

        // Add remaining messages as alternating turns
        for (let i = 1; i < recentMessages.length; i++) {
          apiMessages.push({ role: recentMessages[i].role, content: recentMessages[i].content });
        }

        const response = await runConversation(apiMessages);
        setMessages((prev) => [...prev, { role: "assistant", content: response }]);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Something went wrong";
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${errMsg}` }]);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading],
  );
  sendMessageRef.current = sendMessage;

  // Quick mic: one-shot voice → immediate task creation
  const handleQuickMic = useCallback(
    async (transcript: string) => {
      if (!transcript.trim()) return;
      showToast("Creating task...", "info");
      try {
        const contextSnapshot = await buildContextMessage();
        const apiMessages: Array<{ role: string; content: string | object[] }> = [
          {
            role: "user",
            content: `[Context]\n${contextSnapshot}\n\n[Voice dictation — create a task from this]\n${transcript}`,
          },
        ];
        const response = await runConversation(apiMessages);
        // Extract the created task text for the toast
        const shortText = transcript.length > 40 ? transcript.slice(0, 40) + "..." : transcript;
        showToast(`Created: ${shortText}`, "success");
        // If chat is open, show it there too
        if (open) {
          setMessages((prev) => [
            ...prev,
            { role: "user", content: `[voice] ${transcript}` },
            { role: "assistant", content: response },
          ]);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Failed to create task";
        showToast(`Error: ${errMsg}`, "error");
      }
    },
    [showToast, open],
  );

  const quickMicVoice = useVoice(handleQuickMic);

  // In-chat mic: fills input field
  const chatMicVoice = useVoice(
    (transcript) => {
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
      setInterimVoice("");
    },
    (interim) => setInterimVoice(interim),
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ─── Styles ───

  const fabRight = sidePanelOpen ? 436 : 16;

  const fabStyle: React.CSSProperties = {
    position: "fixed",
    bottom: 16,
    right: fabRight,
    display: "flex",
    gap: 8,
    zIndex: 9998,
    transition: "right 0.15s ease",
  };

  const btnBase: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    transition: "transform 0.1s",
  };

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    bottom: 68,
    right: fabRight,
    transition: "right 0.15s ease",
    width: 360,
    height: 480,
    background: OS.white,
    border: `1px solid ${OS.border}`,
    borderRadius: 12,
    boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
    display: "flex",
    flexDirection: "column",
    zIndex: 9999,
    overflow: "hidden",
    fontFamily: OS.font,
  };

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div style={panelStyle}>
          {/* Header */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${OS.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: OS.bg,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, color: OS.text }}>Clyde</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => (chatMicVoice.listening ? chatMicVoice.stop() : chatMicVoice.start())}
                style={{
                  ...btnBase,
                  width: 28,
                  height: 28,
                  background: chatMicVoice.listening ? OS.red : "transparent",
                  color: chatMicVoice.listening ? OS.white : OS.muted,
                  boxShadow: "none",
                }}
                title={chatMicVoice.listening ? "Stop recording" : "Voice input"}
              >
                {chatMicVoice.listening ? <IconStop /> : <IconMic />}
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{
                  ...btnBase,
                  width: 28,
                  height: 28,
                  background: "transparent",
                  color: OS.muted,
                  boxShadow: "none",
                }}
              >
                <IconX />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {messages.length === 0 && !loading && (
              <div style={{ color: OS.muted, fontSize: 13, textAlign: "center", marginTop: 40 }}>
                Ask me to create tasks, search your board, or manage items.
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "8px 12px",
                  borderRadius: 12,
                  fontSize: 13,
                  lineHeight: 1.4,
                  background: msg.role === "user" ? OS.blue : OS.bg,
                  color: msg.role === "user" ? OS.white : OS.text,
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}
              >
                {msg.content}
              </div>
            ))}
            {loading && (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "8px 12px",
                  borderRadius: 12,
                  fontSize: 13,
                  background: OS.bg,
                  color: OS.muted,
                }}
              >
                Thinking...
              </div>
            )}
          </div>

          {/* Interim voice preview */}
          {interimVoice && (
            <div style={{ padding: "4px 16px", fontSize: 12, color: OS.muted, fontStyle: "italic" }}>
              {interimVoice}
            </div>
          )}

          {/* Input */}
          <div
            style={{
              padding: "8px 12px",
              borderTop: `1px solid ${OS.border}`,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={loading}
              style={{
                flex: 1,
                padding: "8px 12px",
                border: `1px solid ${OS.border}`,
                borderRadius: 8,
                fontSize: 13,
                fontFamily: OS.font,
                outline: "none",
                background: OS.white,
                color: OS.text,
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              style={{
                ...btnBase,
                width: 32,
                height: 32,
                background: input.trim() ? OS.blue : OS.bg,
                color: input.trim() ? OS.white : OS.faint,
                boxShadow: "none",
              }}
            >
              <IconSend />
            </button>
          </div>
        </div>
      )}

      {/* FAB buttons */}
      <div style={fabStyle}>
        <button
          onClick={() => (quickMicVoice.listening ? quickMicVoice.stop() : quickMicVoice.start())}
          style={{
            ...btnBase,
            background: quickMicVoice.listening ? OS.red : OS.white,
            color: quickMicVoice.listening ? OS.white : OS.muted,
          }}
          title={quickMicVoice.listening ? "Stop recording" : "Quick voice task"}
        >
          {quickMicVoice.listening ? <IconStop /> : <IconMic />}
        </button>
        <button
          onClick={() => setOpen(!open)}
          style={{
            ...btnBase,
            background: open ? OS.blue : OS.white,
            color: open ? OS.white : OS.blue,
          }}
          title={open ? "Close chat" : "Open Clyde chat"}
        >
          {open ? <IconX /> : <IconChat />}
        </button>
      </div>
    </>
  );
}
