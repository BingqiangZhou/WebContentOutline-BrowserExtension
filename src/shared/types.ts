export type UiMode = 'edge-dock' | 'classic';

export type TocSelector = {
  type: 'css' | 'xpath';
  expr: string;
};

export type TocConfig = {
  urlPattern: string;
  side: 'left' | 'right';
  selectors: TocSelector[];
  updatedAt?: number;
};

export type BadgePosition = {
  x: number;
  y: number;
  updatedAt?: number;
  anchorX?: 'left' | 'right';
};

export type ContentMessage =
  | { type: 'toc:ping' }
  | { type: 'toc:updateEnabled'; enabled: boolean }
  | { type: 'toc:openPanel' };

export type BackgroundMessage =
  | { type: 'toc:ensureIcon' }
  | { type: 'toc:mutateConfig'; operation: 'add-selector' | 'remove-selector' | 'clear-site'; urlPattern: string; selector?: TocSelector; side?: 'left' | 'right' }
  | { type: 'toc:mutateUiState'; operation: 'set-badge-position' | 'set-panel-expanded'; key: string; value: BadgePosition | boolean };
