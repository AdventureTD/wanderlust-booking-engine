import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

/*
 * getPackageAmenities(nights)
 * Looks up the Packages collection for a row where numberOfNights matches.
 * Returns { title, includedAmenities } — title will be empty string if no match.
 *
 * Field names tried (Wix key names vary by how the collection was created):
 *   numberOfNights, NumberOfNights, numberofnights
 *   title, title_fld, Title, name, Name
 */
export const getPackageBaseRate = webMethod(
  Permissions.Anyone,
  async (nights) => {
    const n = Number(nights);
    if (!n || n <= 0) return 0;
    try {
      const res = await wixData.query('Packages').limit(100).find();
      for (const item of res.items) {
        const itemNights = item.numberOfNights || item.NumberOfNights || item.numberofnights || 0;
        if (Number(itemNights) === n) {
          return Number(item.baseRate) || 0;
        }
      }
    } catch (e) { return 0; }
    return 0;
  }
);

export const getPackageAmenities = webMethod(
  Permissions.Anyone,
  async (nights) => {
    const n = Number(nights);
    if (!n || n <= 0) {
      return { title: '', includedAmenities: '' };
    }

    const res = await wixData.query('Packages')
      .limit(100)
      .find();

    if (!res || !res.items || res.items.length === 0) {
      return { title: '', includedAmenities: '' };
    }

    for (let i = 0; i < res.items.length; i++) {
      const item = res.items[i];
      const itemNights = item.numberOfNights || item.NumberOfNights || item.numberofnights || 0;
      if (Number(itemNights) === n) {
        const title = item.title || item.title_fld || item.Title || item.name || item.Name || '';
        const included = item.includedAmenities || item.IncludedAmenities || '';
        return { title, includedAmenities: included };
      }
    }

    return { title: '', includedAmenities: '' };
  }
);
