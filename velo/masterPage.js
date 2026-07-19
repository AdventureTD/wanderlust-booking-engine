// masterPage.js (site-wide Velo file)
// Captures Google Ads click identifiers on every page and persists them so
// they survive cross-page navigation until the visitor books.

import { captureClickIds } from 'public/tracking';

$w.onReady(function () {
  console.log('[WBE-MASTER] captureClickIds started');
  const ids = captureClickIds();
  console.log('[WBE-MASTER] captureClickIds result:', JSON.stringify(ids));
});
