// Options page: global management surface for per-site activation and
// selector configs. Every site-level action stays possible on the page itself
// (toolbar icon / dock menu); this page exists so users can review and undo
// those decisions without revisiting each site.
//
// Two other writers change the storage shown here — the toolbar icon (per-site
// activation) and the in-page config dialog (selector configs) — so the page
// follows storage changes, and its own writes go through the background's
// serialized queues instead of writing storage directly.

import './style.css';
import { TOC_MESSAGE, type TocRequest } from '../../src/shared/messages.js';

interface StoredConfig {
  urlPattern?: string;
  selectors?: Array<{ type: string; expr: string }>;
}

/** What a background handler answers: at least `{ ok }`. */
type BackgroundResult = { ok?: boolean; reason?: string } | undefined;

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

/** The pending dismissal of each error note (3 s after its latest message). */
const dismissTimers = new WeakMap<Element, number>();

applyLocalizedText('app-title', 'optionsTitle');
applyLocalizedText('sites-heading', 'optionsSitesHeading');
applyLocalizedText('sites-description', 'optionsSitesDescription');
applyLocalizedText('sites-empty', 'optionsNoSites');
applyLocalizedText('configs-heading', 'optionsConfigsHeading');
applyLocalizedText('configs-empty', 'optionsNoConfigs');

function showMessage(parent: Element | null, text: string): void {
  if (!parent) return;
  let note = parent.querySelector<HTMLParagraphElement>('.save-error');
  if (!note) {
    note = document.createElement('p');
    note.className = 'save-error';
    parent.appendChild(note);
  }
  note.textContent = text;
  // The note is shared by consecutive failures. Its lifetime restarts with the
  // latest message: the earlier dismissal must not remove it while that message has only just appeared.
  const previous = dismissTimers.get(note);
  if (previous !== undefined) window.clearTimeout(previous);
  dismissTimers.set(note, window.setTimeout(() => {
    dismissTimers.delete(note);
    note.remove();
  }, 3000));
}

async function readStorage<T>(key: string, fallback: T): Promise<T> {
  try {
    const res = await chrome.storage.local.get([key]);
    return (res[key] as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function elementById<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Render bookkeeping for one list. Rendering clears the list, awaits storage and
 * appends — and two renders of the same list can overlap (a storage event and
 * our own refresh, or two events inside one storage round-trip). Without
 * coordination the second clear lands before the first append and both append.
 * Every render therefore runs under its own generation and gives up after the
 * await when a newer one has started. The newest render also returns keyboard
 * focus to the row the rebuild displaced.
 */
interface ListRenderState {
  generation: number;
  focusKey: string | null;
}

async function renderList<T>(
  state: ListRenderState,
  list: HTMLElement,
  read: () => Promise<T>,
  fill: (data: T) => void
): Promise<void> {
  const active = document.activeElement;
  // A row of this list has focus: remember it for after the rebuild. While an
  // older render is still awaiting storage, focus has already fallen back to
  // <body> — the key that older render saved stays in place.
  if (active && active !== list && list.contains(active)) {
    state.focusKey = (active as HTMLElement).dataset.focusKey || null;
  }

  const generation = ++state.generation;
  list.replaceChildren();
  const data = await read();
  if (generation !== state.generation) return;   // a newer render owns the list
  fill(data);

  const focusKey = state.focusKey;
  state.focusKey = null;
  if (focusKey) {
    const again = list.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    // preventScroll: a re-render caused by another tab must not yank the user back.
    if (again) again.focus({ preventScroll: true });
  }
}

const sitesListState: ListRenderState = { generation: 0, focusKey: null };
const configsListState: ListRenderState = { generation: 0, focusKey: null };

// --- Per-site activation ---

function renderSites(): Promise<void> {
  const listEl = elementById<HTMLUListElement>('sites-list');
  const emptyEl = elementById<HTMLElement>('sites-empty');
  if (!listEl || !emptyEl) return Promise.resolve();

  return renderList(
    sitesListState,
    listEl,
    () => readStorage<Record<string, boolean>>('tocSiteEnabledMap', {}),
    (map) => {
      const origins = Object.keys(map || {}).sort();
      emptyEl.hidden = origins.length > 0;

      for (const origin of origins) {
        const li = document.createElement('li');

        const label = document.createElement('span');
        label.className = 'site-origin';
        label.textContent = origin;

        // Opt-in: only an explicit true entry counts as enabled.
        const enabled = map[origin] === true;
        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = enabled;
        input.setAttribute('aria-label', origin);
        input.dataset.focusKey = origin;

        const track = document.createElement('span');
        track.className = 'track';
        track.setAttribute('aria-hidden', 'true');

        const stateLabel = document.createElement('span');
        stateLabel.className = 'state-label';
        stateLabel.textContent = enabled ? msg('optionsEnabled') : msg('optionsDisabled');

        input.addEventListener('change', () => {
          void persistSiteEnabled(origin, input.checked);
        });

        switchLabel.append(input, track, stateLabel);
        li.append(label, switchLabel);
        listEl.appendChild(li);
      }
    }
  );
}

async function persistSiteEnabled(origin: string, enabled: boolean): Promise<void> {
  // Persist through the background worker so icon updates and same-origin
  // tab broadcasts happen exactly as they do for the toolbar-icon toggle.
  let persisted = false;
  try {
    const res = (await chrome.runtime.sendMessage({
      type: TOC_MESSAGE.PERSIST_ACTIVE_STATE,
      enabled,
      origin
    } satisfies TocRequest)) as BackgroundResult;
    // sendMessage resolves — it does not reject — with { ok: false } when the
    // background could not persist. That is a failure; report it as one.
    persisted = !!res && !!res.ok;
  } catch {
    persisted = false;
  }
  if (persisted) return;   // the write itself re-renders the list (storage.onChanged)
  // Look the section up NOW: the list may have been re-rendered by a storage
  // change while the message was in flight.
  showMessage(elementById('sites-list')?.closest('section') ?? null, msg('optionsSaveFailed'));
  // No storage event follows a refused write; put the toggle back by hand.
  await renderSites();
}

// --- Selector configurations ---

function renderConfigs(): Promise<void> {
  const listEl = elementById<HTMLUListElement>('configs-list');
  const emptyEl = elementById<HTMLElement>('configs-empty');
  if (!listEl || !emptyEl) return Promise.resolve();

  return renderList(
    configsListState,
    listEl,
    () => readStorage<StoredConfig[]>('tocConfigs', []),
    (configs) => {
      const entries = Array.isArray(configs) ? configs.filter((c) => c && c.urlPattern) : [];
      emptyEl.hidden = entries.length > 0;

      for (const cfg of entries) {
        const li = document.createElement('li');

        const mainCol = document.createElement('div');
        const pattern = document.createElement('span');
        pattern.className = 'config-pattern';
        pattern.textContent = String(cfg.urlPattern);
        const meta = document.createElement('div');
        meta.className = 'config-meta';
        const selectorCount = Array.isArray(cfg.selectors) ? cfg.selectors.length : 0;
        meta.textContent = selectorCount ? msg('optionsSelectorsCount', String(selectorCount)) : '—';
        mainCol.append(pattern, meta);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete';
        del.textContent = msg('buttonClearConfig');
        del.setAttribute('aria-label', msg('optionsDeleteConfig'));
        del.dataset.focusKey = String(cfg.urlPattern);
        del.addEventListener('click', () => {
          void deleteSiteConfig(String(cfg.urlPattern));
        });

        li.append(mainCol, del);
        listEl.appendChild(li);
      }
    }
  );
}

async function deleteSiteConfig(urlPattern: string): Promise<void> {
  // The background owns config mutations and serializes them with the in-page
  // dialog's. A direct storage write from here could overwrite a selector a
  // tab is adding at the same moment.
  let cleared = false;
  try {
    const res = (await chrome.runtime.sendMessage({
      type: TOC_MESSAGE.MUTATE_CONFIG,
      operation: 'clear-site',
      urlPattern
    } satisfies TocRequest)) as BackgroundResult;
    cleared = !!res && !!res.ok;
  } catch {
    cleared = false;
  }
  if (cleared) return;    // the write itself re-renders the list (storage.onChanged)
  showMessage(elementById('configs-list')?.closest('section') ?? null, msg('optionsSaveFailed'));
  await renderConfigs();
}

// --- Wiring ---

// Follow storage: the toolbar icon and the in-page config dialog both change it
// while this page is open.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.tocSiteEnabledMap) void renderSites();
  if (changes.tocConfigs) void renderConfigs();
});

void Promise.all([renderSites(), renderConfigs()]);
