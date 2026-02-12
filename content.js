// Swiss Utility content script

(() => {
  "use strict";

  const PREFIX = "[Swiss Utility]";
  const STORAGE_KEY = "swiss_utility_enabled";
  const READING_MODE_KEY = "swiss_utility_reading_mode";
  const DEFAULT_SELECTION_KEY = "swiss_utility_default_selection";
  const DEFAULT_READING_KEY = "swiss_utility_default_reading";
  const SITE_SELECTION_KEY = "swiss_utility_site_selection";
  const SITE_READING_KEY = "swiss_utility_site_reading";
  const READER_SETTINGS_KEY = "swiss_utility_reader_settings";
  const SITE_CUSTOM_KEY = "swiss_utility_site_custom";
  const PANEL_ID = "swiss-utility-panel";
  const READER_ID = "swiss-utility-reader";
  const INLINE_ATTRS = [
    "oncontextmenu",
    "onselectstart",
    "oncopy",
    "oncut",
    "ondragstart",
    "onmousedown",
    "onmouseup",
    "onkeydown",
    "onkeyup"
  ];

  const hostname = window.location.hostname;

  let selectionStyleEl = null;
  let readingStyleEl = null;
  let observer = null;
  let listenersActive = false;
  const listeners = [];

  let lastSelectionEnabled = false;
  let lastReadingModeEnabled = false;
  let panelVisible = false;
  let readerReady = false;
  let panelHost = null;
  let panelRoot = null;
  let panelStyleEl = null;

  let siteSelectionMap = {};
  let siteReadingMap = {};
  let defaultSelectionEnabled = false;
  let defaultReadingEnabled = false;
  let siteCustomMap = {};
  let lastCustomEnabled = false;
  let customState = { enabled: false, css: "", js: "" };
  let lastCustomJsApplied = "";
  let lastCustomJsStatus = "idle";
  let lastCustomJsMessage = "";

  const DEFAULT_READER_SETTINGS = {
    fontFamily: "Georgia",
    fontSize: 18,
    lineHeight: 1.7,
    maxWidth: 820,
    theme: "paper",
    hideImages: false,
    autoRebuild: true
  };

  const READER_THEMES = {
    paper: { background: "#f6f0e6", text: "#1c1b1a", link: "#8a5a2b" },
    warm: { background: "#f3eadc", text: "#2b241d", link: "#7a4e2a" },
    sepia: { background: "#f2e3c5", text: "#3b2f1f", link: "#7f5a35" },
    night: { background: "#141414", text: "#e6e6e6", link: "#9dc3ff" }
  };

  let readerSettings = { ...DEFAULT_READER_SETTINGS };
  let readerObserver = null;
  let readerRebuildTimer = null;
  const readerControls = {};
  let suppressReaderObserver = false;
  let lastReaderRebuildAt = 0;
  const customControls = {};
  let customSaveTimer = null;

  function log(...args) {
    console.log(PREFIX, ...args);
  }

  function isExtensionContextValid() {
    return Boolean(chrome?.runtime?.id);
  }

  function sendMessage(type, payload = {}) {
    if (!isExtensionContextValid()) {
      return Promise.reject(new Error("Extension context invalidated"));
    }
    return chrome.runtime.sendMessage({ type, payload });
  }

  function addSelectionStyle() {
    if (selectionStyleEl) return;
    selectionStyleEl = document.createElement("style");
    selectionStyleEl.id = "swiss-utility-unlock-style";
    selectionStyleEl.textContent = `
      * {
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        -ms-user-select: text !important;
        user-select: text !important;
        -webkit-touch-callout: default !important;
      }
    `;
    const target = document.head || document.documentElement;
    target.appendChild(selectionStyleEl);
  }

  function removeSelectionStyle() {
    if (!selectionStyleEl) return;
    selectionStyleEl.remove();
    selectionStyleEl = null;
  }

  function addReadingModeStyle() {
    if (readingStyleEl) return;
    readingStyleEl = document.createElement("style");
    readingStyleEl.id = "swiss-utility-reading-style";
    readingStyleEl.textContent = `
      html.su-reading-mode,
      html.su-reading-mode body {
        background: var(--su-reader-bg) !important;
      }
      html.su-reading-mode body {
        color: var(--su-reader-text) !important;
      }
      html.su-reading-mode #${READER_ID} {
        display: block !important;
        max-width: var(--su-reader-width);
        margin: 32px auto;
        padding: 0 24px 48px;
        font-family: var(--su-reader-font) !important;
        font-size: var(--su-reader-size) !important;
        line-height: var(--su-reader-line) !important;
        color: var(--su-reader-text) !important;
      }
      html.su-reading-mode #${READER_ID} * {
        font-family: inherit !important;
        font-size: inherit !important;
        line-height: inherit !important;
      }
      html.su-reading-mode #${READER_ID} h1,
      html.su-reading-mode #${READER_ID} h2,
      html.su-reading-mode #${READER_ID} h3,
      html.su-reading-mode #${READER_ID} h4,
      html.su-reading-mode #${READER_ID} h5,
      html.su-reading-mode #${READER_ID} h6 {
        line-height: 1.2 !important;
      }
      html.su-reading-mode #${READER_ID} a {
        color: var(--su-reader-link) !important;
      }
      html.su-reading-mode #${READER_ID} img,
      html.su-reading-mode #${READER_ID} video,
      html.su-reading-mode #${READER_ID} iframe,
      html.su-reading-mode #${READER_ID} canvas {
        max-width: 100% !important;
        height: auto !important;
      }
      html.su-reading-mode.su-reader-hide-images #${READER_ID} img,
      html.su-reading-mode.su-reader-hide-images #${READER_ID} video,
      html.su-reading-mode.su-reader-hide-images #${READER_ID} iframe,
      html.su-reading-mode.su-reader-hide-images #${READER_ID} canvas {
        display: none !important;
      }
      html.su-reading-mode.su-reader-ready body > *:not(#${READER_ID}):not(#${PANEL_ID}) {
        display: none !important;
      }
    `;
    const target = document.head || document.documentElement;
    target.appendChild(readingStyleEl);
  }

  function removeReadingModeStyle() {
    if (!readingStyleEl) return;
    readingStyleEl.remove();
    readingStyleEl = null;
  }

  function applyReaderSettings() {
    const theme = READER_THEMES[readerSettings.theme] || READER_THEMES.paper;
    const fontFamily = readerSettings.fontFamily || "inherit";
    const root = document.documentElement;
    root.style.setProperty("--su-reader-bg", theme.background);
    root.style.setProperty("--su-reader-text", theme.text);
    root.style.setProperty("--su-reader-link", theme.link);
    root.style.setProperty("--su-reader-font", fontFamily);
    root.style.setProperty("--su-reader-font-family", fontFamily);
    root.style.setProperty("--su-reader-size", `${readerSettings.fontSize}px`);
    root.style.setProperty("--su-reader-line", readerSettings.lineHeight.toString());
    root.style.setProperty("--su-reader-width", `${readerSettings.maxWidth}px`);
    root.classList.toggle("su-reader-hide-images", readerSettings.hideImages);
    updateReaderControls();
  }

  function updateReaderControls() {
    if (readerControls.fontFamily) readerControls.fontFamily.value = readerSettings.fontFamily;
    if (readerControls.fontSize) readerControls.fontSize.value = readerSettings.fontSize;
    if (readerControls.fontSizeValue) {
      readerControls.fontSizeValue.textContent = `${readerSettings.fontSize}px`;
    }
    if (readerControls.lineHeight) readerControls.lineHeight.value = readerSettings.lineHeight;
    if (readerControls.lineHeightValue) {
      readerControls.lineHeightValue.textContent = readerSettings.lineHeight.toFixed(2);
    }
    if (readerControls.maxWidth) readerControls.maxWidth.value = readerSettings.maxWidth;
    if (readerControls.maxWidthValue) {
      readerControls.maxWidthValue.textContent = `${readerSettings.maxWidth}px`;
    }
    if (readerControls.theme) readerControls.theme.value = readerSettings.theme;
    if (readerControls.hideImages) readerControls.hideImages.checked = readerSettings.hideImages;
    if (readerControls.autoRebuild) readerControls.autoRebuild.checked = readerSettings.autoRebuild;
  }

  function updateReaderSettings(next) {
    readerSettings = { ...readerSettings, ...next };
    if (isExtensionContextValid()) {
      chrome.storage.local.set({ [READER_SETTINGS_KEY]: readerSettings });
    }
    applyReaderSettings();
    if (lastReadingModeEnabled) {
      if (readerSettings.autoRebuild) {
        startReaderObserver();
      } else {
        stopReaderObserver();
      }
      scheduleReaderRebuild();
    }
  }

  function scheduleReaderRebuild() {
    if (!lastReadingModeEnabled) return;
    clearTimeout(readerRebuildTimer);
    readerRebuildTimer = setTimeout(() => {
      if (!lastReadingModeEnabled) return;
      if (isSelectionActiveInReader()) {
        scheduleReaderRebuild();
        return;
      }
      const now = Date.now();
      if (now - lastReaderRebuildAt < 800) return;
      lastReaderRebuildAt = now;
      buildReaderContent();
    }, 500);
  }

  function isNodeWithin(node, root) {
    if (!node || !root) return false;
    return node === root || root.contains(node);
  }

  function isSelectionActiveInReader() {
    const readerEl = document.getElementById(READER_ID);
    if (!readerEl) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    if (selection.type !== "Range") return false;
    const range = selection.getRangeAt(0);
    const startInReader = isNodeWithin(range.startContainer, readerEl);
    const endInReader = isNodeWithin(range.endContainer, readerEl);
    return startInReader || endInReader;
  }

  function shouldIgnoreReaderMutation(mutations) {
    const readerEl = document.getElementById(READER_ID);
    const panelEl = panelHost;
    return mutations.every((mutation) => {
      const target = mutation.target;
      if (isNodeWithin(target, readerEl) || isNodeWithin(target, panelEl)) return true;
      return false;
    });
  }

  function startReaderObserver() {
    if (readerObserver) return;
    readerObserver = new MutationObserver((mutations) => {
      if (suppressReaderObserver) return;
      if (shouldIgnoreReaderMutation(mutations)) return;
      scheduleReaderRebuild();
    });
    readerObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopReaderObserver() {
    if (!readerObserver) return;
    readerObserver.disconnect();
    readerObserver = null;
  }

  function clearInlineHandlers(root) {
    if (!root || root.nodeType !== 1) return;

    INLINE_ATTRS.forEach((attr) => {
      if (root.hasAttribute(attr)) {
        root.removeAttribute(attr);
      }
    });

    const selector = INLINE_ATTRS.map((attr) => `[${attr}]`).join(",");
    root.querySelectorAll(selector).forEach((node) => {
      INLINE_ATTRS.forEach((attr) => {
        if (node.hasAttribute(attr)) {
          node.removeAttribute(attr);
        }
      });
    });
  }

  function clearDocumentHandlers() {
    const targets = [document, document.documentElement, document.body, window];
    targets.forEach((target) => {
      if (!target) return;
      INLINE_ATTRS.forEach((attr) => {
        const prop = attr.toLowerCase();
        if (prop in target) {
          try {
            target[prop] = null;
          } catch (err) {
            // Some properties are read-only on certain targets.
          }
        }
      });
    });
  }

  function handleContextMenu(event) {
    event.stopImmediatePropagation();
  }

  function handleSelectStart(event) {
    event.stopImmediatePropagation();
  }

  function handleCopy(event) {
    event.stopImmediatePropagation();
  }

  function handleCut(event) {
    event.stopImmediatePropagation();
  }

  function handleDragStart(event) {
    event.stopImmediatePropagation();
  }

  function handleMouseDown(event) {
    if (event.button === 0) {
      event.stopImmediatePropagation();
    }
  }

  function handleKeyDown(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = String(event.key || "").toLowerCase();
    if (key === "c" || key === "x" || key === "a") {
      event.stopImmediatePropagation();
    }
  }

  function addListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    listeners.push({ type, handler, options });
  }

  function addListeners() {
    if (listenersActive) return;
    listenersActive = true;

    addListener("contextmenu", handleContextMenu, true);
    addListener("selectstart", handleSelectStart, true);
    addListener("copy", handleCopy, true);
    addListener("cut", handleCut, true);
    addListener("dragstart", handleDragStart, true);
    addListener("mousedown", handleMouseDown, true);
    addListener("keydown", handleKeyDown, true);
  }

  function removeListeners() {
    if (!listenersActive) return;
    listeners.forEach(({ type, handler, options }) => {
      document.removeEventListener(type, handler, options);
    });
    listeners.length = 0;
    listenersActive = false;
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes") {
          if (INLINE_ATTRS.includes(mutation.attributeName)) {
            mutation.target.removeAttribute(mutation.attributeName);
          }
          return;
        }

        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            clearInlineHandlers(node);
          }
        });
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: INLINE_ATTRS
    });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function enableSelectionUtility() {
    addSelectionStyle();
    addListeners();
    clearDocumentHandlers();
    clearInlineHandlers(document.documentElement);
    startObserver();
  }

  function disableSelectionUtility() {
    removeListeners();
    removeSelectionStyle();
    stopObserver();
  }

  function setSelectionEnabled(enabled) {
    lastSelectionEnabled = enabled;
    if (enabled) {
      enableSelectionUtility();
      log("Right-click and selection enabled");
    } else {
      disableSelectionUtility();
      log("Right-click and selection disabled");
    }
    updatePanelState();
  }

  function ensureReaderContainer() {
    let container = document.getElementById(READER_ID);
    if (container) return container;

    container = document.createElement("div");
    container.id = READER_ID;
    document.body.appendChild(container);
    return container;
  }

  function pickReadingSource() {
    const selectors = [
      "article",
      "main",
      "[role='main']",
      "#content",
      ".content",
      ".article",
      ".post",
      ".entry-content"
    ];

    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((el) => el && el.innerText && el.innerText.trim().length > 200);

    if (candidates.length === 0) {
      return null;
    }

    const best = candidates.reduce((bestEl, el) => {
      const score = (el.innerText || "").trim().length;
      const bestScore = (bestEl.innerText || "").trim().length;
      return score > bestScore ? el : bestEl;
    });

    const bestScore = (best.innerText || "").trim().length;
    if (bestScore < 400) return null;
    return best;
  }

  function buildReaderContent() {
    const container = ensureReaderContainer();
    const source = pickReadingSource();

    suppressReaderObserver = true;
    container.innerHTML = "";

    if (!source) {
      readerReady = false;
      document.documentElement.classList.remove("su-reader-ready");
      container.style.display = "none";
      setTimeout(() => {
        suppressReaderObserver = false;
      }, 0);
      return;
    }

    const clone = source.cloneNode(true);
    clone.querySelectorAll("script, style, nav, footer, header").forEach((el) => el.remove());
    const textLength = (clone.innerText || "").trim().length;
    if (textLength < 200) {
      readerReady = false;
      document.documentElement.classList.remove("su-reader-ready");
      container.style.display = "none";
      setTimeout(() => {
        suppressReaderObserver = false;
      }, 0);
      return;
    }

    container.appendChild(clone);
    container.style.display = "block";
    document.documentElement.classList.add("su-reader-ready");
    readerReady = true;
    setTimeout(() => {
      suppressReaderObserver = false;
    }, 0);
  }

  function setReadingModeEnabled(enabled) {
    lastReadingModeEnabled = enabled;
    if (enabled) {
      applyReaderSettings();
      buildReaderContent();
      document.documentElement.classList.add("su-reading-mode");
      addReadingModeStyle();
      if (readerSettings.autoRebuild) startReaderObserver();
      log("Reading mode enabled");
    } else {
      document.documentElement.classList.remove("su-reading-mode");
      document.documentElement.classList.remove("su-reader-ready");
      readerReady = false;
      removeReadingModeStyle();
      const container = document.getElementById(READER_ID);
      if (container) container.remove();
      stopReaderObserver();
      log("Reading mode disabled");
    }
    updatePanelState();
  }

  function createIcon(type) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line1.setAttribute("x1", "5");
    line1.setAttribute("y1", "12");
    line1.setAttribute("x2", "19");
    line1.setAttribute("y2", "12");

    svg.appendChild(line1);

    if (type === "plus") {
      const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line2.setAttribute("x1", "12");
      line2.setAttribute("y1", "5");
      line2.setAttribute("x2", "12");
      line2.setAttribute("y2", "19");
      svg.appendChild(line2);
    }

    return svg;
  }

  function createSwitch({ checked, onChange }) {
    const label = document.createElement("label");
    label.className = "switch-button";

    const outer = document.createElement("div");
    outer.className = "switch-outer";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(checked);
    input.addEventListener("change", () => onChange(input.checked));

    const button = document.createElement("div");
    button.className = "button";

    const toggle = document.createElement("span");
    toggle.className = "button-toggle";

    const indicator = document.createElement("span");
    indicator.className = "button-indicator";

    button.appendChild(toggle);
    button.appendChild(indicator);
    outer.appendChild(input);
    outer.appendChild(button);
    label.appendChild(outer);

    return { label, input };
  }

  function updatePanelState() {
    const panel = panelRoot;
    if (!panel) return;

    const selectionToggle = panel.querySelector("[data-utility='selection'] input");
    const selectionStatus = panel.querySelector("[data-utility='selection'] .su-status");
    if (selectionToggle) selectionToggle.checked = lastSelectionEnabled;
    if (selectionStatus) {
      selectionStatus.textContent = lastSelectionEnabled ? "Active" : "Disabled";
      selectionStatus.classList.toggle("su-off", !lastSelectionEnabled);
    }

    const readingToggle = panel.querySelector("[data-utility='reading'] input");
    const readingStatus = panel.querySelector("[data-utility='reading'] .su-status");
    if (readingToggle) readingToggle.checked = lastReadingModeEnabled;
    if (readingStatus) {
      if (!lastReadingModeEnabled) {
        readingStatus.textContent = "Disabled";
        readingStatus.classList.add("su-off");
      } else if (!readerReady) {
        readingStatus.textContent = "No content detected";
        readingStatus.classList.add("su-off");
      } else {
        readingStatus.textContent = "Active";
        readingStatus.classList.remove("su-off");
      }
    }

    const customToggle = panel.querySelector("[data-utility='custom'] input");
    const customStatus = panel.querySelector("[data-utility='custom'] .su-status");
    if (customToggle) customToggle.checked = lastCustomEnabled;
    if (customStatus) {
      customStatus.textContent = lastCustomEnabled ? "Active" : "Disabled";
      customStatus.classList.toggle("su-off", !lastCustomEnabled);
    }

    if (customControls.jsStatus) {
      customControls.jsStatus.textContent = lastCustomJsMessage || "";
      customControls.jsStatus.classList.toggle("su-off", lastCustomJsStatus === "error");
    }

    if (customControls.cssInput) {
      const active = document.activeElement === customControls.cssInput;
      if (!active) customControls.cssInput.value = customState.css || "";
    }
    if (customControls.jsInput) {
      const active = document.activeElement === customControls.jsInput;
      if (!active) customControls.jsInput.value = customState.js || "";
    }
  }

  function updateMinimizeIcon(panel) {
    const btn = panel.querySelector(".su-minimize");
    if (!btn) return;
    btn.innerHTML = "";
    const icon = panel.classList.contains("su-minimized") ? createIcon("plus") : createIcon("minus");
    btn.appendChild(icon);
    btn.setAttribute(
      "aria-label",
      panel.classList.contains("su-minimized") ? "Expand panel" : "Minimize panel"
    );
  }

  function toggleMinimized(panel) {
    panel.classList.toggle("su-minimized");
    updateMinimizeIcon(panel);
  }

  function createSettingsSection(titleText) {
    const section = document.createElement("div");
    section.className = "su-settings-section";

    const title = document.createElement("div");
    title.className = "su-settings-title";
    title.textContent = titleText;

    section.appendChild(title);
    return section;
  }

  function createSelectRow({ label, options, value, onChange, controlKey }) {
    const row = document.createElement("div");
    row.className = "su-settings-row";

    const labelEl = document.createElement("div");
    labelEl.className = "su-settings-label";
    labelEl.textContent = label;

    const select = document.createElement("select");
    select.className = "su-settings-select";
    options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    });
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));

    if (controlKey) readerControls[controlKey] = select;

    row.appendChild(labelEl);
    row.appendChild(select);
    return row;
  }

  function createRangeRow({ label, min, max, step, value, unit, onChange, controlKey, valueKey }) {
    const row = document.createElement("div");
    row.className = "su-settings-row su-settings-row--range";

    const labelEl = document.createElement("div");
    labelEl.className = "su-settings-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "su-settings-value";
    valueEl.textContent = `${value}${unit}`;

    const input = document.createElement("input");
    input.className = "su-settings-range";
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("input", () => onChange(Number(input.value)));

    if (controlKey) readerControls[controlKey] = input;
    if (valueKey) readerControls[valueKey] = valueEl;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    row.appendChild(input);
    return row;
  }

  function createToggleRow({ label, checked, onChange, controlKey }) {
    const row = document.createElement("div");
    row.className = "su-settings-row";

    const labelEl = document.createElement("div");
    labelEl.className = "su-settings-label";
    labelEl.textContent = label;

    const { label: toggleLabel, input } = createSwitch({
      checked,
      onChange
    });

    if (controlKey) readerControls[controlKey] = input;

    row.appendChild(labelEl);
    row.appendChild(toggleLabel);
    return row;
  }

  function buildReadingSettings() {
    const container = document.createElement("div");
    container.className = "su-settings";

    const typography = createSettingsSection("Typography");
    typography.appendChild(
      createSelectRow({
        label: "Font",
        options: [
          { label: "Site default", value: "" },
          { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
          { label: "Charter", value: "Charter, 'Georgia', serif" },
          { label: "Merriweather", value: "'Merriweather', Georgia, serif" },
          { label: "Source Serif", value: "'Source Serif Pro', Georgia, serif" },
          { label: "Times New Roman", value: "'Times New Roman', serif" }
        ],
        value: readerSettings.fontFamily,
        onChange: (value) => updateReaderSettings({ fontFamily: value }),
        controlKey: "fontFamily"
      })
    );
    typography.appendChild(
      createRangeRow({
        label: "Font size",
        min: 14,
        max: 24,
        step: 1,
        value: readerSettings.fontSize,
        unit: "px",
        onChange: (value) => updateReaderSettings({ fontSize: value }),
        controlKey: "fontSize",
        valueKey: "fontSizeValue"
      })
    );
    typography.appendChild(
      createRangeRow({
        label: "Line height",
        min: 1.3,
        max: 2.0,
        step: 0.05,
        value: readerSettings.lineHeight,
        unit: "",
        onChange: (value) => updateReaderSettings({ lineHeight: Number(value.toFixed(2)) }),
        controlKey: "lineHeight",
        valueKey: "lineHeightValue"
      })
    );
    typography.appendChild(
      createRangeRow({
        label: "Max width",
        min: 560,
        max: 980,
        step: 20,
        value: readerSettings.maxWidth,
        unit: "px",
        onChange: (value) => updateReaderSettings({ maxWidth: value }),
        controlKey: "maxWidth",
        valueKey: "maxWidthValue"
      })
    );

    const theme = createSettingsSection("Theme");
    theme.appendChild(
      createSelectRow({
        label: "Palette",
        options: [
          { label: "Paper", value: "paper" },
          { label: "Warm", value: "warm" },
          { label: "Sepia", value: "sepia" },
          { label: "Night", value: "night" }
        ],
        value: readerSettings.theme,
        onChange: (value) => updateReaderSettings({ theme: value }),
        controlKey: "theme"
      })
    );
    theme.appendChild(
      createToggleRow({
        label: "Hide images",
        checked: readerSettings.hideImages,
        onChange: (value) => updateReaderSettings({ hideImages: value }),
        controlKey: "hideImages"
      })
    );

    const behavior = createSettingsSection("Behavior");
    behavior.appendChild(
      createToggleRow({
        label: "Auto rebuild",
        checked: readerSettings.autoRebuild,
        onChange: (value) => updateReaderSettings({ autoRebuild: value }),
        controlKey: "autoRebuild"
      })
    );

    const rebuildRow = document.createElement("div");
    rebuildRow.className = "su-settings-row";
    const rebuildLabel = document.createElement("div");
    rebuildLabel.className = "su-settings-label";
    rebuildLabel.textContent = "Rebuild now";
    const rebuildBtn = document.createElement("button");
    rebuildBtn.type = "button";
    rebuildBtn.className = "su-settings-button";
    rebuildBtn.textContent = "Rebuild";
    rebuildBtn.addEventListener("click", () => buildReaderContent());
    rebuildRow.appendChild(rebuildLabel);
    rebuildRow.appendChild(rebuildBtn);
    behavior.appendChild(rebuildRow);

    container.appendChild(typography);
    container.appendChild(theme);
    container.appendChild(behavior);

    return container;
  }

  function buildCustomInjectionSettings() {
    const container = document.createElement("div");
    container.className = "su-settings";

    const warning = document.createElement("div");
    warning.className = "su-utility-note";
    warning.textContent = "Note: Some sites block injected JS via CSP.";
    container.appendChild(warning);

    const cssLabel = document.createElement("div");
    cssLabel.className = "su-settings-label";
    cssLabel.textContent = "Custom CSS";
    const cssArea = document.createElement("textarea");
    cssArea.className = "su-settings-textarea";
    cssArea.rows = 6;
    cssArea.placeholder = "/* CSS applied to this site */";
    cssArea.addEventListener("input", scheduleCustomSave);
    customControls.cssInput = cssArea;

    const jsLabel = document.createElement("div");
    jsLabel.className = "su-settings-label";
    jsLabel.textContent = "Custom JS";
    const jsArea = document.createElement("textarea");
    jsArea.className = "su-settings-textarea";
    jsArea.rows = 6;
    jsArea.placeholder = "// JS injected into this page";
    jsArea.addEventListener("input", scheduleCustomSave);
    customControls.jsInput = jsArea;

    const jsStatus = document.createElement("div");
    jsStatus.className = "su-settings-status";
    customControls.jsStatus = jsStatus;

    const actions = document.createElement("div");
    actions.className = "su-settings-row";
    const applyLabel = document.createElement("div");
    applyLabel.className = "su-settings-label";
    applyLabel.textContent = "Apply now";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "su-settings-button";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => {
      customState = {
        enabled: lastCustomEnabled,
        css: cssArea.value || "",
        js: jsArea.value || ""
      };
      updateCustomStorage(customState);
      if (lastCustomEnabled) applyCustomState(customState);
    });
    actions.appendChild(applyLabel);
    actions.appendChild(applyBtn);

    container.appendChild(cssLabel);
    container.appendChild(cssArea);
    container.appendChild(jsLabel);
    container.appendChild(jsArea);
    container.appendChild(jsStatus);
    container.appendChild(actions);

    return container;
  }

  function setOpenUtility(panel, id) {
    const currentOpen = panel.querySelector(".su-utility.is-open");
    if (currentOpen && currentOpen.dataset.utility === id) {
      currentOpen.classList.remove("is-open");
    } else {
    panel.querySelectorAll(".su-utility").forEach((utility) => {
      const isTarget = utility.dataset.utility === id;
      utility.classList.toggle("is-open", isTarget);
    });
    }

    panel.querySelectorAll(".su-collapse-icon").forEach((icon) => {
      const utility = icon.closest(".su-utility");
      if (!utility) return;
      const open = utility.classList.contains("is-open");
      icon.innerHTML = "";
      icon.appendChild(createIcon(open ? "minus" : "plus"));
    });
  }

  function createUtilityCard({ id, title, description, note, checked, onToggle }) {
    const utility = document.createElement("div");
    utility.className = "su-utility";
    utility.dataset.utility = id;

    const header = document.createElement("div");
    header.className = "su-utility-header";

    const utilTitle = document.createElement("div");
    utilTitle.className = "su-utility-title";
    utilTitle.textContent = title;

    const collapseIcon = document.createElement("span");
    collapseIcon.className = "su-collapse-icon";
    collapseIcon.appendChild(createIcon("plus"));

    header.appendChild(utilTitle);
    header.appendChild(collapseIcon);

    const body = document.createElement("div");
    body.className = "su-utility-body";

    const utilDesc = document.createElement("div");
    utilDesc.className = "su-utility-desc";
    utilDesc.textContent = description;

    const utilNote = document.createElement("div");
    utilNote.className = "su-utility-note";
    utilNote.textContent = note;

    const utilActions = document.createElement("div");
    utilActions.className = "su-utility-actions";

    const { label: toggleLabel } = createSwitch({
      checked,
      onChange: onToggle
    });

    const status = document.createElement("div");
    status.className = "su-status";

    utilActions.appendChild(toggleLabel);
    utilActions.appendChild(status);

    body.appendChild(utilDesc);
    body.appendChild(utilNote);
    body.appendChild(utilActions);

    utility.appendChild(header);
    utility.appendChild(body);

    header.addEventListener("click", () => {
      const panel = utility.closest(".su-panel");
      if (!panel) return;
      setOpenUtility(panel, id);
    });

    return utility;
  }

  function createPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "su-panel";

    const header = document.createElement("div");
    header.className = "su-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "su-title-wrap";

    const icon = document.createElement("img");
    icon.className = "su-icon";
    icon.src = chrome.runtime.getURL("icons/icon-32.png");
    icon.alt = "";
    icon.loading = "lazy";

    const title = document.createElement("div");
    title.className = "su-title";
    title.textContent = "Swiss Utility";

    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "su-minimize";
    minimizeBtn.type = "button";
    minimizeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMinimized(panel);
    });

    titleWrap.appendChild(icon);
    titleWrap.appendChild(title);

    header.appendChild(titleWrap);
    header.appendChild(minimizeBtn);

    const content = document.createElement("div");
    content.className = "su-content";

    const sectionTitle = document.createElement("div");
    sectionTitle.className = "su-section-title";
    sectionTitle.textContent = "Utilities";

    const utilities = document.createElement("div");
    utilities.className = "su-utilities";

    const selectionUtility = createUtilityCard({
      id: "selection",
      title: "Right-click & Select",
      description: "Enable right-click menu and text selection/copy on this page.",
      note: "No refresh required.",
      checked: lastSelectionEnabled,
      onToggle: (value) => updateSiteToggle(SITE_SELECTION_KEY, value)
    });

    const readingUtility = createUtilityCard({
      id: "reading",
      title: "Reading Mode",
      description: "Simplify layout and improve readability on this page.",
      note: "No refresh required.",
      checked: lastReadingModeEnabled,
      onToggle: (value) => updateSiteToggle(SITE_READING_KEY, value)
    });

    const customUtility = createUtilityCard({
      id: "custom",
      title: "Custom CSS / JS",
      description: "Inject custom CSS and JS on this site.",
      note: "Applies automatically on this site when enabled.",
      checked: lastCustomEnabled,
      onToggle: (value) => {
        const nextState = { ...customState, enabled: value };
        updateCustomStorage(nextState);
        applyCustomState(nextState);
      }
    });

    const readingBody = readingUtility.querySelector(".su-utility-body");
    if (readingBody) {
      readingBody.appendChild(buildReadingSettings());
    }

    const customBody = customUtility.querySelector(".su-utility-body");
    if (customBody) {
      customBody.appendChild(buildCustomInjectionSettings());
    }

    utilities.appendChild(selectionUtility);
    utilities.appendChild(readingUtility);
    utilities.appendChild(customUtility);

    content.appendChild(sectionTitle);
    content.appendChild(utilities);

    panel.appendChild(header);
    panel.appendChild(content);

    panel.addEventListener("click", (event) => {
      if (!panel.classList.contains("su-minimized")) return;
      if (event.target && event.target.closest(".su-minimize")) return;
      toggleMinimized(panel);
    });

    updateMinimizeIcon(panel);
    updatePanelState();
    setOpenUtility(panel, "selection");

    return panel;
  }

  function injectPanelStyles(shadowRoot) {
    if (panelStyleEl) return;
    panelStyleEl = document.createElement("style");
    panelStyleEl.textContent = `
      .su-panel {
        position: fixed;
        right: 14px;
        bottom: 14px;
        width: 280px;
        max-width: 92vw;
        z-index: 2147483647;
        background: #101316;
        color: #e6eef7;
        border: 1px solid #2a3038;
        border-radius: 12px;
        padding: 12px;
        font: 12px/1.4 "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      }

      .su-panel.su-hidden {
        display: none;
      }

      .su-panel.su-minimized {
        width: auto;
        padding: 8px 10px;
        cursor: pointer;
      }

      .su-panel.su-minimized .su-content {
        display: none;
      }

      .su-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }

      .su-title-wrap {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .su-icon {
        width: 18px;
        height: 18px;
        border-radius: 4px;
      }

      .su-title {
        font-weight: 700;
        font-size: 13px;
      }

      .su-minimize {
        border: 1px solid #2f3a46;
        background: #171d24;
        color: #e6eef7;
        padding: 4px;
        border-radius: 8px;
        cursor: pointer;
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .su-minimize:hover {
        background: #1f2630;
      }

      .su-section-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #9fb7d0;
        margin: 0 0 6px;
      }

      .su-utilities {
        display: grid;
        gap: 8px;
      }

      .su-utility {
        border: 1px solid #222a33;
        background: #151a20;
        border-radius: 10px;
        overflow: hidden;
      }

      .su-utility-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        cursor: pointer;
      }

      .su-utility-title {
        font-size: 12px;
        font-weight: 600;
      }

      .su-utility-body {
        display: none;
        padding: 8px 12px 12px;
        border-top: 1px solid #1e242c;
        gap: 8px;
      }

      .su-utility.is-open .su-utility-body {
        display: grid;
      }

      .su-utility-desc {
        color: #c0ccdb;
        font-size: 11px;
      }

      .su-utility-note {
        color: #9fb7d0;
        font-size: 10px;
      }

      .su-utility-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .su-collapse-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        color: #9fb7d0;
      }

      .su-status {
        font-size: 10px;
        color: #7ddc9f;
      }

      .su-status.su-off {
        color: #f2b5b5;
      }

      .su-settings {
        display: grid;
        gap: 12px;
        margin-top: 8px;
      }

      .su-settings-section {
        display: grid;
        gap: 8px;
      }

      .su-settings-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #9fb7d0;
      }

      .su-settings-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
      }

      .su-settings-row--range {
        grid-template-columns: 1fr auto;
      }

      .su-settings-label {
        font-size: 11px;
        color: #d6dee7;
      }

      .su-settings-value {
        font-size: 11px;
        color: #9fb7d0;
      }

      .su-settings-range {
        grid-column: 1 / -1;
        accent-color: #60d480;
      }

      .su-settings-select {
        background: #171d24;
        color: #e6eef7;
        border: 1px solid #2f3a46;
        border-radius: 8px;
        padding: 4px 6px;
        font-size: 11px;
      }

      .su-settings-button {
        border: 1px solid #2f3a46;
        background: #171d24;
        color: #e6eef7;
        padding: 4px 8px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 11px;
      }

      .su-settings-button:hover {
        background: #1f2630;
      }

      .su-settings-textarea {
        width: 100%;
        min-height: 80px;
        background: #0f1317;
        color: #e6eef7;
        border: 1px solid #2f3a46;
        border-radius: 8px;
        padding: 8px;
        font-size: 11px;
        resize: vertical;
        box-sizing: border-box;
      }

      .su-settings-textarea:focus {
        outline: 1px solid #60d480;
        border-color: #60d480;
      }

      .su-settings-status {
        font-size: 10px;
        color: #9fb7d0;
        margin-top: -2px;
      }

      /* Switch UI (adapted from Uiverse.io by Admin12121) */
      .switch-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 28px;
      }

      .switch-button .switch-outer {
        height: 100%;
        background: #252532;
        width: 60px;
        border-radius: 999px;
        box-shadow: inset 0 4px 8px 0 #16151c, 0 3px 6px -2px #403f4e;
        border: 1px solid #32303e;
        padding: 4px;
        box-sizing: border-box;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        position: relative;
      }

      .switch-button .switch-outer input[type="checkbox"] {
        opacity: 0;
        appearance: none;
        position: absolute;
      }

      .switch-button .switch-outer .button {
        width: 100%;
        height: 100%;
        display: flex;
        position: relative;
        justify-content: space-between;
      }

      .switch-button .switch-outer .button-toggle {
        height: 20px;
        width: 20px;
        background: linear-gradient(#3b3a4e, #272733);
        border-radius: 100%;
        box-shadow: inset 0 3px 3px 0 #424151, 0 4px 12px 0 #0f0e17;
        position: relative;
        z-index: 2;
        transition: left 0.3s ease-in;
        left: 0;
      }

      .switch-button
        .switch-outer
        input[type="checkbox"]:checked
        + .button
        .button-toggle {
        left: 52%;
      }

      .switch-button .switch-outer .button-indicator {
        height: 12px;
        width: 12px;
        top: 50%;
        transform: translateY(-50%);
        border-radius: 50%;
        border: 2px solid #ef565f;
        box-sizing: border-box;
        right: 6px;
        position: relative;
      }

      .switch-button
        .switch-outer
        input[type="checkbox"]:checked
        + .button
        .button-indicator {
        animation: su-indicator 0.6s forwards;
      }

      @keyframes su-indicator {
        30% {
          opacity: 0;
        }

        0% {
          opacity: 1;
        }

        100% {
          opacity: 1;
          border: 2px solid #60d480;
          left: -66%;
        }
      }
    `;
    shadowRoot.appendChild(panelStyleEl);
  }

  function ensurePanel() {
    if (panelHost) return;
    if (!document.body) {
      setTimeout(ensurePanel, 50);
      return;
    }
    panelHost = document.createElement("div");
    panelHost.id = PANEL_ID;
    const shadowRoot = panelHost.attachShadow({ mode: "open" });
    injectPanelStyles(shadowRoot);
    panelRoot = createPanel();
    shadowRoot.appendChild(panelRoot);
    if (!panelVisible) panelHost.style.display = "none";
    document.body.appendChild(panelHost);
  }

  function setPanelVisible(visible) {
    panelVisible = visible;
    ensurePanel();
    if (!panelHost) return;
    panelHost.style.display = visible ? "block" : "none";
  }

  function togglePanel() {
    setPanelVisible(!panelVisible);
  }

  function updateSiteToggle(key, value) {
    const map = key === SITE_SELECTION_KEY ? { ...siteSelectionMap } : { ...siteReadingMap };
    map[hostname] = value;
    if (isExtensionContextValid()) {
      chrome.storage.local.set({ [key]: map });
    }
  }

  function updateCustomStorage(nextState) {
    siteCustomMap = { ...siteCustomMap, [hostname]: nextState };
    if (isExtensionContextValid()) {
      chrome.storage.local.set({ [SITE_CUSTOM_KEY]: siteCustomMap });
    }
  }

  function scheduleCustomSave() {
    if (!customControls.cssInput || !customControls.jsInput) return;
    clearTimeout(customSaveTimer);
    customSaveTimer = setTimeout(() => {
      customState = {
        enabled: lastCustomEnabled,
        css: customControls.cssInput.value || "",
        js: customControls.jsInput.value || ""
      };
      updateCustomStorage(customState);
      if (lastCustomEnabled) applyCustomState(customState);
    }, 500);
  }

  function ensureCustomCssEl() {
    let el = document.getElementById("su-custom-css");
    if (!el) {
      el = document.createElement("style");
      el.id = "su-custom-css";
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function applyCustomState(state) {
    customState = { ...customState, ...state };
    lastCustomEnabled = customState.enabled === true;

    if (!lastCustomEnabled) {
      const cssEl = document.getElementById("su-custom-css");
      if (cssEl) cssEl.remove();
      lastCustomJsStatus = "idle";
      lastCustomJsMessage = "";
      updatePanelState();
      return;
    }

    if (customState.css && customState.css.trim()) {
      const cssEl = ensureCustomCssEl();
      cssEl.textContent = customState.css;
    } else {
      const cssEl = document.getElementById("su-custom-css");
      if (cssEl) cssEl.remove();
    }

    const jsCode = (customState.js || "").trim();
    if (jsCode && jsCode !== lastCustomJsApplied) {
      lastCustomJsApplied = jsCode;
      lastCustomJsStatus = "pending";
      lastCustomJsMessage = "Applying JS...";
      updatePanelState();
      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (isExtensionContextValid()) {
        chrome.storage.local.set({ swiss_utility_custom_job: jobId });
      }
      sendMessage("apply_custom_js", { code: jsCode, jobId }).catch(() => {});
    }

    updatePanelState();
  }

  function applyStoredState() {
    const selectionValue =
      Object.prototype.hasOwnProperty.call(siteSelectionMap, hostname)
        ? siteSelectionMap[hostname]
        : defaultSelectionEnabled;

    const readingValue =
      Object.prototype.hasOwnProperty.call(siteReadingMap, hostname)
        ? siteReadingMap[hostname]
        : defaultReadingEnabled;

    const customValue = Object.prototype.hasOwnProperty.call(siteCustomMap, hostname)
      ? siteCustomMap[hostname]
      : customState;

    if (selectionValue === true || readingValue === true || customValue?.enabled === true) {
      setPanelVisible(true);
    }

    setSelectionEnabled(selectionValue === true);
    setReadingModeEnabled(readingValue === true);
    if (customValue) applyCustomState(customValue);
  }

  function loadState() {
    if (!isExtensionContextValid()) return;
    chrome.storage.local.get(
      [
        STORAGE_KEY,
        READING_MODE_KEY,
        DEFAULT_SELECTION_KEY,
        DEFAULT_READING_KEY,
        SITE_SELECTION_KEY,
        SITE_READING_KEY,
        READER_SETTINGS_KEY,
        SITE_CUSTOM_KEY
      ],
      (result) => {
        if (!isExtensionContextValid()) return;
        defaultSelectionEnabled = result[DEFAULT_SELECTION_KEY] === true;
        defaultReadingEnabled = result[DEFAULT_READING_KEY] === true;
        siteSelectionMap = result[SITE_SELECTION_KEY] || {};
        siteReadingMap = result[SITE_READING_KEY] || {};
        siteCustomMap = result[SITE_CUSTOM_KEY] || {};
        readerSettings = { ...DEFAULT_READER_SETTINGS, ...(result[READER_SETTINGS_KEY] || {}) };
        applyReaderSettings();

        if (Object.keys(siteSelectionMap).length === 0 && result[STORAGE_KEY] === true) {
          siteSelectionMap[hostname] = true;
        }

        if (Object.keys(siteReadingMap).length === 0 && result[READING_MODE_KEY] === true) {
          siteReadingMap[hostname] = true;
        }

        applyStoredState();
      }
    );
  }

  function handleCustomJsResult(event) {
    if (!event || !event.data) return;
    const data = event.data;
    if (data.source !== "swiss-utility" || data.type !== "custom_js_result") return;
    if (!data.jobId) return;

    if (isExtensionContextValid()) {
      chrome.storage.local.get(["swiss_utility_custom_job"], (result) => {
        if (!isExtensionContextValid()) return;
        if (result.swiss_utility_custom_job !== data.jobId) return;
        lastCustomJsStatus = data.ok ? "success" : "error";
        lastCustomJsMessage = data.ok ? "JS applied" : "JS blocked by CSP";
        updatePanelState();
      });
    }
  }

  if (isExtensionContextValid()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.type) return;
      if (message.type === "toggle_panel") {
        togglePanel();
        sendResponse({ ok: true });
        return true;
      }
    });
  }

  function init() {
    ensurePanel();
    loadState();
    window.addEventListener("message", handleCustomJsResult);

    if (isExtensionContextValid()) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        let shouldApply = false;

        if (DEFAULT_SELECTION_KEY in changes) {
          defaultSelectionEnabled = changes[DEFAULT_SELECTION_KEY].newValue === true;
          shouldApply = true;
        }

        if (DEFAULT_READING_KEY in changes) {
          defaultReadingEnabled = changes[DEFAULT_READING_KEY].newValue === true;
          shouldApply = true;
        }

        if (SITE_SELECTION_KEY in changes) {
          siteSelectionMap = changes[SITE_SELECTION_KEY].newValue || {};
          shouldApply = true;
        }

      if (SITE_READING_KEY in changes) {
        siteReadingMap = changes[SITE_READING_KEY].newValue || {};
        shouldApply = true;
      }

      if (SITE_CUSTOM_KEY in changes) {
        siteCustomMap = changes[SITE_CUSTOM_KEY].newValue || {};
        const nextCustom = siteCustomMap[hostname] || customState;
        applyCustomState(nextCustom);
      }

      if (READER_SETTINGS_KEY in changes) {
        readerSettings = {
          ...DEFAULT_READER_SETTINGS,
          ...(changes[READER_SETTINGS_KEY].newValue || {})
        };
          applyReaderSettings();
          if (lastReadingModeEnabled) scheduleReaderRebuild();
        }

        if (shouldApply) applyStoredState();
      });
    }

    sendMessage("content_ready", { url: window.location.href }).catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
