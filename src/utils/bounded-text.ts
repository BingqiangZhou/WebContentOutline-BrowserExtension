
'use strict';

function positiveInt(value: unknown, fallback: number): number {
  var num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.max(1, Math.floor(num)) : fallback;
}

// Visually-hidden class patterns that frameworks use for screen-reader-only
// text. Mirrors the chatbot path's VISUALLY_HIDDEN_SEL so the standard path
// does not leak hidden child text (anchor glyphs, SR labels) into TOC items.
var HIDDEN_TEXT_CLASS_RE = /(?:^|\s)(?:sr-only|visually-hidden|cdk-visually-hidden|hide-visually)(?:\s|$)/i;

function isHiddenTextNode(node: Node): boolean {
  if (!node || (node as Element).nodeType !== 1) return false;
  var el = node as Element;
  try {
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
  } catch (_) {}
  var cls = (el as any).className;
  return typeof cls === 'string' && HIDDEN_TEXT_CLASS_RE.test(cls);
}

export function getBoundedText(root: Node, opts?: { maxChars?: number; maxNodes?: number; maxDepth?: number }) {
  opts = opts || {};
  var maxChars = positiveInt(opts.maxChars, 200);
  var maxNodes = positiveInt(opts.maxNodes, 200);
  var maxDepth = positiveInt(opts.maxDepth, 8);
  var text = '';
  var visited = 0;
  var stack: Array<{ node: Node; depth: number }> = [{ node: root, depth: 0 }];

  while (stack.length && text.length < maxChars && visited < maxNodes) {
    var item = stack.pop();
    var node = item && item.node;
    var depth = item && item.depth;
    if (!node) continue;
    visited++;

    if (node.nodeType === 3 || node.nodeType === 4) {
      var value = String(node.nodeValue || '');
      if (value) text += value.slice(0, maxChars - text.length);
      continue;
    }

    // Do not descend into visually-hidden subtrees — their text is not visible
    // and would otherwise pollute the TOC item label.
    if (isHiddenTextNode(node)) continue;

    if ((depth as number) >= maxDepth) continue;
    var children: NodeListOf<ChildNode> | null = node.childNodes;
    if (!children || !children.length) continue;

    for (var i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i], depth: (depth as number) + 1 });
    }
  }

  return text;
}
