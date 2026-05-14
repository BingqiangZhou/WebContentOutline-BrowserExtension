// src/utils/toc-utils.js - Aggregate module combining utility APIs
export * from './constants.js';
export * from './core-utils.js';
export * from './toast.js';
export * from './storage.js';
export * from './badge-position.js';
export * from './dom-utils.js';

import * as constants from './constants.js';
import * as coreUtils from './core-utils.js';
import * as toast from './toast.js';
import * as storage from './storage.js';
import * as badgePosition from './badge-position.js';
import * as domUtils from './dom-utils.js';

var api = {};
Object.assign(api, constants, coreUtils, toast, storage, badgePosition, domUtils);

export default api;
