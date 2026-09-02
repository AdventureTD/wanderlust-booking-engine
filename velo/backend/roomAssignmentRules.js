// Pure physical-room assignment rules.
// No Wix APIs, database access, network calls, or side effects belong here.

export function chooseAutomaticUnits(roomCode, quantity, occupiedUnits) {
  const qty = Number(quantity);
  const occupied = Array.isArray(occupiedUnits) ? occupiedUnits.map(Number) : [];
  const fixedUnitByRoomCode = {
    penthouse_apartment: 1,
    two_bedroom_apartment: 2,
  };
  const fixedUnit = Object.prototype.hasOwnProperty.call(fixedUnitByRoomCode, roomCode)
    ? fixedUnitByRoomCode[roomCode]
    : null;
  if (fixedUnit && qty === 1) {
    return occupied.indexOf(fixedUnit) === -1 ? [fixedUnit] : [];
  }
  if (roomCode === 'adventure_suite' && qty === 1) {
    const guestUnit = [3, 4].find(function(unit) {
      return occupied.indexOf(unit) === -1;
    });
    return guestUnit ? [guestUnit] : [];
  }
  if (roomCode === 'adventure_suite' && qty === 2) {
    return occupied.indexOf(3) === -1 && occupied.indexOf(4) === -1
      ? [3, 4]
      : [];
  }
  if (roomCode === 'adventure_suite' && qty === 3) {
    return [3, 4, 5].every(function(unit) {
      return occupied.indexOf(unit) === -1;
    }) ? [3, 4, 5] : [];
  }
  return [];
}

export function ownerUnitForOccupiedUnits(occupiedUnits) {
  const occupied = Array.isArray(occupiedUnits) ? occupiedUnits.map(Number) : [];
  if (
    occupied.indexOf(3) !== -1 &&
    occupied.indexOf(4) !== -1 &&
    occupied.indexOf(5) !== -1
  ) {
    if (occupied.indexOf(1) === -1) return 1;
    if (occupied.indexOf(2) === -1) return 2;
    return null;
  }
  if (occupied.indexOf(3) !== -1 && occupied.indexOf(4) !== -1) {
    return 5;
  }
  const remaining = [1, 2, 3, 4, 5].filter(function(unit) {
    return occupied.indexOf(unit) === -1;
  });
  return remaining.length === 1 ? remaining[0] : null;
}

export function roomCodeForUnit(unit) {
  if (unit === 1) return 'penthouse_apartment';
  if (unit === 2) return 'two_bedroom_apartment';
  if ([3, 4, 5].indexOf(unit) !== -1) return 'adventure_suite';
  return '';
}
