/**
 * sanitize-prompt.ts
 * Sanitizes user-generated text before interpolation into Claude system prompts.
 *
 * SECURITY: Prevents prompt injection by stripping/escaping characters and patterns
 * that could alter the prompt's instruction structure. All user-generated content
 * (dismissal patterns, memory entries, tag names, message text) MUST pass through
 * these functions before being embedded in a system or user prompt.
 */

/**
 * Strips characters and patterns that could break out of quoted/structured
 * sections in a Claude system prompt.
 *
 * - Removes \r to prevent CRLF injection
 * - Collapses multiple newlines into one (prevents creating fake prompt sections)
 * - Strips sequences that look like prompt section headers (e.g. "TASK:", "SYSTEM:", "RULES:")
 * - Truncates to maxLength to prevent prompt bloat
 */
export function sanitizeForPrompt(text: string, maxLength = 500): string {
  let s = text;

  // Strip carriage returns
  s = s.replace(/\r/g, "");

  // Collapse runs of 3+ newlines into 2 (preserve paragraph breaks but prevent section injection)
  s = s.replace(/\n{3,}/g, "\n\n");

  // Strip lines that look like prompt section headers (ALL-CAPS word followed by colon at line start)
  // These could trick Claude into treating user content as a new instruction block
  s = s.replace(/^[A-Z][A-Z _-]{2,}:/gm, (match) => match.toLowerCase());

  // Strip XML-like tags that could mimic Claude's internal formatting
  s = s.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*\s*\/?>/g, "");

  // Truncate
  if (s.length > maxLength) {
    s = s.slice(0, maxLength) + "…";
  }

  return s.trim();
}

/**
 * Sanitizes a dismissal pattern before embedding in the prompt.
 * More aggressive than general sanitization — dismissal patterns are short
 * and should never contain newlines or special formatting.
 */
export function sanitizeDismissalPattern(text: string): string {
  return sanitizeForPrompt(text.replace(/\n/g, " "), 200);
}

/**
 * Sanitizes a dismissal reason before embedding in the prompt.
 * Reasons are user-inferred free text — high injection risk.
 */
export function sanitizeDismissalReason(text: string): string {
  return sanitizeForPrompt(text.replace(/\n/g, " "), 150);
}

/**
 * Sanitizes a tag name before embedding in the prompt.
 * Tags should be short labels — strip everything except alphanumeric, spaces, hyphens.
 */
export function sanitizeTagName(text: string): string {
  return text.replace(/[^a-zA-Z0-9 \-_/&]/g, "").slice(0, 50).trim();
}

/**
 * Sanitizes a memory entry before embedding in the prompt.
 * Memories are AI-extracted summaries but could contain adversarial content
 * if the source messages were crafted.
 */
export function sanitizeMemoryContent(text: string): string {
  return sanitizeForPrompt(text, 300);
}

/**
 * Sanitizes a Slack/Gmail message text before embedding in the user message prompt.
 * Less aggressive — we need to preserve the message content for Claude to analyze —
 * but still strips structural injection attempts.
 */
export function sanitizeMessageText(text: string): string {
  return sanitizeForPrompt(text, 2000);
}

/**
 * Strips \r\n from a string to prevent MIME header injection.
 * Use on email To/Subject fields before building MIME messages.
 */
export function sanitizeMimeHeader(text: string): string {
  return text.replace(/[\r\n]/g, "");
}
