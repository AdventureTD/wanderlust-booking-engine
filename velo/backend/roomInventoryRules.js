import { roomCodeForUnit } from 'backend/roomAssignmentRules';

// Pure read-only projection of physical-room inventory rows.
// No Wix APIs, database access, network calls, or side effects belong here.

const DAY_MS = 86400000;
const ACTIVE_STATUSES = ['confirmed', 'hold', 'blocked', 'in-house'];
const INACTIVE_STATUSES = ['cancelled', 'canceled', 'pending', 'pending confirmation'];

function inventoryStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isActiveInventoryStatus(value) {
  return ACTIVE_STATUSES.indexOf(inventoryStatus(value)) !== -1;
}

function validCalendarPrefix(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day;
}

function inventoryDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized !== value) return null;
  const strictIso = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;
  if (!strictIso.test(normalized) || !validCalendarPrefix(normalized)) return null;
  return new Date(normalized);
}

function inventoryDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = inventoryDate(value);
  if (!date || isNaN(date.getTime())) return null;
  return Math.floor(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ) / DAY_MS);
}

function inventoryUnit(value) {
  let unit = null;
  if (typeof value === 'number') {
    unit = value;
  } else if (typeof value === 'string') {
    const normalized = value.trim();
    if (!/^[1-5]$/.test(normalized)) return null;
    unit = Number(normalized);
  }
  return Number.isInteger(unit) && unit >= 1 && unit <= 5 ? unit : null;
}

function inventoryDateKey(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function buildInventorySnapshot(rows, checkIn, checkOut) {
  const startDay = inventoryDay(checkIn);
  const endDay = inventoryDay(checkOut);
  if (startDay === null || endDay === null || endDay <= startDay) {
    throw new Error('Invalid inventory dates');
  }
  const sourceRows = Array.isArray(rows) ? rows : [];
  const activeRows = sourceRows.filter(function(row) {
    return row && isActiveInventoryStatus(row.status);
  });
  const unknownStatusRows = sourceRows.filter(function(row) {
    if (!row) return false;
    const status = inventoryStatus(row.status);
    if (!status || ACTIVE_STATUSES.indexOf(status) !== -1 || INACTIVE_STATUSES.indexOf(status) !== -1) {
      return false;
    }
    const rowStartDay = inventoryDay(row.checkIn);
    const rowEndDay = inventoryDay(row.checkOut);
    return rowStartDay !== null && rowEndDay !== null && rowEndDay > rowStartDay &&
      rowStartDay < endDay && rowEndDay > startDay;
  });
  const overlappingRows = activeRows.filter(function(row) {
    const rowStartDay = inventoryDay(row.checkIn);
    const rowEndDay = inventoryDay(row.checkOut);
    return rowStartDay !== null && rowEndDay !== null &&
      rowEndDay > rowStartDay && rowStartDay < endDay && rowEndDay > startDay;
  });
  const guestRows = overlappingRows.filter(function(row) {
    return row.autoOwnerBlock !== true;
  });
  const ownerBlockRows = overlappingRows.filter(function(row) {
    return row.autoOwnerBlock === true;
  });
  const occupiedUnits = [];
  for (const row of guestRows) {
    const unit = inventoryUnit(row.assignedRoom);
    if (unit !== null && occupiedUnits.indexOf(unit) === -1) {
      occupiedUnits.push(unit);
    }
  }
  occupiedUnits.sort(function(a, b) { return a - b; });
  const migrationIssueRows = activeRows.filter(function(row) {
    const rowStartDay = inventoryDay(row.checkIn);
    const rowEndDay = inventoryDay(row.checkOut);
    const unit = inventoryUnit(row.assignedRoom);
    return rowStartDay === null || rowEndDay === null || rowEndDay <= rowStartDay ||
      row.quantity !== 1 || unit === null || roomCodeForUnit(unit) !== row.roomCode;
  });
  const occupiedUnitsByNight = {};
  const duplicateUnitClaims = [];
  for (let day = startDay; day < endDay; day += 1) {
    const nightlyUnits = [];
    const nightlyClaims = {};
    for (const row of guestRows) {
      const rowStartDay = inventoryDay(row.checkIn);
      const rowEndDay = inventoryDay(row.checkOut);
      const unit = inventoryUnit(row.assignedRoom);
      if (
        unit !== null &&
        rowStartDay !== null &&
        rowEndDay !== null &&
        rowStartDay <= day && day < rowEndDay
      ) {
        if (nightlyUnits.indexOf(unit) === -1) nightlyUnits.push(unit);
        if (!nightlyClaims[unit]) nightlyClaims[unit] = [];
        nightlyClaims[unit].push(String(row._id || ''));
      }
    }
    nightlyUnits.sort(function(a, b) { return a - b; });
    const nightKey = inventoryDateKey(day);
    occupiedUnitsByNight[nightKey] = nightlyUnits;
    for (const unit of nightlyUnits) {
      const rowIds = nightlyClaims[unit].sort();
      if (rowIds.length > 1) {
        duplicateUnitClaims.push({ night: nightKey, unit: unit, rowIds: rowIds });
      }
    }
  }
  return {
    rows: overlappingRows,
    guestRows: guestRows,
    ownerBlockRows: ownerBlockRows,
    occupiedUnits: occupiedUnits,
    migrationIssueRows: migrationIssueRows,
    unknownStatusRows: unknownStatusRows,
    occupiedUnitsByNight: occupiedUnitsByNight,
    duplicateUnitClaims: duplicateUnitClaims,
  };
}
