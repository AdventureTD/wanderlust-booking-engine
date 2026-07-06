1|import wixLocation from 'wix-location';
2|import wixData from 'wix-data';
3|import { getAllSettings } from 'backend/settings';
4|import { getRoomNames } from 'backend/rooms';
5|import { getPackageAmenities } from 'backend/packages';
6|import { createBooking, issueBookingInvoice } from 'backend/availability';
7|function fmtCurrency(n) { return Number(n || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
8|
9|const ROOM_DISPLAY_NAMES = {
10|  adventure_suite: 'Adventure Suite',
11|  penthouse_apartment: 'Penthouse Apartment',
12|  two_bedroom_apartment: 'Two Bedroom Apartment',
13|};
14|function getRoomDisplayName(roomCode) {
15|  return ROOM_DISPLAY_NAMES[roomCode] || (roomCode || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
16|}
17|
18|function getParam(name) {
19|  const q = wixLocation.query || {};
20|  return q[name] || null;
21|}
22|
23|function parseDateStr(s) {
24|  if (!s) return null;
25|  const p = s.match(/(\d{4})-(\d{2})-(\d{2})/);
26|  if (p) {
27|    const d = new Date(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10));
28|    return isNaN(d.getTime()) ? null : d;
29|  }
30|  const d = new Date(s);
31|  return isNaN(d.getTime()) ? null : d;
32|}
33|
34|function fmtDate(d) {
35|  if (!d) return '';
36|  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
37|}
38|
39|/* nightsFromDisplay — parse checkInDisplay / checkOutDisplay text ("M/D/YYYY")
40|   and return the number of nights.  Used to look up package title by stay length. */
41|function nightsFromDisplay(ciText, coText) {
42|  if (!ciText || !coText) return 0;
43|  try {
44|    const d1 = new Date(ciText);
45|    const d2 = new Date(coText);
46|    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
47|    const ms = d2 - d1;
48|    const days = Math.round(ms / 86400000);
49|    return days > 0 ? days : 0;
50|  } catch (e) { return 0; }
51|}
52|
53|function safeText(id, txt) {
54|  try {
55|    const el = $w('#' + id);
56|    if (typeof el.expand === 'function') el.expand();
57|    if (typeof el.show   === 'function') el.show();
58|    el.text = txt;
59|  } catch (e) {}
60|}
61|function safeCollapse(id) {
62|  try {
63|    const el = $w('#' + id);
64|    if (typeof el.collapse === 'function') el.collapse();
65|    if (typeof el.hide    === 'function') el.hide();
66|  } catch (e) {}
67|}
68|function safeExpand(id) {
69|  try {
70|    const el = $w('#' + id);
71|    if (typeof el.expand === 'function') el.expand();
72|    if (typeof el.show   === 'function') el.show();
73|  } catch (e) {}
74|}
75|function safeVal(id) { try { return $w('#' + id).value || ''; } catch (e) { return ''; } }
76|function safeTextRead(id) { try { return $w('#' + id).text || ''; } catch (e) { return ''; } }
77|function safeDisable(id, v) {
78|  try {
79|    const el = $w('#' + id);
80|    if (v && typeof el.disable === 'function') el.disable();
81|    if (!v && typeof el.enable === 'function') el.enable();
82|  } catch (e) {}
83|}
84|
85|function isPreviewMode() {
86|  try { const q = wixLocation.query || {}; return !!q.editorSessionId || !!q.isEditor; } catch (e) { return false; }
87|}
88|
89|function safeItem($item, selector, action, val) {
90|  try {
91|    const el = $item(selector);
92|    if (action === 'text') el.text = val;
93|    if (action === 'collapse') el.collapse();
94|    if (action === 'expand') el.expand();
95|    if (action === 'options') el.options = val;
96|    if (action === 'value') el.value = val;
97|    return el;
98|  } catch (e) { return null; }
99|}
100|
101|let _guestCounts = {};
102|let _summaryRooms = [];
103|let _summaryNights = 7;
104|let _summaryCis = '';
105|let _summaryCos = '';
106|let _summarySettings = {};
107|let _roomRepReady = false;
108|let _renderCount = 0;
109|let _roomNames = {};
110|
111|$w.onReady(function () {
113|});
114|
115|async function initSummary() {
116|  let rcParam = getParam('rc');
117|  let cis = getParam('ci');
118|  let cos = getParam('co');
119|  let guestsParam = getParam('guests');
120|
121|  // Single-room detail-page redirect fallback (roomCode, checkIn, checkOut, guests)
122|  const roomParam = getParam('roomCode');
123|  if (!rcParam && roomParam) {
124|    rcParam = roomParam + ':1:0';
125|    cis = cis || getParam('checkIn') || '';
126|    cos = cos || getParam('checkOut') || '';
127|  }
128|
129|  if (!rcParam) {
130|    try {
131|      rcParam = sessionStorage.getItem('_wbe_rc') || localStorage.getItem('_wbe_rc');
132|      cis = cis || sessionStorage.getItem('_wbe_ci') || localStorage.getItem('_wbe_ci');
133|      cos = cos || sessionStorage.getItem('_wbe_co') || localStorage.getItem('_wbe_co');
134|    } catch (e) {}
135|  }
136|
137|  if (!rcParam && isPreviewMode()) {
138|    rcParam = 'adventure_suite:2:792,two_bedroom_apartment:3:1188';
139|    cis = '2026-06-07';
140|    cos = '2026-06-12';
141|  }
142|
143|  const ciDate = parseDateStr(cis), coDate = parseDateStr(cos);
144|  const oneDay = 86400000;
145|  const nights = ciDate && coDate ? Math.round((coDate - ciDate) / oneDay) : 7;
146|
147|  safeText('checkInDisplay', fmtDate(ciDate) || '-');
148|  safeText('checkOutDisplay', fmtDate(coDate) || '-');
149|
150|  const rooms = [];
151|  if (rcParam) {
152|    const parts = rcParam.split(',');
153|    for (let i = 0; i < parts.length; i++) {
154|      const s = parts[i].split(':');
155|      if (s.length >= 3) rooms.push({ roomCode: s[0], qty: parseInt(s[1], 10) || 1, baseRate: parseInt(s[2], 10) || 0 });
156|      else if (s.length === 2) rooms.push({ roomCode: s[0], qty: parseInt(s[1], 10) || 1, baseRate: 0 });
157|      else if (parts[i]) rooms.push({ roomCode: parts[i], qty: 1, baseRate: 0 });
158|    }
159|  }
160|
161|  let settings = {};
162|  let roomNames = {};
163|  try { settings = await getAllSettings(); } catch (e) {}
164|  try { roomNames = await getRoomNames(); } catch (e) {}
165|
166|  _summaryRooms = rooms;
167|  _summaryNights = nights;
168|  _summaryCis = cis;
169|  _summaryCos = cos;
170|  _summarySettings = settings;
171|  _roomNames = roomNames;
172|  _guestCounts = {};
173|
174|  initRoomRepeater();
175|  await renderSummary();
176|  wireContinueButton();
177|}
178|
179|async function renderSummary() {
180|  _renderCount++;
181|  const rooms = _summaryRooms;
182|  const nights = _summaryNights;
183|
184|  if (rooms.length === 0) {
185|    safeText('accommodationNamesText', 'No rooms selected.');
186|    safeText('packageSubTotal', '$' + fmtCurrency(0));
187|    safeCollapse('summaryRoomsRepeater');
188|    safeText('subtotalNetText', '$' + fmtCurrency(0));
189|    safeText('vatAccommodationText', '$' + fmtCurrency(0));
190|    safeText('vatAdventureText', '$' + fmtCurrency(0));
191|    safeText('vatAcc', '$' + fmtCurrency(0));
192|    safeText('vatSer', '$' + fmtCurrency(0));
193|    safeText('totalVatText', '$' + fmtCurrency(0));
194|    safeText('propertyFeeText', '$' + fmtCurrency(0));
195|    safeText('grandTotalText', '$' + fmtCurrency(0));
196|    return;
197|  }
198|
199|  const settings = _summarySettings;
200|  const propertyFeeRate = parseFloat(settings.propertyFeeRate) || 0.05;
201|  const accommodationShare = parseFloat(settings.accommodationShare) || 0.5;
202|  const taxRateAccommodation = parseFloat(settings.taxRate_accommodation) || 0.10;
203|  const taxRateAdventure = parseFloat(settings.taxRate_standard) || 0.15;
204|
205|  const names = [], repData = [];
206|  let subtotalNet = 0, propertyFee = 0;
207|
208|  for (let i = 0; i < rooms.length; i++) {
209|    const r = rooms[i];
210|    const displayName = _roomNames[r.roomCode] && _roomNames[r.roomCode] !== r.roomCode ? _roomNames[r.roomCode] : getRoomDisplayName(r.roomCode);
211|    names.push(displayName + ' x' + r.qty);
212|    const rate = r.baseRate || (r.roomCode === 'adventure_suite' ? 792 : r.roomCode === 'penthouse_apartment' ? 930 : r.roomCode === 'two_bedroom_apartment' ? 1188 : 0);
213|    const roomTotal = rate * r.qty * nights;
214|    subtotalNet += roomTotal;
215|    propertyFee += roomTotal * propertyFeeRate;
216|
217|    const accNet = roomTotal * accommodationShare;
218|    const advNet = roomTotal * (1 - accommodationShare);
219|    r.roomTotal = roomTotal;
220|    r.accomodationVat = accNet * taxRateAccommodation;
221|    r.packageVat = advNet * taxRateAdventure;
222|    r.propertyFee = roomTotal * propertyFeeRate;
223|
224|    repData.push({ _id: 'sum_' + i + '_' + _renderCount, roomCode: r.roomCode, roomName: displayName, qty: r.qty, baseRate: rate, roomTotal: roomTotal });
225|  }
226|
227|  const accNet = subtotalNet * accommodationShare;
228|  const advNet = subtotalNet * (1 - accommodationShare);
229|  const vatAccommodation = accNet * taxRateAccommodation;
230|  const vatAdventure = advNet * taxRateAdventure;
231|  const totalVat = vatAccommodation + vatAdventure;
232|  const grandTotal = subtotalNet + propertyFee + totalVat;
233|
234|  safeText('accommodationNamesText', names.join(', '));
235|  safeText('packageSubTotal', '$' + fmtCurrency(subtotalNet));
236|  safeText('subtotalNetText', '$' + fmtCurrency(subtotalNet));
237|  safeText('vatAccommodationText', '$' + fmtCurrency(vatAccommodation));
238|  safeText('vatAdventureText', '$' + fmtCurrency(vatAdventure));
239|  safeText('vatAcc', '$' + fmtCurrency(accNet));
240|  safeText('vatSer', '$' + fmtCurrency(advNet));
241|  safeText('totalVatText', '$' + fmtCurrency(totalVat));
242|  safeText('propertyFeeText', '$' + fmtCurrency(propertyFee));
243|  safeText('grandTotalText', '$' + fmtCurrency(grandTotal));
244|
245|  // Update totalNightsDisplay with calculated nights
246|  if (nights > 0) {
247|    safeText('totalNightsDisplay', String(nights) + ' night' + (nights !== 1 ? 's' : ''));
248|  }
249|
250|  // packageName: look up title from Packages by nights.
251|  let pkgTitle = '';
252|  try {
253|    const ciText = safeTextRead('checkInDisplay');
254|    const coText = safeTextRead('checkOutDisplay');
255|    const nts = nightsFromDisplay(ciText, coText) || _summaryNights || 0;
256|
257|    if (nts > 0) {
258|      try {
259|        const beResult = await getPackageAmenities(nts);
260|        if (beResult && beResult.title) pkgTitle = beResult.title;
261|      } catch (beErr) {}
262|
263|      if (!pkgTitle) {
264|        try {
265|          const res = await wixData.query('Packages').limit(100).find();
266|          for (let i = 0; i < res.items.length; i++) {
267|            const item = res.items[i];
268|            const itemNights = item.numberOfNights || item.NumberOfNights || item.numberofnights || 0;
269|            if (Number(itemNights) === Number(nts)) {
270|              pkgTitle = item.title_fld || item.title || item.Title || item.name || item.Name || '';
271|              break;
272|            }
273|          }
274|        } catch (qErr) {}
275|      }
276|    }
277|
278|    // Single debug log to diagnose the exact state
280|
281|    if (pkgTitle) {
282|      safeExpand('box1');
283|      safeExpand('packageName');
284|      safeText('packageName', pkgTitle);
286|    } else {
287|      safeCollapse('packageName');
289|    }
290|  } catch (e) {
291|    safeCollapse('packageName');
293|  }
294|
295|  renderRoomRepeater(repData);
296|}
297|
298|function initRoomRepeater() {
299|  if (_roomRepReady) return;
300|  let rep;
301|  try { rep = $w('#summaryRoomsRepeater'); } catch (e) { rep = null; }
302|  if (!rep) return;
303|  if (typeof rep.onItemReady !== 'function') return;
304|  _roomRepReady = true;
305|
306|  rep.onItemReady(($item, itemData) => {
307|    safeItem($item, '#roomNameText', 'text', itemData.roomName || itemData.roomCode || '');
308|    safeItem($item, '#qtyRooms', 'text', String(itemData.qty || 1));
309|    safeItem($item, '#roomPriceText', 'text', '$' + (itemData.baseRate || 0) + ' / night (' + _summaryNights + ' nights)');
310|
311|    const dd = safeItem($item, '#guestsDropdown', null, null);
312|    if (dd && typeof dd.onChange === 'function') {
313|      const rc = itemData.roomCode;
314|      let opts = [];
315|      if (rc === 'two_bedroom_apartment') {
316|        opts = [{ label: '3', value: '3' }, { label: '4', value: '4' }];
317|      } else {
318|        opts = [{ label: '2', value: '2' }];
319|      }
320|      dd.options = opts;
321|      const defaultVal = rc === 'two_bedroom_apartment' ? '3' : '2';
322|      try { dd.required = false; } catch (e) {}
323|      setTimeout(() => {
324|        dd.value = defaultVal;
325|        try { dd.valid = true; } catch (e) {}
326|        try { dd.resetValidityIndication(); } catch (e) {}
327|        _guestCounts[rc] = parseInt(defaultVal, 10);
328|      }, 300);
329|      dd.onChange(function (ev) { _guestCounts[rc] = parseInt(ev.target.value, 10) || parseInt(defaultVal, 10); });
330|    }
331|
332|    safeItem($item, '#roomTotalText', 'text', '$' + fmtCurrency(itemData.roomTotal || 0));
333|    const rmBtn = safeItem($item, '#removeBtn', null, null);
334|    if (rmBtn && typeof rmBtn.onClick === 'function') {
335|      rmBtn.onClick(() => {
336|        _summaryRooms = _summaryRooms.filter(r => r.roomCode !== itemData.roomCode);
337|        delete _guestCounts[itemData.roomCode];
338|        renderSummary();
339|      });
340|    }
341|  });
342|}
343|
344|function renderRoomRepeater(repData) {
345|  const rep = (function () { try { return $w('#summaryRoomsRepeater'); } catch (e) { return null; } })();
346|  if (!rep) return;
347|  rep.data = [];
348|  rep.data = repData;
349|  safeExpand('summaryRoomsRepeater');
350|}
351|
352|function wireContinueButton() {
353|  let btn;
354|  try { btn = $w('#btnContinue'); } catch (e) { return; }
355|  if (!btn || typeof btn.onClick !== 'function') return;
356|  if (typeof btn.link === 'string') btn.link = '';
357|
358|  btn.onClick(async function () {
359|    const name = safeVal('inputGuestName').trim();
360|    const email = safeVal('inputGuestEmail').trim();
361|    const phone = safeVal('inputGuestPhone').trim();
362|
363|    if (!name) { safeText('bookingStatus', 'Please enter your full name.'); return; }
364|    if (!email || email.indexOf('@') < 0) { safeText('bookingStatus', 'Please enter a valid email address.'); return; }
365|
366|    safeText('bookingStatus', 'Processing your booking...');
367|    safeDisable('btnContinue', true);
368|
369|    const rooms = _summaryRooms || [];
370|    const ci = _summaryCis;
371|    const bookings = [], errors = [];
372|    let sharedBookingNumber = '';
373|
374|    try {
375|      // Phase 1: book first room to get shared booking number
376|      if (rooms.length > 0) {
377|        const r0 = rooms[0];
378|        const payload0 = {
379|          roomCode: r0.roomCode,
380|          checkIn: ci,
381|          checkOut: _summaryCos,
382|          guests: _guestCounts[r0.roomCode] || r0.qty || 1,
383|          status: 'confirmed',
384|          guestName: name,
385|          guestEmail: email,
386|          guestPhone: phone,
387|          roomTotal: r0.roomTotal || 0,
388|          propertyFee: r0.propertyFee || 0,
389|          accomodationVat: r0.accomodationVat || 0,
390|          packageVat: r0.packageVat || 0,
391|          grandTotal: ((r0.roomTotal || 0) + (r0.accomodationVat || 0) + (r0.packageVat || 0) + (r0.propertyFee || 0)) || 0,
392|        };
393|        const b0 = await createBooking(payload0);
394|        bookings.push(b0);
395|        if (b0.bookingNumber) sharedBookingNumber = b0.bookingNumber;
396|      }
397|
398|      // Phase 2: book remaining rooms in parallel
399|      if (rooms.length > 1 && sharedBookingNumber) {
400|        const restPromises = [];
401|        for (let i = 1; i < rooms.length; i++) {
402|          const r = rooms[i];
403|          const payload = {
404|            roomCode: r.roomCode,
405|            checkIn: ci,
406|            checkOut: _summaryCos,
407|            guests: _guestCounts[r.roomCode] || r.qty || 1,
408|            status: 'confirmed',
409|            guestName: name,
410|            guestEmail: email,
411|            guestPhone: phone,
412|            roomTotal: r.roomTotal || 0,
413|            propertyFee: r.propertyFee || 0,
414|            accomodationVat: r.accomodationVat || 0,
415|            packageVat: r.packageVat || 0,
416|            grandTotal: ((r.roomTotal || 0) + (r.accomodationVat || 0) + (r.packageVat || 0) + (r.propertyFee || 0)) || 0,
417|            bookingNumber: sharedBookingNumber,
418|          };
419|          restPromises.push(
420|            createBooking(payload)
421|              .then(function (b) { return { ok: true, b: b }; })
422|              .catch(function (e) { return { ok: false, err: r.roomCode + ': ' + e.message }; })
423|          );
424|        }
425|        const restResults = await Promise.all(restPromises);
426|        for (let j = 0; j < restResults.length; j++) {
427|          const res = restResults[j];
428|          if (res.ok) {
429|            bookings.push(res.b);
430|          } else {
431|            errors.push(res.err);
432|          }
433|        }
434|      }
435|      if (errors.length > 0) {
436|        safeText('bookingStatus', 'Some rooms could not be booked: ' + errors.join('; '));
437|        safeDisable('btnContinue', false);
438|        return;
439|      }
440|
441|      if (sharedBookingNumber) {
442|        try {
443|          safeText('bookingStatus', 'Booking confirmed! Creating invoice...');
444|          const invResult = await issueBookingInvoice(sharedBookingNumber);
446|          // If calendar creation failed, log but still continue to redirect.
447|          if (invResult && invResult._calendar_debug && !invResult._calendar_debug.ok) {
449|          }
450|        } catch (e) {
452|        }
453|      }
454|
455|      safeText('bookingStatus', 'Booking confirmed! Taking you home...');
456|      wixLocation.to('https://www.wanderlustcaribbean.com');
457|    } catch (e) {
458|      safeText('bookingStatus', 'Booking error: ' + e.message);
459|      safeDisable('btnContinue', false);
460|    }
461|  });
462|}
463|
464|function getGuestCount(idx) {
465|  const rep = (function () { try { return $w('#summaryRoomsRepeater'); } catch (e) { return null; } })();
466|  if (!rep || !rep.data) return null;
467|  const item = rep.data[idx];
468|  if (!item) return null;
469|  return _guestCounts[item.roomCode] || item.qty || null;
470|}
471|