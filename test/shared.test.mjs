import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("../src/shared.js");

const HIT = globalThis.HIT;

test("exposes 49 languages with unique codes", () => {
  assert.equal(HIT.LANGUAGES.length, 49);
  const codes = HIT.LANGUAGES.map((language) => language.code);
  assert.equal(new Set(codes).size, codes.length);
  const googleCodes = HIT.LANGUAGES.map((language) => language.google);
  assert.equal(new Set(googleCodes).size, googleCodes.length);
  for (const language of HIT.LANGUAGES) {
    assert.ok(language.name, `missing name for ${language.code}`);
    assert.match(language.flag, /^[A-Z]{2}$/);
  }
});

test("maps UI codes to Google codes", () => {
  assert.equal(HIT.toGoogleCode("pt-BR"), "pt");
  assert.equal(HIT.toGoogleCode("pt-PT"), "pt-PT");
  assert.equal(HIT.toGoogleCode("zh-CN"), "zh-CN");
  assert.equal(HIT.toGoogleCode("zh-TW"), "zh-TW");
  assert.equal(HIT.toGoogleCode("nb"), "no");
  assert.equal(HIT.toGoogleCode("tl"), "tl");
  assert.equal(HIT.toGoogleCode("unknown-code"), "unknown-code");
  assert.equal(HIT.toGoogleCode(""), "en");
});

test("maps legacy and Google codes back to UI codes", () => {
  assert.equal(HIT.toUiCode("pt"), "pt-BR");
  assert.equal(HIT.toUiCode("pt_BR"), "pt-BR");
  assert.equal(HIT.toUiCode("pt-PT"), "pt-PT");
  assert.equal(HIT.toUiCode("zh"), "zh-CN");
  assert.equal(HIT.toUiCode("no"), "nb");
  assert.equal(HIT.toUiCode("fil"), "tl");
  assert.equal(HIT.toUiCode("iw"), "he");
  assert.equal(HIT.toUiCode("in"), "id");
  assert.equal(HIT.toUiCode("xx"), null);
});

test("normalizes page language tags", () => {
  const cases = {
    "en-US": "en",
    "pt-BR": "pt-BR",
    "pt-PT": "pt-PT",
    pt: "pt-BR",
    "zh-Hans": "zh-CN",
    "zh-Hant-TW": "zh-TW",
    "zh-HK": "zh-TW",
    "nb-NO": "nb",
    no: "nb",
    fil: "tl",
    iw: "he",
    "in-ID": "id",
    "sr-Latn-RS": "sr",
    "fr-FR": "fr",
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(HIT.normalizePageLang(input), expected, input);
  }
  for (const invalid of ["", "und", "zxx", "c", null, undefined]) {
    assert.equal(HIT.normalizePageLang(invalid), null, String(invalid));
  }
});

test("selects a separator per target language", () => {
  assert.equal(HIT.separatorFor("en"), HIT.SEPARATOR);
  assert.equal(HIT.separatorFor("ru"), HIT.SEPARATOR_ALT);
  assert.equal(HIT.separatorFor("uk"), HIT.SEPARATOR_ALT);
  assert.equal(HIT.separatorFor("sr"), HIT.SEPARATOR_SR);
  assert.equal(HIT.separatorFor("ur"), HIT.SEPARATOR_SR);
});

test("builds flag emoji and asset URLs", () => {
  assert.equal(HIT.flagEmoji("BR"), "\u{1F1E7}\u{1F1F7}");
  assert.equal(HIT.flagEmoji("US"), "\u{1F1FA}\u{1F1F8}");
  assert.equal(HIT.flagEmoji("USA"), "");

  globalThis.chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
    },
  };
  assert.equal(
    HIT.getFlagUrl("BR"),
    "chrome-extension://test/icons/flags/br.svg",
  );
  delete globalThis.chrome;
});

test("baseLang handles separators and casing", () => {
  assert.equal(HIT.baseLang("pt-BR"), "pt");
  assert.equal(HIT.baseLang("zh_TW"), "zh");
  assert.equal(HIT.baseLang("EN"), "en");
  assert.equal(HIT.baseLang(""), "");
});
