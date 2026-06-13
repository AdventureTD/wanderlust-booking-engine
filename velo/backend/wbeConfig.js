export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export const ROOM_UNITS = {
  adventure_suite: 3,
  penthouse_apartment: 1,
  two_bedroom_apartment: 1,
};

export const ROOM_DEFAULTS = {
  adventure_suite:     { baseOccupancy: 2, maxOccupancy: 2, extraGuestFee: 0.0 },
  penthouse_apartment: { baseOccupancy: 2, maxOccupancy: 2, extraGuestFee: 0.0 },
  two_bedroom_apartment:{ baseOccupancy: 3, maxOccupancy: 4, extraGuestFee: 396.0 },
};

export const ROOM_MAX_OCCUPANCY = {
  adventure_suite: 2,
  penthouse_apartment: 2,
  two_bedroom_apartment: 4,
};

export const ROOM_MIN_OCCUPANCY = {
  adventure_suite: 2,
  penthouse_apartment: 2,
  two_bedroom_apartment: 3,
};

export const ROOM_DISPLAY_NAMES = {
  adventure_suite: 'Adventure Suite',
  penthouse_apartment: 'Penthouse Apartment',
  two_bedroom_apartment: 'Two Bedroom Apartment',
};

export function getRoomDisplayName(roomCode) {
  return ROOM_DISPLAY_NAMES[roomCode] || (roomCode || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}
