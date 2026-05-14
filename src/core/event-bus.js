var listeners = {};

export function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
}

export function off(event, fn) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(function(f) { return f !== fn; });
}

export function emit(event) {
  var args = [];
  for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
  if (listeners[event]) {
    listeners[event].forEach(function(fn) { fn.apply(null, args); });
  }
}

export default { on: on, off: off, emit: emit };
