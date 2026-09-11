(() => {
  if (globalThis.__promptVaultInstalled) return;
  globalThis.__promptVaultInstalled = true;
  let lastTarget = null;
  let contextTarget = null;
  let lastFocus = 0;
  let notice = null;
  let noticeTimer;
  const inputTypes = new Set(['text', 'search', 'url', 'tel', 'email']);

  function editable(node) {
    if (!(node instanceof Element)) return null;
    if (node instanceof HTMLTextAreaElement || (node instanceof HTMLInputElement && inputTypes.has(node.type))) {
      return !node.disabled && !node.readOnly ? node : null;
    }
    if (node.isContentEditable) {
      while (node.parentElement?.isContentEditable) node = node.parentElement;
      return node.getAttribute('aria-readonly') === 'true' ? null : node;
    }
    return null;
  }
  function activeElement() {
    let node = document.activeElement;
    while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
    return node;
  }
  const initial = editable(activeElement());
  if (initial) { lastTarget = initial; lastFocus = Date.now(); }
  document.addEventListener('focusin', event => {
    lastTarget = editable(event.composedPath()[0]);
    lastFocus = Date.now();
  }, true);
  document.addEventListener('pointerdown', event => {
    // Clicking away intentionally clears a previously focused editor.
    if (!editable(event.composedPath()[0])) lastTarget = null;
  }, true);
  document.addEventListener('contextmenu', event => {
    contextTarget = editable(event.composedPath()[0]);
    if (contextTarget) { lastTarget = contextTarget; lastFocus = Date.now(); }
  }, true);

  function target(contextMenu) {
    const node = contextMenu ? contextTarget || editable(activeElement()) : editable(activeElement()) || lastTarget;
    return node?.isConnected && editable(node) && node.getClientRects().length ? node : null;
  }
  function append(node, text) {
    node.focus();
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      const previous = node.value;
      const next = previous + text;
      if (node.maxLength >= 0 && next.length > node.maxLength) throw new Error('This prompt exceeds the field’s character limit. Use a shorter prompt.');
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      // Native setter bypasses framework value trackers, then input notifies them.
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, next);
      node.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      try { node.setSelectionRange(next.length, next.length); } catch { /* email inputs lack selection APIs */ }
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      // insertText preserves undo and integrates with many rich text editors.
      // HTML is never interpolated from prompt text.
      if (!document.execCommand('insertText', false, text)) {
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges(); selection.addRange(range);
        node.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      }
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'PV_TARGET') {
      respond({ available: !!target(message.contextMenu), focused: document.hasFocus() && !(activeElement() instanceof HTMLIFrameElement), lastFocus, topFrame: window === window.top });
    } else if (message.type === 'PV_READ_FIELD') {
      const node = target(true);
      if (!node) respond({ ok: false, error: 'Right-click an editable text field first. Password and read-only fields are excluded.' });
      else respond({ ok: true, body: node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : node.innerText });
    } else if (message.type === 'PV_NOTICE' && typeof message.message === 'string') {
      notice?.remove(); clearTimeout(noticeTimer);
      notice = document.createElement('div');
      notice.style.cssText = 'all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647;pointer-events:none;max-width:calc(100vw - 40px)';
      const shadow = notice.attachShadow({ mode: 'closed' });
      const label = document.createElement('div');
      label.setAttribute('role', 'status');
      label.style.cssText = 'font:14px/1.5 system-ui,sans-serif;color:#fff;background:#183c36;padding:14px 18px;border-radius:10px;max-width:350px;box-shadow:0 4px 24px #0003';
      label.textContent = message.message;
      shadow.append(label); document.documentElement.append(notice);
      noticeTimer = setTimeout(() => notice?.remove(), 4500);
      respond({ ok: true });
    } else if (message.type === 'PV_INSERT') {
      try {
        if (typeof message.body !== 'string' || !message.body.trim() || message.body.length > 20000) throw new Error('Invalid prompt text.');
        const node = target(message.contextMenu);
        if (!node) throw new Error('The field is no longer available. Click it and try again.');
        append(node, message.body);
        respond({ ok: true });
      } catch (error) { respond({ ok: false, error: error.message }); }
    }
  });
})();
