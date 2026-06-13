
// src/utils/css-selector.ts - CSS selector generation

import { CSS_PATH_MAX_DEPTH } from './constants.js';

var TOC_CLASS_RE = /^(toc-|data-)/;

function getMeaningfulClasses(el: Element): string[] {
  if (!el || !el.classList || !el.classList.length) return [];
  return (Array.from(el.classList) as string[]).filter(function(cls) {
    return !TOC_CLASS_RE.test(cls);
  });
}

function escapeCssIdentifier(ident: string): string {
  return ident.replace(/([^\w-])/g, '\\$1');
}

export function buildClassSelector(el: Element): string {
  var meaningful = getMeaningfulClasses(el);
  if (!meaningful.length) return '';
  return '.' + meaningful.map(function(c) { return escapeCssIdentifier(c); }).join('.');
}

export function cssPathFor(el: Element): string {
  if (!el || el.nodeType !== 1) return '';
  var path: string[] = [];
  var current: Element | null = el;
    while (current && current.nodeType === 1 && path.length < CSS_PATH_MAX_DEPTH) {
    var selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += '#' + escapeCssIdentifier(current.id);
      path.unshift(selector);
      break;
    }
    var meaningful = getMeaningfulClasses(current);
    if (meaningful.length) {
      selector += '.' + meaningful.map(function(c) { return escapeCssIdentifier(c); }).join('.');
    }
    var parent = current.parentElement;
    if (parent) {
      var siblings = Array.from(parent.children).filter(function(s) {
        return (s as Element).tagName === (current as Element).tagName;
      });
      if (siblings.length > 1) {
        var index = siblings.indexOf(current) + 1;
        selector += ':nth-of-type(' + index + ')';
      }
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}
