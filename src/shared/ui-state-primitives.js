function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  var proto = Object.getPrototypeOf(value);
  return proto === null || Object.prototype.toString.call(value) === '[object Object]';
}

function normalizePosition(value) {
  if (!isPlainObject(value)) return null;
  var x = Number(value.x);
  var y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  var result = { x: x, y: y };
  ['vw', 'vh', 'marginX', 'updatedAt'].forEach(function(key) {
    var num = Number(value[key]);
    if (Number.isFinite(num)) result[key] = num;
  });
  if (value.anchorX === 'left' || value.anchorX === 'right') result.anchorX = value.anchorX;
  return result;
}

function pruneMap(map, maxKeys) {
  var limit = Number.isFinite(maxKeys) && maxKeys > 0 ? Math.max(1, Math.floor(maxKeys)) : 400;
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length - limit; i++) {
    delete map[keys[i]];
  }
}

export function validateUiStateMutationSource(mutation, senderUrl) {
  if (!isPlainObject(mutation)) return { ok: false, reason: 'bad-site' };
  try {
    var parsed = new URL(senderUrl);
    if (!/^https?:$/.test(parsed.protocol)) return { ok: false, reason: 'bad-site' };
    var expectedKey = mutation.operation === 'set-badge-position'
      ? parsed.host
      : mutation.operation === 'set-panel-expanded'
        ? parsed.origin
        : '';
    return expectedKey && String(mutation.key || '').trim() === expectedKey
      ? { ok: true, reason: null }
      : { ok: false, reason: 'bad-site' };
  } catch (_) {
    return { ok: false, reason: 'bad-site' };
  }
}

export function applyUiStateMutation(currentMap, mutation, maxKeys) {
  var map = isPlainObject(currentMap) ? Object.assign({}, currentMap) : {};
  if (!isPlainObject(mutation)) return { ok: false, reason: 'invalid-mutation', map: map };
  var operation = mutation.operation;
  var key = String(mutation.key || '').trim();
  if (!key || key.length > 2048) return { ok: false, reason: 'invalid-key', map: map };

  var value;
  if (operation === 'set-badge-position') {
    value = normalizePosition(mutation.value);
    if (!value) return { ok: false, reason: 'invalid-position', map: map };
  } else if (operation === 'set-panel-expanded') {
    if (typeof mutation.value !== 'boolean') return { ok: false, reason: 'invalid-expanded', map: map };
    value = mutation.value;
  } else {
    return { ok: false, reason: 'invalid-operation', map: map };
  }

  if (Object.prototype.hasOwnProperty.call(map, key)) delete map[key];
  map[key] = value;
  pruneMap(map, maxKeys);
  return { ok: true, reason: null, map: map, value: map[key] };
}
