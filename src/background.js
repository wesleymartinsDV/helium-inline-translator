// src/background.js
// MV3 service worker: translation transport, context menus, commands, badges.

importScripts("shared.js");

const HIT = self.HIT;
const TRANSLATE_ENDPOINT =
  "https://translate.googleapis.com/translate_a/single";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;
const BADGE_TIMEOUT_MS = 4000;

const badgeTimers = new Map();

function swallow(promise) {
  if (promise && typeof promise.catch === "function") promise.catch(() => {});
  return promise;
}

function setBadgeState(state, tabId) {
  const key = typeof tabId === "number" ? tabId : "global";
  if (badgeTimers.has(key)) {
    clearTimeout(badgeTimers.get(key));
    badgeTimers.delete(key);
  }

  const target = typeof tabId === "number" ? { tabId } : {};

  if (state === "working") {
    swallow(chrome.action.setBadgeText({ text: "…", ...target }));
    swallow(chrome.action.setBadgeBackgroundColor({ color: "#667eea", ...target }));
  } else if (state === "success") {
    swallow(chrome.action.setBadgeText({ text: "✓", ...target }));
    swallow(chrome.action.setBadgeBackgroundColor({ color: "#22c55e", ...target }));
  } else if (state === "error") {
    swallow(chrome.action.setBadgeText({ text: "!", ...target }));
    swallow(chrome.action.setBadgeBackgroundColor({ color: "#ef4444", ...target }));
  } else {
    swallow(chrome.action.setBadgeText({ text: "", ...target }));
    return;
  }

  // Best-effort clear. If the worker is suspended the timer may not fire, so
  // tabs.onActivated/onUpdated and the next badge state also clear it.
  const timeoutId = setTimeout(() => {
    swallow(chrome.action.setBadgeText({ text: "", ...target }));
    badgeTimers.delete(key);
  }, BADGE_TIMEOUT_MS);
  badgeTimers.set(key, timeoutId);
}

function clearBadge(tabId) {
  if (badgeTimers.has(tabId)) {
    clearTimeout(badgeTimers.get(tabId));
    badgeTimers.delete(tabId);
  }
  swallow(chrome.action.setBadgeText({ text: "", tabId }));
}

chrome.tabs.onActivated.addListener(({ tabId }) => clearBadge(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") clearBadge(tabId);
});

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

function createContextMenus() {
  const pageTitle =
    chrome.i18n.getMessage("menuTranslatePage") || "Translate entire page";
  const selectionTitle =
    chrome.i18n.getMessage("menuTranslateSelection") ||
    "Translate selected text";

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "translate-page",
      title: pageTitle,
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "translate-selection",
      title: selectionTitle,
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  createContextMenus();

  if (details.reason === "install") {
    chrome.i18n.getAcceptLanguages((languages) => {
      const first = (languages && languages[0]) || "en";
      const uiLanguage = HIT.normalizePageLang(first) || "en";
      swallow(
        chrome.storage.sync.set({
          targetLanguage: HIT.toGoogleCode(uiLanguage),
          uiLanguage,
        }),
      );
    });
  }
});

// Menus persist across browser restarts; only rebuild on startup, never on
// every service-worker wake (that caused flicker and duplicate-id races).
chrome.runtime.onStartup.addListener(createContextMenus);

// ---------------------------------------------------------------------------
// Translation transport
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestTranslation(text, targetLanguage, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body = new URLSearchParams({
      client: "gtx",
      sl: "auto",
      tl: targetLanguage,
      dt: "t",
      q: text,
    });

    const response = await fetch(TRANSLATE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        await sleep(400 * (attempt + 1));
        return requestTranslation(text, targetLanguage, attempt + 1);
      }
      throw new Error("HTTP " + response.status);
    }

    const data = await response.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error("Unexpected translation response");
    }

    const translatedText = data[0]
      .map((segment) => (Array.isArray(segment) ? segment[0] || "" : ""))
      .join("");

    if (!translatedText) throw new Error("Empty translation");

    return {
      ok: true,
      translatedText,
      detectedLanguage: typeof data[2] === "string" ? data[2] : null,
    };
  } catch (error) {
    const retryable =
      attempt < MAX_RETRIES &&
      (error.name === "AbortError" || /network|fetch|failed/i.test(error.message || ""));
    if (retryable) {
      await sleep(400 * (attempt + 1));
      return requestTranslation(text, targetLanguage, attempt + 1);
    }
    return {
      ok: false,
      error: error.name === "AbortError" ? "timeout" : "network",
      translatedText: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function translateText(text, requestedTarget) {
  const data = await chrome.storage.sync.get({ targetLanguage: "en" });
  const targetLanguage = HIT.toGoogleCode(
    requestedTarget || data.targetLanguage || "en",
  );
  const value = String(text || "");
  if (!value.trim()) {
    return { ok: true, translatedText: "", detectedLanguage: null };
  }
  return requestTranslation(value, targetLanguage);
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request !== "object") return false;

  if (request.action === "getTranslation") {
    translateText(request.text, request.targetLanguage)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error("Translation error:", error);
        sendResponse({
          ok: false,
          error: "unknown",
          translatedText: "",
        });
      });
    return true;
  }

  if (request.action === "setBadge") {
    setBadgeState(request.state, sender?.tab?.id);
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === "openShortcuts") {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).finally(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (request.action === "get-command-shortcuts") {
    chrome.commands
      .getAll()
      .then((commands) => sendResponse({ ok: true, commands }))
      .catch(() => sendResponse({ ok: false, commands: [] }));
    return true;
  }

  if (request.action === "trigger-page-shortcut") {
    sendActionToActiveTab("translate-full-page").finally(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Commands and context menu actions
// ---------------------------------------------------------------------------

async function sendActionToActiveTab(action) {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab || typeof tab.id !== "number") return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action });
  } catch (error) {
    // No content script (chrome:// pages, PDF viewer, store pages, etc.).
    setBadgeState("error", tab.id);
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "translate-page") {
    sendActionToActiveTab("translate-full-page");
  } else if (command === "translate-selection") {
    sendActionToActiveTab("translate-selection");
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || typeof tab.id !== "number") return;
  const action =
    info.menuItemId === "translate-page"
      ? "translate-full-page"
      : info.menuItemId === "translate-selection"
        ? "translate-selection"
        : null;
  if (!action) return;

  const target =
    action === "translate-selection" && typeof info.frameId === "number"
      ? { frameId: info.frameId }
      : {};

  chrome.tabs.sendMessage(tab.id, { action }, target).catch(() => {
    setBadgeState("error", tab.id);
  });
});
