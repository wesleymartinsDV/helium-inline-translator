# Development Planning for "Helium Inline Translator" Extension

This document describes the steps to create a web page and text snippet translation extension, focusing on usability and in-page translation.

> Historical note: the planning sections at the bottom describe the original design. See `README.md` for the current architecture and behavior.

---

## Changelog / Change History

### v1.2.0 (November 7, 2026) - Reliability Overhaul, Shadow DOM and Embedded Content

#### Added:
- **Popup actions and status**: translate page, translate selection, revert, live status line, dynamic shortcut labels, and dynamic version.
- **Progress and cancellation** for full-page translation, with per-tab badge states.
- **Dynamic-content translation** and SPA navigation detection so translated pages stay translated and reset cleanly after navigation.
- **`src/shared.js`** as the single language registry for the service worker, content script, and popup.
- **Verification tooling**: `npm run verify`, Node tests for the shared registry, and a GitHub Actions CI workflow.
- New localized strings for toasts, context menus, commands, and the popup across the supported locales.

#### Changed:
- Translation transport now uses `POST` to `translate.googleapis.com/translate_a/single` with a timeout, bounded retries, and structured responses.
- **`pt-PT`** is now sent as `pt-PT` (instead of collapsing to `pt`) while `pt-BR` continues to use `pt`.
- Selection translation is range-accurate and can translate part of a text node without replacing the entire node.
- Revert only restores a node when it still contains the value written by the extension, protecting live/SPA content.
- Keyboard shortcuts now use `manifest.commands` (`Alt + Shift + Q` and `Alt + Shift + W` by default) and are customizable at `chrome://extensions/shortcuts`. Because Chromium/Edge may refuse to assign `Alt + Shift + W`, the page shortcut also works through an in-page fallback listener.
- Popup layout is scrollable, has explicit focus states, and restores preferences safely across legacy language codes.
- `ui/i18n.js` falls back to English and then to the key when a translation is missing.

#### Fixed:
- Full-page translation no longer overwrites nodes that changed while a request was in flight.
- A single failed batch no longer cancels the whole page translation; remaining batches finish, partial results are reported as partial, and successful translations stay revertible.
- Pressing the page shortcut while translation is running now cancels it and restores any text translated so far; pressing it after a full or partial translation reverts the page.
- `Alt + Shift + W` is sometimes not assigned by Chromium/Edge as an extension command, so the page shortcut also works through an in-page fallback listener.
- Full-page translation now also reaches same- and cross-origin iframes, so embedded stories/widgets are no longer left in the original language.
- Full-page translation now walks open shadow roots, so widgets that render inside a shadow DOM (for example BBC's AQI banner) are translated, kept up to date by the mutation observer, and reverted with the rest of the page. Selection translation also sees shadow content.
- Text added while the first translation pass is running is picked up by a sweep once the pass completes.
- Batch translation recovers by falling back to smaller requests when a separator is translated or dropped.
- Context menus and background error strings use `chrome.i18n` instead of Portuguese-only text.
- Badge state is cleared on tab activation/navigation and no longer gets stuck after a failed action.

#### Removed:
- The automatic "Translate this page?" prompt bubble, page-language detection, and per-site prompt rules (`siteRules`), along with their localized strings and popup preferences.
- Unused `activeTab` and `scripting` permissions.
- Unnecessary `web_accessible_resources`.
- Dead files: `ui/balloon.*`, empty `css/inline.css`, and `icons/icon128.8.png`.

---

### v1.1.1 (January 2026) - Major Language Expansion and Improvements

#### New Languages (+11, total: 49):
- 🇪🇪 Eesti (Estonian) - et
- 🇱🇻 Latviešu (Latvian) - lv
- 🇱🇹 Lietuvių (Lithuanian) - lt
- 🇸🇮 Slovenščina (Slovenian) - sl
- 🇷🇸 Српски (Serbian) - sr
- 🇮🇪 Gaeilge (Irish) - ga
- 🇮🇸 Íslenska (Icelandic) - is
- 🇱🇺 Lëtzebuergesch (Luxembourgish) - lb
- 🇲🇹 Malti (Maltese) - mt
- 🇦🇩 Català (Catalan) - ca
- 🇿🇦 Afrikaans - af

#### Translation Fixes for Languages with Special Alphabets:
- **Issue identified**: The batch separator `|||HTSEP|||` was transliterated for non-Latin alphabets:
  - Russian: `|||HTSEP|||` → `|||ХТСЭП|||`
  - Ukrainian: `|||HTSEP|||` → `|||ХЦЕП|||`
  - Serbian: `[-HTS-]` → `[-ХТС-]`
  - Urdu: `|||HTSEP|||` → `||| htsep |||`

- **Solution implemented**: 3-separator system:
  - `|||HTSEP|||` - Default languages (majority)
  - `[-HTS-]` - Russian, Ukrainian, Bulgarian, Gaeilge (ru, uk, bg, ga)
  - `[---]` - Serbian, Urdu (sr, ur)

#### Branding Improvements:
- Renamed from "Inline Translator Helium" to "Helium Inline Translator"
- Contact button changed from email to LinkedIn
- LinkedIn icon using emoji 🔗 (SVG had rendering issues)

#### Files Created/Modified:
- 2 new `_locales/xx/messages.json` files (ga, sr)
- 11 new SVG flags in `icons/flags/`
- `ui/popup.js` - Language list expanded to 49
- `ui/popup.html` - LinkedIn button updated
- `ui/i18n.js` - UI translations for 49 languages
- `src/content.js` - Multiple separator system
- `README.md` - Updated to 49 languages
- `docs/StoreListing.md` - Updated to 49 languages

---

### v1.1.0 (January 2026) - Language Expansion and Fixes

#### Critical Fixes:
- **Translation separator fixed**: The separator `[-HTS-]` was translated by Google Translate (e.g.: `[-高溫超導-]` in Chinese), breaking full page translation. Changed to `|||HTSEP|||` which is preserved.

#### Language Codes:
- Fixed `pt` → `pt_BR` (Chrome didn't recognize generic code)
- Fixed `zh` → `zh_CN` and added `zh_TW` (Chrome requires specific codes)
- Fixed `no` → `nb` (Norwegian Bokmål - correct code for Chrome)

#### Language Expansion (from 19 to 38):
**New languages added:**
- 🇵🇹 Portuguese (Portugal) - pt_PT
- 🇺🇦 Ukrainian - uk
- 🇻🇳 Vietnamese - vi
- 🇮🇩 Indonesian - id
- 🇹🇭 Thai - th
- 🇧🇩 Bengali - bn
- 🇮🇱 Hebrew - he
- 🇮🇷 Persian - fa
- 🇵🇰 Urdu - ur
- 🇬🇷 Greek - el
- 🇨🇿 Czech - cs
- 🇸🇰 Slovak - sk
- 🇭🇺 Hungarian - hu
- 🇷🇴 Romanian - ro
- 🇧🇬 Bulgarian - bg
- 🇭🇷 Croatian - hr
- 🇲🇾 Malay - ms
- 🇵🇭 Filipino - tl

#### Files Created/Modified:
- 18 new `_locales/xx/messages.json` files
- 18 new SVG flags in `icons/flags/`
- `ui/popup.js` - Expanded language list and mappings
- `ui/i18n.js` - UI translations for 38 languages
- `src/content.js` - New translation separator

---

## Phase 1: Project Structure and Configuration

1.  **Project Directory Creation:**
    *   Folder structure: `icons/` (for 16, 48, 128px icons), `ui/` (for popup and translation balloon), `src/` (for scripts).

2.  **Creating `manifest.json`:**
    *   **Name:** Helium Inline Translator (provisional)
    *   **Permissions:**
        *   `contextMenus`: To create right-click menu options.
        *   `activeTab`: To interact with the current page.
        *   `storage`: To save user settings (default target language).
        *   `scripting`: To inject scripts and CSS into the page.
    *   **Background Script:** Register `src/background.js`.
    *   **Content Script:** Register `src/content.js`.
    *   **Action (Popup):** Set `ui/popup.html` as the default popup.
    *   **Icons:** Specify paths to icons.
    *   **Web Accessible Resources:** Declare translation balloon files so they can be injected into the page.

## Phase 2: Context Menu and Background Script

1.  **Background Script Implementation (`src/background.js`):**
    *   **Menu Creation:**
        *   On extension installation (`chrome.runtime.onInstalled`), create two context menus.
        *   Menu 1: "Translate entire page", always visible.
        *   Menu 2: "Translate selected text", visible only when text is selected (`"contexts": ["selection"]`).
    *   **Click Listeners:**
        *   Add `chrome.contextMenus.onClicked` to listen for menu click events.
        *   If "Translate entire page" is clicked, send a message to the active tab's content script.
        *   If "Translate selected text" is clicked, get the text (`info.selectionText`), translate it, and send the result to the content script.
    *   **Translation Logic:**
        *   Implement a `translateText(text, targetLang)` function.
        *   Use a free/public translation API (e.g.: Google Translate via HTTP request, to avoid needing an API key initially).
        *   The function will detect the source language and translate to `targetLang`.
    *   **State Management:**
        *   Listen for messages from popup to update the default target language, saving it with `chrome.storage.sync`.

## Phase 3: Page Interaction (Content Script)

1.  **Content Script Implementation (`src/content.js`):**
    *   **Message Listener:**
        *   Listen for messages from `background.js`.
        *   If receiving an order to "translate entire page":
            *   Traverse the page DOM, identifying text nodes.
            *   Send text batches to `background.js` for translation.
            *   Receive translations and replace text node content.
            *   Observe the DOM (`MutationObserver`) to translate dynamic content.
        *   If receiving an order to "show translation balloon":
            *   Receive the translated text and original text.
            *   Inject an `<iframe>` or `<div>` into the page as the translation balloon.
            *   Populate the balloon with translated text, "Copy" and "Listen" buttons.
            *   Position the balloon near the selected text.
            *   Add logic to close the balloon (click outside, Esc key).

## Phase 4: User Interface (UI)

1.  **Translation Balloon Development (`ui/balloon.html`, `ui/balloon.css`, `ui/balloon.js`):**
    *   **HTML:** Balloon structure with areas for translated text, target language, and buttons.
    *   **CSS:** Modern, non-intrusive styling.
    *   **JS:** Logic for buttons (copy, listen - using `speechSynthesis`).

2.  **Popup Development (`ui/popup.html`, `ui/popup.css`, `ui/popup.js`):**
    *   **HTML:** Target language selector, button to revert page translation.
    *   **JS:**
        *   Load the saved target language from `chrome.storage`.
        *   Save the user's choice to `chrome.storage` when changed.
        *   Implement the "Revert Translation" button logic, which will send a message to the content script.

## Phase 5: Testing and Finalization

1.  **Manual Testing:**
    *   Load the extension in developer mode.
    *   Test on different websites (static and dynamic).
    *   Verify correct context menu creation.
    *   Test snippet and full page translation.
    *   Verify balloon and popup UI and functionality.
    *   Test settings persistence.

2.  **Packaging:**
    *   Create the `.zip` file for distribution.