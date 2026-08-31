export const UNIT_ROOM_CODES = {
  1: 'penthouse_apartment',
  2: 'two_bedroom_apartment',
  3: 'adventure_suite',
  4: 'adventure_suite',
  5: 'adventure_suite',
};

export const AUTO_UNITS_BY_ROOM_CODE = {
  penthouse_apartment: [1],
  two_bedroom_apartment: [2],
  adventure_suite: [3, 4],
};

export function chooseAutomaticUnits(roomCode, quantity, unavailableUnits) {
  const qty = Math.max(1, Number(quantity) || 1);
  const unavailable = (unavailableUnits || []).map(Number);
  let candidates = AUTO_UNITS_BY_ROOM_CODE[roomCode] || [];

  // Unit 5 is online-assignable only when one booking requests all three
  // Adventure Suites together. Single/double requests use Units 3 and 4.
  if (roomCode === 'adventure_suite' && qty === 3) candidates = [3, 4, 5];
  if (qty > candidates.length) return [];

  const available = candidates.filter(function (unit) {
    return unavailable.indexOf(unit) === -1;
  });
  return available.length >= qty ? available.slice(0, qty) : [];
}

export function ownerUnitForOccupiedUnits(occupiedUnits) {
  const occupied = (occupiedUnits || []).map(Number);
  const has = function (unit) { return occupied.indexOf(unit) !== -1; };

  if (has(3) && has(4) && !has(5)) return 5;

  if (has(3) && has(4) && has(5)) {
    if (!has(1)) return 1;
    if (!has(2)) return 2;
  }

  if (occupied.length === 4) {
    for (let unit = 1; unit <= 5; unit++) {
      if (!has(unit)) return unit;
    }
  }
  return null;
}

export function roomCodeForUnit(unit) {
  return UNIT_ROOM_CODES[Number(unit)] || '';
}
