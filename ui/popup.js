// ui/popup.js

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    element.textContent = t(key);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.getAttribute("data-i18n-placeholder");
    element.placeholder = t(key);
  });

  document.documentElement.lang = currentLanguage;
  const base = currentLanguage.split("-")[0];
  document.documentElement.dir = ["ar", "he", "fa", "ur"].includes(base)
    ? "rtl"
    : "ltr";
}

document.addEventListener("DOMContentLoaded", async () => {
  const languages = HIT.LANGUAGES;
  const legacyFavoriteMap = {
    pt: "pt-BR",
    zh: "zh-CN",
    no: "nb",
    fil: "tl",
    iw: "he",
    in: "id",
  };

  let selectedLangCode;
  let favorites = [];
  let isDark = false;
  let themeSource = "system";
  let flagEmojiSupported = true;
  let searchTerm = "";
  let statusInterval = null;

  const body = document.body;
  const themeToggle = document.getElementById("themeToggle");
  const selectedLangBtn = document.getElementById("selectedLang");
  const dropdown = document.getElementById("dropdown");
  const langName = document.getElementById("langName");
  const langFlag = document.getElementById("langFlag");
  const searchBox = document.getElementById("searchBox");
  const favoritesSection = document.getElementById("favoritesSection");
  const favoritesList = document.getElementById("favoritesList");
  const allLanguages = document.getElementById("allLanguages");
  const translatePageBtn = document.getElementById("translatePageBtn");
  const translateSelectionBtn = document.getElementById("translateSelectionBtn");
  const revertBtn = document.getElementById("revertBtn");
  const statusLine = document.getElementById("statusLine");
  const shortcutsBtn = document.getElementById("shortcutsBtn");
  const shortcutSelectionKeys = document.getElementById(
    "shortcutSelectionKeys",
  );
  const shortcutPageKeys = document.getElementById("shortcutPageKeys");
  const versionLabel = document.getElementById("versionLabel");

  versionLabel.textContent = "v" + chrome.runtime.getManifest().version;

  // -------------------------------------------------------------------------
  // Preferences
  // -------------------------------------------------------------------------

  async function savePreferences() {
    await chrome.storage.sync.set({
      theme: isDark ? "dark" : "light",
      themeSource,
      favoriteLangs: favorites,
      targetLanguage: HIT.toGoogleCode(selectedLangCode),
      uiLanguage: currentLanguage,
    });
  }

  function normalizeFavorites(list) {
    const result = [];
    for (const code of Array.isArray(list) ? list : []) {
      const mapped = legacyFavoriteMap[code] || code;
      const ui =
        HIT.toUiCode(mapped) ||
        (languages.some((language) => language.code === mapped)
          ? mapped
          : null);
      if (ui && !result.includes(ui)) result.push(ui);
    }
    return result;
  }

  async function loadPreferences() {
    const systemPrefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    const systemLanguage = getSystemLanguage();
    const fallbackUiCode =
      HIT.toUiCode(systemLanguage) || HIT.normalizePageLang(systemLanguage) || "en";

    const data = await chrome.storage.sync.get({
      theme: systemPrefersDark ? "dark" : "light",
      themeSource: "system",
      favoriteLangs: ["en", "es"],
      targetLanguage: HIT.toGoogleCode(fallbackUiCode),
      uiLanguage: fallbackUiCode,
    });

    themeSource = data.themeSource === "manual" ? "manual" : "system";
    isDark =
      themeSource === "system" ? systemPrefersDark : data.theme === "dark";
    favorites = normalizeFavorites(data.favoriteLangs);
    currentLanguage = data.uiLanguage || fallbackUiCode;

    const uiCode =
      HIT.toUiCode(data.targetLanguage) ||
      HIT.normalizePageLang(data.targetLanguage) ||
      fallbackUiCode;
    const matchingLanguage =
      languages.find((language) => language.code === uiCode) ||
      languages.find(
        (language) =>
          HIT.baseLang(language.code) === HIT.baseLang(uiCode),
      ) ||
      languages.find((language) => language.code === "en") ||
      languages[0];
    selectedLangCode = matchingLanguage.code;

    updateUIForPreferences();
    await refreshShortcutLabels();
  }

  function updateUIForPreferences() {
    body.className = isDark ? "dark" : "light";
    themeToggle.textContent = isDark ? "☀️" : "🌙";
    themeToggle.setAttribute(
      "aria-label",
      isDark ? "Switch to light theme" : "Switch to dark theme",
    );

    const language = languages.find(
      (item) => item.code === selectedLangCode,
    );
    if (language) {
      setFlagContent(langFlag, language.flag);
      langName.textContent = language.name;
    }

    applyTranslations();
  }

  // -------------------------------------------------------------------------
  // Theme
  // -------------------------------------------------------------------------

  function toggleTheme() {
    isDark = !isDark;
    themeSource = "manual";
    body.className = isDark ? "dark" : "light";
    themeToggle.textContent = isDark ? "☀️" : "🌙";
    themeToggle.setAttribute(
      "aria-label",
      isDark ? "Switch to light theme" : "Switch to dark theme",
    );
    savePreferences();
  }

  // -------------------------------------------------------------------------
  // Language list
  // -------------------------------------------------------------------------

  function toggleFavorite(code) {
    const index = favorites.indexOf(code);
    if (index > -1) {
      favorites.splice(index, 1);
    } else {
      favorites.push(code);
    }
    savePreferences();
    renderLanguages();
  }

  async function selectLanguage(code) {
    selectedLangCode = code;
    const language = languages.find((item) => item.code === code);
    if (language) {
      setFlagContent(langFlag, language.flag);
      langName.textContent = language.name;
    }
    closeDropdown();
    searchBox.value = "";
    searchTerm = "";
    await savePreferences();
    renderLanguages();
  }

  function closeDropdown() {
    dropdown.classList.remove("active");
    selectedLangBtn.setAttribute("aria-expanded", "false");
  }

  function openDropdown() {
    dropdown.classList.add("active");
    selectedLangBtn.setAttribute("aria-expanded", "true");
    setTimeout(() => searchBox.focus(), 60);
  }

  function renderLanguages() {
    favoritesList.innerHTML = "";
    allLanguages.innerHTML = "";

    const term = searchTerm.toLowerCase();
    const filtered = languages.filter(
      (language) =>
        language.name.toLowerCase().includes(term) ||
        language.code.toLowerCase().includes(term) ||
        language.google.toLowerCase().includes(term),
    );

    const favoriteLanguages = filtered.filter((language) =>
      favorites.includes(language.code),
    );

    if (favoriteLanguages.length > 0 && !searchTerm) {
      favoritesSection.style.display = "block";
      favoriteLanguages.forEach((language) => {
        favoritesList.appendChild(createLanguageOption(language));
      });
    } else {
      favoritesSection.style.display = "none";
    }

    filtered.forEach((language) => {
      allLanguages.appendChild(createLanguageOption(language));
    });
  }

  function createLanguageOption(language) {
    const option = document.createElement("div");
    option.className =
      "language-option" +
      (language.code === selectedLangCode ? " selected" : "");
    option.setAttribute("role", "option");
    option.setAttribute(
      "aria-selected",
      language.code === selectedLangCode ? "true" : "false",
    );
    option.tabIndex = 0;

    const leftContent = document.createElement("div");
    leftContent.className = "left-content";

    const flag = document.createElement("span");
    flag.className = "flag";
    setFlagContent(flag, language.flag);

    const name = document.createElement("span");
    name.textContent = language.name;

    leftContent.appendChild(flag);
    leftContent.appendChild(name);

    const isFavorite = favorites.includes(language.code);
    const star = document.createElement("span");
    star.className = "star" + (isFavorite ? " active" : "");
    star.textContent = "♥";
    star.setAttribute("role", "button");
    star.tabIndex = 0;
    star.setAttribute("aria-pressed", isFavorite ? "true" : "false");
    star.setAttribute("aria-label", "Favorite " + language.name);

    const activateFavorite = (event) => {
      event.stopPropagation();
      event.preventDefault();
      toggleFavorite(language.code);
    };
    star.addEventListener("click", activateFavorite);
    star.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") activateFavorite(event);
    });

    option.appendChild(leftContent);
    option.appendChild(star);

    option.addEventListener("click", () => selectLanguage(language.code));
    option.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectLanguage(language.code);
      }
    });

    return option;
  }

  // -------------------------------------------------------------------------
  // Active tab actions and status
  // -------------------------------------------------------------------------

  async function sendToActiveTab(message) {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab || typeof tab.id !== "number") return null;
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      return null;
    }
  }

  function setStatus(text, kind) {
    statusLine.textContent = text;
    statusLine.className = "status-line" + (kind ? " " + kind : "");
  }

  async function refreshStatus() {
    const status = await sendToActiveTab({ action: "get-status" });
    const supported = Boolean(status && status.canTranslate);

    translatePageBtn.disabled =
      !supported || status.isPageTranslated || status.isTranslatingPage;
    translateSelectionBtn.disabled = !supported || status.isTranslatingPage;
    revertBtn.disabled =
      !supported ||
      (!status.isPageTranslated &&
        !status.isSelectionTranslated &&
        !status.isTranslatingPage);

    if (!supported) {
      setStatus(t("popup.statusUnavailable"), "muted");
    } else if (status.isTranslatingPage) {
      setStatus(t("popup.statusTranslating"), "busy");
    } else if (status.isPagePartial) {
      setStatus(t("popup.statusPartial"), "warning");
    } else if (status.isPageTranslated) {
      setStatus(t("popup.statusTranslated"), "active");
    } else if (status.isSelectionTranslated) {
      setStatus(t("popup.statusSelectionTranslated"), "active");
    } else {
      setStatus(t("popup.statusIdle"), "muted");
    }
  }

  async function refreshShortcutLabels() {
    const fallbackSelection = "Shift + Alt + Q";
    const fallbackPage = "Shift + Alt + W";
    try {
      const commands = await chrome.commands.getAll();
      const pageCommand = commands.find(
        (command) => command.name === "translate-page",
      );
      const selectionCommand = commands.find(
        (command) => command.name === "translate-selection",
      );
      // The page action has an in-page fallback, so show the working key even
      // when Chromium/Edge refuses to assign the extension command.
      shortcutPageKeys.textContent = pageCommand?.shortcut
        ? pageCommand.shortcut.replace(/\+/g, " + ")
        : fallbackPage;
      shortcutSelectionKeys.textContent = selectionCommand?.shortcut
        ? selectionCommand.shortcut.replace(/\+/g, " + ")
        : t("popup.shortcutNotSet");
    } catch (error) {
      shortcutPageKeys.textContent = fallbackPage;
      shortcutSelectionKeys.textContent = fallbackSelection;
    }
  }

  // -------------------------------------------------------------------------
  // Flags
  // -------------------------------------------------------------------------

  function detectFlagEmojiSupport() {
    const testSpan = document.createElement("span");
    testSpan.style.position = "absolute";
    testSpan.style.visibility = "hidden";
    testSpan.style.fontSize = "20px";
    testSpan.style.lineHeight = "1";
    testSpan.textContent = HIT.flagEmoji("BR");
    document.body.appendChild(testSpan);
    const emojiWidth = testSpan.offsetWidth;
    testSpan.textContent = "BR";
    const textWidth = testSpan.offsetWidth;
    testSpan.remove();
    return emojiWidth !== textWidth;
  }

  function setFlagContent(element, countryCode) {
    if (!element) return;
    element.innerHTML = "";
    element.classList.remove("has-image");

    if (!countryCode) {
      element.textContent = "";
      return;
    }

    const assetPath = HIT.getFlagUrl(countryCode);
    if (assetPath) {
      element.classList.add("has-image");
      const image = document.createElement("img");
      image.src = assetPath;
      image.alt = HIT.flagEmoji(countryCode);
      image.width = 36;
      image.height = 36;
      image.decoding = "async";
      image.loading = "lazy";
      element.appendChild(image);
      return;
    }

    element.textContent = flagEmojiSupported
      ? HIT.flagEmoji(countryCode)
      : countryCode;
  }

  // -------------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------------

  themeToggle.addEventListener("click", toggleTheme);

  selectedLangBtn.addEventListener("click", () => {
    if (dropdown.classList.contains("active")) closeDropdown();
    else openDropdown();
  });

  searchBox.addEventListener("input", (event) => {
    searchTerm = event.target.value;
    renderLanguages();
  });

  searchBox.addEventListener("click", (event) => event.stopPropagation());
  searchBox.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDropdown();
      selectedLangBtn.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".language-selector")) closeDropdown();
  });

  dropdown.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDropdown();
      selectedLangBtn.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = Array.from(
      dropdown.querySelectorAll(".language-option"),
    );
    if (!options.length) return;
    const index = options.indexOf(document.activeElement);
    const next =
      event.key === "ArrowDown"
        ? options[(index + 1) % options.length]
        : options[(index - 1 + options.length) % options.length];
    event.preventDefault();
    next.focus();
  });

  translatePageBtn.addEventListener("click", async () => {
    await sendToActiveTab({ action: "translate-full-page" });
    setTimeout(refreshStatus, 300);
    setTimeout(refreshStatus, 1200);
  });

  translateSelectionBtn.addEventListener("click", async () => {
    await sendToActiveTab({ action: "translate-selection" });
    setTimeout(refreshStatus, 300);
    setTimeout(refreshStatus, 1200);
  });

  revertBtn.addEventListener("click", async () => {
    await sendToActiveTab({ action: "revert-translation" });
    setTimeout(refreshStatus, 300);
  });

  shortcutsBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (event) => {
      if (themeSource !== "system") return;
      isDark = event.matches;
      updateUIForPreferences();
      savePreferences();
    });

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------

  flagEmojiSupported = detectFlagEmojiSupport();
  await loadPreferences();
  renderLanguages();
  await refreshStatus();

  statusInterval = setInterval(refreshStatus, 1500);
  window.addEventListener("unload", () => {
    if (statusInterval) clearInterval(statusInterval);
  });
});
