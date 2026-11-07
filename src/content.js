// src/content.js
// Inline translation engine, page/selection translation and toasts.

(function () {
  "use strict";

  if (window.__heliumInlineTranslatorLoaded) return;
  window.__heliumInlineTranslatorLoaded = true;

  const HIT = globalThis.HIT;
  if (!HIT) return;

  const {
    toGoogleCode,
    separatorFor,
  } = HIT;

  const DEBUG = false;
  const log = (...args) => {
    if (DEBUG) console.log("[Helium Inline Translator]", ...args);
  };

  const CACHE_LIMIT = 1500;
  const BATCH_CHAR_LIMIT = 4000;
  const MAX_BATCH_ITEMS = 24;
  const MAX_PARALLEL_REQUESTS = 3;
  const SINGLE_TEXT_LIMIT = 4500;
  const isTopFrame = window.top === window;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  /** @type {Map<Text, string>} */
  let pageOriginals = new Map();
  /** @type {Map<Text, string>} */
  let pageTranslated = new Map();
  let isPageTranslated = false;
  let isPagePartial = false;
  let isTranslatingPage = false;
  let pageRunId = 0;

  /** @type {Array<{node: Text, original: string, translated: string}>|null} */
  let selectionState = null;
  let isSelectionTranslated = false;
  let isTranslatingSelection = false;
  let lastSelectionText = "";

  const translationCache = new Map();
  let targetLanguage = "en";

  let mutationObserver = null;
  let mutationTimer = null;
  let navigationTimer = null;
  let currentPageKey = "";
  /** @type {Set<ShadowRoot>} Open shadow roots already watched by the observer. */
  let observedShadowRoots = new Set();
  /** @type {Array<ReturnType<typeof setTimeout>>} */
  let shadowRescanTimers = [];

  // Chromium/Edge reject Alt+Shift+W as an extension command, so the page
  // shortcut also works through an in-page listener when the command has no
  // assigned key.
  let pageCommandAssigned = true;
  let shortcutRefreshTimer = null;

  let toastState = { host: null, shadow: null, persistent: false, timer: null };

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  function storageGet(area, defaults) {
    return new Promise((resolve) => {
      try {
        chrome.storage[area].get(defaults, (data) => resolve(data || {}));
      } catch (error) {
        resolve(defaults || {});
      }
    });
  }

  function getSettings() {
    return storageGet("sync", { targetLanguage: "en" });
  }

  function setBadge(state) {
    try {
      const result = chrome.runtime.sendMessage({ action: "setBadge", state });
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (error) {
      /* extension context can disappear on navigation */
    }
  }

  function cacheGet(key) {
    if (!translationCache.has(key)) return undefined;
    const value = translationCache.get(key);
    translationCache.delete(key);
    translationCache.set(key, value);
    return value;
  }

  function cacheSet(key, value) {
    if (translationCache.has(key)) translationCache.delete(key);
    translationCache.set(key, value);
    while (translationCache.size > CACHE_LIMIT) {
      translationCache.delete(translationCache.keys().next().value);
    }
  }

  // -------------------------------------------------------------------------
  // Localized UI strings (chrome.i18n with bundled English fallback)
  // -------------------------------------------------------------------------

  const FALLBACK_STRINGS = {
    toastTranslating: "Translating…",
    toastTranslated: "Page translated.",
    toastReverted: "Original page restored.",
    toastSelectionTranslated: "Selection translated.",
    toastNoSelection: "Select some text first.",
    toastFailed: "Translation failed. Try again.",
    toastPartial: "Some text could not be translated. Press the shortcut again to revert.",
    toastRevert: "Revert",
    toastNothing: "No translatable text found.",
    toastNothingToRevert: "Nothing to revert.",
    toastAlready: "This page is already translated.",
    toastCancelled: "Translation cancelled.",
    toastCancel: "Cancel",
  };

  function t(key, ...substitutions) {
    let value = "";
    try {
      value = chrome.i18n.getMessage(key, substitutions);
    } catch (error) {
      value = "";
    }
    if (!value) {
      value = FALLBACK_STRINGS[key] || key;
      substitutions.forEach((substitution, index) => {
        value = value.replace("$" + (index + 1), substitution);
      });
    }
    return value;
  }

  // -------------------------------------------------------------------------
  // Translation transport
  // -------------------------------------------------------------------------

  function chunkText(text, maxLength) {
    if (text.length <= maxLength) return [text];
    const chunks = [];
    let rest = text;
    while (rest.length > maxLength) {
      const windowText = rest.slice(0, maxLength);
      let cut = -1;
      for (const separator of [". ", "! ", "? ", "\n", " "]) {
        const index = windowText.lastIndexOf(separator);
        if (index > cut) cut = index + separator.length;
      }
      if (cut <= 0) cut = maxLength;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) chunks.push(rest);
    return chunks;
  }

  async function requestChunk(text, language) {
    const key = language + "|" + text;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        action: "getTranslation",
        text,
        targetLanguage: language,
      });
    } catch (error) {
      throw new Error("extension");
    }

    if (
      !response ||
      !response.ok ||
      typeof response.translatedText !== "string"
    ) {
      throw new Error(response?.error || "translate");
    }

    cacheSet(key, response.translatedText);
    return response.translatedText;
  }

  async function requestTranslation(text, language) {
    if (!text) return "";
    if (text.length <= SINGLE_TEXT_LIMIT) {
      return requestChunk(text, language);
    }
    const chunks = chunkText(text, SINGLE_TEXT_LIMIT);
    const translated = [];
    for (const chunk of chunks) {
      translated.push(await requestChunk(chunk, language));
    }
    return translated.join(" ");
  }

  /**
   * Translate a list of independent strings, preserving their boundaries.
   * Falls back to per-string requests if the separator is dropped/translated.
   */
  async function translateTexts(texts, language) {
    if (!texts.length) return [];
    if (texts.length === 1) return [await requestTranslation(texts[0], language)];

    const separator = separatorFor(language);
    const canJoin = texts.every((text) => !text.includes(separator));

    if (canJoin) {
      try {
        const joined = await requestTranslation(texts.join(separator), language);
        const parts = joined.split(separator);
        if (parts.length === texts.length) return parts;
        log(
          "Separator mismatch, falling back:",
          texts.length,
          "vs",
          parts.length,
        );
      } catch (error) {
        log("Joined translation failed, falling back", error);
      }
    }

    if (texts.length <= 8) {
      const results = [];
      for (const text of texts) {
        results.push(await requestTranslation(text, language));
      }
      return results;
    }

    const middle = Math.ceil(texts.length / 2);
    const left = await translateTexts(texts.slice(0, middle), language);
    const right = await translateTexts(texts.slice(middle), language);
    return left.concat(right);
  }

  async function runQueue(items, worker, concurrency, isCancelled) {
    let index = 0;
    const runners = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (index < items.length && !isCancelled()) {
          const item = items[index++];
          await worker(item);
        }
      },
    );
    await Promise.all(runners);
  }

  // -------------------------------------------------------------------------
  // Page text collection
  // -------------------------------------------------------------------------

  const BLOCKED_SELECTOR = [
    "script",
    "style",
    "noscript",
    "textarea",
    "input",
    "select",
    "option",
    "pre",
    "code",
    "kbd",
    "samp",
    "svg",
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[translate="no"]',
    ".notranslate",
    "[aria-hidden='true']",
    "[hidden]",
  ].join(",");

  function isVisible(element) {
    if (!element) return true;
    try {
      if (typeof element.checkVisibility === "function") {
        return element.checkVisibility({
          checkOpacity: false,
          checkVisibilityCSS: true,
        });
      }
    } catch (error) {
      /* fall through */
    }
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  // Walks a root (document body or an open shadow root) plus every open
  // shadow root nested beneath it, calling visit() with each root.
  function forEachRoot(root, visit) {
    visit(root);
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null,
    );
    let element;
    while ((element = walker.nextNode())) {
      if (element.shadowRoot) forEachRoot(element.shadowRoot, visit);
    }
  }

  function collectPageTextNodes(extraBlockedSelector) {
    const nodes = [];
    if (!document.body) return nodes;

    const accept = (node) => {
      const value = node.nodeValue;
      if (!value || !value.trim()) return false;
      const parent = node.parentElement;
      if (!parent) {
        // Text directly under a shadow root has no element parent; there is
        // nothing above it to apply blocked selectors or visibility to.
        return Boolean(
          node.parentNode && node.parentNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE,
        );
      }
      if (parent.closest(BLOCKED_SELECTOR)) return false;
      if (extraBlockedSelector && parent.closest(extraBlockedSelector)) {
        return false;
      }
      if (!isVisible(parent)) return false;
      return true;
    };

    // Include text rendered inside open shadow roots (embedded widgets such
    // as BBC's AQI banner) as well as the light DOM.
    forEachRoot(document.body, (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return accept(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      while (walker.nextNode()) nodes.push(walker.currentNode);
    });

    return nodes;
  }

  function buildBatches(items) {
    const batches = [];
    let current = [];
    let count = 0;
    for (const item of items) {
      const length = item.text.length;
      if (
        current.length > 0 &&
        (count + length > BATCH_CHAR_LIMIT ||
          current.length >= MAX_BATCH_ITEMS)
      ) {
        batches.push(current);
        current = [];
        count = 0;
      }
      current.push(item);
      count += length;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  function preserveEdgeWhitespace(original, translated) {
    const leading = (original.match(/^\s+/) || [""])[0];
    const trailing = (original.match(/\s+$/) || [""])[0];
    const core = String(translated).replace(/^\s+/, "").replace(/\s+$/, "");
    if (!core) return original;
    return leading + core + trailing;
  }

  // -------------------------------------------------------------------------
  // Full-page translation
  // -------------------------------------------------------------------------

  function togglePageTranslation() {
    // Pressing the shortcut again while work is in flight cancels the run and
    // restores anything that was already translated.
    if (isTranslatingPage) {
      cancelPageTranslation();
      return;
    }
    if (isPageTranslated) {
      revertPageTranslation();
    } else {
      handleFullPageTranslation();
    }
  }

  async function handleFullPageTranslation(options = {}) {
    if (isTranslatingPage) {
      showToast(t("toastTranslating"), { persistent: true });
      return;
    }
    if (isPageTranslated && !options.force) {
      showToast(t("toastAlready"), { type: "info", duration: 1800 });
      return;
    }

    if (selectionState) revertSelectionTranslation({ silent: true });

    const nodes = collectPageTextNodes();
    if (!nodes.length) {
      showToast(t("toastNothing"), { type: "info", duration: 2000 });
      return;
    }

    const settings = await getSettings();
    targetLanguage = toGoogleCode(settings.targetLanguage || "en");

    // Another trigger may have started while settings were loading.
    if (isTranslatingPage) return;

    isTranslatingPage = true;
    isPageTranslated = false;
    isPagePartial = false;
    const runId = ++pageRunId;

    pageOriginals = new Map();
    pageTranslated = new Map();

    const items = [];
    for (const node of nodes) {
      const value = node.nodeValue;
      pageOriginals.set(node, value);
      if (value && value.trim()) items.push({ node, text: value });
    }

    if (!items.length) {
      isTranslatingPage = false;
      pageOriginals.clear();
      showToast(t("toastNothing"), { type: "info", duration: 2000 });
      return;
    }

    setBadge("working");
    showToast(t("toastTranslating"), {
      persistent: true,
      progress: { done: 0, total: items.length },
      actionLabel: t("toastCancel"),
      onAction: cancelPageTranslation,
    });

    let completed = 0;
    let failed = 0;
    const batches = buildBatches(items);

    await runQueue(
      batches,
      async (batch) => {
        if (runId !== pageRunId) return;
        const texts = batch.map((item) => item.text);
        try {
          const results = await translateTexts(texts, targetLanguage);
          if (runId !== pageRunId) return;

          batch.forEach((item, index) => {
            const translated = results[index];
            if (translated === undefined) return;
            if (!item.node.isConnected) return;
            // Do not overwrite content that changed while we were translating.
            if (item.node.nodeValue !== item.text) return;
            const value = preserveEdgeWhitespace(item.text, translated);
            item.node.nodeValue = value;
            pageTranslated.set(item.node, value);
          });

          completed += batch.length;
        } catch (error) {
          // A single failed batch must not stop the remaining batches.
          if (runId !== pageRunId) return;
          failed += batch.length;
          log("Page translation batch failed", error);
        } finally {
          if (runId === pageRunId) {
            updateToastProgress(completed + failed, items.length);
          }
        }
      },
      MAX_PARALLEL_REQUESTS,
      () => runId !== pageRunId,
    );

    if (runId !== pageRunId) return;

    isTranslatingPage = false;
    isPageTranslated = pageTranslated.size > 0;
    isPagePartial = isPageTranslated && failed > 0;

    if (!isPageTranslated) {
      pageOriginals.clear();
      isPagePartial = false;
      showToast(t("toastFailed"), { type: "error", duration: 3000 });
      setBadge("error");
      return;
    }

    startMutationObserver();
    // Nodes added while the first pass was running are not reported by the
    // observer (it only starts now), so sweep for them once.
    translateNewContent().catch(() => {});

    if (isPagePartial) {
      // Keep the successful parts reversible, but never claim the whole page
      // was translated.
      setBadge("error");
      showToast(t("toastPartial"), {
        type: "error",
        duration: 5000,
        actionLabel: t("toastRevert"),
        onAction: () => revertPageTranslation(),
      });
    } else {
      setBadge("success");
      showToast(t("toastTranslated"), {
        type: "success",
        duration: 2200,
      });
    }
  }

  function cancelPageTranslation() {
    if (!isTranslatingPage) return;
    pageRunId++;
    for (const [node, original] of pageOriginals) {
      const translated = pageTranslated.get(node);
      if (
        translated !== undefined &&
        node.isConnected &&
        node.nodeValue === translated
      ) {
        node.nodeValue = original;
      }
    }
    pageOriginals.clear();
    pageTranslated.clear();
    isPageTranslated = false;
    isPagePartial = false;
    isTranslatingPage = false;
    stopMutationObserver();
    hideToast();
    setBadge("clear");
    showToast(t("toastCancelled"), { type: "info", duration: 2000 });
  }

  function revertPageTranslation(options = {}) {
    // Cancel any in-flight page or dynamic-content translation.
    pageRunId++;
    isTranslatingPage = false;

    stopMutationObserver();
    hideToast();

    let restored = 0;
    for (const [node, original] of pageOriginals) {
      if (!node.isConnected) continue;
      const translated = pageTranslated.get(node);
      // Only restore if the node still holds our translation. This keeps
      // live/SPA content from being overwritten with stale text.
      if (translated !== undefined && node.nodeValue === translated) {
        node.nodeValue = original;
        restored++;
      }
    }

    pageOriginals.clear();
    pageTranslated.clear();
    isPageTranslated = false;
    isPagePartial = false;
    setBadge("clear");

    if (!options.silent) {
      showToast(
        restored ? t("toastReverted") : t("toastNothingToRevert"),
        {
          type: restored ? "success" : "info",
          duration: 1800,
        },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Dynamically added content
  // -------------------------------------------------------------------------

  function observeShadowRoots() {
    if (!mutationObserver || !document.body) return;
    forEachRoot(document.body, (root) => {
      // Only shadow roots are extra observation targets; the body itself is
      // already observed by startMutationObserver().
      if (root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      if (observedShadowRoots.has(root)) return;
      observedShadowRoots.add(root);
      mutationObserver.observe(root, {
        childList: true,
        subtree: true,
      });
    });
  }

  // A shadow root attached to an already-present host fires no mutation in
  // the light DOM, so re-scan a few times while the page stays translated.
  function scheduleShadowRescan(delay) {
    const timer = setTimeout(() => {
      shadowRescanTimers = shadowRescanTimers.filter(
        (entry) => entry !== timer,
      );
      if (!isPageTranslated || !mutationObserver) return;
      observeShadowRoots();
      translateNewContent().catch(() => {});
    }, delay);
    shadowRescanTimers.push(timer);
  }

  function startMutationObserver() {
    if (mutationObserver || !document.body) return;
    mutationObserver = new MutationObserver((mutations) => {
      const hasAddedNodes = mutations.some(
        (mutation) =>
          mutation.type === "childList" && mutation.addedNodes.length > 0,
      );
      if (!hasAddedNodes) return;
      if (mutationTimer) clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        observeShadowRoots();
        translateNewContent().catch(() => {});
      }, 700);
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    observeShadowRoots();
    scheduleShadowRescan(1500);
    scheduleShadowRescan(5000);
    scheduleShadowRescan(12000);
  }

  function stopMutationObserver() {
    if (mutationTimer) {
      clearTimeout(mutationTimer);
      mutationTimer = null;
    }
    for (const timer of shadowRescanTimers) clearTimeout(timer);
    shadowRescanTimers = [];
    observedShadowRoots = new Set();
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }

  async function translateNewContent() {
    if (!isPageTranslated || isTranslatingPage || !document.body) return;
    const runId = pageRunId;

    // Drop references to nodes the page has removed so long-lived SPAs do not
    // accumulate detached text nodes.
    for (const node of pageOriginals.keys()) {
      if (!node.isConnected) {
        pageOriginals.delete(node);
        pageTranslated.delete(node);
      }
    }

    const nodes = collectPageTextNodes().filter(
      (node) => !pageOriginals.has(node),
    );
    if (!nodes.length) return;

    const items = nodes.map((node) => {
      pageOriginals.set(node, node.nodeValue);
      return { node, text: node.nodeValue };
    });

    const batches = buildBatches(items);
    for (const batch of batches) {
      if (!isPageTranslated || runId !== pageRunId) return;
      try {
        const results = await translateTexts(
          batch.map((item) => item.text),
          targetLanguage,
        );
        if (!isPageTranslated || runId !== pageRunId) return;
        batch.forEach((item, index) => {
          const translated = results[index];
          if (translated === undefined) return;
          if (!item.node.isConnected) return;
          if (item.node.nodeValue !== item.text) return;
          const value = preserveEdgeWhitespace(item.text, translated);
          item.node.nodeValue = value;
          pageTranslated.set(item.node, value);
        });
      } catch (error) {
        log("Failed to translate added content", error);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Selection translation (range-accurate, partial nodes supported)
  // -------------------------------------------------------------------------

  function getSelectionSegments() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!range) return null;

    const root = range.commonAncestorContainer;
    const candidates = [];
    // Collect text under the common ancestor, including any open shadow
    // roots so selections that touch embedded widgets still translate.
    forEachRoot(root, (subRoot) => {
      if (subRoot.nodeType === Node.TEXT_NODE) {
        candidates.push(subRoot);
        return;
      }
      const walker = document.createTreeWalker(
        subRoot,
        NodeFilter.SHOW_TEXT,
        null,
      );
      let node;
      while ((node = walker.nextNode())) candidates.push(node);
    });

    const segments = [];
    for (const candidate of candidates) {
      if (!candidate.nodeValue || !candidate.nodeValue.trim()) continue;
      let intersects = false;
      try {
        intersects = range.intersectsNode(candidate);
      } catch (error) {
        intersects = false;
      }
      if (!intersects) continue;

      let start = 0;
      let end = candidate.nodeValue.length;
      if (candidate === range.startContainer) start = range.startOffset;
      if (candidate === range.endContainer) end = range.endOffset;
      start = Math.max(0, Math.min(start, candidate.nodeValue.length));
      end = Math.max(0, Math.min(end, candidate.nodeValue.length));
      if (end <= start) continue;

      const text = candidate.nodeValue.slice(start, end);
      if (!text.trim()) continue;
      segments.push({ node: candidate, start, end, text });
    }

    if (!segments.length) return null;
    return {
      segments,
      text: segments.map((segment) => segment.text).join(" ").trim(),
    };
  }

  function toggleSelectionTranslation() {
    if (isTranslatingSelection || isTranslatingPage) {
      showToast(t("toastTranslating"), { persistent: true });
      return;
    }

    const selection = getSelectionSegments();

    if (isSelectionTranslated) {
      if (!selection || selection.text === lastSelectionText) {
        revertSelectionTranslation();
        return;
      }
      revertSelectionTranslation({ silent: true });
    }

    if (!selection) {
      showToast(t("toastNoSelection"), { type: "info", duration: 2000 });
      return;
    }

    translateSelection(selection);
  }

  async function translateSelection(selection) {
    const settings = await getSettings();
    targetLanguage = toGoogleCode(settings.targetLanguage || "en");

    isTranslatingSelection = true;
    setBadge("working");
    showToast(t("toastTranslating"), { persistent: true });

    try {
      const results = await translateTexts(
        selection.segments.map((segment) => segment.text),
        targetLanguage,
      );
      if (results.length !== selection.segments.length) {
        throw new Error("Selection translation mismatch");
      }

      const record = [];
      selection.segments.forEach((segment, index) => {
        if (!segment.node.isConnected) return;
        const originalFull = segment.node.nodeValue;
        // Bail out if the node changed while the request was in flight.
        if (originalFull.slice(segment.start, segment.end) !== segment.text) {
          return;
        }
        const translated = preserveEdgeWhitespace(segment.text, results[index]);
        const newFull =
          originalFull.slice(0, segment.start) +
          translated +
          originalFull.slice(segment.end);
        segment.node.nodeValue = newFull;
        record.push({
          node: segment.node,
          original: originalFull,
          translated: newFull,
        });
      });

      if (!record.length) throw new Error("Selection translation mismatch");

      selectionState = record;
      isSelectionTranslated = true;
      lastSelectionText = selection.text;

      const currentSelection = window.getSelection();
      if (currentSelection) currentSelection.removeAllRanges();

      showToast(t("toastSelectionTranslated"), {
        type: "success",
        duration: 1800,
      });
      setBadge("success");
    } catch (error) {
      log("Selection translation failed", error);
      showToast(t("toastFailed"), { type: "error", duration: 3000 });
      setBadge("error");
    } finally {
      isTranslatingSelection = false;
    }
  }

  function revertSelectionTranslation(options = {}) {
    let restored = 0;
    if (selectionState) {
      for (const record of selectionState) {
        if (
          record.node.isConnected &&
          record.node.nodeValue === record.translated
        ) {
          record.node.nodeValue = record.original;
          restored++;
        }
      }
    }
    selectionState = null;
    isSelectionTranslated = false;
    lastSelectionText = "";
    if (!options.silent) {
      showToast(
        restored ? t("toastReverted") : t("toastNothingToRevert"),
        {
          type: restored ? "success" : "info",
          duration: 1600,
        },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Overlay host (toasts)
  // -------------------------------------------------------------------------

  function createShadowHost(id) {
    const host = document.createElement("div");
    host.id = id;
    host.setAttribute("data-hit-ui", "true");
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "z-index: 2147483647",
      "display: block",
      "pointer-events: auto",
    ].join(";");
    const shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
    return { host, shadow };
  }

  // -------------------------------------------------------------------------
  // Toasts / progress
  // -------------------------------------------------------------------------

  function hideToast() {
    if (toastState.timer) {
      clearTimeout(toastState.timer);
      toastState.timer = null;
    }
    if (toastState.host) {
      toastState.host.remove();
    }
    toastState = { host: null, shadow: null, persistent: false, timer: null };
  }

  function showToast(message, options = {}) {
    if (!isTopFrame) return;
    hideToast();

    const { host, shadow } = createShadowHost("hit-translate-toast");
    host.style.bottom = "16px";
    host.style.right = "16px";
    toastState.host = host;
    toastState.shadow = shadow;
    toastState.persistent = Boolean(options.persistent);

    const type = options.type || "info";
    const progress = options.progress || null;

    shadow.innerHTML = [
      "<style>",
      ":host{all:initial}",
      ".hit-toast{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-width:220px;max-width:360px;padding:10px 12px;border-radius:12px;background:#111827;color:#f9fafb;box-shadow:0 10px 30px rgba(0,0,0,.28);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Ubuntu,sans-serif;font-size:12.5px;line-height:1.4}",
      ".hit-toast.success{background:#166534}",
      ".hit-toast.error{background:#991b1b}",
      ".hit-spinner{flex:0 0 auto;width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:hit-spin .8s linear infinite}",
      ".hit-toast.success .hit-spinner,.hit-toast.error .hit-spinner{display:none}",
      ".hit-content{flex:1 1 auto;min-width:0}",
      ".hit-text{white-space:normal;word-break:break-word}",
      ".hit-track{margin-top:6px;height:4px;border-radius:999px;background:rgba(255,255,255,.2);overflow:hidden}",
      ".hit-bar{height:100%;width:0%;background:#a5b4fc;transition:width .2s ease}",
      ".hit-action{flex:0 0 auto;background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:7px;padding:5px 9px;font:inherit;cursor:pointer}",
      ".hit-action:hover{background:rgba(255,255,255,.24)}",
      "@keyframes hit-spin{to{transform:rotate(360deg)}}",
      "@media (prefers-reduced-motion:reduce){.hit-spinner{animation:none}}",
      "</style>",
      '<div class="hit-toast ' + type + '" role="status" aria-live="polite">',
      '<div class="hit-spinner" aria-hidden="true"></div>',
      '<div class="hit-content">',
      '<div class="hit-text"></div>',
      progress ? '<div class="hit-track"><div class="hit-bar"></div></div>' : "",
      "</div>",
      options.actionLabel ? '<button class="hit-action" type="button"></button>' : "",
      "</div>",
    ].join("");

    shadow.querySelector(".hit-text").textContent = message;
    if (options.actionLabel) {
      const actionButton = shadow.querySelector(".hit-action");
      actionButton.textContent = options.actionLabel;
      actionButton.addEventListener("click", () => {
        if (typeof options.onAction === "function") options.onAction();
      });
    }

    if (progress) {
      updateToastProgress(progress.done || 0, progress.total || 0);
    }

    if (!options.persistent && options.duration) {
      toastState.timer = setTimeout(hideToast, options.duration);
    }
  }

  function updateToastProgress(done, total) {
    if (!toastState.shadow) return;
    const text = toastState.shadow.querySelector(".hit-text");
    const bar = toastState.shadow.querySelector(".hit-bar");
    if (text) {
      text.textContent = total
        ? t("toastTranslating") + " " + done + "/" + total
        : t("toastTranslating");
    }
    if (bar && total > 0) {
      bar.style.width = Math.min(100, Math.round((done / total) * 100)) + "%";
    }
  }

  // -------------------------------------------------------------------------
  // Navigation changes (SPA support)
  // -------------------------------------------------------------------------

  function pageKey() {
    return location.origin + location.pathname + location.search;
  }

  function resetForNavigation() {
    if (
      !isPageTranslated &&
      !isTranslatingPage &&
      !isTranslatingSelection &&
      !selectionState
    ) {
      return;
    }

    pageRunId++;
    stopMutationObserver();
    hideToast();

    // Restore anything that is still connected before forgetting the
    // originals. Detached/replaced nodes are skipped, so SPA content that has
    // already been swapped out is never resurrected.
    for (const [node, original] of pageOriginals) {
      const translated = pageTranslated.get(node);
      if (
        translated !== undefined &&
        node.isConnected &&
        node.nodeValue === translated
      ) {
        node.nodeValue = original;
      }
    }

    pageOriginals.clear();
    pageTranslated.clear();
    isPageTranslated = false;
    isPagePartial = false;
    isTranslatingPage = false;
    setBadge("clear");

    if (selectionState) {
      revertSelectionTranslation({ silent: true });
    } else {
      selectionState = null;
      isSelectionTranslated = false;
      lastSelectionText = "";
    }
    isTranslatingSelection = false;
  }

  function watchNavigation() {
    currentPageKey = pageKey();
    navigationTimer = setInterval(() => {
      const key = pageKey();
      if (key === currentPageKey) return;
      currentPageKey = key;
      resetForNavigation();
    }, 1500);
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  function getStatus() {
    return {
      isPageTranslated,
      isPagePartial,
      isTranslatingPage,
      isSelectionTranslated,
      isTranslatingSelection,
      targetLanguage,
      canTranslate: Boolean(document.body),
    };
  }

  function hasTextSelection() {
    const selection = window.getSelection();
    return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== "object") return false;

    switch (request.action) {
      case "translate-full-page":
        togglePageTranslation();
        sendResponse({ ok: true });
        return false;
      case "translate-selection":
        if (!hasTextSelection()) {
          // Only the top frame gives feedback when nothing is selected, and
          // only when focus is not inside a child frame (that frame handles it).
          const active = document.activeElement;
          if (isTopFrame && (!active || active.tagName !== "IFRAME")) {
            toggleSelectionTranslation();
          }
          return false;
        }
        toggleSelectionTranslation();
        sendResponse({ ok: true });
        return false;
      case "revert-translation":
        revertSelectionTranslation({ silent: true });
        revertPageTranslation();
        sendResponse({ ok: true });
        return false;
      case "get-status":
        if (!isTopFrame) return false;
        sendResponse(getStatus());
        return false;
      default:
        return false;
    }
  });

  // -------------------------------------------------------------------------
  // Page shortcut fallback (Alt+Shift+W)
  // -------------------------------------------------------------------------

  async function refreshPageCommandAssignment() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "get-command-shortcuts",
      });
      const pageCommand = response?.commands?.find(
        (command) => command.name === "translate-page",
      );
      pageCommandAssigned = Boolean(pageCommand?.shortcut);
    } catch (error) {
      // Keep assuming the browser handles the command so a transient worker
      // failure can never cause a double toggle.
      pageCommandAssigned = true;
    }
  }

  function handlePageShortcutFallback(event) {
    if (pageCommandAssigned) return;
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (
      event.code !== "KeyW" &&
      String(event.key || "").toLowerCase() !== "w"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    chrome.runtime
      .sendMessage({ action: "trigger-page-shortcut" })
      .catch(() => {});
  }

  function scheduleShortcutRefresh() {
    if (shortcutRefreshTimer) clearTimeout(shortcutRefreshTimer);
    shortcutRefreshTimer = setTimeout(() => {
      shortcutRefreshTimer = null;
      refreshPageCommandAssignment();
    }, 400);
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  function boot() {
    watchNavigation();
    document.addEventListener("keydown", handlePageShortcutFallback, true);
    window.addEventListener("focus", scheduleShortcutRefresh);
    refreshPageCommandAssignment();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
