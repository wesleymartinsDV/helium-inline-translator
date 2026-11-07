// Repository consistency checks for the unpacked extension.
// Run with: npm run check

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

function note(message) {
  notes.push(message);
}

function readJson(relativePath) {
  const absolute = join(root, relativePath);
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`${relativePath}: ${error.message}`);
    return null;
  }
}

function requireFile(relativePath, label) {
  if (!existsSync(join(root, relativePath))) {
    fail(`${label}: missing file ${relativePath}`);
  }
}

// ---------------------------------------------------------------------------
// Shared language registry
// ---------------------------------------------------------------------------

const sharedSandbox = {};
vm.createContext(sharedSandbox);
vm.runInContext(
  readFileSync(join(root, "src/shared.js"), "utf8"),
  sharedSandbox,
  { filename: "src/shared.js" },
);

const HIT = sharedSandbox.HIT;
if (!HIT || !Array.isArray(HIT.LANGUAGES)) {
  fail("src/shared.js did not expose globalThis.HIT.LANGUAGES");
}

const languages = HIT ? HIT.LANGUAGES : [];

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const enMessages = readJson("_locales/en/messages.json") || {};

if (manifest) {
  if (manifest.manifest_version !== 3) {
    fail("manifest.json: manifest_version must be 3");
  }
  if (manifest.default_locale !== "en") {
    fail("manifest.json: default_locale must be \"en\"");
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) {
    fail(`manifest.json: invalid version "${manifest.version}"`);
  }
  if (pkg && manifest.version !== pkg.version) {
    fail(
      `Version mismatch: manifest.json is ${manifest.version}, package.json is ${pkg.version}`,
    );
  }

  const permissions = manifest.permissions || [];
  const expectedPermissions = ["contextMenus", "storage"].sort();
  if (JSON.stringify([...permissions].sort()) !== JSON.stringify(expectedPermissions)) {
    fail(
      `manifest.json: unexpected permissions [${permissions.join(", ")}]; expected [${expectedPermissions.join(", ")}]`,
    );
  }
  if (manifest.web_accessible_resources) {
    fail("manifest.json: web_accessible_resources is no longer required");
  }

  requireFile(manifest.background?.service_worker, "manifest background");
  for (const script of manifest.content_scripts || []) {
    for (const file of script.js || []) requireFile(file, "manifest content script");
    for (const file of script.css || []) requireFile(file, "manifest content style");
  }
  requireFile(manifest.action?.default_popup, "manifest popup");
  for (const [size, file] of Object.entries(manifest.icons || {})) {
    requireFile(file, `manifest icon ${size}`);
  }
  for (const [size, file] of Object.entries(
    manifest.action?.default_icon || {},
  )) {
    requireFile(file, `manifest action icon ${size}`);
  }

  const contentScripts = manifest.content_scripts || [];
  const mainScript = contentScripts[0]?.js || [];
  if (mainScript.indexOf("src/shared.js") === -1) {
    fail("manifest.json: content scripts must load src/shared.js");
  }
  if (
    mainScript.indexOf("src/shared.js") > mainScript.indexOf("src/content.js")
  ) {
    fail("manifest.json: src/shared.js must load before src/content.js");
  }

  const commandNames = Object.keys(manifest.commands || {});
  for (const expected of ["translate-page", "translate-selection"]) {
    if (!commandNames.includes(expected)) {
      fail(`manifest.json: missing command "${expected}"`);
    }
  }

  const manifestText = JSON.stringify(manifest);
  const messageKeys = new Set(
    [...manifestText.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)].map(
      (match) => match[1],
    ),
  );
  for (const key of messageKeys) {
    if (!enMessages[key]) {
      fail(`manifest.json: __MSG_${key}__ is not defined in _locales/en`);
    }
  }
  note(`manifest message keys: ${[...messageKeys].join(", ")}`);
}

// ---------------------------------------------------------------------------
// Locales and flags
// ---------------------------------------------------------------------------

const localesDir = join(root, "_locales");
const actualLocales = existsSync(localesDir)
  ? readdirSync(localesDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(join(localesDir, entry.name, "messages.json")),
      )
      .map((entry) => entry.name)
      .sort()
  : [];

const expectedLocales = languages
  .map((language) => language.code.replace("-", "_"))
  .sort();

const missingLocales = expectedLocales.filter(
  (locale) => !actualLocales.includes(locale),
);
const extraLocales = actualLocales.filter(
  (locale) => !expectedLocales.includes(locale),
);
if (missingLocales.length) {
  fail(`_locales: missing locales ${missingLocales.join(", ")}`);
}
if (extraLocales.length) {
  fail(`_locales: unexpected locales ${extraLocales.join(", ")}`);
}

const canonicalKeys = Object.keys(enMessages);
let fallbackMessageCount = 0;

for (const locale of actualLocales) {
  const file = `_locales/${locale}/messages.json`;
  const messages = readJson(file);
  if (!messages) continue;

  for (const key of ["appDesc", "actionTitle"]) {
    if (!messages[key]?.message) {
      fail(`${file}: missing required message "${key}"`);
    }
  }

  for (const [key, entry] of Object.entries(messages)) {
    if (!entry || typeof entry.message !== "string" || !entry.message.trim()) {
      fail(`${file}: message "${key}" is empty or malformed`);
      continue;
    }
    if (!canonicalKeys.includes(key)) {
      fail(`${file}: unknown message "${key}" (not present in _locales/en)`);
    }
  }

  const missing = canonicalKeys.filter((key) => !messages[key]);
  if (missing.length) fallbackMessageCount += 1;
}

if (fallbackMessageCount) {
  note(
    `${fallbackMessageCount} locale(s) rely on the English default for some messages (supported by chrome.i18n)`,
  );
}

const flagsDir = join(root, "icons/flags");
const actualFlags = existsSync(flagsDir)
  ? readdirSync(flagsDir)
      .filter((file) => file.toLowerCase().endsWith(".svg"))
      .map((file) => file.replace(/\.svg$/i, "").toUpperCase())
      .sort()
  : [];
const expectedFlags = languages
  .map((language) => language.flag.toUpperCase())
  .sort();
const missingFlags = expectedFlags.filter((flag) => !actualFlags.includes(flag));
const extraFlags = actualFlags.filter((flag) => !expectedFlags.includes(flag));
if (missingFlags.length) {
  fail(`icons/flags: missing flags ${missingFlags.join(", ")}`);
}
if (extraFlags.length) {
  fail(`icons/flags: unexpected flags ${extraFlags.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Popup markup and translations
// ---------------------------------------------------------------------------

const popupHtml = readFileSync(join(root, "ui/popup.html"), "utf8");
for (const file of [
  "ui/popup.css",
  "ui/popup.js",
  "ui/i18n.js",
  "ui/extra-i18n.js",
  "src/shared.js",
]) {
  requireFile(file, "popup");
}

const scriptOrder = [...popupHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map(
  (match) => match[1],
);
const expectedOrder = [
  "../src/shared.js",
  "i18n.js",
  "extra-i18n.js",
  "popup.js",
];
if (JSON.stringify(scriptOrder) !== JSON.stringify(expectedOrder)) {
  fail(
    `ui/popup.html: script order is ${scriptOrder.join(" -> ")}; expected ${expectedOrder.join(" -> ")}`,
  );
}

const i18nSandbox = {
  console,
  navigator: { language: "en-US" },
};
vm.createContext(i18nSandbox);
vm.runInContext(readFileSync(join(root, "ui/i18n.js"), "utf8"), i18nSandbox, {
  filename: "ui/i18n.js",
});
vm.runInContext(
  readFileSync(join(root, "ui/extra-i18n.js"), "utf8"),
  i18nSandbox,
  { filename: "ui/extra-i18n.js" },
);
vm.runInContext(
  "globalThis.__hitTranslations = translations; globalThis.__hitCurrentLanguage = currentLanguage;",
  i18nSandbox,
);

const translations = i18nSandbox.__hitTranslations || {};
const enPopupKeys = Object.keys(translations.en || {});
if (!enPopupKeys.length) {
  fail("ui/i18n.js: English translations are missing");
}

for (const language of languages) {
  const dictionary = translations[language.code];
  if (!dictionary) {
    fail(`ui/i18n.js: no popup translations for ${language.code}`);
    continue;
  }
  const missing = enPopupKeys.filter((key) => !dictionary[key]);
  if (missing.length) {
    fail(
      `ui/i18n.js: ${language.code} is missing ${missing.join(", ")}`,
    );
  }
}

const usedKeys = new Set(
  [...popupHtml.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map(
    (match) => match[1],
  ),
);
for (const key of usedKeys) {
  if (!translations.en?.[key]) {
    fail(`ui/popup.html: data-i18n key "${key}" is not defined in ui/i18n.js`);
  }
}

// ---------------------------------------------------------------------------
// Source hygiene
// ---------------------------------------------------------------------------

const scriptFiles = [
  "src/shared.js",
  "src/background.js",
  "src/content.js",
  "ui/i18n.js",
  "ui/extra-i18n.js",
  "ui/popup.js",
];

for (const file of scriptFiles) {
  try {
    execFileSync(process.execPath, ["--check", join(root, file)], {
      stdio: "pipe",
    });
  } catch (error) {
    fail(`${file}: syntax error\n${error.stderr?.toString() || error.message}`);
  }
}

const removedReferences = ["balloon", "css/inline.css", "icons/icon128.8.png"];
for (const file of ["manifest.json", ...scriptFiles, "ui/popup.html"]) {
  const contents = readFileSync(join(root, file), "utf8");
  for (const reference of removedReferences) {
    if (contents.includes(reference)) {
      fail(`${file}: references removed asset "${reference}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (notes.length) {
  console.log("Notes:");
  for (const message of notes) console.log(`  - ${message}`);
}

if (errors.length) {
  console.error(`\n${errors.length} check(s) failed:`);
  for (const message of errors) console.error(`  ✗ ${message}`);
  process.exit(1);
}

console.log(
  `\nAll checks passed: ${languages.length} languages, ${actualLocales.length} locales, ${actualFlags.length} flags, ${enPopupKeys.length} popup keys.`,
);
