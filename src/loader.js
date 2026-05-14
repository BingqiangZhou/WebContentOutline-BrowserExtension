// src/loader.js - Module registration system + event bus
// Loaded FIRST before any other content script module.
'use strict';

var __modules = {};
var __waiting = new Map();
var __listeners = {};

/**
 * Register a module with its dependencies.
 * If all deps are already registered, the factory runs immediately.
 * Otherwise, it waits and runs when all deps become available.
 */
function define(name, deps, factory) {
  var resolved = deps.map(function(d) { return __modules[d]; });
  if (resolved.every(Boolean)) {
    __modules[name] = factory.apply(null, resolved);
    var waiting = __waiting.get(name);
    if (waiting) {
      __waiting.delete(name);
      waiting.forEach(function(cb) { cb(); });
    }
  } else {
    var missing = deps.filter(function(d) { return !__modules[d]; });
    missing.forEach(function(d) {
      if (!__waiting.has(d)) __waiting.set(d, []);
      __waiting.get(d).push(function() { define(name, deps, factory); });
    });
  }
}

/**
 * Get a registered module by name.
 */
function require(name) { return __modules[name]; }

// --- Event bus for decoupling modules ---

function on(event, fn) {
  if (!__listeners[event]) __listeners[event] = [];
  __listeners[event].push(fn);
}

function off(event, fn) {
  if (!__listeners[event]) return;
  __listeners[event] = __listeners[event].filter(function(f) { return f !== fn; });
}

function emit(event) {
  var args = [];
  for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
  if (__listeners[event]) {
    __listeners[event].forEach(function(fn) { fn.apply(null, args); });
  }
}
