const selectionToggle = document.getElementById("toggle-selection");
const readingToggle = document.getElementById("toggle-reading");
const readAloudToggle = document.getElementById("toggle-read-aloud");
const status = document.getElementById("status");

const DEFAULT_SELECTION_KEY = "swiss_utility_default_selection";
const DEFAULT_READING_KEY = "swiss_utility_default_reading";
const DEFAULT_READ_ALOUD_KEY = "swiss_utility_default_read_aloud";

chrome.storage.local.get([DEFAULT_SELECTION_KEY, DEFAULT_READING_KEY, DEFAULT_READ_ALOUD_KEY], (result) => {
  selectionToggle.checked = result[DEFAULT_SELECTION_KEY] === true;
  readingToggle.checked = result[DEFAULT_READING_KEY] === true;
  readAloudToggle.checked = result[DEFAULT_READ_ALOUD_KEY] === true;
});

function showStatus(text) {
  status.textContent = text;
  setTimeout(() => {
    status.textContent = "";
  }, 1000);
}

selectionToggle.addEventListener("change", () => {
  chrome.storage.local.set({ [DEFAULT_SELECTION_KEY]: selectionToggle.checked }, () => {
    showStatus(selectionToggle.checked ? "Default enabled" : "Default disabled");
  });
});

readingToggle.addEventListener("change", () => {
  chrome.storage.local.set({ [DEFAULT_READING_KEY]: readingToggle.checked }, () => {
    showStatus(readingToggle.checked ? "Default enabled" : "Default disabled");
  });
});

readAloudToggle.addEventListener("change", () => {
  chrome.storage.local.set({ [DEFAULT_READ_ALOUD_KEY]: readAloudToggle.checked }, () => {
    showStatus(readAloudToggle.checked ? "Default enabled" : "Default disabled");
  });
});
