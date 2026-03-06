import React from "react";
import { createRoot } from "react-dom/client";
import App from "../popup/App";

// Auto-refresh when extension reloads
const manifest = chrome.runtime.getManifest();
const currentVersion = `${manifest.version}-${chrome.runtime.id}`;
const storedVersion = sessionStorage.getItem("clyde-ext-version");
if (storedVersion && storedVersion !== currentVersion) {
  sessionStorage.setItem("clyde-ext-version", currentVersion);
  location.reload();
} else {
  sessionStorage.setItem("clyde-ext-version", currentVersion);
}

// Detect if the extension context was invalidated (after reload)
setInterval(() => {
  try {
    chrome.runtime.getManifest();
  } catch {
    location.reload();
  }
}, 10000);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
