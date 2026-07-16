import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { ROOM_UNITS } from 'backend/wbeConfig';

const BOOKINGS = 'Bookings';
const BOOKING_SUMMARIES = 'BookingSummary';
const ROOMS = 'Rooms';
const MIN_N = 4;
const DAY = 86400000;

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
  x.setHours(0, 0, 0, 0);
  return x;
}

function ad(dt, n) {
  const x = new Date(dt);
  x.setDate(x.getDate() + n);
  return x;
}

function nb(a, b) {
  return Math.round((ds(b) - ds(a)) / DAY);
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

    const nights = [];
    for (let i = 0; i < rq; i++) { nights.push(ad(ci, i)); }

    const roomRes = await wixData.query(ROOMS).limit(50).find();
    const bookingRes = await wixData.query(BOOKINGS).limit(1000).find();

    const rooms = roomRes.items;
    const allBookings = bookingRes.items;
    // Fetch all BookingSummary records once; BookingSummary stores dates as text.
    const summaryAllRes = await wixData.query(BOOKING_SUMMARIES).limit(1000).find();
    const allSummaries = summaryAllRes.items;

    const normalizedSummaries = [];
    for (const s of allSummaries) {
      const bn = s.bookingNumber != null ? String(s.bookingNumber) : null;
      if (!bn) continue;
      const ciRaw = s.checkIn;
      const coRaw = s.checkOut;
      if (ciRaw == null || coRaw == null) continue;
      try {
        const dsCi = ds(ciRaw);
        const dsCo = ds(coRaw);
        if (isNaN(dsCi.getTime()) || isNaN(dsCo.getTime())) continue;
        normalizedSummaries.push({ bn: bn, dsCi: dsCi, dsCo: dsCo });
      } catch (e) { continue; }
    }

    const out = [];

    for (let r = 0; r < rooms.length; r++) {
      const rm = rooms[r];
      const code = rm.roomCode;
      const name = rm.name || code;
      const units = rm.units != null ? rm.units : ROOM_UNITS[code] || 1;
      const maxOcc = rm.maxOccupancy || 2;
      const baseOcc = rm.baseOccupancy || maxOcc;
      const roomFee = Number(rm.roomFee) || 0;

      const minNights = rm.minNightsAllowed != null ? Number(rm.minNightsAllowed) : null;
      if (minNights != null && !isNaN(minNights) && rq < minNights) {
        out.push({
          roomCode: code, roomName: name, units: units,
          occupancy: maxOcc, baseOccupancy: baseOcc,
          maxQty: 0, status: 'unavailable',
          availableCheckIn: '', availableCheckOut: '',
          availableNights: 0, baseRate: 0,
          roomFee: roomFee,
          mainPhoto: imgUrl(rm.mainPhoto),
        });
        continue;
      }

      const rBookings = allBookings.filter(b => b.roomCode === code);

      // Build summaryMap scoped to this room's booking numbers only.
      const summaryMap = {};
      for (const bk of rBookings) {
        if (bk.bookingNumber) summaryMap[String(bk.bookingNumber)] = null;
      }
      for (const ns of normalizedSummaries) {
        if (summaryMap.hasOwnProperty(ns.bn)) {
          summaryMap[ns.bn] = { dsCi: ns.dsCi, dsCo: ns.dsCo };
        }
      }

      const bpn = [];
      for (let i = 0; i < nights.length; i++) {
        const nt = nights[i];
        const nx = ad(nt, 1);
        let count = 0;
        for (const bk of rBookings) {
          const s = (bk.status || '').toLowerCase().trim();
          if (s === 'cancelled' || s === 'canceled') continue;
          const dates = summaryMap[String(bk.bookingNumber)];
          if (dates) {
            if (dates.dsCi < nx && dates.dsCo > nt) { count += 1; }
          }
        }
        bpn.push(count);
      }

      let allAvail = true;
      let maxBooked = 0;
      for (let i = 0; i < bpn.length; i++) {
        if (bpn[i] > maxBooked) maxBooked = bpn[i];
        if (bpn[i] >= units) allAvail = false;
      }
      const maxQty = units - maxBooked;

      if (allAvail) {
        out.push({
          roomCode: code, roomName: name, units: units,
          occupancy: maxOcc, baseOccupancy: baseOcc,
          maxQty: maxQty, status: 'full',
          availableCheckIn: ci.toISOString(),
          availableCheckOut: co.toISOString(),
          availableNights: rq,
          roomFee: roomFee,
          mainPhoto: imgUrl(rm.mainPhoto),
        });
        continue;
      }

      if (maxQty <= 0) {
        out.push({
          roomCode: code, roomName: name, units: units,
          occupancy: maxOcc, baseOccupancy: baseOcc,
          maxQty: 0, status: 'unavailable',
          availableCheckIn: '', availableCheckOut: '',
          availableNights: 0, baseRate: 0,
          roomFee: roomFee,
          mainPhoto: imgUrl(rm.mainPhoto),
        });
        continue;
      }

      let bs = null, bl = 0, cs = null, cl = 0;
      for (let i = 0; i < bpn.length; i++) {
        if (bpn[i] < units) {
          if (cs === null) { cs = i; cl = 1; } else { cl += 1; }
          if (cl > bl) { bl = cl; bs = cs; }
        } else { cs = null; cl = 0; }
      }

      if (bs !== null && bl >= MIN_N) {
        let minFreePartial = units;
        for (let i = bs; i < bs + bl; i++) {
          const free = units - bpn[i];
          if (free < minFreePartial) minFreePartial = free;
        }
        const aci = nights[bs];
        const aco = ad(nights[bs + bl - 1], 1);
        out.push({
          roomCode: code, roomName: name, units: units,
          occupancy: maxOcc, baseOccupancy: baseOcc,
          maxQty: minFreePartial, status: 'partial',
          availableCheckIn: aci.toISOString(),
          availableCheckOut: aco.toISOString(),
          availableNights: bl,
          roomFee: roomFee,
          mainPhoto: imgUrl(rm.mainPhoto),
        });
      }
    }

    const filtered = out.filter(r => r.maxQty > 0);

    return {
      ok: true, error: null, requestedNights: rq, results: filtered,
      _ver: 'string-date-overlap-fix',
    };
  }
);
