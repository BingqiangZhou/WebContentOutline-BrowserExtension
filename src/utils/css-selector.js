// src/utils/css-selector.js - CSS selector generation
define('css-selector', [], function() {

  function escapeCssIdentifier(ident) {
    if (typeof ident !== 'string') return '';
    return ident.replace(/([^\w-])/g, '\\$1');
  }

  function buildClassSelector(el) {
    if (!el || !el.classList || !el.classList.length) return '';
    var meaningful = Array.from(el.classList).filter(function(cls) {
      return !/^(toc-|data-)/.test(cls);
    });
    if (!meaningful.length) return '';
    return '.' + meaningful.map(function(c) { return escapeCssIdentifier(c); }).join('.');
  }

  function cssPathFor(el) {
    if (!el || el.nodeType !== 1) return '';
    var path = [];
    var current = el;
    while (current && current.nodeType === 1) {
      var selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += '#' + escapeCssIdentifier(current.id);
        path.unshift(selector);
        break;
      }
      if (current.classList && current.classList.length) {
        var meaningful = Array.from(current.classList).filter(function(cls) {
          return !/^(toc-|data-)/.test(cls);
        });
        if (meaningful.length) {
          selector += '.' + meaningful.map(function(c) { return escapeCssIdentifier(c); }).join('.');
        }
      }
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(s) {
          return s.tagName === current.tagName;
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

  var api = { buildClassSelector: buildClassSelector, cssPathFor: cssPathFor };
  try { window.CSS_SELECTOR = api; } catch (_) {}
  return api;
});
