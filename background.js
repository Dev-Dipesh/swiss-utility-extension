// Background service worker (MV3)

const PREFIX = "[Swiss Utility]";
const STORAGE_KEY = "swiss_utility_enabled";
const READING_MODE_KEY = "swiss_utility_reading_mode";
const PANEL_VISIBLE_KEY = "swiss_utility_panel_visible";
const DEFAULT_SELECTION_KEY = "swiss_utility_default_selection";
const DEFAULT_READING_KEY = "swiss_utility_default_reading";
const SITE_SELECTION_KEY = "swiss_utility_site_selection";
const SITE_READING_KEY = "swiss_utility_site_reading";

function log(...args) {
  console.log(PREFIX, ...args);
}

chrome.runtime.onInstalled.addListener(() => {
  log("Installed");
  chrome.storage.local.set({
    [STORAGE_KEY]: false,
    [READING_MODE_KEY]: false,
    [PANEL_VISIBLE_KEY]: false,
    [DEFAULT_SELECTION_KEY]: false,
    [DEFAULT_READING_KEY]: false,
    [SITE_SELECTION_KEY]: {},
    [SITE_READING_KEY]: {}
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "content_ready") {
    log("Content script ready", message.payload?.url);
    sendResponse({ ok: true });
    return true;
  }

  sendResponse({ ok: false });
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || typeof tab.id !== "number") return;
  chrome.tabs.sendMessage(tab.id, { type: "toggle_panel" }).catch(() => {});
});
