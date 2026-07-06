import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { ROOM_UNITS } from 'backend/wbeConfig';

const BOOKINGS = 'Bookings';
const BOOKING_SUMMARIES = 'BookingSummary';
const ROOMS = 'Rooms';
const ROOM_PRICING = 'RoomPricing';
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
      return {
        ok: false,
        error: 'Check-out must be after check-in.',
        requestedNights: 0,
        results: [],
      };
    }
    const rq = nb(ci, co);
    if (rq < MIN_N) {
      const em = 'Minimum stay is ' + MIN_N + ' nights.';
      return {
        ok: false,
        error: em,
        requestedNights: rq,
        results: [],
      };
    }

    const nights = [];
    for (let i = 0; i < rq; i++) {
      nights.push(ad(ci, i));
    }

    const roomRes = await wixData.query(ROOMS).limit(50).find();
    const bookingRes = await wixData.query(BOOKINGS).limit(1000).find();
    const pricingRes = await wixData.query(ROOM_PRICING).limit(1000).find();

    const rooms = roomRes.items;
    const allBookings = bookingRes.items;
    const priceMap = {};
    for (let i = 0; i < pricingRes.items.length; i++) {
      const p = pricingRes.items[i];
      priceMap[p.roomCode + '|' + p.nights] = p.baseRate;
    }

    // Deep diagnostics: list ALL bookings we know about, not just adventure_suite
    const diagBookingNumbers = [];
    for (const bk of allBookings) {
      if (bk.roomCode === 'adventure_suite') {
        diagBookingNumbers.push({
          bookingNumber: bk.bookingNumber,
          status: bk.status,
          bkp: typeof bk.bookingNumber,
        });
      }
    }
    console.log('>>> [SEARCH-DIAG] adventure_suite bookings in Bookings col:', JSON.stringify(diagBookingNumbers));

    const out = [];
    for (let r = 0; r < rooms.length; r++) {
      const rm = rooms[r];
      const code = rm.roomCode;
      const name = rm.name || code;
      const units = rm.units != null ? rm.units : ROOM_UNITS[code] || 1;
      const maxOcc = rm.maxOccupancy || 2;
      const baseOcc = rm.baseOccupancy || maxOcc;

      // Per-room minimum stay check — silently skip rooms below their threshold
      const minNights = rm.minNightsAllowed != null ? Number(rm.minNightsAllowed) : null;
      if (minNights != null && !isNaN(minNights) && rq < minNights) {
        continue; // room requires longer stay than requested
      }

      const rBookings = [];
      for (let b = 0; b < allBookings.length; b++) {
        if (allBookings[b].roomCode === code) {
          rBookings.push(allBookings[b]);
        }
      }

      // Build a map of bookingNumber -> BookingSummary dates for overlap checks
      const summaryMap = {};
      for (const bk of allBookings) {
        if (bk.bookingNumber && bk.roomCode === code && !summaryMap[bk.bookingNumber]) {
          summaryMap[bk.bookingNumber] = {};
        }
      }

      // Join: find overlapping BookingSummaries and map their dates to Bookings rows
      const overlapNumbers = [];
      for (const nt of nights) {
        const nx = ad(nt, 1);
        const summaryRes = await wixData.query(BOOKING_SUMMARIES)
          .lt('checkIn', nx)
          .gt('checkOut', nt)
          .limit(1000)
          .find();
        for (const s of summaryRes.items) {
          if (s.bookingNumber && overlapNumbers.indexOf(String(s.bookingNumber)) === -1) {
            overlapNumbers.push(String(s.bookingNumber));
          }
        }
      }

      if (code === 'adventure_suite') {
        console.log('>>> [SEARCH-DIAG] overlapNumbers found:', JSON.stringify(overlapNumbers));
      }

      // Attach summary dates to each booking row
      if (overlapNumbers.length > 0) {
        const summaryRes = await wixData.query(BOOKING_SUMMARIES)
          .hasSome('bookingNumber', overlapNumbers)
          .limit(1000)
          .find();
        if (code === 'adventure_suite') {
          console.log('>>> [SEARCH-DIAG] BookingSummary records returned:', summaryRes.items.length);
          for (const s of summaryRes.items) {
            console.log('>>> [SEARCH-DIAG] summary bookingNumber:', s.bookingNumber, 'type:', typeof s.bookingNumber, 'checkIn:', s.checkIn, 'checkOut:', s.checkOut);
          }
        }
        for (const s of summaryRes.items) {
          summaryMap[String(s.bookingNumber)] = { checkIn: s.checkIn, checkOut: s.checkOut };
        }
      }

      const bpn = [];
      for (let i = 0; i < nights.length; i++) {
        const nt = nights[i];
        const nx = ad(nt, 1);
        let count = 0;
        for (let b = 0; b < rBookings.length; b++) {
          const bk = rBookings[b];
          // Exclude cancelled bookings only
          const bkStatus = (bk.status || '').toLowerCase().trim();
          if (bkStatus === 'cancelled' || bkStatus === 'canceled') { continue; }

          const dates = summaryMap[String(bk.bookingNumber)];
          if (code === 'adventure_suite' && i === 0) {
            // Log EVERY booking in rBookings and whether it has dates in summaryMap
            console.log('>>> [SEARCH-DIAG] night0 bookingNumber:', String(bk.bookingNumber), 'status:', bkStatus, 'hasDates:', !!(dates && dates.checkIn && dates.checkOut));
          }
          if (dates && dates.checkIn && dates.checkOut) {
            const dsCheckIn = ds(dates.checkIn);
            const dsCheckOut = ds(dates.checkOut);
            if (code === 'adventure_suite') {
              console.log('>>> [SEARCH-DIAG] checking overlap:', 'ci:', dsCheckIn.getTime(), '<', nx.getTime(), '&&', 'co:', dsCheckOut.getTime(), '>', nt.getTime(), 'result:', (dsCheckIn < nx && dsCheckOut > nt));
            }
            if (dsCheckIn < nx && dsCheckOut > nt) {
              count += 1;
            }
          }
        }
        bpn.push(count);
      }

      if (code === 'adventure_suite') {
        console.log('>>> [SEARCH] bpn for adventure_suite:', bpn.join(','), '| units=', units, '| maxBooked=', Math.max(...bpn), '| overlapNumbers=', overlapNumbers.length);
      }

      let allAvail = true;
      let maxBooked = 0;
      for (let i = 0; i < bpn.length; i++) {
        if (bpn[i] > maxBooked) { maxBooked = bpn[i]; }
        if (bpn[i] >= units) {
          allAvail = false;
        }
      }
      const maxQty = units - maxBooked;

      if (allAvail) {
        const key = code + '|' + rq;
        const rate = priceMap[key];
        if (rate === undefined) { continue; }
        out.push({
          roomCode: code,
          roomName: name,
          units: units,
          occupancy: maxOcc,
          baseOccupancy: baseOcc,
          maxQty: maxQty,
          status: 'full',
          availableCheckIn: ci.toISOString(),
          availableCheckOut: co.toISOString(),
          availableNights: rq,
          baseRate: rate,
          mainPhoto: imgUrl(rm.mainPhoto),
        });
        continue;
      }

      let bs = null;
      let bl = 0;
      let cs = null;
      let cl = 0;
      for (let i = 0; i < bpn.length; i++) {
        if (bpn[i] < units) {
          if (cs === null) {
            cs = i;
            cl = 1;
          } else {
            cl += 1;
          }
          if (cl > bl) {
            bl = cl;
            bs = cs;
          }
        } else {
          cs = null;
          cl = 0;
        }
      }

      if (bs !== null && bl >= MIN_N) {
        const key = code + '|' + bl;
        const rate = priceMap[key];
        if (rate === undefined) { continue; }
        // Calculate min free units across the partial stretch (not entire range)
        let minFreePartial = units;
        for (let i = bs; i < bs + bl; i++) {
          const free = units - bpn[i];
          if (free < minFreePartial) { minFreePartial = free; }
        }
        const aci = nights[bs];
        const aco = ad(nights[bs + bl - 1], 1);
        out.push({
          roomCode: code,
          roomName: name,
          units: units,
          occupancy: maxOcc,
          baseOccupancy: baseOcc,
          maxQty: minFreePartial,
          status: 'partial',
          availableCheckIn: aci.toISOString(),
          availableCheckOut: aco.toISOString(),
          availableNights: bl,
          baseRate: rate,
          mainPhoto: imgUrl(rm.mainPhoto),
        });
      }
    }

    // Safety filter: drop any results with maxQty <= 0
    const filtered = [];
    for (let i = 0; i < out.length; i++) {
      if (out[i].maxQty > 0) {
        filtered.push(out[i]);
      }
    }

    return {
      ok: true,
      error: null,
      requestedNights: rq,
      results: filtered,
      _ver: 'cancel-only-v2-diag1',
    };
  }
);
