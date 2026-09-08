import wixData from 'wix-data';

export async function getAllSettings() {
  const res = await wixData.query('Settings').limit(1000).find({ suppressAuth: true });
  const settings = {};
  for (let i = 0; i < res.items.length; i++) {
    const item = res.items[i];
    settings[item.key] = item.value;
  }
  return settings;
}

// Backend-only observation for positive advertising purchases; NOT a webMethod.
// Returns only 0 (off), 1 (on), or null (unresolved), never private Settings.
// The SDK's initial totalCount bounds row progress, not an arbitrary page cap.
// This validates a complete SDK traversal, not a transactional snapshot or a
// guarantee against a setting changing after observation.
export async function observeAdvertisingSuspension(key) {
  if (key !== 'suspendGoogleAds' && key !== 'suspendMicrosoftAds') return null;
  try {
    let page = await wixData.query('Settings').limit(1000)
      .find({ suppressAuth: true, consistentRead: true });
    const total = page && page.totalCount;
    if (!Number.isSafeInteger(total) || total < 0) return null;
    const ids = new Set();
    let matches = 0;
    let observed = null;
    while (true) {
      if (!page || page.totalCount !== total || !Array.isArray(page.items) ||
          page.items.length > 1000 || typeof page.hasNext !== 'function') return null;
      for (const item of page.items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const id = Object.getOwnPropertyDescriptor(item, '_id');
        const rowKey = Object.getOwnPropertyDescriptor(item, 'key');
        if (!id || !Object.prototype.hasOwnProperty.call(id, 'value') ||
            typeof id.value !== 'string' || !id.value.trim() || ids.has(id.value) ||
            !rowKey || !Object.prototype.hasOwnProperty.call(rowKey, 'value') ||
            typeof rowKey.value !== 'string' || !rowKey.value.trim()) return null;
        ids.add(id.value);
        if (ids.size > total) return null;
        if (rowKey.value === key) {
          if (++matches !== 1) return null;
          const field = Object.getOwnPropertyDescriptor(item, 'value');
          if (!field || !Object.prototype.hasOwnProperty.call(field, 'value')) return null;
          const value = typeof field.value === 'string' ? field.value.trim() : field.value;
          if (value === 0 || value === '0') observed = 0;
          else if (value === 1 || value === '1') observed = 1;
          else return null;
        }
      }
      const more = page.hasNext();
      if (typeof more !== 'boolean') return null;
      if (!more) return ids.size === total && matches === 1 ? observed : null;
      if (!page.items.length || ids.size >= total || typeof page.next !== 'function') return null;
      page = await page.next();
    }
  } catch (e) { return null; }
}

export async function incrementSetting(key) {
  // Atomically read, increment, and update a numeric setting.
  // Returns the NEXT value (after incrementing). Caller formats it.
  const res = await wixData.query('Settings').eq('key', key).limit(1).find({ suppressAuth: true });
  if (!res.items.length) {
    throw new Error('Settings key not found: ' + key);
  }
  const item = res.items[0];
  const current = Number(item.value);
  if (isNaN(current)) {
    throw new Error('Settings key ' + key + ' is not numeric');
  }
  const next = current + 1;
  await wixData.update('Settings', { _id: item._id, key: item.key, value: String(next) }, { suppressAuth: true });
  return next;
}
