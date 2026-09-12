import { startPromptDiagnostic } from 'backend/promptDiagnostic.web';

$w.onReady(() => {
  $w('#runPromptDiagnostic').onClick(async () => {
    $w('#runPromptDiagnostic').disable();
    try {
      const result=await startPromptDiagnostic();
      $w('#promptDiagnosticStatus').text=result?.status==='SEE_OBSERVATIONS'?'SEE_OBSERVATIONS':'DENIED';
    } catch { $w('#promptDiagnosticStatus').text='DENIED'; }
    finally { $w('#runPromptDiagnostic').enable(); }
  });
});
