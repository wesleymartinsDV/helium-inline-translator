// src/shared.js
// Shared language registry and code helpers used by the background worker,
// the content script, and the popup. Kept dependency-free so it can be loaded
// both as a service-worker import and as a classic content/popup script.

(function (global) {
  "use strict";

  /**
   * Single source of truth for every language the extension exposes.
   * - code:   UI code shown in the popup
   * - name:   native language name
   * - flag:   country flag asset (icons/flags/<flag>.svg)
   * - google: code sent to the translation endpoint
   */
  const LANGUAGES = [
    { code: "pt-BR", name: "Português (Brasil)", flag: "BR", google: "pt" },
    { code: "pt-PT", name: "Português (Portugal)", flag: "PT", google: "pt-PT" },
    { code: "en", name: "English", flag: "US", google: "en" },
    { code: "es", name: "Español", flag: "ES", google: "es" },
    { code: "fr", name: "Français", flag: "FR", google: "fr" },
    { code: "de", name: "Deutsch", flag: "DE", google: "de" },
    { code: "it", name: "Italiano", flag: "IT", google: "it" },
    { code: "ja", name: "日本語", flag: "JP", google: "ja" },
    { code: "ko", name: "한국어", flag: "KR", google: "ko" },
    { code: "zh-CN", name: "中文 (简体)", flag: "CN", google: "zh-CN" },
    { code: "zh-TW", name: "中文 (繁體)", flag: "TW", google: "zh-TW" },
    { code: "ru", name: "Русский", flag: "RU", google: "ru" },
    { code: "uk", name: "Українська", flag: "UA", google: "uk" },
    { code: "ar", name: "العربية", flag: "SA", google: "ar" },
    { code: "he", name: "עברית", flag: "IL", google: "he" },
    { code: "fa", name: "فارسی", flag: "IR", google: "fa" },
    { code: "ur", name: "اردو", flag: "PK", google: "ur" },
    { code: "hi", name: "हिन्दी", flag: "IN", google: "hi" },
    { code: "bn", name: "বাংলা", flag: "BD", google: "bn" },
    { code: "th", name: "ไทย", flag: "TH", google: "th" },
    { code: "vi", name: "Tiếng Việt", flag: "VN", google: "vi" },
    { code: "id", name: "Bahasa Indonesia", flag: "ID", google: "id" },
    { code: "ms", name: "Bahasa Melayu", flag: "MY", google: "ms" },
    { code: "tl", name: "Filipino", flag: "PH", google: "tl" },
    { code: "nl", name: "Nederlands", flag: "NL", google: "nl" },
    { code: "pl", name: "Polski", flag: "PL", google: "pl" },
    { code: "tr", name: "Türkçe", flag: "TR", google: "tr" },
    { code: "el", name: "Ελληνικά", flag: "GR", google: "el" },
    { code: "cs", name: "Čeština", flag: "CZ", google: "cs" },
    { code: "sk", name: "Slovenčina", flag: "SK", google: "sk" },
    { code: "hu", name: "Magyar", flag: "HU", google: "hu" },
    { code: "ro", name: "Română", flag: "RO", google: "ro" },
    { code: "bg", name: "Български", flag: "BG", google: "bg" },
    { code: "hr", name: "Hrvatski", flag: "HR", google: "hr" },
    { code: "sv", name: "Svenska", flag: "SE", google: "sv" },
    { code: "da", name: "Dansk", flag: "DK", google: "da" },
    { code: "nb", name: "Norsk", flag: "NO", google: "no" },
    { code: "fi", name: "Suomi", flag: "FI", google: "fi" },
    { code: "et", name: "Eesti", flag: "EE", google: "et" },
    { code: "lv", name: "Latviešu", flag: "LV", google: "lv" },
    { code: "lt", name: "Lietuvių", flag: "LT", google: "lt" },
    { code: "sl", name: "Slovenščina", flag: "SI", google: "sl" },
    { code: "is", name: "Íslenska", flag: "IS", google: "is" },
    { code: "lb", name: "Lëtzebuergesch", flag: "LU", google: "lb" },
    { code: "mt", name: "Malti", flag: "MT", google: "mt" },
    { code: "ca", name: "Català", flag: "AD", google: "ca" },
    { code: "af", name: "Afrikaans", flag: "ZA", google: "af" },
    { code: "ga", name: "Gaeilge", flag: "IE", google: "ga" },
    { code: "sr", name: "Српски", flag: "RS", google: "sr" },
  ];

  // Legacy/alternate codes that may already be in chrome.storage.
  const LEGACY_TO_UI = {
    pt: "pt-BR",
    "pt-br": "pt-BR",
    "pt_BR": "pt-BR",
    "pt-pt": "pt-PT",
    "pt_PT": "pt-PT",
    zh: "zh-CN",
    "zh-cn": "zh-CN",
    "zh_CN": "zh-CN",
    "zh-tw": "zh-TW",
    "zh_TW": "zh-TW",
    no: "nb",
    nb: "nb",
    fil: "tl",
    iw: "he",
    in: "id",
  };

  const ALT_SEPARATOR_LANGS = ["ru", "uk", "bg", "ga"];
  const SR_SEPARATOR_LANGS = ["sr", "ur"];
  const SEPARATOR = "\n|||HTSEP|||\n";
  const SEPARATOR_ALT = "\n\n[-HTS-]\n\n";
  const SEPARATOR_SR = "\n\n[---]\n\n";

  function findByCode(code) {
    if (!code) return null;
    const lower = String(code).toLowerCase().replace(/_/g, "-");
    return (
      LANGUAGES.find((language) => language.code.toLowerCase() === lower) || null
    );
  }

  function findByGoogleCode(code) {
    if (!code) return null;
    const raw = String(code);
    return (
      LANGUAGES.find(
        (language) => language.google.toLowerCase() === raw.toLowerCase(),
      ) || null
    );
  }

  /** Convert any known UI or legacy code into the code sent to Google. */
  function toGoogleCode(code) {
    if (!code) return "en";
    const ui =
      findByCode(code) || findByCode(LEGACY_TO_UI[String(code).toLowerCase()]);
    if (ui) return ui.google;
    const byGoogle = findByGoogleCode(code);
    if (byGoogle) return byGoogle.google;
    // Already looks like a Google code we do not ship; pass it through.
    return String(code);
  }

  /** Convert a Google/legacy code into the UI code used by LANGUAGES. */
  function toUiCode(code) {
    if (!code) return null;
    const direct = findByCode(code);
    if (direct) return direct.code;
    const legacy = LEGACY_TO_UI[String(code).toLowerCase()];
    if (legacy) return legacy;
    const byGoogle = findByGoogleCode(code);
    if (byGoogle) return byGoogle.code;
    return null;
  }

  function baseLang(code) {
    if (!code) return "";
    return String(code).toLowerCase().replace(/_/g, "-").split("-")[0];
  }

  /**
   * Normalize a page/`navigator.language` code into one of our UI codes.
   * Returns null when the language cannot be mapped.
   */
  function normalizePageLang(raw) {
    if (!raw) return null;
    const value = String(raw).trim().toLowerCase();
    if (!value || value === "und" || value === "c" || value === "zxx") {
      return null;
    }

    // Chinese: prefer the explicit script/region.
    if (value.startsWith("zh")) {
      if (
        value.includes("hant") ||
        /-(tw|hk|mo)\b/.test(value) ||
        value.endsWith("-tw") ||
        value.endsWith("-hk") ||
        value.endsWith("-mo")
      ) {
        return "zh-TW";
      }
      return "zh-CN";
    }

    // Portuguese: keep the region distinction.
    if (value.startsWith("pt")) {
      if (value === "pt-pt" || value.includes("-pt")) return "pt-PT";
      return "pt-BR";
    }

    const legacy = LEGACY_TO_UI[value];
    if (legacy) return legacy;

    const direct = findByCode(value);
    if (direct) return direct.code;

    const base = baseLang(value);
    if (base === "no" || base === "nb") return "nb";
    if (base === "fil") return "tl";
    if (base === "iw") return "he";
    if (base === "in") return "id";
    if (base === "zh") return "zh-CN";
    if (base === "pt") return "pt-BR";

    const byBase = LANGUAGES.find((language) => baseLang(language.code) === base);
    return byBase ? byBase.code : null;
  }

  /** Separator that survives Google Translate for the given target code. */
  function separatorFor(targetCode) {
    const google = toGoogleCode(targetCode);
    const base = baseLang(google);
    if (SR_SEPARATOR_LANGS.includes(base)) return SEPARATOR_SR;
    if (ALT_SEPARATOR_LANGS.includes(base)) return SEPARATOR_ALT;
    return SEPARATOR;
  }

  function flagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "";
    const base = 0x1f1e6 - "A".charCodeAt(0);
    const upper = countryCode.toUpperCase();
    return (
      String.fromCodePoint(base + upper.charCodeAt(0)) +
      String.fromCodePoint(base + upper.charCodeAt(1))
    );
  }

  function getFlagUrl(countryCode) {
    if (!countryCode) return "";
    return global.chrome.runtime.getURL(
      "icons/flags/" + countryCode.toLowerCase() + ".svg",
    );
  }

  global.HIT = {
    LANGUAGES,
    toGoogleCode,
    toUiCode,
    normalizePageLang,
    baseLang,
    separatorFor,
    flagEmoji,
    getFlagUrl,
    SEPARATOR,
    SEPARATOR_ALT,
    SEPARATOR_SR,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
