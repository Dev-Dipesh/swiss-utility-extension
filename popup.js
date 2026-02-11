const toggle = document.getElementById("enabled-toggle");
const openOptions = document.getElementById("open-options");
const STORAGE_KEY = "swiss_utility_enabled";

chrome.storage.local.get([STORAGE_KEY], (result) => {
  toggle.checked = result[STORAGE_KEY] !== false;
});

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ [STORAGE_KEY]: toggle.checked });
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
