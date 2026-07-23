import { getNativeCollections } from 'backend/listCollections';

$w.onReady(async function () {
  const output = (function () { try { return $w('#jsonOutput'); } catch (e) { return null; } })();

  function setText(msg) {
    console.log(msg);
    if (output) {
      try { output.text = String(output.text || '') + '\n' + msg; } catch (e) {}
    }
  }

  try {
    setText('[WBE-ERD] calling getNativeCollections...');
    const res = await getNativeCollections();
    if (res && res.ok) {
      const json = JSON.stringify(res.collections, null, 2);
      setText('--- WIX NATIVE COLLECTIONS JSON START ---');
      setText(json);
      setText('--- WIX NATIVE COLLECTIONS JSON END ---');
    } else {
      setText('[WBE-ERD] failed: ' + ((res && res.error) || 'unknown error'));
    }
  } catch (e) {
    setText('[WBE-ERD] error: ' + (e.message || e));
  }
});
