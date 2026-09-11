import { CATEGORIES, selectPrompts } from './library.js';
const $ = id => document.getElementById(id);
let prompts = [], favorites = false, editingId = null, activeTabId, pendingDelete = null;
let toastTimer, busy = false;
for (const category of CATEGORIES) {
  $('category-filter').add(new Option(category, category));
  $('prompt-category').add(new Option(category, category));
}
async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || 'PromptVault could not connect. Reload the extension and try again.');
  return result;
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 3500);
}
async function perform(task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await task(); } catch (error) { toast(error.message, true); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
function render() {
  const visible = selectPrompts(prompts, $('search').value, $('category-filter').value, favorites);
  $('all-count').textContent = prompts.length;
  $('result-count').textContent = `${visible.length} ${visible.length === 1 ? 'prompt' : 'prompts'}${visible.length !== prompts.length ? ` of ${prompts.length}` : ' in your vault'}`;
  $('prompt-list').replaceChildren();
  $('empty').hidden = visible.length > 0;
  $('empty-title').textContent = prompts.length ? 'No prompts found.' : 'A little space for a big idea.';
  $('empty-description').textContent = prompts.length ? 'Try another keyword or clear your filters.' : 'Save your first prompt and make it a shortcut.';
  $('empty-action').textContent = prompts.length ? 'Clear filters' : 'Create a prompt';
  for (const p of visible) {
    const card = $('card-template').content.firstElementChild.cloneNode(true);
    card.querySelector('h2').textContent = p.title;
    card.querySelector('.preview').textContent = p.body;
    card.querySelector('.category').textContent = p.category;
    card.querySelector('.category').dataset.category = p.category;
    card.querySelector('.length').textContent = `${p.body.length.toLocaleString()} characters`;
    const favorite = card.querySelector('.favorite');
    favorite.textContent = p.favorite ? '★' : '☆';
    favorite.setAttribute('aria-pressed', String(p.favorite));
    favorite.setAttribute('aria-label', `${p.favorite ? 'Unfavorite' : 'Favorite'} ${p.title}`);
    favorite.onclick = () => perform(async () => update(await request({ type: 'PV_FAVORITE', id: p.id })));
    card.querySelector('.edit').onclick = () => openEditor(p);
    card.querySelector('.delete').onclick = () => { pendingDelete = p.id; $('delete-name').textContent = p.title; $('delete-dialog').showModal(); };
    card.querySelector('.copy').onclick = () => perform(async () => { await navigator.clipboard.writeText(p.body); toast('Copied. Take a good prompt anywhere.'); });
    card.querySelector('.insert').onclick = () => perform(async () => {
      await request({ type: 'PV_INJECT', id: p.id, tabId: activeTabId });
      toast('Prompt appended. Your existing text is still there.');
    });
    $('prompt-list').append(card);
  }
}
function update(result) {
  prompts = result.prompts; render();
  if (result.warning) toast(result.warning, true);
}
function setFavorites(value) {
  favorites = value;
  $('all-tab').classList.toggle('active', !value); $('favorites-tab').classList.toggle('active', value);
  $('all-tab').setAttribute('aria-pressed', String(!value)); $('favorites-tab').setAttribute('aria-pressed', String(value)); render();
}
function openEditor(prompt = null) {
  editingId = prompt?.id || null;
  $('editor-title').textContent = prompt ? 'Refine your prompt.' : 'New prompt.';
  $('prompt-title').value = prompt?.title || '';
  $('prompt-body').value = prompt?.body || '';
  $('prompt-category').value = prompt?.category || 'General';
  $('prompt-favorite').checked = prompt?.favorite || false;
  countCharacters(); $('library-view').hidden = true; $('editor-view').hidden = false; $('prompt-title').focus();
}
function closeEditor() { $('editor-view').hidden = true; $('library-view').hidden = false; $('new-prompt').focus(); }
function countCharacters() { $('character-count').textContent = `${$('prompt-body').value.length.toLocaleString()} / 20,000`; }
$('new-prompt').onclick = () => openEditor();
$('back').onclick = closeEditor; $('cancel').onclick = closeEditor;
$('prompt-body').oninput = countCharacters;
$('search').oninput = render; $('category-filter').onchange = render;
$('all-tab').onclick = () => setFavorites(false); $('favorites-tab').onclick = () => setFavorites(true);
$('empty-action').onclick = () => {
  if (!prompts.length) return openEditor();
  $('search').value = ''; $('category-filter').value = 'All'; setFavorites(false);
};
$('prompt-form').onsubmit = event => {
  event.preventDefault();
  perform(async () => {
    const result = await request({ type: 'PV_SAVE', id: editingId, prompt: { title: $('prompt-title').value, body: $('prompt-body').value, category: $('prompt-category').value, favorite: $('prompt-favorite').checked } });
    $('search').value = ''; $('category-filter').value = 'All'; setFavorites(false);
    update(result); closeEditor(); if (!result.warning) toast('Saved to your vault. Ready for next time.');
  });
};
$('delete-dialog').addEventListener('close', () => {
  if ($('delete-dialog').returnValue !== 'delete' || !pendingDelete) return;
  const id = pendingDelete; pendingDelete = null;
  perform(async () => { const result = await request({ type: 'PV_DELETE', id }); update(result); if (!result.warning) toast('Prompt deleted.'); });
});
$('export').onclick = () => perform(async () => {
  const result = await request({ type: 'PV_LIST' });
  const backup = { format: 'promptvault', version: 1, exportedAt: new Date().toISOString(), prompts: result.prompts };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `promptvault-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000); toast('Backup download started. Keep it somewhere safe.');
});
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = () => perform(async () => {
  const file = $('import-file').files[0]; $('import-file').value = '';
  if (!file) return;
  if (file.size > 6000000) throw new Error('Choose a JSON backup smaller than 6 MB.');
  let backup; try { backup = JSON.parse(await file.text()); } catch { throw new Error('That file is not valid JSON. Choose a PromptVault backup.'); }
  const result = await request({ type: 'PV_IMPORT', backup }); update(result);
  if (!result.warning) toast(`${result.imported} prompts imported. Exact duplicates were skipped.`);
});
$('help').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('library-view').hidden && !$('delete-dialog').open) { event.preventDefault(); $('search').focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !$('editor-view').hidden) $('prompt-form').requestSubmit();
});
await perform(async () => {
  const [result, tabs] = await Promise.all([request({ type: 'PV_LIST' }), chrome.tabs.query({ active: true, currentWindow: true })]);
  activeTabId = tabs[0]?.id; update(result);
});
