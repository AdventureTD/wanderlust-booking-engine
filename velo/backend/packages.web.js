import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

export const getPackageAmenities = webMethod(
  Permissions.Anyone,
  async (nights) => {
    if (!nights || nights <= 0) {
      return { title: '', includedAmenities: '' };
    }
    const res = await wixData.query('Packages')
      .limit(100)
      .find();

    let pkg = null;
    for (let i = 0; i < res.items.length; i++) {
      const item = res.items[i];
      // Match night count. Wix field keys are exact — try common variations.
      const itemNights = item.NumberOfNights || item.numberOfNights || item.numberofnights || 0;
      if (Number(itemNights) === Number(nights)) {
        pkg = item;
        break;
      }
    }

    if (!pkg) {
      return { title: '', includedAmenities: '' };
    }

    // Title in Packages collection uses Wix's internal key 'title_fld' (not 'title').
    const title = pkg.title_fld || pkg.title || pkg.Title || pkg.name || pkg.Name || '';
    const included = pkg.IncludedAmenities || pkg.includedAmenities || pkg.includeamenities || '';

    return {
      title: title,
      includedAmenities: included
    };
  }
);
