import { fetch } from 'wix-fetch';

// Bounds local waiting only; underlying fetch/body work is NOT cancelled.
// Promise.race installs rejection handlers on late-settling operations.
async function withDeadline(operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('diagnostic-deadline')), 1500);
      })
    ]);
  } finally { clearTimeout(timer); }
}

// Private, disconnected readiness helper. No arguments or caller-selected URLs.
export async function redirectProbe() {
  const target = 'https://httpbin.org/get?marker=wbe-redirect-readiness-v1';
  const cases = [];
  for (const status of [301, 302, 303, 307, 308]) {
    const url = 'https://httpbin.org/redirect-to?url=' + encodeURIComponent(target) + '&status_code=' + status;
    // Omit redirect option: ordinary platform following, same exact endpoint.
    try {
      const response = await withDeadline(() => fetch(url, { method: 'get' }));
      const body = await withDeadline(() => response.json());
      if (!(response.status === 200 && body && body.url === target && body.args && body.args.marker === 'wbe-redirect-readiness-v1')) {
        return { state: 'INCONCLUSIVE_CONTROL', cases };
      }
    } catch (_) { return { state: 'INCONCLUSIVE_CONTROL', cases }; }
    try {
      const response = await withDeadline(() => fetch(url, { method: 'get', redirect: 'error' }));
      let body;
      try { body = await withDeadline(() => response.json()); }
      catch (_) { cases.push({ status, control: 'FOLLOW_CONFIRMED', result: 'UNKNOWN' }); continue; }
      const marker = body && body.args && body.args.marker === 'wbe-redirect-readiness-v1';
      cases.push({ status, control: 'FOLLOW_CONFIRMED', result: marker ? 'FOLLOWED' : 'FULFILLED_UNPROVEN' });
    } catch (error) {
      cases.push({ status, control: 'FOLLOW_CONFIRMED', result: error && error.type === 'no-redirect' ? 'EXPECTED_REJECTION' : 'UNKNOWN' });
    }
  }
  return { state: cases.some(x => x.result === 'FOLLOWED') ? 'REDIRECT_FOLLOWED_UNSAFE' : 'REQUIRES_REVIEW', cases };
}
