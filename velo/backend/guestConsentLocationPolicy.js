/** Disconnected configurable receipt requirement only. NOT_REQUIRED is not consent,
 * opt-out clearance, provider permission or legal certification. Explicit opt-outs
 * and withdrawals remain independent; absence of a receipt is not an opt-out.
 * Lexical tokens are NOT ISO/state membership or provenance validation. Trusted
 * adapters must establish those facts and complete coherent reads separately.
 * No geolocation, CMS reader, seeded laws, receipt generation or effects here.
 * Trusted-load same-realm inert DTOs only: stable lying Proxies are not detectable.
 */
const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const prototype = Object.getPrototypeOf;
const arrayIsArray = Array.isArray;
const same = Object.is;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;

function token(value) {
  return typeof value === 'string' && value.length === 2 &&
    value[0] >= 'A' && value[0] <= 'Z' && value[1] >= 'A' && value[1] <= 'Z';
}

export function resolveGuestConsentRequirement(input) {
  // All private storage has null prototypes; no inherited setter dispatch.
  let observations = null;
  function snapshot(value, fields, array = false) {
    if (value === null || typeof value !== 'object') throw 0;
    const proto = prototype(value);
    if (array ? (!arrayIsArray(value) || proto !== arrayPrototype) :
      (arrayIsArray(value) || (proto !== null && proto !== objectPrototype))) throw 0;
    let length = 0;
    if (array) {
      const d = descriptor(value, 'length');
      if (!d || !descriptor(d, 'value')) throw 0;
      length = d.value;
      if (typeof length !== 'number' || length < 0 || length > 4096 || length % 1 !== 0) throw 0;
    }
    const keys = ownKeys(value);
    const count = array ? length + 1 : fields.length;
    if (keys.length !== count) throw 0;
    const values = { __proto__: null };
    const saved = { __proto__: null };
    for (let i = 0; i < count; i++) {
      const key = keys[i];
      if (array) {
        if (key !== (i === length ? 'length' : '' + i)) throw 0;
      } else {
        let allowed = false;
        for (let j = 0; j < fields.length; j++) if (key === fields[j]) allowed = true;
        if (!allowed) throw 0;
      }
      const d = descriptor(value, key);
      if (!d || !descriptor(d, 'value') || !descriptor(d, 'writable') ||
        d.enumerable !== !(array && key === 'length') ||
        (array && key === 'length' && d.configurable !== false)) throw 0;
      values[key] = d.value;
      saved[i] = { __proto__: null, key, value: d.value, enumerable: d.enumerable,
        configurable: d.configurable, writable: d.writable };
    }
    if (prototype(value) !== proto) throw 0;
    observations = { __proto__: null, value, proto, count, saved, next: observations };
    return values;
  }
  try {
    const envelope = snapshot(input, ['v', 'location', 'requirements']);
    if (envelope.v !== 1) return 'UNRESOLVED';
    // A successful outcome requires these exact variants. Other variants have
    // the same UNRESOLVED outcome whether well-shaped or malformed.
    const location = snapshot(envelope.location, ['status', 'countryCode', 'usStateCode']);
    const requirements = snapshot(envelope.requirements, ['status', 'rows']);
    if (location.status !== 'KNOWN' || requirements.status !== 'COMPLETE') return 'UNRESOLVED';
    if (!token(location.countryCode) ||
      (location.countryCode === 'US' ? !token(location.usStateCode) : location.usStateCode !== '')) return 'UNRESOLVED';
    const rows = snapshot(requirements.rows, null, true);
    let required = false;
    for (let i = 0; i < rows.length; i++) {
      const row = snapshot(rows[i], ['countryCode', 'usStateCode', 'consentRequired']);
      if (!token(row.countryCode) || typeof row.consentRequired !== 'boolean' ||
        (row.usStateCode !== '' && (row.countryCode !== 'US' || !token(row.usStateCode)))) return 'UNRESOLVED';
      if (row.countryCode === location.countryCode &&
        (row.usStateCode === '' || (row.countryCode === 'US' && row.usStateCode === location.usStateCode)) &&
        row.consentRequired === true) required = true;
    }
    // Bounded final observable pass over the detached descriptor evidence.
    // This catches observed drift, not arbitrary stable lies or future mutation.
    for (let node = observations; node !== null; node = node.next) {
      if (prototype(node.value) !== node.proto) return 'UNRESOLVED';
      const keys = ownKeys(node.value);
      if (keys.length !== node.count) return 'UNRESOLVED';
      for (let i = 0; i < node.count; i++) {
        const old = node.saved[i];
        if (keys[i] !== old.key) return 'UNRESOLVED';
        const d = descriptor(node.value, old.key);
        if (!d || !descriptor(d, 'value') || !descriptor(d, 'writable') ||
          !same(d.value, old.value) || d.enumerable !== old.enumerable ||
          d.configurable !== old.configurable || d.writable !== old.writable) return 'UNRESOLVED';
      }
      if (prototype(node.value) !== node.proto) return 'UNRESOLVED';
    }
    return required ? 'REQUIRED' : 'NOT_REQUIRED';
  } catch (_) {
    return 'UNRESOLVED';
  }
}
