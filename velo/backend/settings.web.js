import wixData from 'wix-data';

export async function getAllSettings() {
  const res = await wixData.query('Settings').limit(100).find();
  const settings = {};
  for (let i = 0; i < res.items.length; i++) {
    const item = res.items[i];
    settings[item.key] = item.value;
  }
  return settings;
}
