
// Shared message protocol between the background service worker and the content
// script. Previously these discriminant strings were duplicated as raw literals
// across 4 files / 16 sites with everything typed `any` — a typo'd type or
// payload field failed silently at runtime. Centralizing the constants + a
// discriminated union gives compile-time protection on both ends.
//
// WXT bundles this ESM module into both the background and content entrypoints,
// the same way it bundles `primitives.ts`. Use the `.js` import specifier in
// source per the project's WXT/ESM convention.

export const TOC_MESSAGE = {
  PING: 'toc:ping',
  ENSURE_ICON: 'toc:ensureIcon',
  OPEN_PANEL: 'toc:openPanel',
  UPDATE_ENABLED: 'toc:updateEnabled',
  PERSIST_ACTIVE_STATE: 'toc:persistActiveState',
  MUTATE_CONFIG: 'toc:mutateConfig',
  MUTATE_UI_STATE: 'toc:mutateUiState',
} as const;

export type TocMessageType = (typeof TOC_MESSAGE)[keyof typeof TOC_MESSAGE];

export interface SelectorPayload {
  type: string;
  expr: string;
}

// Request envelope: background ↔ content script. The `type` field discriminates
// the payload shape on both the send and receive sides.
export type TocRequest =
  // Background → content: liveness probe before injecting the content script.
  | { type: typeof TOC_MESSAGE.PING }
  // Content → background: ask the SW to refresh this tab's action icon.
  | { type: typeof TOC_MESSAGE.ENSURE_ICON }
  // External trigger (popup/options, not present in this tree) → content:
  // open the TOC panel. Kept for compatibility; no internal sender today.
  | { type: typeof TOC_MESSAGE.OPEN_PANEL }
  // Background → content: broadcast the new per-origin enabled state (cross-tab).
  | { type: typeof TOC_MESSAGE.UPDATE_ENABLED; enabled: boolean }
  // Content → background: page-side "Close TOC" persists disabled state.
  | { type: typeof TOC_MESSAGE.PERSIST_ACTIVE_STATE; enabled: boolean; origin: string }
  // Content → background: add/remove a selector or clear a site's config.
  | {
      type: typeof TOC_MESSAGE.MUTATE_CONFIG;
      operation: 'add-selector' | 'remove-selector' | 'clear-site';
      urlPattern: string;
      selector?: SelectorPayload;
      side?: string;
    }
  // Content → background: persist UI state (e.g. badge/dock position per host).
  | {
      type: typeof TOC_MESSAGE.MUTATE_UI_STATE;
      operation: 'set-badge-position';
      key: string;
      value: unknown;
    };

// Response envelope. All handlers reply with at least `{ ok }`; the index
// signature carries the mutation-result extras (`config`, `reason`, …) without
// forcing every call site to spell them out.
export interface TocResponse {
  ok: boolean;
  reason?: string;
  [key: string]: unknown;
}
