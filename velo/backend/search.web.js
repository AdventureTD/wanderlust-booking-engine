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

    // ── NEW: fetch all BookingSummary records ONCE and do overlap in JS ──
    const summaryAllRes = await wixData.query(BOOKING_SUMMARIES).limit(1000).find();
    const allSummaries = summaryAllRes.items;

    // Pre-process summaries: only keep those with valid dates.
    // Normalize each checkIn/checkOut with ds() for midnight-stripping.
    const normalizedSummaries = [];
    for (const s of allSummaries) {
      const bn = s.bookingNumber != null ? String(s.bookingNumber) : null;
      if (!bn) continue;
      // Support both string dates and Wix Date objects
      const ciRaw = s.checkIn;
      const coRaw = s.checkOut;
      if (ciRaw == null || coRaw == null) continue;
      try {
        const dsCi = ds(ciRaw);
        const dsCo = ds(coRaw);
        if (isNaN(dsCi.getTime()) || isNaN(dsCo.getTime())) continue;
        normalizedSummaries.push({
          bn: bn,
          dsCi: dsCi,
          dsCo: dsCo,
          rawCi: ciRaw,
          rawCo: coRaw,
        });
      } catch (e) {
        continue;
      }
    }
    // ── end NEW ──

    const asBookings = [];
    for (const bk of allBookings) {
      if (bk.roomCode === 'adventure_suite') {
        asBookings.push({ bookingNumber: String(bk.bookingNumber), status: bk.status });
      }
    }

    const out = [];
    let asDebug = null;

    for (let r = 0; r < rooms.length; r++) {
      const rm = rooms[r];
      const code = rm.roomCode;
      const name = rm.name || code;
      const units = rm.units != null ? rm.units : ROOM_UNITS[code] || 1;
      const maxOcc = rm.maxOccupancy || 2;
      const baseOcc = rm.baseOccupancy || maxOcc;

      const minNights = rm.minNightsAllowed != null ? Number(rm.minNightsAllowed) : null;
      if (minNights != null && !isNaN(minNights) && rq < minNights) {
        continue;
      }

      const rBookings = [];
      for (let b = 0; b < allBookings.length; b++) {
        if (allBookings[b].roomCode === code) {
          rBookings.push(allBookings[b]);
        }
      }

      // ── NEW: build per-room summaryMap purely in-memory ──
      const summaryMap = {};
      for (const ns of normalizedSummaries) {
        summaryMap[ns.bn] = { checkIn: ns.rawCi, checkOut: ns.rawCo, dsCi: ns.dsCi, dsCo: ns.dsCo };
      }
      // ── end NEW ──

      const bpn = [];
      let night0Diag = [];
      for (let i = 0; i < nights.length; i++) {
        const nt = nights[i];
        const nx = ad(nt, 1);
        let count = 0;
        for (let b = 0; b < rBookings.length; b++) {
          const bk = rBookings[b];
          const bkStatus = (bk.status || '').toLowerCase().trim();
          if (bkStatus === 'cancelled' || bkStatus === 'canceled') { continue; }

          const ns = summaryMap[String(bk.bookingNumber)];
          const hasDates = !!(ns && ns.dsCi && ns.dsCo);

          if (code === 'adventure_suite' && i === 0) {
            night0Diag.push({
              bkNum: String(bk.bookingNumber),
              status: bkStatus,
              hasDates: hasDates,
              dsCI: hasDates ? ns.dsCi.toISOString() : null,
              dsCO: hasDates ? ns.dsCo.toISOString() : null,
              nt: nt.toISOString(),
              nx: nx.toISOString(),
              overlap: hasDates ? (ns.dsCi < nx && ns.dsCo > nt) : null,
            });
          }

          if (hasDates) {
            if (ns.dsCi < nx && ns.dsCo > nt) {
              count += 1;
            }
          }
        }
        bpn.push(count);
      }

      if (code === 'adventure_suite') {
        asDebug = {
          requestDates: { checkIn: ci.toISOString(), checkOut: co.toISOString() },
          allAsBookings: asBookings,
          night0Diagnosis: night0Diag,
          bpn: bpn,
          units: units,
          maxBooked: Math.max(...bpn),
        };
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
      _ver: 'cancel-only-v2-diag4',
      _debug: asDebug,
    };
  }
);
