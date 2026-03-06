/** Clyde design tokens — quiet, functional, tool-grade aesthetic */
export const OS = {
  // Accent — single muted color, used sparingly for primary actions and active states
  blue: "#5e6ad2",

  // Sidebar
  darkBlue: "#1c1c22",

  // Surfaces
  bg: "#f5f5f7",
  white: "#ffffff",

  // Borders
  border: "#e1e2e5",

  // Text hierarchy
  text: "#111111",
  secondary: "#555555",
  muted: "#777777",
  faint: "#aaaaaa",

  // Semantic — only for meaning
  red: "#d14343",
  green: "#3b8c5f",
  yellowBg: "#fef9e8",
  yellowBorder: "#e8d174",

  // Typography — one neutral sans-serif
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  mono: '"SF Mono", "JetBrains Mono", Menlo, monospace',
} as const;
