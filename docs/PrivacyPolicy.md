# Privacy Policy for Helium Inline Translator

Last updated: November 7, 2026

Helium Inline Translator ("the Extension") is an open-source browser extension maintained by Wesley Martins ("we", "us"). This policy explains what data the Extension handles when you install and use it in Chromium-based browsers such as Google Chrome, Microsoft Edge, Opera, or Helium.

## Summary

- Text is sent to Google Translate only when you ask the Extension to translate something.
- The Extension has no analytics, advertising, tracking, or developer-operated servers.
- Preferences are stored in your browser's extension storage.
- We do not sell, rent, or share personal data.

## Text you choose to translate

When you translate a page, translate a selection, or use the right-click menu, the Extension reads visible text from the current tab and sends it over HTTPS to Google's public Translate endpoint (`translate.googleapis.com`) to obtain a translation. This is the same service used by the Google Translate website.

The text may include personal or sensitive information that appears on the page you are viewing, so only translate pages you trust. The Extension sends only the extracted visible text needed for the request; it does not intentionally send URLs, cookies, browsing history, credentials, or form data.

The Extension does not operate a server, does not log or retain translated text, and keeps a short-lived in-memory cache per tab so identical text is not sent twice during the same page session. That cache is discarded when the page is closed or reloaded.

## Preferences

- **`chrome.storage.sync`** stores your target language, UI language, theme, and favorite languages. If you are signed in to the browser, the browser vendor may synchronize this data across your devices under its own privacy policy.

You can remove all stored data by uninstalling the Extension.

## Permissions and why they are needed

- **`storage`**: saves the preferences described above.
- **`contextMenus`**: adds "Translate entire page" and "Translate selected text" to the right-click menu.
- **Content script access to web pages (`<all_urls>`)**: required to read and replace page text inline. Without it, the Extension cannot translate pages. It does not run on browser-internal pages such as `chrome://` or `edge://`.

No other permissions are requested.

## Third-party services

Translations are produced by Google Translate. Text sent for translation is handled by Google under the [Google Privacy Policy](https://policies.google.com/privacy). We do not control Google's handling of that data and do not receive a copy of it.

Apart from Google Translate, the Extension communicates with no external services. Installation and updates are handled by the browser store you used.

## Data sharing and sale

We do not sell, rent, trade, or otherwise transfer personal data. We cannot access the text you translate because it is sent directly from your browser to Google Translate.

## Security

Translation requests use HTTPS. No system is perfectly secure; use the Extension only on pages you trust and keep your browser up to date. Install the Extension only from the Chrome Web Store, Microsoft Edge Add-ons, or the official GitHub repository.

## Children's privacy

The Extension is not directed to children under the age of 13 and does not knowingly collect personal information from them.

## Changes to this policy

We may update this policy from time to time. The date at the top of this document will reflect the most recent revision, and the current version is published in the public repository.

## Contact

For questions about this policy or the Extension, contact `wesleydeveloper@icloud.com`.
