// Options page: global management surface for per-site activation and
// selector configs. Every site-level action stays possible on the page itself
// (toolbar icon / dock menu); this page exists so users can review and undo
// those decisions without revisiting each site.

import './style.css';
import { applyTocConfigMutation } from '../../src/shared/primitives.js';
import { TOC_MESSAGE, type TocRequest } from '../../src/shared/messages.js';

interface StoredConfig {
  urlPattern?: string;
  side?: string;
  selectors?: Array<{ type: string; expr: string }>;
}

function msg(key: string, substitutions?: string | string[]): string {
  try {
    return chrome.i18n.getMessage(key, substitutions) || key;
  } catch {
    return key;
  }
}

function applyLocalizedText(id: string, key: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg(key);
}

applyLocalizedText('app-title', 'optionsTitle');
applyLocalizedText('sites-heading', 'optionsSitesHeading');
applyLocalizedText('sites-description', 'optionsSitesDescription');
applyLocalizedText('sites-empty', 'optionsNoSites');
applyLocalizedText('configs-heading', 'optionsConfigsHeading');
applyLocalizedText('configs-empty', 'optionsNoConfigs');

function showMessage(parent: HTMLElement, text: string): void {
  let note = parent.querySelector<HTMLParagraphElement>('.save-error');
  if (!note) {
    note = document.createElement('p');
    note.className = 'save-error';
    parent.appendChild(note);
  }
  note.textContent = text;
  window.setTimeout(() => note.remove(), 3000);
}

async function readStorage<T>(key: string, fallback: T): Promise<T> {
  try {
    const res = await chrome.storage.local.get([key]);
    return (res[key] as T) ?? fallback;
  } catch {
    return fallback;
  }
}

// --- Per-site activation ---

async function renderSites(): Promise<void> {
  const listEl = document.getElementById('sites-list') as HTMLUListElement;
  const emptyEl = document.getElementById('sites-empty') as HTMLElement;
  listEl.replaceChildren();

  const map = await readStorage<Record<string, boolean>>('tocSiteEnabledMap', {});
  const origins = Object.keys(map || {}).sort();

  emptyEl.hidden = origins.length > 0;
  if (!origins.length) return;

  for (const origin of origins) {
    const li = document.createElement('li');

    const label = document.createElement('span');
    label.className = 'site-origin';
    label.textContent = origin;

    const enabled = map[origin] !== false;
    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = enabled;
    input.setAttribute('aria-label', origin);

    const track = document.createElement('span');
    track.className = 'track';
    track.setAttribute('aria-hidden', 'true');

    const stateLabel = document.createElement('span');
    stateLabel.className = 'state-label';
    stateLabel.textContent = enabled ? msg('optionsEnabled') : msg('optionsDisabled');

    input.addEventListener('change', () => {
      void persistSiteEnabled(origin, input.checked, stateLabel, listEl);
    });

    switchLabel.append(input, track, stateLabel);
    li.append(label, switchLabel);
    listEl.appendChild(li);
  }
}

async function persistSiteEnabled(
  origin: string,
  enabled: boolean,
  stateLabel: HTMLElement,
  listEl: HTMLElement
): Promise<void> {
  // Persist through the background worker so icon updates and same-origin
  // tab broadcasts happen exactly as they do for the toolbar-icon toggle.
  try {
    await chrome.runtime.sendMessage({
      type: TOC_MESSAGE.PERSIST_ACTIVE_STATE,
      enabled,
      origin
    } satisfies TocRequest);
    stateLabel.textContent = enabled ? msg('optionsEnabled') : msg('optionsDisabled');
  } catch {
    showMessage(listEl.closest('section') || listEl, msg('optionsSaveFailed'));
    // Re-render to restore the checkbox to the stored state.
    await renderSites();
  }
}

// --- Selector configurations ---

async function renderConfigs(): Promise<void> {
  const listEl = document.getElementById('configs-list') as HTMLUListElement;
  const emptyEl = document.getElementById('configs-empty') as HTMLElement;
  listEl.replaceChildren();

  const configs = await readStorage<StoredConfig[]>('tocConfigs', []);
  const entries = Array.isArray(configs) ? configs.filter((c) => c && c.urlPattern) : [];

  emptyEl.hidden = entries.length > 0;
  if (!entries.length) return;

  for (const cfg of entries) {
    const li = document.createElement('li');

    const mainCol = document.createElement('div');
    const pattern = document.createElement('span');
    pattern.className = 'config-pattern';
    pattern.textContent = String(cfg.urlPattern);
    const meta = document.createElement('div');
    meta.className = 'config-meta';
    const selectorCount = Array.isArray(cfg.selectors) ? cfg.selectors.length : 0;
    meta.textContent = `${selectorCount ? msg('optionsSelectorsCount', String(selectorCount)) : '—'} · ${cfg.side === 'left' ? 'left' : 'right'}`;
    mainCol.append(pattern, meta);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.textContent = msg('buttonClearConfig');
    del.setAttribute('aria-label', msg('optionsDeleteConfig'));
    del.addEventListener('click', () => {
      void deleteSiteConfig(String(cfg.urlPattern));
    });

    li.append(mainCol, del);
    listEl.appendChild(li);
  }
}

async function deleteSiteConfig(urlPattern: string): Promise<void> {
  try {
    const key = 'tocConfigs';
    const stored = await readStorage<unknown[]>(key, []);
    // Same mutation pipeline the background worker uses for the in-page
    // config dialog; open tabs pick the change up via storage.onChanged.
    const result = applyTocConfigMutation(stored, {
      operation: 'clear-site',
      urlPattern
    }, Date.now(), null);
    if (result && result.ok) {
      await chrome.storage.local.set({ [key]: result.configs });
    }
    await renderConfigs();
  } catch {
    const section = document.getElementById('configs-list')?.closest('section');
    if (section) showMessage(section, msg('optionsSaveFailed'));
  }
}

void Promise.all([renderSites(), renderConfigs()]);
