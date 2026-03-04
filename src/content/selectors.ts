/** Slack DOM selectors with primary (data-qa) and fallback (class) strategies */

interface SelectorPair {
  primary: string;
  fallback: string;
}

export const SELECTORS = {
  messageContainer: {
    primary: '[data-qa="virtual-list-item"]',
    fallback: ".c-virtual_list__item",
  },
  messageText: {
    primary: '[data-qa="message-text"]',
    fallback: ".c-message_kit__text",
  },
  senderName: {
    primary: '[data-qa="message_sender_name"]',
    fallback: ".c-message_kit__sender",
  },
  timestamp: {
    primary: '[data-qa="message_timestamp"]',
    fallback: "[datetime]",
  },
  messageList: {
    primary: '[data-qa="slack_kit_list"]',
    fallback: ".c-virtual_list__scroll_container",
  },
  channelHeader: {
    primary: '[data-qa="channel_name"]',
    fallback: ".p-view_header__channel_title",
  },
} as const satisfies Record<string, SelectorPair>;

/**
 * Query an element using primary selector first, falling back to secondary.
 * Logs a warning when the primary selector fails so we know Slack DOM changed.
 */
export function queryWithFallback(
  parent: Element | Document,
  selector: SelectorPair,
): Element | null {
  const el = parent.querySelector(selector.primary);
  if (el) return el;

  const fallbackEl = parent.querySelector(selector.fallback);
  if (fallbackEl) {
    console.warn(
      `[CommitmentTracker] Primary selector "${selector.primary}" failed, used fallback "${selector.fallback}"`,
    );
  }
  return fallbackEl;
}

/**
 * Query all matching elements using primary selector first, falling back to secondary.
 */
export function queryAllWithFallback(
  parent: Element | Document,
  selector: SelectorPair,
): Element[] {
  const els = parent.querySelectorAll(selector.primary);
  if (els.length > 0) return Array.from(els);

  const fallbackEls = parent.querySelectorAll(selector.fallback);
  if (fallbackEls.length > 0) {
    console.warn(
      `[CommitmentTracker] Primary selector "${selector.primary}" failed, used fallback "${selector.fallback}"`,
    );
  }
  return Array.from(fallbackEls);
}

/**
 * Health check — tests if primary selectors are finding elements.
 * Call once after page load to detect if Slack DOM has changed.
 */
export function healthCheck(): void {
  const entries = Object.entries(SELECTORS) as [string, SelectorPair][];
  for (const [name, selector] of entries) {
    const primary = document.querySelector(selector.primary);
    const fallback = document.querySelector(selector.fallback);
    if (!primary && !fallback) {
      console.warn(
        `[CommitmentTracker] Health check: "${name}" — neither primary nor fallback found. Slack DOM may have changed.`,
      );
    } else if (!primary && fallback) {
      console.warn(
        `[CommitmentTracker] Health check: "${name}" — primary selector broken, fallback still works.`,
      );
    }
  }
}

/**
 * Extract channel name from the URL path or the header element.
 * Slack URLs look like: app.slack.com/client/T.../C.../thread/...
 * DMs look like: app.slack.com/client/T.../D.../...
 */
export function getChannelName(): string {
  // Try header element first — it shows the human-readable name
  const headerEl = queryWithFallback(document, SELECTORS.channelHeader);
  if (headerEl?.textContent?.trim()) {
    return headerEl.textContent.trim();
  }

  // Fall back to URL path — extract the channel/DM ID
  const pathParts = window.location.pathname.split("/");
  // Pattern: /client/{teamId}/{channelId}
  const channelId = pathParts[3];
  if (channelId) {
    return channelId;
  }

  return "unknown-channel";
}
