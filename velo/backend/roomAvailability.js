import { loadInventorySnapshot } from 'backend/roomInventory';
import { maximumAutomaticQuantity } from 'backend/roomAvailabilityRules';

// Backend-only read composition. This module exposes no web method and performs no writes.
const ROOM_CODES = [
  'penthouse_apartment',
  'two_bedroom_apartment',
  'adventure_suite'
];

export async function loadRoomAvailability(checkIn, checkOut) {
  const snapshot = await loadInventorySnapshot(checkIn, checkOut);
  return ROOM_CODES.map(function(roomCode) {
    const maxQuantity = maximumAutomaticQuantity(snapshot, roomCode);
    return {
      roomCode: roomCode,
      available: maxQuantity > 0,
      maxQuantity: maxQuantity
    };
  });
}
