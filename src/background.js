// src/background.js
console.log("Background script starting...");

const BADGE_TIMEOUT_MS = 4000;
const badgeTimers = new Map();

function setBadgeState(state, tabId) {
  const key = typeof tabId === "number" ? tabId : "global";
  if (badgeTimers.has(key)) {
    clearTimeout(badgeTimers.get(key));
    badgeTimers.delete(key);
  }

  const target = typeof tabId === "number" ? { tabId } : {};

  if (state === "success") {
    chrome.action.setBadgeText({ text: "✓", ...target });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e", ...target });
  } else if (state === "error") {
    chrome.action.setBadgeText({ text: "!", ...target });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444", ...target });
  } else {
    chrome.action.setBadgeText({ text: "", ...target });
    return;
  }

  const timeoutId = setTimeout(() => {
    chrome.action.setBadgeText({ text: "", ...target });
    badgeTimers.delete(key);
  }, BADGE_TIMEOUT_MS);
  badgeTimers.set(key, timeoutId);
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    console.log("Context menus (re)created.");
    // This menu appears only when you right-click on the page without selecting text
    chrome.contextMenus.create({
      id: "translate-page",
      title: chrome.i18n.getMessage("contextTranslatePage"),
      contexts: ["page"],
    });
    // This menu appears only when you right-click on selected text
    chrome.contextMenus.create({
      id: "translate-selection",
      title: chrome.i18n.getMessage("contextTranslateSelection"),
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Extension installed/updated.");
  setupContextMenus();

  if (details.reason === "install") {
    chrome.i18n.getAcceptLanguages((languages) => {
      if (languages && languages.length > 0) {
        const primaryLang = languages[0].split("-")[0];
        console.log(
          `Helium Inline Translator: Detected primary language: ${primaryLang}. Setting as default.`
        );
        chrome.storage.sync.set({ targetLanguage: primaryLang });
      } else {
        chrome.storage.sync.set({ targetLanguage: "en" });
      }
    });
  }
});

setupContextMenus();

async function translateText(text) {
  const { targetLanguage } = await chrome.storage.sync.get("targetLanguage");
  const targetLang = targetLanguage || "en";

  // Debugging log to see which language is being used
  console.log(
    `Helium Inline Translator: Translating to target language: '${targetLang}'`
  );

  const sourceLang = "auto";
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(
    text
  )}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data && data[0] && data[0][0] && data[0][0][0]) {
      return {
        success: true,
        translatedText: data[0].map((segment) => segment[0]).join(""),
      };
    }
    throw new Error("Invalid translation response format");
  } catch (error) {
    console.error("Translation Error:", error);
    return {
      success: false,
      translatedText: "Erro na tradução.",
    };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getTranslation") {
    translateText(request.text)
      .then((result) => {
        const tabId = sender?.tab?.id;
        setBadgeState(result.success ? "success" : "error", tabId);
        sendResponse({ translatedText: result.translatedText });
      })
      .catch((error) => {
        console.error("Message handler error:", error);
        const tabId = sender?.tab?.id;
        setBadgeState("error", tabId);
        sendResponse({ translatedText: "Erro na tradução." });
      });
    return true;
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-page") {
    chrome.tabs.sendMessage(tab.id, { action: "translate-full-page" });
  } else if (info.menuItemId === "translate-selection") {
    chrome.scripting
      .insertCSS({
        target: { tabId: tab.id },
        files: ["css/inline.css"],
      })
      .then(() => {
        chrome.tabs.sendMessage(tab.id, {
          action: "translate-selection",
        });
      })
      .catch((error) => {
        console.error("Error inserting CSS:", error);
        chrome.tabs.sendMessage(tab.id, {
          action: "translate-selection",
        });
      });
  }
});
