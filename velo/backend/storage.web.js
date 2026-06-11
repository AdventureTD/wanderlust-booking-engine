/*
 * Wanderlust Booking Engine — Safe storage helper for Wix pages.
 * File: backend/storage.web.js
 *
 * Wix Test mode blocks localStorage; this provides a memory fallback.
 */

export const SEL_KEY = 'wbe_room_selections';
export const DATE_KEY_IN = 'wbe_checkIn';
export const DATE_KEY_OUT = 'wbe_checkOut';

const _memStore = {};

export function storeGet(key) {
  try { const v = localStorage.getItem(key); if (v !== null) return v; } catch (e) {}
  return _memStore[key] || null;
}

export function storeSet(key, val) {
  try { localStorage.setItem(key, val); } catch (e) {}
  _memStore[key] = val;
}

export function storeRemove(key) {
  try { localStorage.removeItem(key); } catch (e) {}
  delete _memStore[key];
}
