import wixData from 'wix-data';

export async function getAllSettings() {
  const res = await wixData.query('Settings').limit(1000).find();
  const settings = {};
  for (let i = 0; i < res.items.length; i++) {
    const item = res.items[i];
    settings[item.key] = item.value;
  }
  return settings;
}

export async function incrementSetting(key) {
  // Atomically read, increment, and update a numeric setting.
  // Returns the NEXT value (after incrementing). Caller formats it.
  const res = await wixData.query('Settings').eq('key', key).limit(1).find();
  if (!res.items.length) {
    throw new Error('Settings key not found: ' + key);
  }
  const item = res.items[0];
  const current = Number(item.value);
  if (isNaN(current)) {
    throw new Error('Settings key ' + key + ' is not numeric');
  }
  const next = current + 1;
  await wixData.update('Settings', { _id: item._id, key: item.key, value: String(next) });
  return next;
}
