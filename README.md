# PromptVault

PromptVault is a privacy-first Chrome extension for saving, organizing, searching, and reusing AI prompts without leaving the webpage you are working on.

## What it does

- Saves reusable prompts with a title, category, and favorite status.
- Searches prompts by title, body, or category.
- Inserts a saved prompt into the focused input, textarea, or supported rich-text editor.
- Adds right-click actions to save selected text, save a field, or insert a prompt.
- Copies prompts when a webpage does not support direct insertion.
- Imports and exports the complete library as a JSON backup.
- Keeps up to 250 prompts locally in the current Chrome profile.
- Makes no network requests and requires no account, backend, analytics service, or API key.

## Built with

- HTML5
- CSS3
- Vanilla JavaScript (ES modules)
- Chrome Extension Manifest V3
- Chrome Storage API
- Chrome Context Menus API
- Chrome Tabs API
- Chrome Scripting API
- Clipboard API

No libraries or frameworks are used.

## Privacy

Prompts are stored locally using `chrome.storage.local`. PromptVault does not send prompt data to a server. The extension only changes a webpage field after the user explicitly chooses an Insert action.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions/` in Google Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the downloaded PromptVault folder.
6. Open a normal HTTP or HTTPS webpage, click an editable field, and use the extension popup or right-click menu.

## Main files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3 configuration and permissions |
| `background.js` | Local storage, context menus, imports, exports, and prompt insertion workflow |
| `content.js` | Detects editable webpage fields and safely appends prompt text |
| `library.js` | Validation, filtering, categories, limits, and starter prompts |
| `popup.html` / `popup.css` / `popup.js` | Responsive prompt-library interface |
| `guide.html` / `guide.css` | Built-in usage and privacy guide |

## Browser support

Designed for Google Chrome and other Chromium-based browsers that support Manifest V3 APIs.

## Author

**Saad Ali**

- [GitHub](https://github.com/Saadali880)
- [LinkedIn](https://www.linkedin.com/in/saad-ali-3007a1333)
- [Portfolio](https://saadali-portfolio.vercel.app/)