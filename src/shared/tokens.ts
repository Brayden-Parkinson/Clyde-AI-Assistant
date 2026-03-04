/** OpenSpace brand design tokens */
export const OS = {
  blue: "#2b67db",
  darkBlue: "#163B83",
  yellow: "#fde13c",
  lightBlue: "#bfd1f4",
  lightestBlue: "#d5e0f8",
  lightGray: "#dcdcdc",
  darkGray: "#323232",
  white: "#ffffff",
  bg: "#f7f8fc",
  cardBg: "#ffffff",
  border: "#e4e7f0",
  textPrimary: "#1a1d2e",
  textSecondary: "#5c6078",
  textMuted: "#8e92a8",
  font: "'Arial', 'Helvetica Neue', sans-serif",
} as const;

/** Urgency → left border color mapping */
export const URGENCY_COLORS = {
  high: "#dc2626",
  medium: "#eab308",
  low: OS.border,
} as const;

/** Urgency indicator pill styles */
export const URGENCY_STYLES = {
  high: { color: "#dc2626", bg: "#fee2e2", label: "Urgent" },
  medium: { color: "#ca8a04", bg: "#fef9c3", label: "Medium" },
  low: { color: "#16a34a", bg: "#dcfce7", label: "Low" },
} as const;

/** Confidence pill color thresholds */
export function getConfidenceColors(value: number) {
  if (value >= 0.85) return { color: "#16a34a", bg: "#dcfce7" };
  if (value >= 0.7) return { color: "#ca8a04", bg: "#fef9c3" };
  return { color: "#dc2626", bg: "#fee2e2" };
}
