// ==UserScript==
// @name         Stacks Project Hover Preview
// @namespace    https://stacks.math.columbia.edu/
// @version      1.1.1
// @description  Read linked Stacks Project statements and proofs without leaving the page.
// @homepageURL  https://github.com/lucashmartinss/stacks-project-hover-preview
// @match        https://stacks.math.columbia.edu/*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  if (location.origin !== 'https://stacks.math.columbia.edu' ||
      document.getElementById('stacks-hover-card')) return;

  const prefix = 'stacks-hover-preview:v1:';
  const maxBytes = 512 * 1024;
  const htmlNamespace = 'http://www.w3.org/1999/xhtml';
  const day = 24 * 60 * 60 * 1000;
  const retryDelay = 5 * 60 * 1000;
  const pending = new Map();
  const failures = new Map();
  const memory = new Map();
  const safeElements = new Set(
    'a article b blockquote br caption code dd div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img li ol p pre section small span strong sub sup table tbody td tfoot th thead tr ul'.split(' ')
  );
  const discard = new Set([
    'script', 'style', 'iframe', 'object', 'template', 'noscript', 'form', 'button', 'select'
  ]);
  const allowedClasses = /^(?:env-[a-z-]+|environment-identifier|equation|qed|tex-[a-z-]+|tag)$/;

  const tagURL = (tag) => new URL('/tag/' + tag, location.origin);

  function getTag(link) {
    if (!link || card.contains(link) || !URL.canParse(link.href, document.baseURI)) return null;
    const url = new URL(link.href, document.baseURI);
    if (url.origin !== location.origin) return null;
    return /^\/tag\/([0-9A-Z]{4})\/?$/i.exec(url.pathname)?.[1].toUpperCase() ?? null;
  }

  function readCache(tag) {
    if (memory.has(tag)) return memory.get(tag);
    try {
      const entry = JSON.parse(localStorage.getItem(prefix + tag));
      if (typeof entry?.html === 'string' && entry.html.length <= maxBytes &&
          Number.isFinite(entry.checkedAt) && entry.checkedAt <= Date.now()) return entry;
    } catch {
      // Browsers can deny storage, and individual entries can be corrupt.
    }
    return null;
  }

  function saveCache(tag, entry) {
    try {
      localStorage.setItem(prefix + tag, JSON.stringify(entry));
      memory.delete(tag);
    } catch {
      memory.set(tag, entry);
      if (memory.size > 8) memory.delete(memory.keys().next().value);
    }
  }

  function parseFragment(html, tag) {
    const template = document.createElement('template');
    template.innerHTML = html;
    if (!template.content.querySelector('[id="' + tag + '"], [data-tag="' + tag + '"]')) {
      throw new Error('The tag response did not contain the requested tag.');
    }
    return template.content;
  }

  async function readHTML(response) {
    if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/html')) {
      throw new Error('Unexpected preview content type.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let html = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return html + decoder.decode();
        size += value.byteLength;
        if (size > maxBytes) throw new Error('Preview exceeds the size limit.');
        html += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async function fetchTag(tag) {
    const cached = readCache(tag);
    if (cached && Date.now() - cached.checkedAt < day) return cached;
    if (Date.now() < (failures.get(tag) ?? 0)) return cached;

    const headers = {};
    if (typeof cached?.etag === 'string') headers['If-None-Match'] = cached.etag;
    if (typeof cached?.lastModified === 'string') headers['If-Modified-Since'] = cached.lastModified;
    try {
      const endpoint = new URL('/data/tag/' + tag + '/content/full', location.origin);
      const response = await fetch(endpoint, {
        cache: 'no-store',
        credentials: 'omit',
        mode: 'same-origin',
        redirect: 'error',
        headers,
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok && !(response.status === 304 && cached)) {
        throw new Error('The tag request failed.');
      }
      const html = response.status === 304 ? cached.html : await readHTML(response);
      if (html !== cached?.html) parseFragment(html, tag);
      const entry = {
        html: html === cached?.html ? cached.html : html,
        checkedAt: Date.now(),
        etag: response.headers.get('ETag') ?? (response.status === 304 ? cached.etag : null),
        lastModified: response.headers.get('Last-Modified') ??
          (response.status === 304 ? cached.lastModified : null)
      };
      saveCache(tag, entry);
      failures.delete(tag);
      return entry;
    } catch {
      failures.set(tag, Date.now() + retryDelay);
      return cached;
    }
  }

  function refresh(tag) {
    if (!pending.has(tag)) {
      const request = navigator.locks?.request(prefix + tag, () => fetchTag(tag))
        .catch(() => fetchTag(tag)) ?? fetchTag(tag);
      pending.set(tag, request.finally(() => pending.delete(tag)));
    }
    return pending.get(tag);
  }

  function previewContent(html, tag) {
    const base = tagURL(tag);
    const output = document.createDocumentFragment();
    let remaining = 12000;
    function copyChildren(source, target, depth) {
      if (depth > 64) return;
      for (const node of source.childNodes) {
        if (--remaining < 0) return;
        if (node.nodeType === Node.TEXT_NODE) {
          target.append(document.createTextNode(node.data));
          continue;
        }
        const name = node.localName;
        if (node.namespaceURI !== htmlNamespace || discard.has(name)) continue;
        if (!safeElements.has(name)) {
          copyChildren(node, target, depth + 1);
          continue;
        }

        const clean = document.createElement(name);
        const classes = [...node.classList].filter(value => allowedClasses.test(value));
        if (classes.length) clean.className = classes.join(' ');
        for (const attr of ['alt', 'title', 'colspan', 'rowspan', 'start', 'value']) {
          if (node.hasAttribute(attr)) clean.setAttribute(attr, node.getAttribute(attr));
        }
        if (name === 'a' || name === 'img') {
          const attribute = name === 'a' ? 'href' : 'src';
          const raw = node.getAttribute(attribute);
          if (raw && URL.canParse(raw, base)) {
            const url = new URL(raw, base);
            const imageAllowed = url.origin === base.origin &&
              url.pathname.startsWith('/static/') && !url.search && !url.hash;
            if (/^https?:$/.test(url.protocol) && !url.username && !url.password &&
                (name === 'a' || imageAllowed)) {
              clean.referrerPolicy = 'no-referrer';
              clean.setAttribute(attribute, url.href);
            }
          }
        }
        copyChildren(node, clean, depth + 1);
        target.append(clean);
      }
    }
    copyChildren(parseFragment(html, tag), output, 0);
    return output;
  }

  const style = document.createElement('style');
  style.textContent = `
    #stacks-hover-card {
      position: fixed; z-index: 2147483647; margin: 0;
      width: min(42rem, calc(100vw - 16px)); max-height: min(33rem, 65vh);
      overflow: auto; overscroll-behavior: contain; box-sizing: border-box;
      background: #fff; color: #202326; border: 1px solid #b5bec7;
      border-radius: 8px; box-shadow: 0 8px 28px #18263533;
      font-size: 1rem; line-height: 1.5;
    }
    #stacks-hover-card[hidden] { display: none !important; }
    #stacks-hover-card header {
      position: sticky; top: 0; z-index: 1; display: flex;
      align-items: center; justify-content: space-between;
      background: #f3f6f9; border-bottom: 1px solid #dbe1e7; padding: 6px 14px;
    }
    #stacks-hover-card button { cursor: pointer; border: 0; background: none; font-size: 1.2rem; }
    #stacks-hover-body { padding: 12px 16px; }
    #stacks-hover-body > :last-child, #stacks-hover-body > :last-child > :last-child { margin-bottom: 0; }
    #stacks-hover-body img { max-width: 100%; height: auto; }
    #stacks-hover-body .equation { overflow-x: auto; }
  `;
  document.head.append(style);

  const card = document.createElement('aside');
  card.id = 'stacks-hover-card';
  card.hidden = true;
  card.setAttribute('aria-label', 'Stacks Project tag preview');
  const header = document.createElement('header');
  const openLink = document.createElement('a');
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Close preview');
  const body = document.createElement('div');
  body.id = 'stacks-hover-body';
  header.append(openLink, closeButton);
  card.append(header, body);
  document.body.append(card);

  let anchor = null;
  let openTimer;
  let closeTimer;
  let mathTimer;
  let generation = 0;

  function position() {
    if (card.hidden || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 11;
    const above = rect.top - 11;
    const showAbove = below < 320 && above > below;
    const available = Math.min(innerHeight - 16, showAbove ? above : below);
    card.style.maxHeight = 'min(33rem, 65vh, ' + Math.max(0, available) + 'px)';
    card.style.left = Math.max(8, Math.min(rect.left, innerWidth - card.offsetWidth - 8)) + 'px';
    const top = showAbove ? rect.top - card.offsetHeight - 3 : rect.bottom + 3;
    card.style.top = Math.max(8, Math.min(top, innerHeight - card.offsetHeight - 8)) + 'px';
  }

  function close() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    clearTimeout(mathTimer);
    generation++;
    anchor = null;
    card.hidden = true;
    body.replaceChildren();
  }

  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!card.matches(':hover, :focus-within') &&
          !anchor?.matches(':hover, :focus')) close();
    }, 220);
  }

  function typeset(content, attempts = 40) {
    if (!content.isConnected || card.hidden) return;
    const math = window.MathJax;
    const hub = math?.Hub;
    if (hub?.Queue && math.Ajax?.Require) {
      // HTML filtering does not cover the markup generated by TeX commands.
      const allow = { URLs: 'none', classes: 'none', cssIDs: 'none', styles: 'none', require: 'none' };
      hub.Queue(
        () => {
          if (!content.isConnected || math.Extension?.Safe) return;
          hub.Config({ Safe: { allow } });
          return math.Ajax.Require('[MathJax]/extensions/Safe.js');
        },
        () => {
          const settings = math.Extension?.Safe?.config?.allow;
          if (!content.isConnected || !settings) return;
          Object.assign(settings, allow);
          return hub.Typeset(content);
        },
        () => { if (content.isConnected) position(); }
      );
    } else if (attempts > 0) {
      mathTimer = setTimeout(() => typeset(content, attempts - 1), 125);
    }
  }

  function render(html, tag) {
    clearTimeout(mathTimer);
    const content = document.createElement('div');
    try {
      content.append(previewContent(html, tag));
    } catch {
      return false;
    }
    body.replaceChildren(content);
    typeset(content);
    position();
    return true;
  }

  async function show(link, tag, ticket) {
    if (ticket !== generation || anchor !== link) return;
    openLink.href = tagURL(tag).href;
    openLink.textContent = 'Open tag ' + tag;
    card.hidden = false;
    card.scrollTop = 0;
    const cached = readCache(tag);
    const displayed = cached && render(cached.html, tag);
    if (!displayed) {
      body.textContent = 'Loading preview…';
      position();
    }
    const result = await refresh(tag);
    if (ticket !== generation) return;
    const updated = result && result.html !== cached?.html && render(result.html, tag);
    if (!displayed && !updated) {
      body.textContent = 'Preview unavailable. Open the tag to read it on Stacks.';
      position();
    }
  }

  function scheduleOpen(link) {
    const tag = getTag(link);
    if (!tag) return;
    clearTimeout(closeTimer);
    if (anchor === link) return;
    close();
    anchor = link;
    const ticket = generation;
    openTimer = setTimeout(() => show(link, tag, ticket), 260);
  }

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    scheduleOpen(event.target.closest?.('a[href]'));
  });
  document.addEventListener('pointerout', (event) => {
    if (event.target.closest?.('a[href]') !== anchor || !anchor ||
        anchor.contains(event.relatedTarget)) return;
    if (card.hidden && !anchor.matches(':focus')) close();
    else scheduleClose();
  });
  document.addEventListener('focusin', (event) => scheduleOpen(event.target.closest?.('a[href]')));
  document.addEventListener('focusout', (event) => {
    if (event.target === anchor || card.contains(event.target)) scheduleClose();
  });
  card.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  card.addEventListener('pointerleave', scheduleClose);
  function dismiss() {
    if (card.contains(document.activeElement)) anchor?.focus({ preventScroll: true });
    close();
  }
  closeButton.addEventListener('click', dismiss);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && anchor) dismiss();
    if (event.key === 'ArrowDown' && event.target === anchor && !card.hidden) {
      event.preventDefault();
      openLink.focus({ preventScroll: true });
    }
  });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, { passive: true });
})();
