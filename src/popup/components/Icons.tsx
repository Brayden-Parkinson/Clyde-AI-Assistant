import React from "react";

// Shared SVG props for consistent sizing/stroke
interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const defaults = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

// ─── Action icons ───

export function IconCheck({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function IconX({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function IconCalendar({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function IconBell({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function IconSend({ size = 14 }: IconProps) {
  return (
    <svg {...defaults(size)} fill="currentColor" stroke="none">
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

// ─── Source icons ───

export function IconChat({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconMic({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

export function IconMail({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

export function IconDocument({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

export function IconStop({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)} stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

// ─── Navigation / UI ───

export function IconSearch({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function IconWarning({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function IconInfo({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function IconChevronRight({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function IconChevronDown({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function IconChevronUp({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

export function IconChevronLeft({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function IconArrowRight({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export function IconRefresh({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

export function IconSettings({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconSort({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

export function IconSun({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

export function IconBrain({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M9.5 2A5.5 5.5 0 0 0 5 8.5c0 1.5.5 2.8 1.3 3.8L12 21l5.7-8.7c.8-1 1.3-2.3 1.3-3.8A5.5 5.5 0 0 0 14.5 2a5.4 5.4 0 0 0-2.5.6A5.4 5.4 0 0 0 9.5 2z" />
    </svg>
  );
}

export function IconSignal({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M2 20h.01" />
      <path d="M7 20v-4" />
      <path d="M12 20v-8" />
      <path d="M17 20V8" />
      <path d="M22 4v16" />
    </svg>
  );
}

export function IconLogo({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

export function IconBoard({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function IconList({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

export function IconPlay({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

export function IconClock({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function IconLoader({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  );
}

export function IconEdit({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export function IconPeople({ size = 16 }: IconProps) {
  return (
    <svg {...defaults(size)}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// ─── Inline wrapper for icons used in text flow ───

export function InlineIcon({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}>
      {children}
    </span>
  );
}
