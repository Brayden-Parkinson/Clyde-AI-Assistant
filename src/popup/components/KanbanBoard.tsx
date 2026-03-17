import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { OS } from "@shared/tokens";
import type { Commitment, CompletionSuggestion, Tag } from "@shared/types";
import type { Actions } from "../hooks/useActions";
import { db } from "@shared/db";
import { IconChat, IconDocument, IconMic, IconMail, IconCheck, IconPlay, IconSort, IconChevronDown } from "./Icons";

// ─── Column types ───

type ColumnKey = "todo" | "inProgress" | "done";
type SortKey = "default" | "urgency" | "confidence" | "deadline" | "smart";

interface KanbanColumnData {
  key: string;
  label: string;
  items: Commitment[];
  color: string;
  isCustom?: boolean;
  isReorderable?: boolean;
}

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "smart", label: "✦ Smart" },
  { key: "default", label: "Default" },
  { key: "urgency", label: "Urgency" },
  { key: "confidence", label: "Confidence" },
  { key: "deadline", label: "Deadline" },
];

const FIXED_COLORS: Record<ColumnKey, string> = {
  todo: OS.blue,
  inProgress: "#b08d33",
  done: OS.green,
};

const CUSTOM_PALETTE = ["#6b5fbd", "#3d8a8a", "#a15586", "#3b8c5f", "#c55252", "#b08d33"];

const CARD_CAP = 6;

function lightenHex(hex: string, t: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `#${Math.round(r + (255 - r) * t).toString(16).padStart(2, "0")}${Math.round(g + (255 - g) * t).toString(16).padStart(2, "0")}${Math.round(b + (255 - b) * t).toString(16).padStart(2, "0")}`;
}

function dk(dark: boolean | undefined, darkVal: string, lightVal: string): string {
  return dark ? darkVal : lightVal;
}

// ─── Ensure "inProgress" row exists in kanban_columns ───

async function ensureInProgressColumn() {
  const existing = await db.kanban_columns.get("inProgress");
  if (!existing) {
    const allCols = await db.kanban_columns.toArray();
    const minPos = allCols.length > 0 ? Math.min(...allCols.map((c) => c.position)) - 1 : 0;
    await db.kanban_columns.add({ id: "inProgress", label: "In Progress", position: minPos });
  }
}

function smartScore(item: Commitment): number {
  let score = 0;

  const urgPts: Record<string, number> = { high: 30, medium: 15, low: 5 };
  score += urgPts[item.urgency] ?? 5;

  score += item.confidence * 20;

  if (item.deadline) {
    const daysUntil = (new Date(item.deadline).getTime() - Date.now()) / 86_400_000;
    if (daysUntil < 0)       score += 40;
    else if (daysUntil < 1)  score += 35;
    else if (daysUntil < 3)  score += 28;
    else if (daysUntil < 7)  score += 20;
    else if (daysUntil < 14) score += 10;
    else                     score += 3;
  } else {
    score += 5;
  }

  if (item.direction === "by_me") score += 5;
  if (item.likely_completed) score -= 15;

  return score;
}

function sortItems(items: Commitment[], sortKey: SortKey): Commitment[] {
  if (sortKey === "default") return items;
  return [...items].sort((a, b) => {
    if (sortKey === "smart")      return smartScore(b) - smartScore(a);
    if (sortKey === "urgency") {
      const urg: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (urg[a.urgency] ?? 2) - (urg[b.urgency] ?? 2);
    }
    if (sortKey === "confidence") return b.confidence - a.confidence;
    if (sortKey === "deadline") {
      const aTime = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bTime = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return aTime - bTime;
    }
    return 0;
  });
}

// ─── Verbose badge helper ───

function VerboseBadges({ item }: { item: Commitment }) {
  const badges = [
    {
      label: `${Math.round(item.confidence * 100)}%`,
      color: item.confidence >= 0.8 ? OS.green : item.confidence >= 0.5 ? "#b08d33" : OS.faint,
    },
    {
      label: item.urgency,
      color: item.urgency === "high" ? OS.red : item.urgency === "medium" ? "#b08d33" : OS.faint,
    },
    { label: item.direction === "by_me" ? "mine" : "assigned", color: OS.faint },
    { label: item.source_type, color: OS.faint },
    ...(item.likely_completed ? [{ label: "likely done", color: OS.green }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
      {badges.map((badge) => (
        <span
          key={badge.label}
          style={{
            padding: "1px 5px",
            fontSize: 9,
            fontFamily: OS.mono,
            fontWeight: 500,
            borderRadius: 3,
            color: badge.color,
            background: OS.bg,
            lineHeight: 1.6,
          }}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

// ─── KanbanCard ───

interface CardDisplaySettings {
  showActions: boolean;
  showSourceBadges: boolean;
  showDeadlines: boolean;
  showConfidence: boolean;
}

function KanbanCard({
  item,
  tag,
  isSelected,
  isNew,
  verboseMode,
  onSelect,
  onDone,
  onStartWorking,
  onDragStart,
  onVisible,
  onHidden,
  completionSuggestion,
  onAcceptCompletion,
  onDismissCompletion,
  displaySettings,
  privacyMode,
  darkMode,
}: {
  item: Commitment;
  tag?: Tag;
  isSelected: boolean;
  isNew?: boolean;
  verboseMode: boolean;
  onSelect: (id: number) => void;
  onDone: (id: number) => void;
  onStartWorking: (id: number) => void;
  onDragStart: (e: React.DragEvent, id: number) => void;
  onVisible?: () => void;
  onHidden?: () => void;
  completionSuggestion?: CompletionSuggestion;
  onAcceptCompletion?: (suggestionId: number, commitmentId: number) => void;
  onDismissCompletion?: (suggestionId: number, commitmentId: number) => void;
  displaySettings?: CardDisplaySettings;
  privacyMode?: boolean;
  darkMode?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Intersection observer for visibility tracking (new indicator)
  useEffect(() => {
    if (!isNew || !onVisible || !onHidden || !cardRef.current) return;
    const el = cardRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => { entry.isIntersecting ? onVisible() : onHidden(); },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => { observer.disconnect(); onHidden(); };
  }, [isNew, onVisible, onHidden]);

  const deadlineStr = item.deadline
    ? new Date(item.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  const isUrgent = item.urgency === "high";
  const isOverdue = !!(item.deadline && new Date(item.deadline).getTime() < Date.now() && item.status !== "done");
  const blurred = !!(privacyMode && item.sensitive);

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={(e) => item.id != null && onDragStart(e, item.id)}
      onClick={() => item.id != null && onSelect(item.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.white),
        border: `0.5px solid ${completionSuggestion ? OS.green : isSelected ? OS.blue : hovered ? dk(darkMode, 'rgba(255,255,255,0.18)', OS.secondary) : dk(darkMode, 'rgba(255,255,255,0.10)', OS.border)}`,
        borderRadius: 12,
        borderLeft: (isOverdue && !isSelected && !completionSuggestion) ? `2px solid ${OS.red}` : undefined,
        padding: "10px 12px",
        cursor: "grab",
        transition: "border 0.12s ease",
        position: "relative",
      }}
    >
      {isNew && (
        <div style={{
          position: "absolute", top: 6, right: 6,
          width: 7, height: 7, borderRadius: "50%",
          background: OS.blue,
        }} />
      )}
      <div style={{
        fontSize: 13, fontWeight: 400, color: dk(darkMode, 'rgba(255,255,255,0.90)', OS.text), lineHeight: 1.4,
        filter: blurred ? "blur(5px)" : undefined,
        userSelect: blurred ? "none" : undefined,
      }}>
        {blurred ? "Sensitive commitment" : item.text}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 11.5, color: dk(darkMode, 'rgba(255,255,255,0.45)', OS.muted), flexWrap: "wrap", rowGap: 2 }}>
        {(displaySettings?.showSourceBadges !== false) && (
          <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
            {item.source_type === "slack" ? <IconChat size={12} /> : item.source_type === "gdoc" ? <IconDocument size={12} /> : item.source_type === "gmail" ? <IconMail size={12} /> : <IconMic size={12} />}
          </span>
        )}
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120,
          ...(blurred ? { filter: "blur(4px)", userSelect: "none" as const } : {}),
        }}>{item.context}</span>
        {tag && tag.name !== "General" && (
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "1px 6px",
            borderRadius: 999,
            background: darkMode ? tag.color + "28" : tag.color + "15",
            color: darkMode ? lightenHex(tag.color, 0.55) : tag.color,
            lineHeight: 1.6, whiteSpace: "nowrap",
            flexShrink: 0,
            border: `0.5px solid ${darkMode ? tag.color + "50" : tag.color + "30"}`,
          }}>
            {tag.name}
          </span>
        )}
        {(displaySettings?.showDeadlines !== false) && deadlineStr && (
          <>
            <span style={{ color: dk(darkMode, 'rgba(255,255,255,0.20)', OS.faint), flexShrink: 0 }}>&middot;</span>
            <span style={{ color: (isUrgent || isOverdue) ? dk(darkMode, '#F09595', OS.red) : dk(darkMode, 'rgba(255,255,255,0.45)', OS.muted), fontWeight: isUrgent ? 500 : 400, whiteSpace: "nowrap", flexShrink: 0 }}>
              {deadlineStr}
            </span>
          </>
        )}
      </div>
      {verboseMode && <VerboseBadges item={item} />}

      {/* Completion suggestion prompt */}
      {completionSuggestion && completionSuggestion.id != null && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg),
            borderRadius: 5,
            border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', OS.border)}`,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 500, color: OS.green, marginBottom: 4 }}>
            Done?
          </div>
          <div style={{ fontSize: 11, color: OS.secondary, fontStyle: "italic", marginBottom: 6, lineHeight: 1.4 }}>
            &quot;{completionSuggestion.evidence}&quot;
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAcceptCompletion?.(completionSuggestion.id!, completionSuggestion.commitmentId);
              }}
              style={{
                padding: "3px 10px", fontSize: 11, fontWeight: 500, fontFamily: OS.font,
                background: OS.green, color: "#fff", border: "none", borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Yes
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismissCompletion?.(completionSuggestion.id!, completionSuggestion.commitmentId);
              }}
              style={{
                padding: "3px 10px", fontSize: 11, fontWeight: 500, fontFamily: OS.font,
                background: dk(darkMode, 'rgba(255,255,255,0.06)', OS.white),
                color: dk(darkMode, 'rgba(255,255,255,0.45)', OS.muted),
                border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', OS.border)}`,
                borderRadius: 4, cursor: "pointer",
              }}
            >
              Not yet
            </button>
          </div>
        </div>
      )}

      {(displaySettings?.showActions !== false) && hovered && item.id != null && (
        <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 4 }}>
          {item.status !== "done" && (
            <button
              onClick={(e) => { e.stopPropagation(); onDone(item.id!); }}
              title="Mark done"
              style={{
                width: 22, height: 22, borderRadius: 8,
                border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.12)', OS.border)}`,
                background: dk(darkMode, 'rgba(255,255,255,0.08)', OS.white),
                color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.muted), fontSize: 12, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <IconCheck size={12} />
            </button>
          )}
          {item.status !== "actioned" && item.status !== "done" && (
            <button
              onClick={(e) => { e.stopPropagation(); onStartWorking(item.id!); }}
              title="Start working"
              style={{
                width: 22, height: 22, borderRadius: 8,
                border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.12)', OS.border)}`,
                background: dk(darkMode, 'rgba(255,255,255,0.08)', OS.white),
                color: dk(darkMode, 'rgba(255,255,255,0.55)', OS.muted), cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <IconPlay size={10} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sort dropdown ───

function SortDropdown({ sortKey, onSort, darkMode }: { sortKey: SortKey; onSort: (key: SortKey) => void; darkMode?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title="Sort column"
        style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "2px 6px", fontSize: 10, fontWeight: 500, fontFamily: OS.font,
          color: sortKey !== "default" ? dk(darkMode, '#AFA9EC', OS.blue) : dk(darkMode, 'rgba(255,255,255,0.4)', OS.muted),
          background: darkMode && sortKey !== "default" ? 'rgba(175,169,236,0.08)' : 'transparent',
          border: sortKey !== "default" ? `0.5px solid ${dk(darkMode, 'rgba(175,169,236,0.25)', 'rgba(0,0,0,0.12)')}` : `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)')}`,
          borderRadius: 4, cursor: "pointer", lineHeight: 1.6,
        }}
      >
        <IconSort size={10} />{sortKey !== "default" ? ` ${sortOptions.find((s) => s.key === sortKey)?.label}` : ""}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 4,
          background: dk(darkMode, '#1e1e20', OS.white),
          border: `1px solid ${dk(darkMode, 'rgba(255,255,255,0.10)', OS.border)}`, borderRadius: 6,
          boxShadow: dk(darkMode, '0 4px 12px rgba(0,0,0,0.4)', '0 4px 12px rgba(0,0,0,0.1)'), zIndex: 30, minWidth: 110, overflow: "hidden",
        }}>
          {sortOptions.map((opt) => (
            <div
              key={opt.key}
              onClick={(e) => { e.stopPropagation(); onSort(opt.key); setOpen(false); }}
              style={{
                padding: "6px 12px", fontSize: 11,
                fontWeight: sortKey === opt.key ? 500 : 500,
                color: sortKey === opt.key ? dk(darkMode, '#AFA9EC', OS.blue) : dk(darkMode, 'rgba(255,255,255,0.75)', OS.text),
                background: sortKey === opt.key ? dk(darkMode, 'rgba(175,169,236,0.12)', `${OS.blue}14`) : dk(darkMode, 'transparent', OS.white),
                cursor: "pointer", fontFamily: OS.font,
              }}
              onMouseEnter={(e) => { if (sortKey !== opt.key) e.currentTarget.style.background = dk(darkMode, 'rgba(255,255,255,0.06)', OS.bg); }}
              onMouseLeave={(e) => { if (sortKey !== opt.key) e.currentTarget.style.background = dk(darkMode, 'transparent', OS.white); }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KanbanColumn ───

function KanbanColumn({
  column,
  selectedId,
  collapsed,
  verboseMode,
  sortKey,
  onSortChange,
  onToggleCollapse,
  onSelect,
  onDone,
  onStartWorking,
  onDragStart,
  onDragOver,
  onDrop,
  isNarrow,
  onRename,
  onDelete,
  isReorderable,
  isBeingDragged,
  isColumnDragOver,
  onColumnDragStart,
  onColumnDragEnd,
  onColumnDragOver,
  suggestionByCommitmentId,
  onAcceptCompletion,
  onDismissCompletion,
  displaySettings,
  privacyMode,
  tagMap,
  isNewFn,
  onMarkVisible,
  onMarkHidden,
  darkMode,
}: {
  column: KanbanColumnData;
  selectedId: number | null;
  collapsed: boolean;
  verboseMode: boolean;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  onToggleCollapse: () => void;
  onSelect: (id: number) => void;
  onDone: (id: number) => void;
  onStartWorking: (id: number) => void;
  onDragStart: (e: React.DragEvent, id: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, target: string) => void;
  isNarrow: boolean;
  onRename?: (label: string) => void;
  onDelete?: () => void;
  isReorderable?: boolean;
  isBeingDragged?: boolean;
  isColumnDragOver?: boolean;
  onColumnDragStart?: (e: React.DragEvent, colId: string) => void;
  onColumnDragEnd?: () => void;
  onColumnDragOver?: (colId: string) => void;
  suggestionByCommitmentId?: Map<number, CompletionSuggestion>;
  onAcceptCompletion?: (suggestionId: number, commitmentId: number) => void;
  onDismissCompletion?: (suggestionId: number, commitmentId: number) => void;
  displaySettings?: CardDisplaySettings;
  privacyMode?: boolean;
  tagMap?: Map<number, Tag>;
  isNewFn?: (id: number | undefined, createdAt: string) => boolean;
  onMarkVisible?: (id: number) => void;
  onMarkHidden?: (id: number) => void;
  darkMode?: boolean;
}) {
  const [cardDragOver, setCardDragOver] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(column.label);
  const isOverdueColumn = column.label.toLowerCase() === "overdue" || column.key === "overdue";

  const { color } = column;
  const sorted = useMemo(() => sortItems(column.items, sortKey), [column.items, sortKey]);
  const shouldCap = column.key !== "inProgress" && !expanded;
  const visibleItems = shouldCap && sorted.length > CARD_CAP ? sorted.slice(0, CARD_CAP) : sorted;
  const hiddenCount = sorted.length - visibleItems.length;

  const handleDragOver = (e: React.DragEvent) => {
    const isColDrag = e.dataTransfer.types.includes("application/x-column-id");
    if (isColDrag) {
      if (!isReorderable) return; // don't accept column drops on fixed edges
      e.preventDefault();
      onColumnDragOver?.(column.key);
    } else {
      onDragOver(e);
      setCardDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setCardDragOver(false);
    // column drag-over clears via parent state when another column is entered
  };

  const handleDrop = (e: React.DragEvent) => {
    setCardDragOver(false);
    onDrop(e, column.key);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        background: cardDragOver ? dk(darkMode, 'rgba(94,106,210,0.12)', `${OS.blue}08`) : dk(darkMode, 'rgba(255,255,255,0.04)', OS.bg),
        borderRadius: 12,
        border: isColumnDragOver ? `1.5px solid ${OS.blue}` : `0.5px solid ${dk(darkMode, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.08)')}`,
        padding: "12px 10px",
        minHeight: isNarrow ? undefined : "calc(100vh - 140px)",
        display: "flex",
        flexDirection: "column" as const,
        opacity: isBeingDragged ? 0.45 : 1,
        transition: "all 0.12s ease",
      }}
    >
      {/* Column header */}
      <div
        onClick={isNarrow ? onToggleCollapse : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: collapsed ? 0 : 10,
          cursor: isNarrow ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Drag handle — only for reorderable middle columns */}
          {isReorderable && (
            <span
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("application/x-column-id", column.key);
                onColumnDragStart?.(e, column.key);
              }}
              onDragEnd={onColumnDragEnd}
              title="Drag to reorder"
              style={{
                cursor: "grab",
                color: dk(darkMode, 'rgba(255,255,255,0.20)', OS.faint),
                fontSize: 14,
                lineHeight: 1,
                userSelect: "none",
                padding: "0 2px",
                flexShrink: 0,
              }}
            >
              ⠿
            </span>
          )}

          {/* Label */}
          {(column.isCustom || column.key === "inProgress") && editingLabel ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={() => { onRename?.(labelDraft.trim() || column.label); setEditingLabel(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onRename?.(labelDraft.trim() || column.label); setEditingLabel(false); }
                if (e.key === "Escape") { setLabelDraft(column.label); setEditingLabel(false); }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 13, fontWeight: 500,
                border: `1px solid ${OS.blue}`, borderRadius: 8,
                padding: "1px 6px", background: dk(darkMode, '#2a2a2c', OS.white),
                outline: "none", fontFamily: OS.font, width: 90, color: dk(darkMode, 'rgba(255,255,255,0.85)', OS.text),
              }}
            />
          ) : (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: isOverdueColumn ? dk(darkMode, '#F09595', OS.red) : dk(darkMode, 'rgba(255,255,255,0.55)', OS.secondary),
                cursor: isReorderable ? "text" : "default",
              }}
              onDoubleClick={isReorderable ? () => { setEditingLabel(true); setLabelDraft(column.label); } : undefined}
              title={isReorderable ? "Double-click to rename" : undefined}
            >
              {column.label}
            </span>
          )}

          <span style={{
            fontSize: 10, fontWeight: 500, fontFamily: OS.mono,
            color: isOverdueColumn ? dk(darkMode, '#F7C1C1', OS.red) : dk(darkMode, 'rgba(255,255,255,0.5)', OS.muted),
            padding: "1px 6px", borderRadius: 999,
            background: isOverdueColumn ? dk(darkMode, '#501313', `${OS.red}10`) : dk(darkMode, 'rgba(255,255,255,0.08)', OS.border),
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            {column.items.length}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!isNarrow && column.items.length > 1 && (
            <SortDropdown sortKey={sortKey} onSort={onSortChange} darkMode={darkMode} />
          )}
          {isNarrow && (
            <span style={{
              color: dk(darkMode, 'rgba(255,255,255,0.35)', OS.muted), display: "inline-flex",
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}>
              <IconChevronDown size={12} />
            </span>
          )}
        </div>
      </div>

      {/* Card list */}
      {!collapsed && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 6,
          maxHeight: isNarrow ? 400 : "calc(100vh - 220px)",
          flex: isNarrow ? undefined : 1,
          overflowY: "auto",
        }}>
          {sorted.length === 0 && (
            <div style={{
              textAlign: "center", padding: "24px 8px",
              fontSize: 12, color: dk(darkMode, 'rgba(255,255,255,0.25)', OS.muted), fontStyle: "italic",
            }}>
              {column.key === "todo" ? "Nothing here yet."
                : column.key === "done" ? "Nothing completed yet."
                : "Drag items here"}
            </div>
          )}
          {visibleItems.map((item) => (
            <KanbanCard
              key={item.id}
              item={item}
              tag={item.tag_id != null ? tagMap?.get(item.tag_id) : undefined}
              isSelected={selectedId === item.id}
              isNew={isNewFn?.(item.id, item.createdAt)}
              verboseMode={verboseMode}
              onSelect={onSelect}
              onDone={onDone}
              onStartWorking={onStartWorking}
              onDragStart={onDragStart}
              onVisible={item.id != null ? () => onMarkVisible?.(item.id!) : undefined}
              onHidden={item.id != null ? () => onMarkHidden?.(item.id!) : undefined}
              completionSuggestion={item.id != null ? suggestionByCommitmentId?.get(item.id) : undefined}
              onAcceptCompletion={onAcceptCompletion}
              onDismissCompletion={onDismissCompletion}
              displaySettings={displaySettings}
              privacyMode={privacyMode}
              darkMode={darkMode}
            />
          ))}
          {hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(true)}
              style={{
                border: `1px dashed ${dk(darkMode, 'rgba(255,255,255,0.12)', OS.border)}`, background: "transparent",
                color: dk(darkMode, 'rgba(255,255,255,0.4)', OS.muted), borderRadius: 8, padding: 10,
                textAlign: "center", fontSize: 12, fontWeight: 500,
                fontFamily: OS.font, cursor: "pointer",
              }}
            >
              +{hiddenCount} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── KanbanBoard ───

const TODO_OVERFLOW_THRESHOLD = 15;

interface KanbanBoardProps {
  todo: Commitment[];
  inProgress: Commitment[];
  done: Commitment[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  actions: Actions;
  showToast: (msg: string) => void;
  isNarrow: boolean;
  verboseMode: boolean;
  demoMode?: boolean;
  pendingSuggestions?: CompletionSuggestion[];
  onAcceptCompletion?: (suggestionId: number, commitmentId: number) => void;
  onDismissCompletion?: (suggestionId: number, commitmentId: number) => void;
  displaySettings?: CardDisplaySettings;
  privacyMode?: boolean;
  onTodoOverflow?: (count: number) => void;
  tagMap?: Map<number, Tag>;
  isNewFn?: (id: number | undefined, createdAt: string) => boolean;
  onMarkVisible?: (id: number) => void;
  onMarkHidden?: (id: number) => void;
  darkMode?: boolean;
}

export function KanbanBoard({
  todo,
  inProgress,
  done,
  selectedId,
  onSelect,
  actions,
  showToast,
  isNarrow,
  verboseMode,
  demoMode,
  pendingSuggestions,
  onAcceptCompletion,
  onDismissCompletion,
  displaySettings,
  privacyMode,
  onTodoOverflow,
  tagMap,
  isNewFn,
  onMarkVisible,
  onMarkHidden,
  darkMode,
}: KanbanBoardProps) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(new Set());
  const [columnSorts, setColumnSorts] = useState<Record<string, SortKey>>({
    todo: "smart",
    inProgress: "smart",
    done: "smart",
  });
  const [draggingColId, setDraggingColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  // Ensure "inProgress" row exists in kanban_columns on mount
  useEffect(() => { ensureInProgressColumn(); }, []);

  // All middle column definitions from DB (includes "inProgress" + custom)
  const allColDefs = useLiveQuery(() => db.kanban_columns.orderBy("position").toArray(), []) ?? [];

  // Custom column assignments
  const assignments = useLiveQuery(() => db.kanban_assignments.toArray(), []) ?? [];

  // Set of commitment IDs assigned to a custom column
  const assignedIds = useMemo(
    () => new Set(assignments.map((a) => a.commitment_id)),
    [assignments],
  );

  // Fixed flanking columns exclude assigned items
  const filteredTodo = useMemo(
    () => todo.filter((c) => c.id != null && !assignedIds.has(c.id!)),
    [todo, assignedIds],
  );
  const filteredInProgress = useMemo(
    () => inProgress.filter((c) => c.id != null && !assignedIds.has(c.id!)),
    [inProgress, assignedIds],
  );

  // Detect todo overflow — only for custom-column-less boards
  const hasCustomColumns = allColDefs.some((c) => c.id !== "inProgress");
  useEffect(() => {
    if (!hasCustomColumns && filteredTodo.length >= TODO_OVERFLOW_THRESHOLD) {
      onTodoOverflow?.(filteredTodo.length);
    }
  }, [filteredTodo.length, hasCustomColumns, onTodoOverflow]);

  // All active items — used for custom column membership
  const allActive = useMemo(() => [...todo, ...inProgress], [todo, inProgress]);

  // Build all columns (middle only) in DB order
  const middleColumns: KanbanColumnData[] = useMemo(() => {
    let customIdx = 0;
    return allColDefs.map((col) => {
      if (col.id === "inProgress") {
        return {
          key: "inProgress",
          label: col.label,
          items: filteredInProgress,
          color: FIXED_COLORS.inProgress,
          isCustom: false,
          isReorderable: true,
        };
      }
      const result: KanbanColumnData = {
        key: col.id,
        label: col.label,
        color: CUSTOM_PALETTE[customIdx % CUSTOM_PALETTE.length],
        isCustom: true,
        isReorderable: true,
        items: allActive.filter((c) =>
          assignments.some((a) => a.commitment_id === c.id && a.column_id === col.id),
        ),
      };
      customIdx++;
      return result;
    });
  }, [allColDefs, filteredInProgress, allActive, assignments]);

  const todoCol: KanbanColumnData = useMemo(
    () => ({ key: "todo", label: "Todo", items: filteredTodo, color: FIXED_COLORS.todo }),
    [filteredTodo],
  );
  const doneCol: KanbanColumnData = useMemo(
    () => ({ key: "done", label: "Done", items: done, color: FIXED_COLORS.done }),
    [done],
  );

  // ─── Card drag ───

  const handleDragStart = useCallback(
    (e: React.DragEvent, id: number) => {
      setDraggedId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(id));
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  // ─── Unified drop handler (routes card vs column) ───

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetColKey: string) => {
      e.preventDefault();

      // Demo mode: no DB writes, just show toast
      if (demoMode) {
        setDraggedId(null);
        setDraggingColId(null);
        setDragOverColId(null);
        showToast("Card moved");
        return;
      }

      // Column reorder drop
      if (e.dataTransfer.types.includes("application/x-column-id")) {
        const sourceColId = e.dataTransfer.getData("application/x-column-id");
        setDraggingColId(null);
        setDragOverColId(null);
        if (!sourceColId || sourceColId === targetColKey) return;
        if (targetColKey === "todo" || targetColKey === "done") return;

        const fromIdx = allColDefs.findIndex((c) => c.id === sourceColId);
        const toIdx = allColDefs.findIndex((c) => c.id === targetColKey);
        if (fromIdx === -1 || toIdx === -1) return;

        const reordered = [...allColDefs];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);

        await db.transaction("rw", db.kanban_columns, async () => {
          for (let i = 0; i < reordered.length; i++) {
            await db.kanban_columns.update(reordered[i].id, { position: i });
          }
        });
        return;
      }

      // Card drop
      const id = draggedId;
      if (id == null) return;
      setDraggedId(null);

      const existingAssignment = assignments.find((a) => a.commitment_id === id);
      const source: string | null =
        existingAssignment?.column_id
        ?? (todo.some((c) => c.id === id) ? "todo"
          : inProgress.some((c) => c.id === id) ? "inProgress"
          : done.some((c) => c.id === id) ? "done"
          : null);

      if (!source || source === targetColKey) return;

      let msg = "";
      if (targetColKey === "done") {
        if (existingAssignment) await db.kanban_assignments.delete(id);
        msg = await actions.handleDone(id);
      } else if (targetColKey === "todo") {
        if (existingAssignment) await db.kanban_assignments.delete(id);
        msg = await actions.handleReopen(id);
      } else if (targetColKey === "inProgress") {
        if (existingAssignment) await db.kanban_assignments.delete(id);
        msg = await actions.handleStartWorking(id);
      } else {
        // Custom column — upsert assignment
        await db.kanban_assignments.put({ commitment_id: id, column_id: targetColKey });
      }

      if (msg) showToast(msg);
    },
    [draggedId, allColDefs, assignments, todo, inProgress, done, actions, showToast, demoMode],
  );

  // ─── Column drag handlers ───

  const handleColumnDragStart = useCallback(
    (e: React.DragEvent, colId: string) => {
      setDraggingColId(colId);
    },
    [],
  );

  const handleColumnDragEnd = useCallback(() => {
    setDraggingColId(null);
    setDragOverColId(null);
  }, []);

  const toggleCollapse = useCallback((key: string) => {
    setCollapsedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleRenameColumn = useCallback(async (id: string, label: string) => {
    if (demoMode) return;
    if (label.trim()) await db.kanban_columns.update(id, { label: label.trim() });
  }, [demoMode]);

  const handleDeleteColumn = useCallback(async (id: string) => {
    if (demoMode) return;
    if (id === "inProgress") return;
    await db.kanban_assignments.where("column_id").equals(id).delete();
    await db.kanban_columns.delete(id);
  }, [demoMode]);

  // ─── Shared column props ───

  const allColumns = useMemo(
    () => [todoCol, ...middleColumns, doneCol],
    [todoCol, middleColumns, doneCol],
  );

  const COL_MIN_W = 220;
  const gridCols = isNarrow
    ? undefined
    : `repeat(${allColumns.length}, minmax(${COL_MIN_W}px, 1fr))`;
  const gridMinWidth = isNarrow
    ? undefined
    : allColumns.length * COL_MIN_W + (allColumns.length - 1) * 12;

  // Build a lookup: commitmentId → pending suggestion (for inline prompts on cards)
  const suggestionByCommitmentId = useMemo(() => {
    const map = new Map<number, CompletionSuggestion>();
    if (pendingSuggestions) {
      for (const s of pendingSuggestions) {
        map.set(s.commitmentId, s);
      }
    }
    return map;
  }, [pendingSuggestions]);

  const sharedColProps = {
    selectedId,
    verboseMode,
    onSelect: (id: number) => onSelect(selectedId === id ? null : id),
    onDone: async (id: number) => { const msg = await actions.handleDone(id); showToast(msg); },
    onStartWorking: async (id: number) => { const msg = await actions.handleStartWorking(id); showToast(msg); },
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    isNarrow,
    suggestionByCommitmentId,
    onAcceptCompletion,
    onDismissCompletion,
    displaySettings,
    privacyMode,
    tagMap,
    isNewFn,
    onMarkVisible,
    onMarkHidden,
    darkMode,
  };

  return (
    <div>
      {/* Column grid — scroll wrapper clips to container, inner grid enforces min-width */}
      <div style={{ overflowX: isNarrow ? undefined : "auto", paddingBottom: 4 }}>
      <div style={{
        display: isNarrow ? "flex" : "grid",
        gridTemplateColumns: gridCols,
        gridAutoRows: isNarrow ? undefined : "1fr",
        alignItems: isNarrow ? undefined : "stretch",
        flexDirection: isNarrow ? "column" : undefined,
        gap: 12,
        minWidth: gridMinWidth,
      }}>
        {allColumns.map((col) => (
          <KanbanColumn
            key={col.key}
            column={col}
            collapsed={isNarrow && collapsedCols.has(col.key)}
            sortKey={columnSorts[col.key] ?? "smart"}
            onSortChange={(key) => setColumnSorts((prev) => ({ ...prev, [col.key]: key }))}
            onToggleCollapse={() => toggleCollapse(col.key)}
            onRename={col.isReorderable ? (label) => handleRenameColumn(col.key, label) : undefined}
            onDelete={col.isCustom ? () => handleDeleteColumn(col.key) : undefined}
            isReorderable={col.isReorderable}
            isBeingDragged={draggingColId === col.key}
            isColumnDragOver={dragOverColId === col.key}
            onColumnDragStart={handleColumnDragStart}
            onColumnDragEnd={handleColumnDragEnd}
            onColumnDragOver={(id) => setDragOverColId(id)}
            {...sharedColProps}
          />
        ))}
      </div>
      </div> {/* end scroll wrapper */}
    </div>
  );
}
