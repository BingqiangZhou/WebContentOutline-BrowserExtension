/**
 * The options page (entrypoints/options/main.ts), executed for real.
 *
 * The page is a thin view over chrome.storage.local, and two other writers
 * change that storage behind its back: the toolbar icon (per-site activation)
 * and the in-page config dialog (selector configs). So the page has to follow
 * storage, and its own writes have to go through the background's serialized
 * queues instead of writing storage directly — where they could overwrite a
 * change another tab is making at the same moment.
 *
 * A small fake DOM and a fake `chrome` stand in for the browser: the module is
 * loaded at top level (it renders on import), so this is as close to running
 * the real page as a unit test gets.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { moduleScript, loadTocMessage } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOC_MESSAGE = loadTocMessage();
const clone = (value) => structuredClone(value);

// --- fake DOM ---------------------------------------------------------------------
// Selector support is deliberately tiny: tag, .class, #id and [attr="value"],
// combined into descendant chains by whitespace ("#list input[x=\"y\"]").
function matches(el, selector) {
  const compounds = String(selector).trim().split(/\s+/);
  if (!compound(el, compounds[compounds.length - 1])) return false;
  const ancestors = compounds.slice(0, -1).reverse();
  let node = el._parent;
  for (const part of ancestors) {
    for (; node; node = node._parent) if (compound(node, part)) break;
    if (!node) return false;
    node = node._parent;
  }
  return true;
}

function compound(el, selector) {
  const parsed = String(selector).match(/^([a-z]*)((?:[.#][\w-]+|\[[^\]]+\])*)$/i);
  if (!parsed) return false;
  if (parsed[1] && el.tagName !== parsed[1].toUpperCase()) return false;
  const parts = parsed[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || [];
  return parts.every((part) => {
    if (part[0] === '.') return el._classes.has(part.slice(1));
    if (part[0] === '#') return el._attrs.id === part.slice(1);
    const attr = part.slice(1, -1).match(/^([\w-]+)(?:="([^"]*)")?$/);
    if (!attr) return false;
    const name = attr[1];
    const value = name.startsWith('data-')
      ? el.dataset[name.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())]
      : el._attrs[name];
    if (attr[2] === undefined) return value !== undefined && value !== null;
    // Values are written with CSS.escape(); undo it.
    return String(value) === attr[2].replace(/\\(.)/g, '$1');
  });
}
const descendants = (el) => el.children.flatMap((child) => [child, ...descendants(child)]);

function makeDocument() {
  const document = { activeElement: null, body: null };
  document.body = makeEl('body');
  // The skeleton of entrypoints/options/index.html.
  const main = makeEl('main'); main.id = 'app';
  const section = (headingId, ...extra) => {
    const s = makeEl('section'); s.setAttribute('aria-labelledby', headingId);
    const h2 = makeEl('h2'); h2.id = headingId; s.append(h2, ...extra);
    return s;
  };
  const title = makeEl('h1'); title.id = 'app-title';
  const sitesNote = makeEl('p'); sitesNote.id = 'sites-description'; sitesNote.className = 'section-note';
  const sitesList = makeEl('ul'); sitesList.id = 'sites-list'; sitesList.className = 'card-list';
  const sitesEmpty = makeEl('p'); sitesEmpty.id = 'sites-empty'; sitesEmpty.className = 'empty'; sitesEmpty.hidden = true;
  const configsList = makeEl('ul'); configsList.id = 'configs-list'; configsList.className = 'card-list';
  const configsEmpty = makeEl('p'); configsEmpty.id = 'configs-empty'; configsEmpty.className = 'empty'; configsEmpty.hidden = true;
  main.append(title, section('sites-heading', sitesNote, sitesList, sitesEmpty), section('configs-heading', configsList, configsEmpty));
  document.body.append(main);
  document.getElementById = (id) => descendants(document.body).find((el) => el._attrs.id === id) || null;
  document.querySelector = (selector) => descendants(document.body).find((el) => matches(el, selector)) || null;
  document.querySelectorAll = (selector) => descendants(document.body).filter((el) => matches(el, selector));
  document.createElement = makeEl;
  return document;

  function makeEl(tagName) {
    const el = {
      tagName: String(tagName).toUpperCase(),
      ownerDocument: document,
      children: [],
      _parent: null,
      _classes: new Set(),
      _attrs: {},
      _listeners: {},
      dataset: {},
      _text: '',
      _checked: false,
      type: '',
      hidden: false
    };
    Object.defineProperty(el, 'id', {
      get: () => el._attrs.id || '',
      set: (value) => { el._attrs.id = String(value); },
      configurable: true, enumerable: true
    });
    Object.defineProperty(el, 'className', {
      get: () => [...el._classes].join(' '),
      set: (value) => { el._classes = new Set(String(value).split(/\s+/).filter(Boolean)); },
      configurable: true, enumerable: true
    });
    Object.defineProperty(el, 'textContent', {
      get: () => el._text + el.children.map((child) => child.textContent).join(''),
      set: (value) => { el.children.forEach((child) => { child._parent = null; }); el.children = []; el._text = String(value); },
      configurable: true, enumerable: true
    });
    Object.defineProperty(el, 'checked', {
      get: () => el._checked,
      set: (value) => { el._checked = !!value; },
      configurable: true, enumerable: true
    });
    Object.defineProperty(el, 'isConnected', {
      get: () => { for (let n = el; n; n = n._parent) if (n === document.body) return true; return false; },
      configurable: true
    });
    el.setAttribute = (name, value) => {
      el._attrs[name] = String(value);
      if (name === 'class') el.className = String(value);
      if (name === 'id') el.id = String(value);
    };
    el.getAttribute = (name) => (name in el._attrs ? el._attrs[name] : null);
    el.matches = (selector) => matches(el, selector);
    el.append = (...nodes) => { nodes.forEach((node) => el.appendChild(node)); };
    el.appendChild = (child) => { child._parent = el; el.children.push(child); return child; };
    const detach = (child) => {
      child._parent = null;
      // Like a real DOM: removing the focused element (or a subtree holding it)
      // moves focus to <body>.
      if (document.activeElement && el.contains(document.activeElement) && !nodesIncludes(document.activeElement)) document.activeElement = document.body;
    };
    let pending;
    const nodesIncludes = (node) => pending.includes(node);
    el.replaceChildren = (...nodes) => {
      pending = nodes;
      el.children.forEach(detach);
      el.children = [];
      nodes.forEach((node) => el.appendChild(node));
    };
    el.remove = () => {
      if (!el._parent) return;
      const i = el._parent.children.indexOf(el);
      if (i >= 0) el._parent.children.splice(i, 1);
      el._parent = null;
      if (document.activeElement && el.contains(document.activeElement)) document.activeElement = document.body;
    };
    el.contains = (node) => { for (let n = node; n; n = n._parent) if (n === el) return true; return false; };
    el.closest = (selector) => { for (let n = el; n; n = n._parent) if (matches(n, selector)) return n; return null; };
    el.querySelector = (selector) => descendants(el).find((node) => matches(node, selector)) || null;
    el.querySelectorAll = (selector) => descendants(el).filter((node) => matches(node, selector));
    el.addEventListener = (type, fn) => { (el._listeners[type] = el._listeners[type] || []).push(fn); };
    el.removeEventListener = (type, fn) => { el._listeners[type] = (el._listeners[type] || []).filter((f) => f !== fn); };
    // Bubbles to the ancestors, like a real DOM event.
    el.dispatch = (type, event = {}) => {
      event.target = el;
      for (let n = el; n; n = n._parent) {
        for (const fn of [...(n._listeners[type] || [])]) fn(event);
      }
    };
    el.click = () => {
      if (el.type === 'checkbox') el._checked = !el._checked;
      el.dispatch('click');
      el.dispatch('change');
    };
    el.focus = () => { document.activeElement = el; };
    return el;
  }
}

// --- the real page over a fake chrome ----------------------------------------------
async function settle() {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function loadOptionsPage(stored) {
  const store = { tocSiteEnabledMap: {}, tocConfigs: [], ...clone(stored) };
  const storageListeners = [];
  const sentMessages = [];
  const timers = [];
  let directWrites = 0;
  let background = () => ({ ok: true });        // what the "background" answers; tests replace it

  const chrome = {
    i18n: {
      getMessage: (key, substitutions) => (substitutions ? key + ':' + [].concat(substitutions).join(',') : key)
    },
    storage: {
      local: {
        get: async (keys) => { const out = {}; for (const key of keys) out[key] = clone(store[key]); return out; },
        // The page must never write storage itself; make that visible.
        set: async () => { directWrites++; throw new Error('direct storage write from the options page'); }
      },
      onChanged: { addListener: (fn) => storageListeners.push(fn) }
    },
    runtime: {
      sendMessage: async (message) => { sentMessages.push(clone(message)); return background(message); }
    }
  };
  const document = makeDocument();
  const window = {
    // Timers are queued; a test fires them one at a time.
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1] = null; }
  };
  const sandbox = {
    console,
    document,
    window,
    chrome,
    // What the page imports from the shared module.
    TOC_MESSAGE,
    CSS: { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  const file = path.join(repoRoot, 'entrypoints/options/main.ts');
  vm.runInNewContext(moduleScript(fs.readFileSync(file, 'utf8')), sandbox, { filename: file });

  return {
    store,
    // Fire the oldest queued timer (a cleared one counts as fired) …
    runFirstTimer: () => { const fn = timers.shift(); if (fn) fn(); },
    // … or all of them, oldest first.
    runAllTimers: () => { while (timers.length) { const fn = timers.shift(); if (fn) fn(); } },
    sentMessages: () => clone(sentMessages),
    directWrites: () => directWrites,
    background: (fn) => { background = fn; },
    fireStorageChange: (key) => {
      // chrome fires onChanged after the write has landed.
      for (const fn of storageListeners) fn({ [key]: { newValue: clone(store[key]) } }, 'local');
    },
    toggleFor: (origin) => document.querySelector(`#sites-list input[aria-label="${origin}"]`),
    stateLabelFor: (origin) => {
      const toggle = document.querySelector(`#sites-list input[aria-label="${origin}"]`);
      return toggle ? toggle.closest('label').querySelector('.state-label').textContent : null;
    },
    // The delete button of the row that lists `urlPattern`.
    deleteButtonFor: (urlPattern) => {
      const row = document.querySelectorAll('#configs-list li').find((li) => li.querySelector('.config-pattern').textContent === urlPattern);
      return row ? row.querySelector('button[aria-label="optionsDeleteConfig"]') : null;
    },
    listedConfigPatterns: () => document.querySelectorAll('#configs-list .config-pattern').map((el) => el.textContent),
    listedOrigins: () => document.querySelectorAll('#sites-list input[aria-label]').map((el) => el.getAttribute('aria-label')),
    // Error notes that a visitor could actually read: attached to the document.
    visibleErrors: () => descendants(document.body).filter((el) => el._classes.has('save-error')).map((el) => el.textContent),
    focusedElement: () => document.activeElement
  };
}

// --- tests --------------------------------------------------------------------------

test('the site list follows activation changes made elsewhere while the page is open', async () => {
  const env = loadOptionsPage({ tocSiteEnabledMap: { 'https://a.example': true } });
  await settle();
  assert.equal(env.toggleFor('https://a.example').checked, true);

  // The user clicks the toolbar icon in some tab; the background writes storage.
  env.store.tocSiteEnabledMap['https://a.example'] = false;
  env.fireStorageChange('tocSiteEnabledMap');
  await settle();

  const toggle = env.toggleFor('https://a.example');
  assert.ok(toggle, 'the site is still listed');
  assert.equal(toggle.checked, false, 'the list shows what is stored, not what it rendered a minute ago');
});

test('the config list follows changes made in a page while the options page is open', async () => {
  const env = loadOptionsPage({ tocConfigs: [] });
  await settle();
  assert.deepEqual(env.listedConfigPatterns(), []);

  // The user saves a selector through the in-page config dialog.
  env.store.tocConfigs = [{ urlPattern: 'https://a.example/*', selectors: [{ type: 'css', expr: 'h2' }] }];
  env.fireStorageChange('tocConfigs');
  await settle();

  assert.deepEqual(env.listedConfigPatterns(), ['https://a.example/*']);
});

test('toggling a site persists through the background and the list shows the stored state', async () => {
  const env = loadOptionsPage({ tocSiteEnabledMap: { 'https://a.example': false } });
  await settle();
  env.background((message) => {                 // what the real background does with it
    if (message.type !== TOC_MESSAGE.PERSIST_ACTIVE_STATE) return { ok: false };
    env.store.tocSiteEnabledMap[message.origin] = message.enabled;
    env.fireStorageChange('tocSiteEnabledMap');
    return { ok: true };
  });

  env.toggleFor('https://a.example').click();    // enable

  await settle();
  assert.deepEqual(env.sentMessages(), [{ type: TOC_MESSAGE.PERSIST_ACTIVE_STATE, enabled: true, origin: 'https://a.example' }]);
  assert.equal(env.store.tocSiteEnabledMap['https://a.example'], true);
  assert.equal(env.toggleFor('https://a.example').checked, true);
  assert.equal(env.directWrites(), 0);
});

test('a refused persist shows the failure and puts the toggle back', async () => {
  const env = loadOptionsPage({ tocSiteEnabledMap: { 'https://a.example': false } });
  await settle();
  env.background(() => ({ ok: false }));        // the background could not persist

  env.toggleFor('https://a.example').click();    // the user tried to enable
  await settle();

  assert.equal(env.toggleFor('https://a.example').checked, false, 'the toggle shows the stored state');
  assert.deepEqual(env.visibleErrors(), ['optionsSaveFailed']);
});

test('deleting the selectors of a site goes through the background, never a direct storage write', async () => {
  const env = loadOptionsPage({
    tocConfigs: [{ urlPattern: 'https://a.example/*', selectors: [{ type: 'css', expr: 'h2' }] }]
  });
  await settle();
  assert.deepEqual(env.listedConfigPatterns(), ['https://a.example/*']);
  env.background((message) => {                 // the background's serialized clear-site
    if (message.type !== TOC_MESSAGE.MUTATE_CONFIG) return { ok: false };
    env.store.tocConfigs = env.store.tocConfigs.filter((cfg) => cfg.urlPattern !== message.urlPattern);
    env.fireStorageChange('tocConfigs');
    return { ok: true };
  });

  env.deleteButtonFor('https://a.example/*').click();
  await settle();

  assert.deepEqual(env.sentMessages(), [{ type: TOC_MESSAGE.MUTATE_CONFIG, operation: 'clear-site', urlPattern: 'https://a.example/*' }]);
  assert.equal(env.store.tocConfigs.length, 0);
  assert.deepEqual(env.listedConfigPatterns(), []);
  assert.equal(env.directWrites(), 0, 'config storage is written by the background only');
});

test('a refused deletion is reported and the config stays listed', async () => {
  const env = loadOptionsPage({ tocConfigs: [{ urlPattern: 'https://a.example/*', selectors: [] }] });
  await settle();
  env.background(() => ({ ok: false }));

  env.deleteButtonFor('https://a.example/*').click();
  await settle();

  assert.deepEqual(env.listedConfigPatterns(), ['https://a.example/*']);
  assert.deepEqual(env.visibleErrors(), ['optionsSaveFailed']);
});

test('keyboard focus on a toggle survives the re-render that a storage change causes', async () => {
  const env = loadOptionsPage({ tocSiteEnabledMap: { 'https://a.example': false, 'https://b.example': true } });
  await settle();
  env.toggleFor('https://b.example').focus();    // a keyboard user is on this toggle

  env.fireStorageChange('tocSiteEnabledMap');     // something re-renders the list
  await settle();

  assert.equal(env.focusedElement(), env.toggleFor('https://b.example'), 'focus stays on the same site');
});

test('deleting from a multi-row list does not duplicate the remaining rows', async () => {
  // A successful delete renders the config list twice: once from the storage
  // event and once from deleteSiteConfig() itself. Both clear the list, await
  // storage and append — unless the older render gives way, the second clear
  // lands before the first append, and both append.
  const env = loadOptionsPage({
    tocConfigs: [
      { urlPattern: 'https://a.example/*', selectors: [{ type: 'css', expr: 'h2' }] },
      { urlPattern: 'https://b.example/*', selectors: [{ type: 'css', expr: 'h3' }] }
    ]
  });
  await settle();
  assert.deepEqual(env.listedConfigPatterns(), ['https://a.example/*', 'https://b.example/*']);
  env.background((message) => {
    if (message.type !== TOC_MESSAGE.MUTATE_CONFIG) return { ok: false };
    env.store.tocConfigs = env.store.tocConfigs.filter((cfg) => cfg.urlPattern !== message.urlPattern);
    env.fireStorageChange('tocConfigs');
    return { ok: true };
  });

  env.deleteButtonFor('https://a.example/*').click();
  await settle();

  assert.deepEqual(env.listedConfigPatterns(), ['https://b.example/*']);
});

test('two storage changes for one key inside one round-trip render each list once', async () => {
  const env = loadOptionsPage({ tocSiteEnabledMap: { 'https://a.example': false, 'https://b.example': true } });
  await settle();

  env.store.tocSiteEnabledMap = { 'https://a.example': true, 'https://b.example': false, 'https://c.example': true };
  env.fireStorageChange('tocSiteEnabledMap');
  env.fireStorageChange('tocSiteEnabledMap');     // e.g. two tabs toggled almost at once
  await settle();

  assert.deepEqual(env.listedOrigins(), ['https://a.example', 'https://b.example', 'https://c.example']);
});

test('keyboard focus also survives a refused toggle', async () => {
  // The refused path re-renders the list to put the toggle back.
  const env = loadOptionsPage({ tocSiteEnabledMap: { 'https://a.example': false, 'https://b.example': true } });
  await settle();
  env.background(() => ({ ok: false }));
  env.toggleFor('https://a.example').focus();

  env.toggleFor('https://a.example').click();
  await settle();

  assert.equal(env.focusedElement(), env.toggleFor('https://a.example'));
});

test('a second failure within 3 seconds keeps the shared error note up for its own full duration', async () => {
  // Both failures land in the same note. Without care the FIRST failure's
  // 3-second dismissal removes the note while the second message has only just appeared.
  const env = loadOptionsPage({ tocSiteEnabledMap: { 'https://a.example': false, 'https://b.example': false } });
  await settle();
  env.background(() => ({ ok: false }));

  env.toggleFor('https://a.example').click();
  await settle();
  env.toggleFor('https://b.example').click();
  await settle();
  assert.deepEqual(env.visibleErrors(), ['optionsSaveFailed']);

  env.runFirstTimer();                        // the first failure's dismissal fires …
  assert.deepEqual(env.visibleErrors(), ['optionsSaveFailed'], '… and must not remove the second message early');

  env.runAllTimers();                        // the second failure's own 3 seconds pass …
  assert.deepEqual(env.visibleErrors(), [], '… and the note goes');
});
