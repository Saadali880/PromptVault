import { KEY, LIMIT, validatePrompt, parseBackup, selectPrompts, starterPrompts } from './library.js';

// All writes go through this worker. A queue prevents concurrent popups from
// overwriting one another's read-modify-write operations.
let writes = Promise.resolve();
function serialized(task) {
  const next = writes.then(task);
  writes = next.catch(() => {});
  return next;
}
async function readLibrary() {
  const stored = (await chrome.storage.local.get(KEY))[KEY];
  if (stored !== undefined) {
    if (!Array.isArray(stored)) throw new Error('The saved library is invalid. Export a backup before troubleshooting.');
    return stored;
  }
  const initial = starterPrompts();
  await chrome.storage.local.set({ [KEY]: initial });
  return initial;
}

async function rebuildMenus(prompts) {
  await chrome.contextMenus.removeAll();
  const create = options => new Promise((resolve, reject) => chrome.contextMenus.create(options, () => {
    const error = chrome.runtime.lastError;
    error ? reject(new Error(error.message)) : resolve();
  }));
  await create({ id: 'vault', title: 'PromptVault · Insert prompt', contexts: ['editable'] });
  await create({ id: 'save-selection', title: 'Save selection to PromptVault', contexts: ['selection'] });
  await create({ id: 'save-field', title: 'Save field text to PromptVault', contexts: ['editable'] });
  if (!prompts.length) await create({ id: 'empty', parentId: 'vault', title: 'Add a prompt in the extension popup', contexts: ['editable'], enabled: false });
  for (const prompt of selectPrompts(prompts)) {
    await create({ id: `prompt:${prompt.id}`, parentId: 'vault', title: `${prompt.favorite ? '★ ' : ''}${prompt.title}`, contexts: ['editable'] });
  }
}

async function initialize() {
  // Content scripts have no need to read the library directly.
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await rebuildMenus(await readLibrary());
}
chrome.runtime.onInstalled.addListener(() => serialized(initialize).catch(console.error));
chrome.runtime.onStartup.addListener(() => serialized(initialize).catch(console.error));

async function inject(tabId, body, frameId, contextMenu = false) {
  if (!Number.isInteger(tabId)) throw new Error('Open a webpage and click a text field first.');
  const target = frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
  let frames;
  try {
    // Also bootstraps tabs that were open before installation; content.js is idempotent.
    frames = await chrome.scripting.executeScript({ target, files: ['content.js'] });
  } catch {
    throw new Error('This page cannot be edited. Try a normal http(s) webpage, then click its text field.');
  }
  const candidates = await Promise.all(frames.map(async frame => {
    try {
      const status = await chrome.tabs.sendMessage(tabId, { type: 'PV_TARGET', contextMenu }, { frameId: frame.frameId });
      return { ...status, frameId: frame.frameId };
    } catch { return { available: false }; }
  }));
  const chosen = candidates.filter(c => c.available).sort((a, b) => Number(b.focused) - Number(a.focused) || b.lastFocus - a.lastFocus)[0];
  if (!chosen) throw new Error('Click an editable text field first, then open PromptVault again.');
  const result = await chrome.tabs.sendMessage(tabId, { type: 'PV_INSERT', body, contextMenu }, { frameId: chosen.frameId });
  if (!result?.ok) throw new Error(result?.error || 'The field could not be updated. Try Copy instead.');
  return result;
}

async function handle(message) {
  if (message.type === 'PV_LIST') return { prompts: await readLibrary() };
  if (message.type === 'PV_INJECT') {
    const prompt = (await readLibrary()).find(p => p.id === message.id);
    if (!prompt) throw new Error('This prompt no longer exists.');
    return inject(message.tabId, prompt.body);
  }
  let prompts = await readLibrary();
  if (message.type === 'PV_SAVE') {
    const data = validatePrompt(message.prompt);
    const existing = prompts.find(p => p.id === message.id);
    if (message.id && !existing) throw new Error('This prompt was deleted. Create a new prompt instead.');
    if (!existing && prompts.length >= LIMIT) throw new Error(`Your vault is full (${LIMIT} prompts). Export a backup and remove unused prompts.`);
    const record = { ...data, id: existing?.id || crypto.randomUUID(), createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() };
    prompts = existing ? prompts.map(p => p.id === record.id ? record : p) : [...prompts, record];
  } else if (message.type === 'PV_DELETE') {
    prompts = prompts.filter(p => p.id !== message.id);
  } else if (message.type === 'PV_FAVORITE') {
    prompts = prompts.map(p => p.id === message.id ? { ...p, favorite: !p.favorite } : p);
  } else if (message.type === 'PV_IMPORT') {
    const imported = parseBackup(message.backup);
    const seen = new Set(prompts.map(p => JSON.stringify([p.title, p.body])));
    const additions = imported.filter(p => {
      const key = JSON.stringify([p.title, p.body]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map(p => ({ ...p, id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now() }));
    if (prompts.length + additions.length > LIMIT) throw new Error(`Import would exceed the ${LIMIT}-prompt limit. No changes were made.`);
    prompts = [...prompts, ...additions];
    await chrome.storage.local.set({ [KEY]: prompts });
    const warning = await refreshMenus(prompts);
    return { prompts, imported: additions.length, warning };
  } else throw new Error('Unknown request.');
  await chrome.storage.local.set({ [KEY]: prompts });
  return { prompts, warning: await refreshMenus(prompts) };
}

async function refreshMenus(prompts) {
  try { await rebuildMenus(prompts); }
  catch (error) { console.error(error); return 'Saved, but the right-click menu could not refresh. Reload the extension.'; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only extension pages may read or mutate the vault, or request injection.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  serialized(() => handle(message)).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const saving = ['save-selection', 'save-field'].includes(info.menuItemId);
  if (!saving && !String(info.menuItemId).startsWith('prompt:')) return;
  return serialized(async () => {
    try {
      if (saving) {
        let body = info.selectionText;
        if (info.menuItemId === 'save-field') {
          const options = { frameId: info.frameId ?? 0 };
          let response;
          try {
            response = await chrome.tabs.sendMessage(tab.id, { type: 'PV_READ_FIELD' }, options);
          } catch {
            await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [options.frameId] }, files: ['content.js'] });
            response = await chrome.tabs.sendMessage(tab.id, { type: 'PV_READ_FIELD' }, options);
          }
          if (!response?.ok) throw new Error(response?.error || 'Refresh the page, right-click the field, and try again.');
          body = response.body;
        }
        if (typeof body !== 'string' || !body.trim()) throw new Error('Select some text or type in the field before saving.');
        const title = body.trim().replace(/\s+/g, ' ').slice(0, 80);
        // Reuse normal validation, capacity checks, storage, and menu updates.
        const result = await handle({ type: 'PV_SAVE', prompt: { title, body, category: 'General' } });
        await chrome.action.setBadgeText({ tabId: tab.id, text: result.warning ? '!' : 'SAV' });
        await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: result.warning ? '#a83d31' : '#25604e' });
        await chrome.action.setTitle({ tabId: tab.id, title: result.warning || `Saved to PromptVault: ${title}` });
        await notifyPage(tab.id, info.frameId, result.warning || 'Saved to PromptVault. You can rename it later in your library.');
        return;
      }
      const prompt = (await readLibrary()).find(p => `prompt:${p.id}` === info.menuItemId);
      if (!prompt) return;
      await inject(tab.id, prompt.body, info.frameId, true);
      await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      await chrome.action.setTitle({ tabId: tab.id, title: 'Open PromptVault' });
    } catch (error) {
      await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#a83d31' });
      await chrome.action.setTitle({ tabId: tab.id, title: error.message });
      await notifyPage(tab.id, info.frameId, error.message);
    }
  }).catch(console.error);
});

async function notifyPage(tabId, frameId, message) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'PV_NOTICE', message }, { frameId: frameId ?? 0 }); }
  catch { /* Protected pages still show the action badge and tooltip. */ }
}
