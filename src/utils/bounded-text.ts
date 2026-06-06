
'use strict';

function positiveInt(value: unknown, fallback: number): number {
  var num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.max(1, Math.floor(num)) : fallback;
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
      var value = '';
      try { value = String(node.nodeValue || ''); } catch (_) { value = ''; }
      if (value) text += value.slice(0, maxChars - text.length);
      continue;
    }

    if ((depth as number) >= maxDepth) continue;
    var children: NodeListOf<ChildNode> | null = null;
    try { children = node.childNodes; } catch (_) { children = null; }
    if (!children || !children.length) continue;

    for (var i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i], depth: (depth as number) + 1 });
    }
  }

  return text;
}
