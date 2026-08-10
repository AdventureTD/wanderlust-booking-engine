import { Permissions, webMethod } from 'wix-web-module';
import { createLockedPricingQuote, verifyLockedPricingQuote } from 'backend/pricingQuote';

export const createPricingQuote = webMethod(
  Permissions.Anyone,
  async (packageId, checkIn, checkOut) => {
    return createLockedPricingQuote(packageId, checkIn, checkOut);
  }
);

export const readPricingQuote = webMethod(
  Permissions.Anyone,
  async (token, packageId, checkIn, checkOut) => {
    return verifyLockedPricingQuote(token, { packageId, checkIn, checkOut });
  }
);
