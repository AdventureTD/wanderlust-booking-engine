// masterPage.js (site-wide Velo file)
// Captures Google Ads click identifiers on every page and persists them so
// they survive cross-page navigation until the visitor books.

import { captureClickIds } from 'public/tracking';

$w.onReady(function () {
  captureClickIds();
});
