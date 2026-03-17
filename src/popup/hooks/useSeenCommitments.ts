import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "clyde_seen_commitments";
const NEW_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const SEEN_DELAY_MS = 60 * 1000; // 60 seconds before marking as seen

interface SeenData {
  [id: string]: number; // commitment id → timestamp when marked seen
}

/**
 * Tracks which commitments the user has "seen".
 * A commitment is "new" if created within 24h AND not yet in the seen set.
 * After being visible for 60 seconds, it gets marked as seen.
 */
export function useSeenCommitments() {
  const [seenMap, setSeenMap] = useState<SeenData>({});
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Load seen data from chrome.storage.local on mount
  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const data: SeenData = result[STORAGE_KEY] ?? {};
      // Prune entries older than 48h to keep storage lean
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      const pruned: SeenData = {};
      for (const [id, ts] of Object.entries(data)) {
        if (ts > cutoff) pruned[id] = ts;
      }
      setSeenMap(pruned);
    });
    return () => {
      // Clear all timers on unmount
      timersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Persist to storage whenever seenMap changes
  useEffect(() => {
    chrome.storage.local.set({ [STORAGE_KEY]: seenMap });
  }, [seenMap]);

  /** Returns true if a commitment should show the "new" indicator */
  const isNew = useCallback(
    (id: number | undefined, createdAt: string): boolean => {
      if (id == null) return false;
      // Not new if older than 24h
      const age = Date.now() - new Date(createdAt).getTime();
      if (age > NEW_THRESHOLD_MS) return false;
      // Not new if already seen
      return !(String(id) in seenMap);
    },
    [seenMap],
  );

  /** Call when a commitment becomes visible. Starts a 60s timer to mark it seen. */
  const markVisible = useCallback(
    (id: number) => {
      if (timersRef.current.has(id)) return; // already tracking
      if (String(id) in seenMap) return; // already seen
      const timer = setTimeout(() => {
        setSeenMap((prev) => ({ ...prev, [String(id)]: Date.now() }));
        timersRef.current.delete(id);
      }, SEEN_DELAY_MS);
      timersRef.current.set(id, timer);
    },
    [seenMap],
  );

  /** Call when a commitment leaves the viewport. Cancels the 60s timer. */
  const markHidden = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  return { isNew, markVisible, markHidden };
}
