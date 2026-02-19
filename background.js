// Background service worker (MV3)

const PREFIX = "[Swiss Utility]";
const STORAGE_KEY = "swiss_utility_enabled";
const READING_MODE_KEY = "swiss_utility_reading_mode";
const PANEL_VISIBLE_KEY = "swiss_utility_panel_visible";
const DEFAULT_SELECTION_KEY = "swiss_utility_default_selection";
const DEFAULT_READING_KEY = "swiss_utility_default_reading";
const DEFAULT_READ_ALOUD_KEY = "swiss_utility_default_read_aloud";
const SITE_SELECTION_KEY = "swiss_utility_site_selection";
const SITE_READING_KEY = "swiss_utility_site_reading";
const SITE_READ_ALOUD_KEY = "swiss_utility_site_read_aloud";

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
    [DEFAULT_READ_ALOUD_KEY]: false,
    [SITE_SELECTION_KEY]: {},
    [SITE_READING_KEY]: {},
    [SITE_READ_ALOUD_KEY]: {}
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "content_ready") {
    log("Content script ready", message.payload?.url);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "apply_custom_js") {
    const code = message.payload?.code || "";
    const tabId = sender.tab?.id;
    if (!tabId || !code) {
      sendResponse({ ok: false });
      return true;
    }

    const jobId = message.payload?.jobId || "";
    chrome.scripting.executeScript(
      {
        target: { tabId },
        world: "MAIN",
        func: (scriptText, job) => {
          try {
            const blob = new Blob([scriptText], { type: "text/javascript" });
            const url = URL.createObjectURL(blob);
            const script = document.createElement("script");
            script.src = url;
            script.onload = () => {
              URL.revokeObjectURL(url);
              script.remove();
              window.postMessage({ source: "swiss-utility", type: "custom_js_result", jobId: job, ok: true }, "*");
            };
            script.onerror = () => {
              URL.revokeObjectURL(url);
              script.remove();
              window.postMessage({ source: "swiss-utility", type: "custom_js_result", jobId: job, ok: false }, "*");
            };
            document.documentElement.appendChild(script);
          } catch (err) {
            console.error("[Swiss Utility] Custom JS error", err);
            window.postMessage({ source: "swiss-utility", type: "custom_js_result", jobId: job, ok: false }, "*");
          }
        },
        args: [code, jobId]
      },
      () => {
        sendResponse({ ok: !chrome.runtime.lastError });
      }
    );
    return true;
  }

  sendResponse({ ok: false });
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || typeof tab.id !== "number") return;
  chrome.tabs.sendMessage(tab.id, { type: "toggle_panel" }).catch(() => {});
});
