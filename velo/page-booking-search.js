1|import { getActiveMessages } from 'backend/messages';
2|import { searchAvailability, suggestAlternateDates } from 'backend/search';
3|import { getPackageAmenities, getPackageBaseRate, getPackageDetailsByNights, getPackagesByNights, packageExistsForNights } from 'backend/packages';
4|import { getRoomNames } from 'backend/rooms';
5|import { trackBeginBooking, captureClickIds, trackViewBookingSearch, trackRoomView, trackSearchNoResults, initTracking, setSuspendGoogleAds } from 'public/tracking';
6|import { getAllSettings } from 'backend/settings';
7|import wixLocation from 'wix-location';
8|import wixWindow from 'wix-window-frontend';
9|
10|let _selections = [];
11|let _roomFeeMap = {};
12|let _summaryNights = 0;
13|let _cachedBaseRate = 0;
14|let _availablePackages = [];
15|let _selectedPackage = null;
16|
17|function clearSelections(silent) {
18|  _selections = [];
19|  if (!silent) updateSelectionPanel();
20|}
21|
22|function setRoomSelection(roomCode, roomName, qty, numGuests, availableCheckIn, availableCheckOut, roomFee) {
23|  let next = [], found = false;
24|  for (let i = 0; i < _selections.length; i++) {
25|    if (_selections[i].roomCode === roomCode) {
26|      found = true;
27|      if (qty > 0) next.push({ roomCode, roomName, qty, numGuests, availableCheckIn, availableCheckOut, roomFee: roomFee || 0 });
28|    } else next.push(_selections[i]);
29|  }
30|  if (!found && qty > 0) next.push({ roomCode, roomName, qty, numGuests, availableCheckIn, availableCheckOut, roomFee: roomFee || 0 });
31|  _selections = next;
32|  updateSelectionPanel();
33|}
34|
35|function removeRoomSelection(roomCode) {
36|  const next = [];
37|  for (let i = 0; i < _selections.length; i++) {
38|    if (_selections[i].roomCode !== roomCode) next.push(_selections[i]);
39|  }
40|  _selections = next;
41|  updateSelectionPanel();
42|}
43|
44|function showElement(el, name) {
45|  if (!el) {
46|    console.log('>>> showElement skipped:', name, 'element not found');
47|    return false;
48|  }
49|  try {
50|    if (typeof el.show === 'function') { el.show(); }
51|    if (typeof el.expand === 'function') { el.expand(); }
52|    console.log('>>> showElement success:', name, 'collapsed:', el.collapsed, 'hidden:', el.hidden, 'visible:', el.visible);
53|    return true;
54|  } catch (e) {
55|    console.log('>>> showElement error:', name, e && e.message || e);
56|    return false;
57|  }
58|}
59|
60|function hideElement(el, name) {
61|  if (!el) return false;
62|  try {
63|    if (typeof el.hide === 'function') { el.hide(); }
64|    if (typeof el.collapse === 'function') { el.collapse(); }
65|    console.log('>>> hideElement success:', name);
66|    return true;
67|  } catch (e) {
68|    console.log('>>> hideElement error:', name, e && e.message || e);
69|    return false;
70|  }
71|}
72|function updateSelectionPanel() {
73|  const panel = tryFind('selectionPanel');
74|  const container = tryFind('selectedRoomsContainer');
75|  const btnSummary = tryFind('btnSummary');
76|  const box3 = tryFind('box3');
77|  const summaryContainer = tryFind('bookingSummaryContainer');
78|  const selection = tryFind('selection');
79|  const transSummary = tryFind('transSummary');
80|  const jpegBackground = tryFind('jpegBackground');
81|  console.log('>>> updateSelectionPanel elements:', {
82|    panel: !!panel,
83|    container: !!container,
84|    btnSummary: !!btnSummary,
85|    box3: !!box3,
86|    summaryContainer: !!summaryContainer,
87|    selection: !!selection,
88|    transSummary: !!transSummary,
89|    jpegBackground: !!jpegBackground,
90|    selections: _selections.length
91|  });
92|
93|  if (_selections.length === 0) {
94|    hideElement(panel, 'selectionPanel');
95|    if (container) { container.text = ''; }
96|    hideElement(container, 'selectedRoomsContainer');
97|    hideElement(btnSummary, 'btnSummary');
98|    hideElement(box3, 'box3');
99|    hideElement(summaryContainer, 'bookingSummaryContainer');
100|    hideElement(selection, 'selection');
101|    hideElement(transSummary, 'transSummary');
102|    hideElement(jpegBackground, 'jpegBackground');
103|    return;
104|  }
105|
106|  // Build text first, then expand parent, then show text.
107|  let total = 0, totalGuests = 0, lines = [];
108|  for (let i = 0; i < _selections.length; i++) {
109|    const s = _selections[i];
110|    const guests = (s.numGuests || 1) * s.qty;
111|    lines.push((s.roomName || s.roomCode) + ' (Qty: ' + s.qty + ', Guests: ' + guests + ')');
112|    total += s.qty;
113|    totalGuests += guests;
114|  }
115|
116|  if (container) {
117|    container.text = lines.join('\n');
118|    console.log('>>> selectedRoomsContainer text set:', JSON.stringify(container.text));
119|    console.log('>>> selectedRoomsContainer state:', {
120|      collapsed: container.collapsed,
121|      hidden: container.hidden,
122|      visible: container.visible,
123|      height: container.height,
124|      minHeight: container.minHeight,
125|      fitToContent: typeof container.fitToContent === 'function'
126|    });
127|  }
128|
129|  // Expand parent container(s) first so the text element can actually appear.
130|  showElement(box3, 'box3');
131|  showElement(summaryContainer, 'bookingSummaryContainer');
132|  showElement(selection, 'selection');
133|  showElement(transSummary, 'transSummary');
134|  console.log('>>> about to show jpegBackground, element found:', !!jpegBackground, 'src:', jpegBackground && typeof jpegBackground.src);
135|  try {
136|    if (jpegBackground && typeof jpegBackground.src === 'string') {
137|      jpegBackground.src = 'https://static.wixstatic.com/media/wanderlust-booking-engine/summary-background.jpg';
138|    }
139|  } catch (e) {
140|    console.log('>>> jpegBackground src error:', e && e.message || e);
141|  }
142|  showElement(jpegBackground, 'jpegBackground');
143|  showElement(panel, 'selectionPanel');
144|  showElement(container, 'selectedRoomsContainer');
145|  showElement(btnSummary, 'btnSummary');
146|
147|  // Update total guest count text in booking summary container.
148|  const numTotalGuestsEl = tryFind('numTotalGuests');
149|  if (numTotalGuestsEl) {
150|    numTotalGuestsEl.text = String(totalGuests);
151|  }
152|
153|  // Compute total Penthouse Apartment additional fee if selected.
154|  const hasPenthouseSelected = _selections.some((s) => s.roomCode === 'penthouse_apartment');
155|  const penthouseFeeEl = tryFind('penthouseFee');
156|  if (penthouseFeeEl) {
157|    let penthouseTotal = 0;
158|    if (hasPenthouseSelected) {
159|      for (let i = 0; i < _selections.length; i++) {
160|        const s = _selections[i];
161|        if (s.roomCode === 'penthouse_apartment') {
162|          penthouseTotal += (Number(s.roomFee) || 0) * s.qty;
163|        }
164|      }
165|    }
166|        if (_summaryNights > 0 && hasPenthouseSelected) {
167|      const totalPenthouseFee = penthouseTotal * _summaryNights;
168|      penthouseFeeEl.text = '$' + totalPenthouseFee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
169|      try { penthouseFeeEl.show(); } catch (e) {}
170|    } else {
171|      try { penthouseFeeEl.hide(); } catch (e) {}
172|    }
173|  }
174|
175|  // Show/hide Penthouse label text based on selection.
176|  const penthouseTextEl = tryFind('penthouseText');
177|  if (penthouseTextEl) {
178|    if (hasPenthouseSelected) {
179|      try { penthouseTextEl.show(); } catch (e) {}
180|    } else {
181|      try { penthouseTextEl.hide(); } catch (e) {}
182|    }
183|  }
184|
185|  // Calculate and display subTotalBooking: baseRate * nights * total guests.
186|  // Also compute finalTotal = subTotalBooking + penthouseFee.
187|  let finalTotal = 0;
188|  if (summaryContainer) {
189|    if (_selections.length > 0 && _summaryNights > 0 && _cachedBaseRate > 0) {
190|      const subTotal = _cachedBaseRate * _summaryNights * totalGuests;
191|      const subTotalEl = tryFind('subTotalBooking');
192|      if (subTotalEl) {
193|        subTotalEl.text = '$' + subTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
194|      }
195|
196|      const penthouseFeeEl = tryFind('penthouseFee');
197|      let penthouseFeeValue = 0;
198|      if (penthouseFeeEl && typeof penthouseFeeEl.text === 'string') {
199|        const cleaned = penthouseFeeEl.text.replace(/[^0-9.]/g, '');
200|        penthouseFeeValue = Number(cleaned) || 0;
201|      }
202|
203|      finalTotal = subTotal + penthouseFeeValue;
204|      const finalTotalEl = tryFind('finalTotal');
205|      if (finalTotalEl) {
206|        finalTotalEl.text = '$' + finalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
207|      }
208|
209|      if (typeof summaryContainer.show === 'function') { try { summaryContainer.show(); } catch (e) {} }
210|      if (typeof summaryContainer.expand === 'function') { try { summaryContainer.expand(); } catch (e) {} }
211|    } else {
212|      if (typeof summaryContainer.collapse === 'function') { try { summaryContainer.collapse(); } catch (e) {} } else if (typeof summaryContainer.hide === 'function') { try { summaryContainer.hide(); } catch (e) {} }
213|    }
214|  }
215|}
216|
217|function safeItem($item, selector, action, val) {
218|  try {
219|    const el = $item(selector);
220|    if (action === 'text') el.text = val;
221|    if (action === 'collapse') el.collapse();
222|    if (action === 'expand') el.expand();
223|    if (action === 'options') el.options = val;
224|    if (action === 'value') el.value = val;
225|    return el;
226|  } catch (e) { return null; }
227|}
228|
229|function tryFind(id) { try { return $w('#' + id); } catch (e) { return null; } }
230|
231|function plainTextFromHtml(html) {
232|  if (!html) return '';
233|  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
234|}
235|
236|function escapeHtml(str) {
237|  if (!str) return '';
238|  return String(str)
239|    .replace(/&/g, '&amp;')
240|    .replace(/</g, '&lt;')
241|    .replace(/>/g, '&gt;')
242|    .replace(/"/g, '&quot;')
243|    .replace(/'/g, '&#039;');
244|}
245|
246|function formatVacationDate(d) {
247|  if (!d || isNaN(d.getTime())) { return ''; }
248|  const months = ['January', 'February', 'March', 'April', 'May', 'June',
249|                  'July', 'August', 'September', 'October', 'November', 'December'];
250|  const day = d.getDate();
251|  let suffix = 'th';
252|  if (day % 100 < 11 || day % 100 > 13) {
253|    if (day % 10 === 1) suffix = 'st';
254|    else if (day % 10 === 2) suffix = 'nd';
255|    else if (day % 10 === 3) suffix = 'rd';
256|  }
257|  return months[d.getMonth()] + ' ' + day + suffix + ', ' + d.getFullYear();
258|}
259|
260|
261|$w.onReady(async function () {
262|  try {
263|    let settings = {};
264|    try { settings = await getAllSettings(); } catch (e) {}
265|    const suspend = String(settings.suspendGoogleAds).trim() === '1' || Number(settings.suspendGoogleAds) === 1;
266|    if (typeof setSuspendGoogleAds === 'function') {
267|      setSuspendGoogleAds(suspend);
268|    } else {
269|      console.log('[WBE-SEARCH] setSuspendGoogleAds import not ready, suspendGoogleAds defaults to false');
270|    }
271|  } catch (err) {
272|    console.log('[WBE-SEARCH] settings load error:', err && err.message || err);
273|  }
274|
275|  initTracking($w);
276|  captureClickIds();
277|
278|  // Load room metadata including roomFee once for the repeater rows.
279|  (async function () {
280|    try { _roomFeeMap = await getRoomNames(); } catch (e) { _roomFeeMap = {}; }
281|  })();
282|
283|  trackViewBookingSearch();
284|  hideSearchHeader();
285|
286|  // Ensure the page starts at the top when loaded.
287|  try {
288|    console.log('>>> scrollToTop attempt');
289|    if (wixWindow && typeof wixWindow.scrollTo === 'function') {
290|      wixWindow.scrollTo(0, 0);
291|      console.log('>>> scrollToTop via wixWindow.scrollTo executed');
292|    } else if (wixWindow && typeof wixWindow.scrollBy === 'function') {
293|      wixWindow.scrollBy(0, -100000);
294|      console.log('>>> scrollToTop via wixWindow.scrollBy executed');
295|    } else {
296|      console.log('>>> scrollToTop skipped: neither scrollTo nor scrollBy available');
297|    }
298|  } catch (e) {
299|    console.log('>>> scrollToTop error:', e && e.message || e);
300|  }
301|
302|  // Fallback: try scrolling the html/body through the event-bridge iframe or document.
303|  try {
304|    if (typeof document !== 'undefined' && document.body && typeof document.body.scrollTo === 'function') {
305|      document.body.scrollTo(0, 0);
306|      console.log('>>> scrollToTop via document.body.scrollTo executed');
307|    } else if (typeof document !== 'undefined' && document.documentElement && typeof document.documentElement.scrollTo === 'function') {
308|      document.documentElement.scrollTo(0, 0);
309|      console.log('>>> scrollToTop via document.documentElement.scrollTo executed');
310|    }
311|  } catch (e2) {
312|    console.log('>>> scrollToTop document fallback error:', e2 && e2.message || e2);
313|  }
314|
315|  const shouldAutoSearch = applyUrlDatesIfPresent();
316|  if (shouldAutoSearch) {
317|    setTimeout(function () { searchHandler(); }, 400);
318|  }
319|  if (tryFind('btnSearchRooms')) {
320|    $w('#btnSearchRooms').onClick(async function () {
321|      console.log('>>> btnSearchRooms clicked');
322|      const ciEl = tryFind('datePickerCheckIn');
323|      const coEl = tryFind('datePickerCheckOut');
324|      const ci = ciEl && ciEl.value ? new Date(ciEl.value) : null;
325|      const co = coEl && coEl.value ? new Date(coEl.value) : null;
326|      let nights = 0;
327|      if (ci && co && co > ci) {
328|        nights = Math.round((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24));
329|      }
330|      _summaryNights = nights;
331|
332|      const estValue = await ensureBaseRate(nights).then(function () {
333|        return estimateSearchValue(nights);
334|      });
335|      trackBeginBooking({
336|        checkIn: ci ? (ci.getMonth() + 1) + '/' + ci.getDate() + '/' + ci.getFullYear() : undefined,
337|        checkOut: co ? (co.getMonth() + 1) + '/' + co.getDate() + '/' + co.getFullYear() : undefined,
338|        nights: nights || undefined,
339|        value: estValue
340|      });
341|      searchHandler();
342|    });
343|  }
344|
345|  const summaryUrl = '/booking-summary';
346|
347|  // When check-in date is selected, default check-out to the same date for easier picking.
348|  const ciPicker = tryFind('datePickerCheckIn');
349|  const coPicker = tryFind('datePickerCheckOut');
350|  if (ciPicker && coPicker && typeof ciPicker.onChange === 'function') {
351|    ciPicker.onChange((event) => {
352|      const newCheckIn = event.target.value;
353|      if (!newCheckIn) return;
354|      // Only override check-out if it's empty or before the new check-in date.
355|      const currentCo = coPicker.value;
356|      const ciDate = parseDate(newCheckIn);
357|      const coDate = currentCo ? parseDate(currentCo) : null;
358|      if (!coDate || ciDate > coDate) {
359|        coPicker.value = new Date(ciDate.getFullYear(), ciDate.getMonth(), ciDate.getDate(), 12, 0, 0);
360|      }
361|    });
362|  }
363|
364|  if (tryFind('btnSummary')) {
365|    console.log('>>> btnSummary handler registered');
366|    const summaryBtn = $w('#btnSummary');
367|    if (typeof summaryBtn.link === 'string') summaryBtn.link = '';
368|    summaryBtn.onClick(() => {
369|      console.log('>>> btnSummary clicked');
370|      if (_selections.length === 0) {
371|        safeText('Please select a room below.');
372|        console.log('>>> Summary blocked: no room selected');
373|        return;
374|      }
375|      if (!_selectedPackage || !_selectedPackage._id) {
376|        safeText('Please select a package above before continuing.');
377|        console.log('>>> Summary blocked: no package selected');
378|        return;
379|      }
380|      const parts = [], first = _selections[0];
381|      for (let i = 0; i < _selections.length; i++) {
382|        const s = _selections[i];
383|        parts.push(s.roomCode + ':' + s.qty + ':' + (s.numGuests || 1) + ':' + (s.roomFee || 0));
384|      }
385|      function stripTime(d) {
386|        if (!d) return '';
387|        const str = String(d);
388|        const tIndex = str.indexOf('T');
389|        return tIndex !== -1 ? str.substring(0, tIndex) : str;
390|      }
391|      const ciOnly = stripTime(first.availableCheckIn);
392|      const coOnly = stripTime(first.availableCheckOut);
393|      try {
394|        if (typeof localStorage !== 'undefined' && localStorage) {
395|          localStorage.setItem('_wbe_rc', parts.join(','));
396|          localStorage.setItem('_wbe_ci', ciOnly);
397|          localStorage.setItem('_wbe_co', coOnly);
398|          if (_selectedPackage && _selectedPackage._id) {
399|            localStorage.setItem('_wbe_pkg', _selectedPackage._id);
400|          }
401|          console.log('>>> STORED rc (summary):', parts.join(','));
402|        }
403|      } catch (e) {
404|        console.log('>>> storage save error (summary):', e && e.message || e);
405|      }
406|      const pkgParam = _selectedPackage && _selectedPackage._id ? '&pkg=' + encodeURIComponent(_selectedPackage._id) : '';
407|      wixLocation.to(summaryUrl + '?rc=' + encodeURIComponent(parts.join(',')) +
408|        '&ci=' + encodeURIComponent(ciOnly) +
409|        '&co=' + encodeURIComponent(coOnly) + pkgParam);
410|    });
411|  }
412|
413|  const rep = tryFind('searchResultsRepeater');
414|  if (rep && typeof rep.onItemReady === 'function') {
415|    rep.onItemReady(($item, itemData) => {
416|      // Repeater item debug log disabled to reduce console noise
417|      if ((itemData.maxQty || 0) <= 0 || itemData.status === 'unavailable') {
418|        safeItem($item, '#roomName', 'text', (itemData.roomName || itemData.roomCode || '') + ' — Not available for these dates');
419|        safeItem($item, '#roomPrice', 'text', '');
420|        safeItem($item, '#roomAvailability', 'text', '');
421|        safeItem($item, '#numRooms', 'text', '');
422|        safeItem($item, '#occupancy', 'text', '');
423|        safeItem($item, '#defaultOccupancy', 'text', '');
424|        const dd = safeItem($item, '#roomQtyDropdown', null, null);
425|        if (dd) { dd.options = [{ label: '0', value: '0' }]; dd.value = '0'; try { dd.disable(); } catch (e) {} }
426|        const guestDdUnavail = safeItem($item, '#numberOfGuests', null, null);
427|        if (guestDdUnavail) { guestDdUnavail.options = []; try { guestDdUnavail.disable(); } catch (e) {} }
428|        return;
429|      }
430|      safeItem($item, '#roomName', 'text', itemData.roomName || itemData.roomCode || '');
431|      safeItem($item, '#roomname2', 'text', itemData.name || itemData.roomName || itemData.roomCode || '');
432|      safeItem($item, '#description', 'text', plainTextFromHtml(itemData.description));
433|      safeItem($item, '#roomType', 'text', itemData.roomType || '');
434|      safeItem($item, '#occupancyText', 'text', itemData.occupancyText || '');
435|      safeItem($item, '#additionalFeeText', 'text', itemData.additionalFeeText || '');
436|      safeItem($item, '#numRooms', 'text', String(itemData.maxQty || itemData.units || 1));
437|      safeItem($item, '#roomPrice', 'text', '');
438|      safeItem($item, '#roomAvailability', 'text',
439|        itemData.status === 'full' ? 'Available for your full ' + itemData.availableNights + ' nights'
440|        : 'Available for ' + itemData.availableNights + ' nights (partial)');
441|      safeItem($item, '#occupancy', 'text', String(itemData.occupancy || 2));
442|      safeItem($item, '#defaultOccupancy', 'text', String(itemData.baseOccupancy || itemData.occupancy || 2));
443|
444|      // Selected badge defaults hidden inside repeater template; reveal when qty selected.
445|      const badgeEl = safeItem($item, '#selectedBadge', null, null);
446|      if (badgeEl) { try { badgeEl.hide(); } catch (e) {} }
447|
448|      // Set roomFeeText from Rooms collection and show penthouseFeeText only for Penthouse Apartment.
449|      const feeInfo = (_roomFeeMap && _roomFeeMap[itemData.roomCode]) || {};
450|      const feeAmount = Number(feeInfo.roomFee) || Number(itemData.roomFee) || 0;
451|      const roomFeeTextEl = safeItem($item, '#roomFeeText', null, null);
452|      if (roomFeeTextEl) {
453|        roomFeeTextEl.text = feeAmount > 0 ? '$' + feeAmount.toFixed(2) : '';
454|      }
455|
456|      const penthouseFeeTextEl = safeItem($item, '#penthouseFeeText', null, null);
457|      if (penthouseFeeTextEl) {
458|        if (itemData.roomCode === 'penthouse_apartment') {
459|          if (typeof penthouseFeeTextEl.show === 'function') { try { penthouseFeeTextEl.show(); } catch (e) {} }
460|          if (typeof penthouseFeeTextEl.expand === 'function') { try { penthouseFeeTextEl.expand(); } catch (e) {} }
461|        } else {
462|          if (typeof penthouseFeeTextEl.hide === 'function') { try { penthouseFeeTextEl.hide(); } catch (e) {} }
463|          if (typeof penthouseFeeTextEl.collapse === 'function') { try { penthouseFeeTextEl.collapse(); } catch (e) {} }
464|        }
465|      }
466|
467|      if (itemData.mainPhoto) try { $item('#roomThumb').src = itemData.mainPhoto; } catch (e) {}
468|
469|      try {
470|        const rowVectorInit = $item('#vectorImage2');
471|        if (rowVectorInit) { try { rowVectorInit.hide(); } catch (e) {} if (typeof rowVectorInit.collapse === 'function') { try { rowVectorInit.collapse(); } catch (e) {} } }
472|      } catch (e) {}
473|
474|      const baseOcc = Number(itemData.baseOccupancy || itemData.occupancy || 2);
475|      const maxOcc = Number(itemData.occupancy || baseOcc);
476|      const guestOpts = [];
477|      for (let g = baseOcc; g <= maxOcc; g++) guestOpts.push({ label: String(g), value: String(g) });
478|      let selectedGuests = baseOcc;
479|      const guestDd = safeItem($item, '#numberOfGuests', null, null);
480|      if (guestDd) {
481|        guestDd.options = guestOpts;
482|        guestDd.value = String(baseOcc);
483|        if (typeof guestDd.onChange === 'function') {
484|          guestDd.onChange((event) => {
485|            selectedGuests = parseInt(event.target.value || String(baseOcc), 10);
486|            const qtyDd = safeItem($item, '#roomQtyDropdown', null, null);
487|            const qty = qtyDd ? parseInt(qtyDd.value || '0', 10) : 0;
488|            if (qty > 0) {
489|              setRoomSelection(itemData.roomCode, itemData.roomName || itemData.roomCode, qty, selectedGuests, itemData.availableCheckIn, itemData.availableCheckOut, itemData.roomFee || 0);
490|            }
491|          });
492|        }
493|      }
494|
495|      const dd = safeItem($item, '#roomQtyDropdown', null, null);
496|      if (dd && typeof dd.onChange === 'function') {
497|        const maxQty = typeof itemData.maxQty === 'number' ? itemData.maxQty : (Number(itemData.units) || 1);
498|        if (maxQty <= 0) {
499|          dd.options = [{ label: '0', value: '0' }];
500|          dd.value = '0';
501|          dd.disable && dd.disable();
502|        } else {
503|          const opts = [];
504|          for (let q = 0; q <= maxQty; q++) opts.push({ label: String(q), value: String(q) });
505|          dd.options = opts;
506|          dd.value = '0';
507|          dd.enable && dd.enable();
508|        }
509|        dd.onChange((event) => {
510|          const qty = parseInt(event.target.value || '1', 10);
511|          const numGuests = typeof selectedGuests === 'number' ? selectedGuests : baseOcc;
512|          const rowVector = safeItem($item, '#vectorImage2', null, null);
513|          const badgeEl = safeItem($item, '#selectedBadge', null, null);
514|          if (qty > 0) {
515|            setRoomSelection(itemData.roomCode, itemData.roomName || itemData.roomCode, qty, numGuests, itemData.availableCheckIn, itemData.availableCheckOut, itemData.roomFee || 0);
516|            if (rowVector) {
517|              try { rowVector.show(); } catch (e) {}
518|              try { rowVector.expand(); } catch (e) {}
519|            }
520|            if (badgeEl) { try { badgeEl.show(); } catch (e) {} try { badgeEl.expand(); } catch (e) {} }
521|          } else {
522|            removeRoomSelection(itemData.roomCode);
523|            if (rowVector) {
524|              try { rowVector.hide(); } catch (e) {}
525|              try { rowVector.collapse(); } catch (e) {}
526|            }
527|            if (badgeEl) { try { badgeEl.hide(); } catch (e) {} try { badgeEl.collapse(); } catch (e) {} }
528|          }
529|
530|          // Visibility is now handled centrally by updateSelectionPanel().
531|        });
532|      }
533|    });
534|  }
535|
536|  function hideIfFound(id) {
537|    const el = tryFind(id);
538|    if (!el) return;
539|    if (typeof el.collapse === 'function') {
540|      try { el.collapse(); } catch (e) {}
541|    } else if (typeof el.hide === 'function') {
542|      try { el.hide(); } catch (e) {}
543|    }
544|  }
545|
546|  hideIfFound('vacationDates');
547|  hideIfFound('selectionPanel');
548|  hideIfFound('selectedRoomsContainer');
549|  hideIfFound('searchResultsRepeater');
550|  hideIfFound('btnSummary');
551|  hideIfFound('box3');
552|
553|  loadMessages();
554|});
555|
556|async function loadMessages() {
557|  try {
558|    const msgs = await getActiveMessages('search');
559|    const el = tryFind('messagesContainer');
560|    if (!el) return;
561|    if (msgs.length === 0) {
562|      if (typeof el.collapse === 'function') { try { el.collapse(); } catch (e) {} }
563|    } else {
564|      if (typeof el.expand === 'function') { try { el.expand(); } catch (e) {} }
565|      el.text = msgs.map((m) => m.title || '').join('; ');
566|    }
567|  } catch (e) {}
568|}
569|
570|// Value estimate for audience tiering: 2 guests at the per-person package rate.
571|async function ensureBaseRate(nights) {
572|  if (_cachedBaseRate || !nights) return;
573|  try { _cachedBaseRate = Number(await getPackageBaseRate(nights)) || 0; } catch (e) {}
574|}
575|
576|function estimateSearchValue(nights) {
577|  if (!nights || !_cachedBaseRate) return 0;
578|  return Math.round(_cachedBaseRate * nights * 2 * 100) / 100;
579|}
580|
581|async function searchHandler() {
582|  const gallery = tryFind('hotelRoomPhotos');
583|  if (gallery && typeof gallery.collapse === 'function') { try { gallery.collapse(); } catch (e) {} }
584|
585|  let ciEl = tryFind('datePickerCheckIn'), coEl = tryFind('datePickerCheckOut');
586|  if (!ciEl || !coEl) {
587|    try {
588|      $w().forEach((el) => {
589|        if (el.type === 'DatePicker' || el.type === '$w.DatePicker') {
590|          if (!ciEl) ciEl = el; else if (!coEl) coEl = el;
591|        }
592|      });
593|    } catch (e) {}
594|  }
595|
596|  let ci = null, co = null;
597|  if (ciEl) try { ci = ciEl.value; } catch (e) {}
598|  if (coEl) try { co = coEl.value; } catch (e) {}
599|
600|  const ciDate = parseDate(ci), coDate = parseDate(co);
601|  if (!ciDate || !coDate) { hideSearchHeader(); safeText('Please select check-in and check-out dates.'); return; }
602|  if (ciDate >= coDate) { hideSearchHeader(); safeText('Check-in date must be before the Check-out date.'); return; }
603|
604|  const computedNights = Math.round((coDate.getTime() - ciDate.getTime()) / 86400000);
605|  _summaryNights = computedNights;
606|  await ensureBaseRate(computedNights);
607|
608|  // Validate that an adventure package is defined for this number of nights.
609|  const pkgExists = await packageExistsForNights(computedNights);
610|  if (!pkgExists) {
611|    hideSearchHeader();
612|    hideAlternateDates();
613|    const rep = tryFind('searchResultsRepeater');
614|    if (rep) { try { rep.collapse(); } catch (e) {} }
615|    const box3 = tryFind('box3');
616|    if (box3) { if (typeof box3.collapse === 'function') { try { box3.collapse(); } catch (e) {} } else if (typeof box3.hide === 'function') { try { box3.hide(); } catch (e) {} } }
617|    const panel = tryFind('selectionPanel');
618|    if (panel) { try { panel.collapse(); } catch (e) {} }
619|    const container = tryFind('selectedRoomsContainer');
620|    if (container) { try { container.hide(); } catch (e) {} }
621|    safeText('No adventure packages exist for that number of nights. Please choose a lower number of nights.');
622|    return;
623|  }
624|
625|  clearSelections(true);
626|  safeText('Searching...');
627|
628|  try {
629|    const res = await searchAvailability(ciDate, coDate);
630|    console.log('>>> [WBE-SEARCH] raw results:', JSON.stringify(res));
631|    if (!res.ok) { hideSearchHeader(); safeText(res.error); return; }
632|
633|    const rep = tryFind('searchResultsRepeater');
634|    if (!rep) { safeText('Found ' + res.results.length + ' result(s) but no repeater to display them.'); return; }
635|    if (res.results.length === 0) {
636|      rep.data = [];
637|      clearSelections(true);
638|      hideSearchHeader();
639|      const box3 = tryFind('box3');
640|      if (box3) { if (typeof box3.collapse === 'function') { try { box3.collapse(); } catch (e) {} } else if (typeof box3.hide === 'function') { try { box3.hide(); } catch (e) {} } }
641|      const panel = tryFind('selectionPanel');
642|      if (panel) { try { panel.collapse(); } catch (e) {} }
643|      const container = tryFind('selectedRoomsContainer');
644|      if (container) { try { container.hide(); } catch (e) {} }
645|        safeText('No rooms are available for the dates entered. Checking nearby dates...');
646|      trackSearchNoResults({ nights: res.requestedNights, checkIn: ciDate ? ciDate.toISOString().slice(0, 10) : undefined });
647|      showAlternateDates(ciDate, coDate);
648|      return;
649|    }
650|    hideAlternateDates();
651|
652|    updateSelectionPanel();
653|
654|    const repData = [];
655|    const availableData = [];
656|    for (let i = 0; i < res.results.length; i++) {
657|      const item = res.results[i];
658|      item._id = 'room_' + i;
659|      repData.push(item);
660|      if ((item.maxQty || 0) > 0 && item.status !== 'unavailable') availableData.push(item);
661|      trackRoomView({ roomCode: item.roomCode, nights: res.requestedNights });
662|    }
663|    if (availableData.length === 0) {
664|      rep.data = repData;
665|      clearSelections(true);
666|      updateSelectionPanel();
667|      hideSearchHeader();
668|      try { rep.expand(); } catch (e) {}
669|      const box3 = tryFind('box3');
670|      if (box3) { if (typeof box3.collapse === 'function') { try { box3.collapse(); } catch (e) {} } else if (typeof box3.hide === 'function') { try { box3.hide(); } catch (e) {} } }
671|      const selPanel = tryFind('selectionPanel');
672|      if (selPanel) { try { selPanel.collapse(); } catch (e) {} }
673|      const container = tryFind('selectedRoomsContainer');
674|      if (container) { try { container.hide(); } catch (e) {} }
675|        safeText('No rooms are available for the dates entered. Checking nearby dates...');
676|      trackSearchNoResults({ nights: res.requestedNights, checkIn: ciDate ? ciDate.toISOString().slice(0, 10) : undefined });
677|      showAlternateDates(ciDate, coDate);
678|      return;
679|    }
680|    showSearchHeader(ciDate, coDate, computedNights);
681|    if (rep) { try { rep.show(); } catch (e) {} try { rep.expand(); } catch (e) {} }
682|    rep.data = repData;
683|    loadPackageInfo(res.requestedNights);
684|
685|    // Show package column labels above the repeater.
686|    ['packageText', 'nightsLabel', 'specialtyText', 'priceText'].forEach(function (id) {
687|      const el = tryFind(id);
688|      if (el) {
689|        if (typeof el.show === 'function') { try { el.show(); } catch (e) {} }
690|        if (typeof el.expand === 'function') { try { el.expand(); } catch (e) {} }
691|      }
692|    });
693|
694|    safeText('Found ' + res.results.length + ' result' + (res.results.length === 1 ? '' : 's') + ' for ' + res.requestedNights + ' nights.');
695|  } catch (e) { safeText('Error: ' + e.message); }
696|}
697|
698|async function loadPackageInfo(nights) {
699|  if (!nights || nights <= 0) { console.log('>>> loadPackageInfo: invalid nights'); hidePackageInfo(); return; }
700|  try {
701|    console.log('>>> loadPackageInfo: fetching package for', nights, 'nights');
702|    const pkg = await getPackageAmenities(nights);
703|    console.log('>>> loadPackageInfo response:', pkg);
704|    const pkgNameEl = $w('#packageName');
705|    const pkgAmenEl = $w('#packageAmenities');
706|    const title = pkg.title || '';
707|    if (title) {
708|      pkgNameEl.text = title;
709|      pkgNameEl.expand();
710|      console.log('>>> packageName set to:', title);
711|    } else {
712|      pkgNameEl.collapse();
713|      console.log('>>> packageName collapsed (no title)');
714|    }
715|    if (pkg && pkg.includedAmenities) {
716|      pkgAmenEl.text = pkg.includedAmenities;
717|      pkgAmenEl.expand();
718|      console.log('>>> packageAmenities set to:', pkg.includedAmenities.substring(0, 50) + '...');
719|    } else {
720|      pkgAmenEl.collapse();
721|      console.log('>>> packageAmenities collapsed (no amenities)');
722|    }
723|  } catch (e) { console.error('>>> loadPackageInfo error:', e.message); hidePackageInfo(); }
724|}
725|
726|function hidePackageInfo() {
727|  try { $w('#packageName').collapse(); } catch (e) {}
728|  try { $w('#packageAmenities').collapse(); } catch (e) {}
729|}
730|
731|function loadPackageOptions(nights) {
732|  const pkgContainer = tryFind('packageContainer');
733|  if (!pkgContainer) return;
734|
735|  getPackagesByNights(nights).then(function (packages) {
736|    _availablePackages = packages || [];
737|    if (!_availablePackages.length) return;
738|
739|    // Default to first package if none selected
740|    _selectedPackage = _availablePackages[0];
741|    _cachedBaseRate = _selectedPackage.baseRate;
742|
743|    // Legacy single-package elements
744|    const pkgName2 = tryFind('packageName2');
745|    const nightsTextEl = tryFind('nightsText');
746|    const specialtyToursEl = tryFind('specialtyTours');
747|    if (pkgName2) { pkgName2.text = _selectedPackage.title || ''; }
748|    if (nightsTextEl) { nightsTextEl.text = String(nights) + ' night' + (nights === 1 ? '' : 's'); }
749|    if (specialtyToursEl) { specialtyToursEl.text = _selectedPackage.specialtyTours || ''; }
750|    [pkgName2, nightsTextEl, specialtyToursEl].forEach(function (el) {
751|      if (el) {
752|        if (typeof el.show === 'function') { try { el.show(); } catch (e) {} }
753|        if (typeof el.expand === 'function') { try { el.expand(); } catch (e) {} }
754|      }
755|    });
756|
757|    // Repeater with multiple package options
758|    const repeater = tryFind('packageRepeater');
759|    if (repeater) {
760|      if (typeof repeater.onItemReady === 'function') {
761|        repeater.onItemReady(($item, itemData) => {
762|          safeItem($item, '#packageName2', 'text', itemData.title || '');
763|          safeItem($item, '#nightsText', 'text', String(nights) + ' night' + (nights === 1 ? '' : 's'));
764|          safeItem($item, '#specialtyTours', 'text', itemData.specialtyTours || '');
765|          const packagePriceEl = safeItem($item, '#packagePrice', null, null);
766|          if (packagePriceEl) {
767|            const price = (Number(itemData.baseRate) || 0) * nights;
768|            packagePriceEl.text = price > 0 ? '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
769|          }
770|
771|          // Bind click to the row container and each text element inside the item.
772|          function selectThisPackage(evt) {
773|            console.log('>>> package row clicked:', itemData.title);
774|            _selectedPackage = itemData;
775|            _cachedBaseRate = itemData.baseRate;
776|            updateSelectionPanel();
777|            updatePackageNameField();
778|            highlightSelectedPackageRow();
779|            if (evt && evt.stopPropagation) { evt.stopPropagation(); }
780|          }
781|
782|          const rowContainer = $item('#packageContainer');
783|          if (rowContainer && typeof rowContainer.onClick === 'function') {
784|            rowContainer.onClick(selectThisPackage);
785|          }
786|          ['#packageName2', '#nightsText', '#specialtyTours', '#packagePrice'].forEach(function (sel) {
787|            const el = $item(sel);
788|            if (el && typeof el.onClick === 'function') {
789|              try { el.onClick(selectThisPackage); } catch (e) {}
790|            }
791|          });
792|        });
793|      }
794|
795|      // Mark first as selected by default
796|      try {
797|        repeater.data = _availablePackages.map((p, idx) => ({ ...p, _id: String(idx) }));
798|      } catch (e) {
799|        console.log('>>> packageRepeater data error:', e.message);
800|      }
801|
802|      // Determine which package should be selected by default.
803|      const defaultSelected = _availablePackages[0];
804|      _selectedPackage = defaultSelected;
805|      _cachedBaseRate = defaultSelected.baseRate;
806|
807|      // After data is set, highlight the default package row.
808|      setTimeout(highlightSelectedPackageRow, 100);
809|      updatePackageNameField();
810|    }
811|
812|    if (typeof pkgContainer.show === 'function') { try { pkgContainer.show(); } catch (e) {} }
813|    if (typeof pkgContainer.expand === 'function') { try { pkgContainer.expand(); } catch (e) {} }
814|
815|    // Ensure column header labels above the repeater are visible.
816|    ['packageText', 'nightsLabel', 'specialtyText', 'priceText'].forEach(function (id) {
817|      const el = tryFind(id);
818|      if (el) {
819|        if (typeof el.show === 'function') { try { el.show(); } catch (e) {} }
820|        if (typeof el.expand === 'function') { try { el.expand(); } catch (e) {} }
821|      }
822|    });
823|
824|    // Ensure the package repeater itself is visible.
825|    const packageRepeaterEl = tryFind('packageRepeater');
826|    console.log('>>> packageRepeater found:', !!packageRepeaterEl);
827|    if (packageRepeaterEl) {
828|      if (typeof packageRepeaterEl.show === 'function') { try { packageRepeaterEl.show(); } catch (e) {} }
829|      if (typeof packageRepeaterEl.expand === 'function') { try { packageRepeaterEl.expand(); } catch (e) {} }
830|    }
831|
832|    const packagePriceEl = tryFind('packagePrice');
833|    if (packagePriceEl) {
834|      const packagePrice = _cachedBaseRate * nights;
835|      if (packagePrice > 0) {
836|        packagePriceEl.text = '$' + packagePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
837|        if (typeof packagePriceEl.show === 'function') { try { packagePriceEl.show(); } catch (e) {} }
838|        if (typeof packagePriceEl.expand === 'function') { try { packagePriceEl.expand(); } catch (e) {} }
839|      }
840|    }
841|  }).catch(function (err) {
842|    console.log('>>> loadPackageOptions error:', err && err.message || err);
843|  });
844|}
845|
846|function highlightSelectedPackageRow() {
  const repeater = tryFind('packageRepeater');
  if (!repeater || !_selectedPackage) return;
  const selectedTitle = _selectedPackage.title || '';
  try {
    repeater.forEachItem((itemScope) => {
      const container = itemScope('#packageContainer');
      const pkgNameEl = itemScope('#packageName2');
      if (!container || !pkgNameEl) return;
      const isSelected = pkgNameEl.text === selectedTitle;
      try {
        if (container.style && typeof container.style.backgroundColor !== 'undefined') {
          container.style.backgroundColor = isSelected ? '#E6F0FF' : '#FFFFFF';
        } else if (typeof container.backgroundColor !== 'undefined') {
          container.backgroundColor = isSelected ? '#E6F0FF' : '#FFFFFF';
        }
      } catch (e) {}
    });
  } catch (e) {}
}

function hideSearchHeader() {
960|  ['packageSelectionText', 'accommodationText', 'vacationDates', 'packageContainer', 'packageName2', 'nightsText', 'specialtyTours', 'packagePrice', 'packageText', 'nightsLabel', 'specialtyText', 'priceText']
961|    .forEach(function (id) {
962|      const el = tryFind(id);
963|      if (el) {
964|        if (typeof el.hide === 'function') { try { el.hide(); } catch (e) {} }
965|        if (typeof el.collapse === 'function') { try { el.collapse(); } catch (e) {} }
966|      }
967|    });
968|}
969|
970|function showSearchHeader(ciDate, coDate, nights) {
971|  ['packageSelectionText', 'accommodationText'].forEach(function (id) {
972|    const el = tryFind(id);
973|    if (el) { try { el.show(); } catch (e) {} try { el.expand(); } catch (e) {} }
974|  });
975|
976|  const vacationDatesEl = tryFind('vacationDates');
977|  if (vacationDatesEl) {
978|    const ciFmt = formatVacationDate(ciDate);
979|    const coFmt = formatVacationDate(coDate);
980|    if (ciFmt && coFmt) {
981|      vacationDatesEl.text = (ciFmt + ' - ' + coFmt).trim();
982|      if (typeof vacationDatesEl.show === 'function') { try { vacationDatesEl.show(); } catch (e) {} }
983|      if (typeof vacationDatesEl.expand === 'function') { try { vacationDatesEl.expand(); } catch (e) {} }
984|    }
985|  }
986|
987|  if (nights > 0) {
988|    loadPackageOptions(nights);
989|  }
990|}
991|
992|function parseDate(v) {
993|  if (!v) return null;
994|  if (v instanceof Date) return v;
995|  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
996|  if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
997|  return null;
998|}
999|
1000|function safeText(txt, opts) {
1001|  try {
1002|    const el = tryFind('statusText');
1003|    if (!el) { console.log('>>> safeText: statusText element not found'); return; }
1004|    const style = "font-family: 'Inter Semi Bold', 'Inter', sans-serif; font-size: 20px;";
1005|    if (opts && opts.html) {
1006|      el.html = "<span style=\"" + style + "\">" + txt + "</span>";
1007|    } else {
1008|      const escaped = escapeHtml(txt).replace(/\n/g, '<br>');
1009|      el.html = "<span style=\"" + style + "\">" + escaped + "</span>";
1010|    }
1011|    if (typeof el.expand === 'function') el.expand();
1012|    if (typeof el.show === 'function') el.show();
1013|    console.log('>>> safeText:', txt);
1014|  } catch (e) { console.log('>>> safeText error:', e.message); }
1015|}
1016|
1017|async function showAlternateDates(ciDate, coDate) {
1018|  try {
1019|    const res = await suggestAlternateDates(ciDate, coDate);
1020|    const sug = (res && res.suggestions) || [];
1021|
1022|    if (sug.length === 0) {
1023|      safeText('* No rooms available within 30 days of your dates. Please contact us or try a shorter stay.', { html: true });
1024|      return;
1025|    }
1026|
1027|    const links = sug.map(function (s) {
1028|      const url = buildAltUrl(s.checkIn, s.checkOut);
1029|      return "<a href=\"" + url + "\" style=\"font-family: 'Inter Semi Bold', 'Inter', sans-serif; font-size: 20px;\">" + s.label + "</a>";
1030|    }).join(' &middot; ');
1031|    safeText('* No rooms for those dates. Try: ' + links, { html: true });
1032|  } catch (e) {
1033|    console.error('>>> showAlternateDates error:', e && e.message || e);
1034|    safeText('* No rooms are available for the dates entered.');
1035|  }
1036|}
1037|
1038|function buildAltUrl(checkInIso, checkOutIso) {
1039|  const ci = new Date(checkInIso);
1040|  const co = new Date(checkOutIso);
1041|  const fmt = function (d) {
1042|    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
1043|  };
1044|  return '/wanderlust-booking?ci=' + fmt(ci) + '&co=' + fmt(co) + '&auto=1';
1045|}
1046|
1047|function hideAlternateDates() {}
1048|
1049|function applyUrlDatesIfPresent() {
1050|  try {
1051|    const q = wixLocation.query || {};
1052|    if (!q.ci || !q.co) return false;
1053|    const ciEl = tryFind('datePickerCheckIn');
1054|    const coEl = tryFind('datePickerCheckOut');
1055|    if (ciEl) ciEl.value = new Date(q.ci + 'T00:00:00');
1056|    if (coEl) coEl.value = new Date(q.co + 'T00:00:00');
1057|    return q.auto === '1';
1058|  } catch (e) { return false; }
1059|