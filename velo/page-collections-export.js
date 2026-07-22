import { getNativeCollections } from 'backend/listCollections';

$w.onReady(async function () {
  try {
    const res = await getNativeCollections();
    if (res && res.ok) {
      console.log('--- WIX NATIVE COLLECTIONS JSON START ---');
      console.log(JSON.stringify(res.collections, null, 2));
      console.log('--- WIX NATIVE COLLECTIONS JSON END ---');
    } else {
      console.error('[WBE-ERD] failed to load collections:', res && res.error);
    }
  } catch (e) {
    console.error('[WBE-ERD] error:', e.message);
  }
});
