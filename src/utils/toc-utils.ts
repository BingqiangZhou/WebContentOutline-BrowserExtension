
// src/utils/toc-utils.ts - Aggregate module combining utility APIs
export * from './constants.js';
export * from './core-utils.js';
export * from './toast.js';
export * from './storage.js';
export * from './badge-position.js';
export * from './dom-utils.js';
export * from './content-region.js';
// chatbot-detector is imported directly by toc-builder.ts and rebuild-scheduler.ts
// (its only consumers). Re-exporting it through this barrel pulled the whole
// ~1.6k-line module into every barrel importer's graph for no reason.
export * from './css-selector.js';
export * from './toc-builder.js';
