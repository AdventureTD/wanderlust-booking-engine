import { diagnoseSearch } from 'backend/diagnoseSearch';

$w.onReady(function () {
  diagnoseSearch().then((res) => {
    console.log('=== DIAGNOSE RESULT ===');
    for (let i = 0; i < res.length; i++) {
      console.log(res[i]);
    }
  }).catch((err) => {
    console.error('=== DIAGNOSE FAILED ===', err.message);
  });
});
