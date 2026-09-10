import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { ROOM_UNITS } from 'backend/wbeConfig';
import { loadRoomAvailabilityWindowReader } from 'backend/roomAvailability';

const ROOMS = 'Rooms';
const HOTEL_CLOSURES = 'HotelClosures';
const MIN_N = 4;
const DAY = 86400000;

function dstr(d) {
  if (!d) return '';
  try { const dt = d instanceof Date ? d : new Date(d); if (isNaN(dt.getTime())) return String(d); return dt.toISOString().slice(0, 10); } catch (e) { return String(d); }
}

async function checkHotelClosure(checkIn, checkOut) {
  try {
    const q = wixData.query(HOTEL_CLOSURES)
      .le('startDate', checkOut)
      .ge('endDate', checkIn);
    const res = await q.limit(100).find({ suppressAuth: true });
    if (res.items.length) {
      const c = res.items[0];
      return {
        closed: true,
        startDate: dstr(c.startDate),
        endDate: dstr(c.endDate),
        reason: c.reason || '',
      };
    }
  } catch (e) { return { closed: true, reason: 'Unable to check resort closures. Please try again.' }; }
  return { closed: false };
}

function imgUrl(v) {
  if (!v) { return ''; }
  if (typeof v === 'string') {
    const orig = v;
    if (orig.indexOf('wix:image://') === 0) {
      const noProto = orig.substring(12);
      const hashIdx = noProto.indexOf('#');
      const clean = hashIdx >= 0
        ? noProto.substring(0, hashIdx) : noProto;
      const slash1 = clean.indexOf('/');
      if (slash1 < 0) { return ''; }
      const version = clean.substring(0, slash1);
      const rest = clean.substring(slash1 + 1);
      const slash2 = rest.indexOf('/');
      let mediaId = '';
      let fileName = '';
      if (slash2 >= 0) {
        mediaId = rest.substring(0, slash2);
        fileName = rest.substring(slash2 + 1);
      } else {
        mediaId = rest;
      }
      let url = 'https://static.wixstatic.com/media/' + mediaId;
      return url;
    }
    return orig;
  }
  if (v.src) {
    return imgUrl(v.src);
  }
  return '';
}

function ds(dt) {
  const x = new Date(dt);
  // Match the inventory UTC-day contract, not the backend host timezone.
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function ad(dt, n) {
  const x = new Date(dt);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function nb(a, b) {
  return Math.round((ds(b) - ds(a)) / DAY);
}

const PHYSICAL_MAX_QUANTITY = {
  penthouse_apartment: 1,
  two_bedroom_apartment: 1,
  adventure_suite: 3
};
const PHYSICAL_ROOM_CODE_ORDER = [
  'penthouse_apartment',
  'two_bedroom_apartment',
  'adventure_suite'
];

function physicalCapMap(rows) {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
    throw new Error('Invalid physical availability');
  }
  const rowDescriptors = Object.getOwnPropertyDescriptors(rows);
  const expectedRowKeys = ['0', '1', '2', 'length'];
  const rowKeys = Reflect.ownKeys(rowDescriptors);
  if (rowKeys.length !== expectedRowKeys.length || rowKeys.some(function(key) {
    return typeof key !== 'string' || expectedRowKeys.indexOf(key) === -1;
  })) {
    throw new Error('Invalid physical availability');
  }
  const lengthDescriptor = rowDescriptors.length;
  if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
    lengthDescriptor.value !== 3) {
    throw new Error('Invalid physical availability');
  }
  const caps = Object.create(null);
  const expectedFields = ['available', 'maxQuantity', 'roomCode'];
  for (let index = 0; index < lengthDescriptor.value; index++) {
    const rowDescriptor = rowDescriptors[String(index)];
    if (!rowDescriptor || rowDescriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(rowDescriptor, 'value')) {
      throw new Error('Invalid physical availability');
    }
    const row = rowDescriptor.value;
    const rowPrototype = row && typeof row === 'object' ? Object.getPrototypeOf(row) : null;
    if (!row || typeof row !== 'object' || Array.isArray(row) || rowPrototype !== Object.prototype) {
      throw new Error('Invalid physical availability');
    }
    const descriptors = Object.getOwnPropertyDescriptors(row);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (descriptorKeys.length !== expectedFields.length || descriptorKeys.some(function(key) {
      return typeof key !== 'string' || expectedFields.indexOf(key) === -1;
    })) {
      throw new Error('Invalid physical availability');
    }
    const roomCodeDescriptor = descriptors.roomCode;
    const availableDescriptor = descriptors.available;
    const maxQuantityDescriptor = descriptors.maxQuantity;
    if (!roomCodeDescriptor || !availableDescriptor || !maxQuantityDescriptor ||
      roomCodeDescriptor.enumerable !== true || availableDescriptor.enumerable !== true ||
      maxQuantityDescriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(roomCodeDescriptor, 'value') ||
      !Object.prototype.hasOwnProperty.call(availableDescriptor, 'value') ||
      !Object.prototype.hasOwnProperty.call(maxQuantityDescriptor, 'value')) {
      throw new Error('Invalid physical availability');
    }
    const code = roomCodeDescriptor.value;
    const available = availableDescriptor.value;
    const maxQuantity = maxQuantityDescriptor.value;
    if (typeof code !== 'string' || code !== PHYSICAL_ROOM_CODE_ORDER[index] ||
      !Object.prototype.hasOwnProperty.call(PHYSICAL_MAX_QUANTITY, code) ||
      Object.prototype.hasOwnProperty.call(caps, code) ||
      !Number.isInteger(maxQuantity) || maxQuantity < 0 ||
      maxQuantity > PHYSICAL_MAX_QUANTITY[code] ||
      typeof available !== 'boolean' || available !== (maxQuantity > 0)) {
      throw new Error('Invalid physical availability');
    }
    caps[code] = maxQuantity;
  }
  if (Object.keys(caps).length !== 3) throw new Error('Invalid physical availability');
  return caps;
}

export const searchAvailability = webMethod(
  Permissions.Anyone,
  async (checkIn, checkOut) => {
    const ci = ds(checkIn);
    const co = ds(checkOut);
    if (co <= ci) {
      return { ok: false, error: 'Check-out must be after check-in.', requestedNights: 0, results: [] };
    }
    const rq = nb(ci, co);
    if (rq < MIN_N) {
      return { ok: false, error: 'Minimum stay is ' + MIN_N + ' nights.', requestedNights: rq, results: [] };
    }

    const closure = await checkHotelClosure(ci, co);
    if (closure.closed) {
      return {
        ok: false,
        error: closure.reason || 'The resort is closed from ' + closure.startDate + ' to ' + closure.endDate + '.',
        requestedNights: rq,
        results: []
      };
    }

    const physicalAvailabilityByWindow = Object.create(null);
    const windowReader = Promise.resolve().then(function() {
      return loadRoomAvailabilityWindowReader(new Date(ci.getTime()), new Date(co.getTime()));
    });
    async function physicalAvailabilityFor(startDate, endDate) {
      const key = startDate.toISOString() + '|' + endDate.toISOString();
      if (!Object.prototype.hasOwnProperty.call(physicalAvailabilityByWindow, key)) {
        const coordinatorStartDate = new Date(startDate.getTime());
        const coordinatorEndDate = new Date(endDate.getTime());
        physicalAvailabilityByWindow[key] = windowReader
          .then(function(readWindow) { return readWindow(coordinatorStartDate, coordinatorEndDate); })
          .then(physicalCapMap);
      }
      return physicalAvailabilityByWindow[key];
    }

    let physicalCaps = null;
    try {
      physicalCaps = await physicalAvailabilityFor(ci, co);
    } catch (error) {
      return {
        ok: false,
        error: 'Unable to check room availability. Please try again.',
        requestedNights: rq,
        results: []
      };
    }
    const nights = [];
    for (let i = 0; i < rq; i++) { nights.push(ad(ci, i)); }

    const roomRes = await wixData.query(ROOMS).limit(50).find({ suppressAuth: true });

    const rooms = roomRes.items;
    const seenRoomCodes = Object.create(null);
    const normalizedRooms = [];
    for (const room of rooms) {
      const roomCode = room && room.roomCode;
      normalizedRooms.push({ room: room, roomCode: roomCode });
      if (typeof roomCode !== 'string') continue;
      if (Object.prototype.hasOwnProperty.call(seenRoomCodes, roomCode)) {
        return {
          ok: false,
          error: 'Unable to check room availability. Please try again.',
          requestedNights: rq,
          results: []
        };
      }
      seenRoomCodes[roomCode] = true;
    }
    const out = [];

    for (let r = 0; r < normalizedRooms.length; r++) {
      const rm = normalizedRooms[r].room;
      const code = normalizedRooms[r].roomCode;
      const name = rm.name || code;
      const units = ROOM_UNITS[code] != null ? ROOM_UNITS[code] : (rm.units != null ? rm.units : 1);
      const maxOcc = rm.maxOccupancy || 2;
      const baseOcc = rm.baseOccupancy || maxOcc;
      const roomFee = Number(rm.roomFee) || 0;
      const extraFieldsUnavailable = {
        name: rm.name || '',
        description: rm.description || '',
        roomType: rm.roomType || '',
        occupancyText: rm.occupancyText || '',
        additionalFeeText: rm.additionalFeeText || ''
      };

      const minNights = rm.minNightsAllowed != null ? Number(rm.minNightsAllowed) : null;
      if (minNights != null && !isNaN(minNights) && rq < minNights) {
        out.push(Object.assign({
          roomCode: code, roomName: name, units: units,
          occupancy: maxOcc, baseOccupancy: baseOcc,
          maxQty: 0, status: 'unavailable',
          availableCheckIn: '', availableCheckOut: '',
          availableNights: 0, baseRate: 0,
          roomFee: roomFee,
          mainPhoto: imgUrl(rm.mainPhoto),
        }, extraFieldsUnavailable));
        continue;
      }

      // The validated physical reader resolves Bookings dates first and enforces
      // continuous eligible units, lifecycle validity and nightly owner capacity.
      const maxQty = Object.prototype.hasOwnProperty.call(physicalCaps, code)
        ? physicalCaps[code] : 0;
      const allAvail = maxQty > 0;

      if (allAvail) {
        out.push(Object.assign({
          roomCode: code, roomName: name, units: units,
          occupancy: maxOcc, baseOccupancy: baseOcc,
          maxQty: maxQty, status: 'full',
          availableCheckIn: ci.toISOString(),
          availableCheckOut: co.toISOString(),
          availableNights: rq,
          roomFee: roomFee,
          mainPhoto: imgUrl(rm.mainPhoto),
        }, extraFieldsUnavailable));
        continue;
      }

      let pushedPartial = false;
      let partialWindow = null;
      // Longest eligible exact window wins; ascending starts retain the earliest
      // tie. Night-by-night free counts cannot establish a continuous room.
      // The request-local cache shares each validated window across room classes.
      try {
        for (let length = rq - 1; length >= MIN_N && !partialWindow; length--) {
          for (let start = 0; start + length <= rq; start++) {
            const windowStart = nights[start];
            const windowEnd = ad(windowStart, length);
            const caps = await physicalAvailabilityFor(windowStart, windowEnd);
            const quantity = Object.prototype.hasOwnProperty.call(caps, code) ? caps[code] : 0;
            if (quantity > 0) {
              partialWindow = { start: windowStart, end: windowEnd, nights: length, quantity: quantity };
              break;
            }
          }
        }
      } catch (error) {
        return {
          ok: false,
          error: 'Unable to check room availability. Please try again.',
          requestedNights: rq,
          results: []
        };
      }
      if (partialWindow) {
        const aci = partialWindow.start;
        const aco = partialWindow.end;
        const bl = partialWindow.nights;
        const partialMaxQty = partialWindow.quantity;
        if (partialMaxQty > 0) {
          out.push(Object.assign({
            roomCode: code, roomName: name, units: units,
            occupancy: maxOcc, baseOccupancy: baseOcc,
            maxQty: partialMaxQty, status: 'partial',
            availableCheckIn: aci.toISOString(),
            availableCheckOut: aco.toISOString(),
            availableNights: bl,
            roomFee: roomFee,
            mainPhoto: imgUrl(rm.mainPhoto),
          }, extraFieldsUnavailable));
          pushedPartial = true;
        }
      }
      if (!pushedPartial) {
        out.push(Object.assign({
          roomCode: code, roomName: name, units: units,
          occupancy: maxOcc, baseOccupancy: baseOcc,
          maxQty: 0, status: 'unavailable',
          availableCheckIn: '', availableCheckOut: '',
          availableNights: 0, baseRate: 0,
          roomFee: roomFee,
          mainPhoto: imgUrl(rm.mainPhoto),
        }, extraFieldsUnavailable));
      }
    }

    // Deduplicate by roomCode. If both full and partial exist, prefer the full row.
    const seen = {};
    const deduped = [];
    for (const r of out) {
      if (seen[r.roomCode]) {
        const existing = seen[r.roomCode];
        if (r.status === 'full' && existing.status !== 'full') {
          existing.status = 'full';
          existing.maxQty = r.maxQty;
          existing.availableCheckIn = r.availableCheckIn;
          existing.availableCheckOut = r.availableCheckOut;
          existing.availableNights = r.availableNights;
        }
        continue;
      }
      seen[r.roomCode] = r;
      deduped.push(r);
    }

    const filtered = deduped.filter(r => r.maxQty > 0);

    return {
      ok: true, error: null, requestedNights: rq, results: filtered,
      _ver: 'string-date-overlap-fix',
    };
  }
);

function fmtShort(d) {
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
}

// Scans up to 30 days past checkOut for windows of the same night count
// with at least one room fully available. Returns up to 3 suggestions.
export const suggestAlternateDates = webMethod(
  Permissions.Anyone,
  async (checkIn, checkOut) => {
    const ci = ds(checkIn);
    const co = ds(checkOut);
    if (co <= ci) { return { ok: true, nights: 0, suggestions: [] }; }

    const nights = nb(ci, co);
    if (nights < MIN_N) { return { ok: true, nights: nights, suggestions: [] }; }

    const suggestions = [];
    const maxStartOffset = 30;

    for (let offset = 1; offset <= maxStartOffset && suggestions.length < 3; offset++) {
      const newCi = ad(ci, offset);
      const newCo = ad(newCi, nights);
      try {
        const res = await searchAvailability(newCi, newCo);
        if (res && res.ok && res.results) {
          const hasFull = res.results.some(function (r) { return r.status === 'full'; });
          if (hasFull) {
            suggestions.push({
              checkIn: newCi.toISOString(),
              checkOut: newCo.toISOString(),
              checkInLabel: fmtShort(newCi),
              checkOutLabel: fmtShort(newCo),
              label: '(' + fmtShort(newCi) + ' – ' + fmtShort(newCo) + ')',
            });
          }
        }
      } catch (e) { /* skip this candidate */ }
    }

    return { ok: true, nights: nights, suggestions: suggestions };
  }
);
