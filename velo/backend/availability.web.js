1|/*
2| * Wanderlust Booking Engine — Velo backend: availability, booking, blocking, and invoice generation.
3| * File location in Wix Editor: backend/availability.web.js
4| *
5| * Uses Wix Data (wix-data) to query the Bookings collection. Mirrors the tested
6| * Python availability engine. The half-open interval rule is identical:
7| *   a booking occupies nights [checkIn, checkOut)
8| *   two bookings conflict iff  a.checkIn < b.checkOut && b.checkIn < a.checkOut
9| *   => same-day turnover (checkout == next checkin) is allowed.
10| *
11| * .web.js = Velo web module: these exported functions are callable from the
12| * frontend but EXECUTE ON THE SERVER, so guests cannot tamper with availability.
13| *
14| * Completely self-contained — no imports of custom backend modules.
15| * Only built-in Wix modules: wix-data, wix-web-module, wix-fetch, wix-secrets-backend.
16| */
17|
18|import wixData from 'wix-data';
19|import { Permissions, webMethod } from 'wix-web-module';
20|import { fetch } from 'wix-fetch';
21|import { getSecret } from 'wix-secrets-backend';
22|import { getAllSettings } from 'backend/settings.web';
23|
24|const BOOKINGS = 'Bookings';
25|const BOOKING_SUMMARIES = 'BookingSummary';
26|const INVOICE_SERVICE_URL_KEY = 'WBE_INVOICE_SERVICE_URL';
27|const SHARED_SECRET_KEY = 'WBE_SHARED_SECRET';
28|
29|/* ---------- room config (inlined from wbeConfig.js) ---------- */
30|const ROOM_UNITS = {
31|  adventure_suite: 3,
32|  penthouse_apartment: 1,
33|  two_bedroom_apartment: 1,
34|};
35|
36|const ROOM_MAX_OCCUPANCY = {
37|  adventure_suite: 2,
38|  penthouse_apartment: 2,
39|  two_bedroom_apartment: 4,
40|};
41|
42|const ROOM_MIN_OCCUPANCY = {
43|  adventure_suite: 2,
44|  penthouse_apartment: 2,
45|  two_bedroom_apartment: 3,
46|};
47|
48|const ROOM_DISPLAY_NAMES = {
49|  adventure_suite: 'Adventure Suite',
50|  penthouse_apartment: 'Penthouse Apartment',
51|  two_bedroom_apartment: 'Two Bedroom Apartment',
52|};
53|
54|function getRoomDisplayName(roomCode) {
55|  return ROOM_DISPLAY_NAMES[roomCode] || (roomCode || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
56|}
57|
58|/* ---------- helpers ---------- */
59|async function getNextBookingNumber() {
60|  const PREFIX = 'WBE-INV-';
61|  const PAD = 4;
62|  let maxNum = 0;
63|  let page = await wixData.query(BOOKINGS)
64|    .limit(1000)
65|    .find();
66|  while (page.items.length) {
67|    for (const item of page.items) {
68|      const bn = item.bookingNumber;
69|      if (bn) {
70|        const m = String(bn).match(/(\d+)$/);
71|        if (m) {
72|          const n = parseInt(m[1], 10);
73|          if (n > maxNum) maxNum = n;
74|        }
75|      }
76|    }
77|    if (page.hasNext()) {
78|      page = await page.next();
79|    } else {
80|      break;
81|    }
82|  }
83|  let candidate = maxNum + 1;
84|  let attempts = 0;
85|  while (attempts < 5) {
86|    const numStr = PREFIX + String(candidate).padStart(PAD, '0');
87|    const exist = await wixData.query(BOOKINGS)
88|      .eq('bookingNumber', numStr)
89|      .limit(1)
90|      .find();
91|    if (exist.items.length === 0) {
92|      return numStr;
93|    }
94|    candidate++;
95|    attempts++;
96|  }
97|  throw new Error('Failed to generate unique booking number');
98|}
99|
100|function nightsBetween(checkIn, checkOut) {
101|  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
102|  return Math.round(ms / (1000 * 60 * 60 * 24));
103|}
104|
105|function capitaliseWords(s) {
106|  return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
107|}
108|
109|function snakeCaseKeys(obj) {
110|  if (Array.isArray(obj)) return obj.map(snakeCaseKeys);
111|  if (obj && typeof obj === 'object') {
112|    const out = {};
113|    for (const [k, v] of Object.entries(obj)) {
114|      const sk = k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
115|      out[sk] = snakeCaseKeys(v);
116|    }
117|    return out;
118|  }
119|  return obj;
120|}
121|
122|/* ---------- invoice service call (inlined from issueInvoice.web.js) ---------- */
123|async function callIssueInvoice(guest, quoteBreakdown, dates, sendEmail, invoiceNumber) {
124|  const serviceUrl = await getSecret(INVOICE_SERVICE_URL_KEY);
125|  const secret = await getSecret(SHARED_SECRET_KEY);
126|  if (!serviceUrl || !secret) {
127|    throw new Error('Invoice service not configured. Set WBE_INVOICE_SERVICE_URL and WBE_SHARED_SECRET in Secrets Manager.');
128|  }
129|
130|  const body = {
131|    guest: guest,
132|    quote_breakdown: snakeCaseKeys(quoteBreakdown),
133|    issue_date: new Date().toISOString().slice(0, 10),
134|    check_in: dates.checkIn,
135|    check_out: dates.checkOut,
136|    room_code: Array.isArray(dates.roomCode) ? dates.roomCode.join(', ') : dates.roomCode,
137|    send_email: sendEmail,
138|  };
139|  if (invoiceNumber) {
140|    body.invoice_number = invoiceNumber;
141|  }
142|
143|  const res = await fetch(serviceUrl + '/issue-invoice', {
144|    method: 'post',
145|    headers: {
146|      'Content-Type': 'application/json',
147|      'X-WBE-Secret': secret,
148|    },
149|    body: JSON.stringify(body),
150|  });
151|
152|  if (!res.ok) {
153|    const text = await res.text();
154|    throw new Error('Invoice service error ' + res.status + ': ' + text);
155|  }
156|
157|  return res.json();
158|}
159|
160|/* ---------- quote breakdown (inlined from invoice.web.js) ---------- */
161|function buildQuoteBreakdown(booking) {
162|  const nights = nightsBetween(booking.checkIn, booking.checkOut);
163|  const roomTotal = booking.roomTotal || 0;
164|  const propertyFee = booking.propertyFee || 0;
165|  const accommodationShare = 0.5;
166|  const taxRateAccommodation = 0.10;
167|  const taxRateStandard = 0.15;
168|
169|  const accNet = roomTotal * accommodationShare;
170|  const advNet = roomTotal * (1 - accommodationShare);
171|  const accVat = accNet * taxRateAccommodation;
172|  const pkgVat = advNet * taxRateStandard;
173|
174|  const accUnitPrice = nights > 0 ? accNet / nights : 0;
175|  const advUnitPrice = nights > 0 ? advNet / nights : 0;
176|
177|  const displayName = getRoomDisplayName(booking.roomCode);
178|
179|  return {
180|    line_items: [
181|      {
182|        label: displayName + ' — Accommodation',
183|        tax_class: 'accommodation',
184|        quantity: nights,
185|        unit_price: accUnitPrice,
186|        net: accNet,
187|        vat_rate: taxRateAccommodation,
188|        vat: accVat,
189|        gross: accNet + accVat
190|      },
191|      {
192|        label: displayName + ' — Activities & Services',
193|        tax_class: 'standard',
194|        quantity: nights,
195|        unit_price: advUnitPrice,
196|        net: advNet,
197|        vat_rate: taxRateStandard,
198|        vat: pkgVat,
199|        gross: advNet + pkgVat
200|      }
201|    ],
202|    subtotal_net: roomTotal,
203|    total_vat: Math.round((accVat + pkgVat + Number.EPSILON) * 100) / 100,
204|    total: roomTotal + propertyFee + accVat + pkgVat,
205|    property_fee_rate: roomTotal > 0 ? propertyFee / roomTotal : 0,
206|    property_fee: propertyFee,
207|    currency: 'USD'
208|  };
209|}
210|
211|async function generateAndStoreInvoice(bookingId) {
213|
214|  const booking = await wixData.get(BOOKINGS, bookingId);
215|  if (!booking) throw new Error('Booking ' + bookingId + ' not found');
216|
217|  const quoteBreakdown = buildQuoteBreakdown(booking);
219|
220|  const guest = {
221|    name: booking.guestName || '',
222|    email: booking.guestEmail || '',
223|    phone: booking.guestPhone || ''
224|  };
225|  const dates = {
226|    checkIn: booking.checkIn.toISOString().slice(0, 10),
227|    checkOut: booking.checkOut.toISOString().slice(0, 10),
228|    roomCode: booking.roomCode || ''
229|  };
230|
231|  let result;
232|  try {
233|    result = await callIssueInvoice(guest, quoteBreakdown, dates, true, '');
235|  } catch (e) {
237|    throw new Error('Invoice generation failed: ' + e.message);
238|  }
239|
240|  // Store invoice number in bookingNumber field (minimal update pattern)
241|  const updateObj = {
242|    _id: booking._id,
243|    bookingNumber: result.invoice_number
244|  };
245|  try {
246|    await wixData.save(BOOKINGS, updateObj);
248|  } catch (err) {
250|  }
251|
252|  return {
253|    bookingNumber: result.invoice_number,
254|    total: result.total,
255|    emailed: result.emailed || false
256|  };
257|}
258|
259|/* ---------- availability helpers ---------- */
260|async function updateBookingSummary(bookingNumber, checkInArg, checkOutArg, optGuest) {
261|  if (!bookingNumber) {
263|    return;
264|  }
266|
267|  try {
268|    // Try to read existing summary first (for dates during cancel, invoice, etc.)
269|    let checkIn = checkInArg || null;
270|    let checkOut = checkOutArg || null;
271|
272|    if (!checkIn || !checkOut) {
273|      const existingSummaryRes = await wixData.query(BOOKING_SUMMARIES)
274|        .eq('bookingNumber', bookingNumber)
275|        .limit(1)
276|        .find();
277|      if (existingSummaryRes.items.length > 0) {
278|        const es = existingSummaryRes.items[0];
279|        if (!checkIn && es.checkIn) checkIn = es.checkIn;
280|        if (!checkOut && es.checkOut) checkOut = es.checkOut;
281|      }
282|    }
283|
284|    const res = await wixData.query(BOOKINGS)
285|      .eq('bookingNumber', bookingNumber)
286|      .limit(1000)
287|      .find();
288|
290|
291|    if (res.items.length === 0) {
293|      return;
294|    }
295|
296|    let totalRoomTotal = 0;
297|    let totalAccommodationVat = 0;
298|    let totalPackageVat = 0;
299|    let totalPropertyFee = 0;
300|    let guestName = optGuest && optGuest.guestName ? optGuest.guestName : '';
301|    let guestEmail = optGuest && optGuest.guestEmail ? optGuest.guestEmail : '';
302|    let guestPhone = optGuest && optGuest.guestPhone ? optGuest.guestPhone : '';
303|    let roomCount = 0;
304|    let status = '';
305|
306|    for (const row of res.items) {
307|      totalRoomTotal += (row.roomTotal || 0);
308|      totalAccommodationVat += (row.accomodationVat || 0);
309|      totalPackageVat += (row.packageVat || 0);
310|      totalPropertyFee += (row.propertyFee || 0);
311|      roomCount++;
312|
313|      if (!status && row.status) status = row.status;
314|    }
315|
316|    const summary = {
317|      bookingNumber,
318|      checkIn,
319|      checkOut,
320|      guestName,
321|      guestEmail,
322|      guestPhone,
323|      roomCount,
324|      roomTotal: Math.round((totalRoomTotal + Number.EPSILON) * 100) / 100,
325|      accommodationVat: Math.round((totalAccommodationVat + Number.EPSILON) * 100) / 100,
326|      packageVat: Math.round((totalPackageVat + Number.EPSILON) * 100) / 100,
327|      propertyFee: Math.round((totalPropertyFee + Number.EPSILON) * 100) / 100,
328|      grandTotal: Math.round((totalRoomTotal + totalAccommodationVat + totalPackageVat + totalPropertyFee + Number.EPSILON) * 100) / 100,
329|      status: status || 'confirmed'
330|    };
331|
333|
334|    const existing = await wixData.query(BOOKING_SUMMARIES)
335|      .eq('bookingNumber', bookingNumber)
336|      .limit(1)
337|      .find();
338|
339|    if (existing.items.length > 0) {
340|      summary._id = existing.items[0]._id;
341|      // Preserve existing bookingDate when updating so the original creation date stays
342|      summary.bookingDate = existing.items[0].bookingDate || new Date();
344|      await wixData.update(BOOKING_SUMMARIES, summary);
346|    } else {
347|      summary.bookingDate = new Date();
349|      await wixData.insert(BOOKING_SUMMARIES, summary);
351|    }
352|  } catch (e) {
354|    throw e; // re-throw so caller can log it too
355|  }
356|}
357|async function overlappingCount(roomCode, checkIn, checkOut) {
358|  let total = 0;
359|  const seenIds = [];
360|
361|  // Primary: join via BookingSummary (new canonical path)
362|  const summaryRes = await wixData.query(BOOKING_SUMMARIES)
363|    .lt('checkIn', new Date(checkOut))
364|    .gt('checkOut', new Date(checkIn))
365|    .limit(1000)
366|    .find();
367|
368|  const overlapNumbers = [];
369|  for (const s of summaryRes.items) {
370|    if (s.bookingNumber && overlapNumbers.indexOf(String(s.bookingNumber)) === -1) {
371|      overlapNumbers.push(String(s.bookingNumber));
372|    }
373|  }
374|
375|  if (overlapNumbers.length > 0) {
376|    const res = await wixData.query(BOOKINGS)
377|      .eq('roomCode', roomCode)
378|      .hasSome('status', ['confirmed', 'hold', 'blocked'])
379|      .hasSome('bookingNumber', overlapNumbers)
380|      .limit(1000)
381|      .find();
382|    for (const row of res.items) {
383|      total += (row.quantity || 1);
384|      if (row._id) seenIds.push(row._id);
385|    }
386|  }
387|
388|  return total;
389|}
390|
391|async function overlappingRows(roomCode, checkIn, checkOut) {
392|  const rows = [];
393|  const seenIds = [];
394|  const summaryDateMap = {}; // bookingNumber -> {checkIn, checkOut}
395|
396|  // Primary: join via BookingSummary
397|  const summaryRes = await wixData.query(BOOKING_SUMMARIES)
398|    .lt('checkIn', new Date(checkOut))
399|    .gt('checkOut', new Date(checkIn))
400|    .limit(1000)
401|    .find();
402|
403|  const overlapNumbers = [];
404|  for (const s of summaryRes.items) {
405|    if (s.bookingNumber) {
406|      const num = String(s.bookingNumber);
407|      if (overlapNumbers.indexOf(num) === -1) {
408|        overlapNumbers.push(num);
409|        if (s.checkIn && s.checkOut) {
410|          summaryDateMap[num] = { checkIn: s.checkIn, checkOut: s.checkOut };
411|        }
412|      }
413|    }
414|  }
415|
416|  if (overlapNumbers.length > 0) {
417|    const res = await wixData.query(BOOKINGS)
418|      .eq('roomCode', roomCode)
419|      .hasSome('status', ['confirmed', 'hold', 'blocked'])
420|      .hasSome('bookingNumber', overlapNumbers)
421|      .limit(1000)
422|      .find();
423|    for (const row of res.items) {
424|      if (!row.checkIn && summaryDateMap[String(row.bookingNumber)]) {
425|        row.checkIn = summaryDateMap[String(row.bookingNumber)].checkIn;
426|        row.checkOut = summaryDateMap[String(row.bookingNumber)].checkOut;
427|      }
428|      rows.push(row);
429|      if (row._id) seenIds.push(row._id);
430|    }
431|  }
432|
433|  return rows;
434|}
435|
436|/* ---------- exported methods ---------- */
437|export const isAvailable = webMethod(
438|  Permissions.Anyone,
439|  async (roomCode, checkIn, checkOut) => {
440|    if (!(roomCode in ROOM_UNITS)) {
441|      throw new Error('Unknown room type \'' + roomCode + '\'');
442|    }
443|    if (nightsBetween(checkIn, checkOut) <= 0) {
444|      throw new Error('checkOut must be after checkIn');
445|    }
446|    const booked = await overlappingCount(roomCode, checkIn, checkOut);
447|    return booked < ROOM_UNITS[roomCode];
448|  }
449|);
450|
451|export const unitsAvailable = webMethod(
452|  Permissions.Anyone,
453|  async (roomCode, checkIn, checkOut) => {
454|    if (!(roomCode in ROOM_UNITS)) throw new Error('Unknown room type \'' + roomCode + '\'');
455|    const booked = await overlappingCount(roomCode, checkIn, checkOut);
456|    return Math.max(0, ROOM_UNITS[roomCode] - booked);
457|  }
458|);
459|
460|export const createBooking = webMethod(
461|  Permissions.Anyone,
462|  async (booking) => {
464|    const roomCode = booking.roomCode;
465|    const checkIn = booking.checkIn;
466|    const checkOut = booking.checkOut;
467|    const guests = booking.guests || 1;
468|    const guestName = booking.guestName;
469|    const guestEmail = booking.guestEmail;
470|    const guestPhone = booking.guestPhone;
471|    const roomTotal = booking.roomTotal;
472|    const accomodationVat = booking.accomodationVat;
473|    const packageVat = booking.packageVat;
474|    const propertyFee = booking.propertyFee;
475|    const grandTotal = booking.grandTotal;
476|    const note = booking.note;
477|    let saveNote = note;
478|    const bookingNumber = booking.bookingNumber;
479|
481|    const roomDisplay = getRoomDisplayName(roomCode);
482|    if (!(roomCode in ROOM_UNITS)) throw new Error('Unknown room type \'' + roomDisplay + '\'');
483|    if (nightsBetween(checkIn, checkOut) <= 0) throw new Error('checkOut must be after checkIn');
484|    if (guests < ROOM_MIN_OCCUPANCY[roomCode]) {
485|      throw new Error(roomDisplay + ' requires at least ' + ROOM_MIN_OCCUPANCY[roomCode] + ' guests (no single-guest bookings); requested ' + guests);
486|    }
487|    if (guests > ROOM_MAX_OCCUPANCY[roomCode]) {
488|      throw new Error(roomDisplay + ' sleeps ' + ROOM_MAX_OCCUPANCY[roomCode] + '; requested ' + guests);
489|    }
490|
491|    const available = await isAvailable(roomCode, checkIn, checkOut);
492|    if (!available) {
493|      throw new Error('No ' + roomDisplay + ' available for ' + checkIn + ' to ' + checkOut);
494|    }
495|
496|    // Generate booking number if not provided
497|    let invoiceNumber = bookingNumber || '';
498|    if (!invoiceNumber) {
499|      try {
500|        invoiceNumber = await getNextBookingNumber();
501|