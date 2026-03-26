/**
 * X/Twitter post scraper — injected programmatically via chrome.scripting.executeScript.
 * Extracts visible posts from a user's profile page and sends them to the background.
 * Uses data-testid attributes as primary selectors for DOM stability.
 */

interface ScrapedPost {
  tweetId: string;
  author: string;
  authorDisplayName: string;
  text: string;
  timestamp: string;
  url: string;
  links: string[];
}

function extractPosts(): ScrapedPost[] {
  const posts: ScrapedPost[] = [];
  const articles = document.querySelectorAll('article[data-testid="tweet"]');

  for (const article of articles) {
    try {
      // Tweet text
      const textEl = article.querySelector('div[data-testid="tweetText"]');
      const text = textEl?.textContent?.trim() ?? "";
      if (!text) continue;

      // Timestamp + URL from the <time> element's parent <a>
      const timeEl = article.querySelector("time[datetime]");
      const timestamp = timeEl?.getAttribute("datetime") ?? "";
      const timeLink = timeEl?.closest("a");
      const url = timeLink?.getAttribute("href") ?? "";

      // Tweet ID from URL: /username/status/{id}
      const tweetIdMatch = url.match(/\/status\/(\d+)/);
      const tweetId = tweetIdMatch?.[1] ?? "";
      if (!tweetId) continue;

      // Author handle — look for links to user profiles within the article
      // The first user-name link typically contains the author's handle
      const userNameEl = article.querySelector('div[data-testid="User-Name"]');
      let author = "";
      let authorDisplayName = "";

      if (userNameEl) {
        // Display name is the first text node / span in the user name area
        const displayNameSpan = userNameEl.querySelector("span");
        authorDisplayName = displayNameSpan?.textContent?.trim() ?? "";

        // Handle is in a span containing @ inside the user name div
        const allSpans = userNameEl.querySelectorAll("span");
        for (const span of allSpans) {
          const t = span.textContent?.trim() ?? "";
          if (t.startsWith("@")) {
            author = t.slice(1); // remove @
            break;
          }
        }
      }

      // Extract links from the tweet text
      const links: string[] = [];
      if (textEl) {
        const anchors = textEl.querySelectorAll("a[href]");
        for (const a of anchors) {
          const href = a.getAttribute("href") ?? "";
          // Skip internal X links like hashtags and mentions
          if (href && !href.startsWith("/") && !href.startsWith("https://x.com/hashtag/")) {
            links.push(href);
          }
        }
      }

      posts.push({
        tweetId,
        author,
        authorDisplayName,
        text,
        timestamp,
        url: url.startsWith("/") ? `https://x.com${url}` : url,
        links,
      });
    } catch {
      // Individual post extraction failure — skip and continue
      continue;
    }
  }

  return posts;
}

// Only scrape on profile pages (x.com/<handle>, not /settings, /status, etc.)
function isProfilePage(): boolean {
  const path = window.location.pathname;
  // Profile pages are /<handle> with no further segments (or with trailing /)
  // Exclude known non-profile paths
  const nonProfile = ["/home", "/explore", "/search", "/notifications", "/messages", "/settings", "/i/", "/compose"];
  if (nonProfile.some((p) => path.startsWith(p))) return false;
  // Must be /<handle> with exactly one segment
  const segments = path.split("/").filter(Boolean);
  return segments.length === 1;
}

// Wait for X's dynamic rendering, then scrape and send
(async () => {
  if (!isProfilePage()) return;

  // Give X time to render posts (SPA hydration)
  await new Promise((r) => setTimeout(r, 3000));

  const posts = extractPosts();

  chrome.runtime.sendMessage({
    type: "X_SCRAPED_POSTS",
    posts,
  }).catch(() => {
    // Background not listening — that's OK
  });
})();
