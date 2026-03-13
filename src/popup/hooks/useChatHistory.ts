import { useState, useCallback, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import type { ChatSession, ChatMessageRecord } from "@shared/types";

interface UseChatHistoryReturn {
  sessions: ChatSession[];
  activeSessionId: number | null;
  messages: ChatMessageRecord[];
  createSession: () => Promise<number>;
  loadSession: (id: number) => void;
  persistMessage: (sessionId: number, role: "user" | "assistant", content: string, snapshots?: string | null) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  renameSession: (id: number, title: string) => Promise<void>;
}

export function useChatHistory(demoMode: boolean): UseChatHistoryReturn {
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

  // In demo mode, return empty/no-op everything
  const liveSessions = useLiveQuery(
    () => {
      if (demoMode) return [] as ChatSession[];
      return db.chat_sessions.orderBy("updatedAt").reverse().toArray();
    },
    [demoMode],
    [] as ChatSession[],
  );

  const liveMessages = useLiveQuery(
    () => {
      if (demoMode || activeSessionId == null) return [] as ChatMessageRecord[];
      return db.chat_messages
        .where("sessionId")
        .equals(activeSessionId)
        .sortBy("createdAt");
    },
    [demoMode, activeSessionId],
    [] as ChatMessageRecord[],
  );

  const sessions = liveSessions ?? [];
  const messages = liveMessages ?? [];

  // Initialize activeSessionId to most recent session
  useEffect(() => {
    if (demoMode) return;
    if (activeSessionId == null && sessions.length > 0 && sessions[0].id != null) {
      setActiveSessionId(sessions[0].id!);
    }
  }, [sessions, activeSessionId, demoMode]);

  const createSession = useCallback(async (): Promise<number> => {
    if (demoMode) return -1;
    const now = new Date().toISOString();
    const id = await db.chat_sessions.add({
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
    });
    const numId = id as number;
    setActiveSessionId(numId);
    return numId;
  }, [demoMode]);

  const loadSession = useCallback((id: number) => {
    setActiveSessionId(id);
  }, []);

  const persistMessage = useCallback(
    async (sessionId: number, role: "user" | "assistant", content: string, snapshots?: string | null) => {
      if (demoMode) return;
      const now = new Date().toISOString();
      await db.chat_messages.add({
        sessionId,
        role,
        content,
        snapshots: snapshots ?? null,
        createdAt: now,
      });
      // Update session's updatedAt
      await db.chat_sessions.update(sessionId, { updatedAt: now });
    },
    [demoMode],
  );

  const renameSession = useCallback(
    async (id: number, title: string) => {
      if (demoMode) return;
      await db.chat_sessions.update(id, { title });
    },
    [demoMode],
  );

  const deleteSession = useCallback(
    async (id: number) => {
      if (demoMode) return;
      // Delete all messages for this session
      await db.chat_messages.where("sessionId").equals(id).delete();
      // Delete the session itself
      await db.chat_sessions.delete(id);
      // If we deleted the active session, switch to the next available
      if (activeSessionId === id) {
        const remaining = await db.chat_sessions.orderBy("updatedAt").reverse().first();
        setActiveSessionId(remaining?.id ?? null);
      }
    },
    [demoMode, activeSessionId],
  );

  return {
    sessions,
    activeSessionId,
    messages,
    createSession,
    loadSession,
    persistMessage,
    deleteSession,
    renameSession,
  };
}
