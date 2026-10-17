// Pure reporting state only. No storage, consent authority, network or Wix imports.
// Each timestamp belongs to one landing bundle; never merge provider identifiers.
const fields = ['gclid', 'gbraid', 'wbraid', 'msclkid'];
const windowMs = 90 * 86400000;
function ownData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const out = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      out[key] = descriptor.value;
    }
    return out;
  } catch (_) { return null; }
}
function touch(value, now, allowExpired = false) {
  value = ownData(value);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !['capturedAt', ...fields].includes(k)) ||
      typeof value.capturedAt !== 'string' || value.capturedAt.length > 30) return null;
  const at = Date.parse(value.capturedAt);
  if (!Number.isFinite(at) || at > now || (!allowExpired && now - at > windowMs)) return null;
  const out = { capturedAt: value.capturedAt };
  for (const key of fields) {
    const id = value[key] === undefined ? '' : value[key];
    if (typeof id !== 'string' || id.length > 512 || (id !== '' && !/^[\x21-\x7e]+$/.test(id))) return null;
    out[key] = id;
  }
  return fields.some(k => out[k]) ? out : null;
}
export function normalizePaidTouches(value, now) {
  if (!Number.isSafeInteger(now) || now < 0) return null;
  value = ownData(value);
  if (value && value.v === 1) {
    if (Object.keys(value).sort().join(',') !== 'first,latest,v') return null;
    const originalFirst = value.first === null ? null : touch(value.first, now, true);
    const originalLatest = touch(value.latest, now, true);
    if ((value.first !== null && !originalFirst) || !originalLatest ||
        (originalFirst && Date.parse(originalFirst.capturedAt) > Date.parse(originalLatest.capturedAt))) return null;
    const first = touch(originalFirst, now), latest = touch(originalLatest, now);
    return latest ? { v: 1, first, latest } : null;
  }
  const first = touch(value, now);
  return first ? { v: 1, first, latest: { ...first } } : null;
}
function sameIds(a, b) { return a && b && fields.every(k => a[k] === b[k]); }
export function capturePaidTouch(value, landing, now) {
  const old = normalizePaidTouches(value, now), next = touch(landing, now);
  if (!next || (old && (sameIds(old.first, next) || sameIds(old.latest, next) ||
      Date.parse(next.capturedAt) < Date.parse(old.latest.capturedAt)))) return old;
  // A live first is preserved. After first expires, only a distinct newer paid
  // landing (not a direct visit, identical bundle or older landing) begins a new lifetime.
  return { v: 1, first: old && old.first ? old.first : { ...next }, latest: next };
}
// Call only after permission has authorized both partitions in the same epoch.
// This pure merge is data handling, never proof that a copy may be restored.
export function reconcilePaidTouches(left, right, now) {
  const a = normalizePaidTouches(left, now), b = normalizePaidTouches(right, now);
  if (!a || !b) return a || b;
  const firsts = [a.first, b.first].filter(Boolean);
  firsts.sort((x, y) => Date.parse(x.capturedAt) - Date.parse(y.capturedAt));
  const first = firsts[0] || null;
  const latests = [a.latest, b.latest];
  // A reconstructed partition must not renew a known identical click's age.
  for (let i = 0; i < latests.length; i++) {
    for (const known of [a.first, a.latest, b.first, b.latest]) {
      if (sameIds(latests[i], known) && Date.parse(known.capturedAt) < Date.parse(latests[i].capturedAt)) latests[i] = known;
    }
  }
  latests.sort((x, y) => Date.parse(y.capturedAt) - Date.parse(x.capturedAt));
  return { v: 1, first: first && { ...first }, latest: { ...latests[0] } };
}
