# Helium Inline Translator

The project started when moving from Microsoft Edge to Helium Browser revealed the lack of a translation flow comparable to Edge’s native feature, so the extension was built to fill that gap—and it works seamlessly in any Chromium browser, including Chrome and Edge.

- Helium Browser and most other Chromium-based browsers
- [Google Chrome](https://chromewebstore.google.com/detail/helium-translator-inline/odibgflepadohfmpcemnjbhkionjkapk) 3+ ![Chrome Web Store](https://img.shields.io/chrome-web-store/users/odibgflepadohfmpcemnjbhkionjkapk?color=white&label=users&style=flat-square)
- [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/nbnmfihmepgnmpfaohjmdljphdkkmhoh) 1+ ![users count](https://img.shields.io/badge/dynamic/json?label=users&query=activeInstallCount&style=flat-square&color=white&url=https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/nbnmfihmepgnmpfaohjmdljphdkkmhoh)
- [Opera] soon...

![A screenshot from the extension pop-up page](https://i.ibb.co/B23N9mVs/Camada-1.jpg)

<p align="center">
  Made by <a href="https://github.com/wesleymartinsdv">Wesley Martins</a>
</p>


## Features

- **Inline translation** for full pages and highlighted passages, with no disruptive popups or iframes.
- **Range-accurate selection translation** — translating part of a text node replaces only the selected span.
- **Safe revert** — restores the original content only while a node still holds the translation, so live pages are not overwritten with stale text.
- **Progress and cancel** — press the page shortcut again while translating to cancel and restore; press it after translation to revert. Per-tab badge feedback shows progress.
- **Honest partial results** — a failed batch no longer aborts the remaining batches; the toast and popup report a partial translation and keep successful parts revertible.
- **Dynamic content and SPA support** — newly added nodes are translated while the page stays in translated mode (including a sweep after the first pass), and navigation resets state cleanly.
- **Embedded frame translation** — text inside iframes is translated too, so embedded stories and widgets do not stay in the original language.
- **Shadow DOM widgets** — text rendered inside open shadow roots (common for embedded interactives such as BBC's AQI banner) is collected, translated, kept up to date, and reverted with the rest of the page.
- **Popup controls** — translate page, translate selection, revert, and live status.
- **Customizable shortcuts** — defaults are `Alt + Shift + Q` (selection) and `Alt + Shift + W` (page); change them at `chrome://extensions/shortcuts`. The page shortcut also works through an in-page listener when the browser refuses to assign it.
- **49 languages**, favorite languages, quick search, light/dark themes, and full interface localization.
- Store metadata localized via `_locales/<lang>/messages.json`.

## Supported Languages (49)

| Region | Languages |
|--------|-----------|
| **Portuguese** | Português (Brasil) 🇧🇷, Português (Portugal) 🇵🇹 |
| **Western Europe** | English 🇺🇸, Español 🇪🇸, Français 🇫🇷, Deutsch 🇩🇪, Italiano 🇮🇹, Nederlands 🇳🇱, Català 🇦🇩, Gaeilge 🇮🇪 |
| **Central Europe** | Lëtzebuergesch 🇱🇺, Malti 🇲🇹 |
| **Eastern Europe** | Русский 🇷🇺, Українська 🇺🇦, Polski 🇵🇱, Čeština 🇨🇿, Slovenčina 🇸🇰, Magyar 🇭🇺, Română 🇷🇴, Български 🇧🇬, Hrvatski 🇭🇷, Slovenščina 🇸🇮, Српски 🇷🇸 |
| **Scandinavia & Baltics** | Svenska 🇸🇪, Dansk 🇩🇰, Norsk 🇳🇴, Suomi 🇫🇮, Íslenska 🇮🇸, Eesti 🇪🇪, Latviešu 🇱🇻, Lietuvių 🇱🇹 |
| **East Asia** | 日本語 🇯🇵, 한국어 🇰🇷, 中文 (简体) 🇨🇳, 中文 (繁體) 🇹🇼 |
| **Southeast Asia** | Tiếng Việt 🇻🇳, Bahasa Indonesia 🇮🇩, ไทย 🇹🇭, Bahasa Melayu 🇲🇾, Filipino 🇵🇭 |
| **South Asia** | हिन्दी 🇮🇳, বাংলা 🇧🇩, اردو 🇵🇰 |
| **Middle East** | العربية 🇸🇦, עברית 🇮🇱, فارسی 🇮🇷 |
| **Mediterranean** | Türkçe 🇹🇷, Ελληνικά 🇬🇷 |
| **Africa** | Afrikaans 🇿🇦 |

## How translation works

The content script extracts visible text nodes (skipping scripts, inputs, code blocks, hidden content, and `translate="no"` regions), batches them, and asks the background service worker to translate. The worker sends a `POST` request to Google's public Translate endpoint, retries transient failures, and returns structured results. The content script then swaps text in place and remembers the original values for revert. Identical strings are cached in memory per tab for the page session.

## Disclaimer

This extension uses the Google Translate service to provide translations but is not affiliated with, endorsed, or sponsored by Google. All copyrights and trademarks belong to their respective owners.

## Known Limitations

- Due to browser security restrictions, this extension cannot run on internal pages (e.g., `chrome://`, `edge://`) or on the Chrome Web Store / Edge Add-ons website itself.
- Translation relies on an external service and requires an active internet connection.
- Very large pages are translated in batches; a slow connection can make the process take a while. Use the cancel action or revert at any time.

## Manual installation (development build)

1. Clone this repository or download the latest release ZIP.
2. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
3. Click **Load unpacked** and choose the folder that contains `manifest.json`.
4. Use the refresh icon whenever you change local files.

## Development

- `src/shared.js` is the single source of truth for the 49 languages, code normalization, and batch separators. It is loaded by the service worker (`importScripts`), the content script, and the popup.
- `src/background.js` handles the translation transport, context menus, commands, and badges.
- `src/content.js` handles page/selection translation, toasts, revert, dynamic content, and SPA navigation.
- `ui/popup.*` implements the popup; `ui/i18n.js` and `ui/extra-i18n.js` hold its translations.
- `_locales/` holds the browser-facing strings used by the manifest, content script, and background worker. Missing strings fall back to English automatically.
- Preferences persist via `chrome.storage.sync`.

### Verification

```bash
npm run verify
```

This validates the manifest, referenced files, locale/flag parity, popup translation coverage, script order, and JavaScript syntax, then runs the shared-registry tests with Node's built-in test runner. CI runs the same command on every push and pull request.

## Repository Structure

```text
manifest.json
src/
  shared.js
  background.js
  content.js
ui/
icons/
_locales/
docs/
scripts/
test/
```

## Privacy and Support

- Privacy policy: [`docs/PrivacyPolicy.md`](docs/PrivacyPolicy.md)
- LinkedIn: <https://www.linkedin.com/in/wesleymartinsDV>
- GitHub: <https://github.com/wesleymartinsDV/helium-translator-inline>

## License

Feel free to contribute! Keep in mind that the license I chose
is [GPL v3](https://github.com/wesleymartinsDV/helium-translator-inline/blob/main/LICENSE)
