import { diagnostic } from 'backend/promptDiagnostic';

// COMPOSITION INPUT ONLY: never overwrite an existing events.js with this file.
// If this named handler exists, retain its body and await diagnostic.onCreated
// using a separately reviewed merge. Do not create a second same-name export.
export async function wixData_onDataItemCreated(event) {
  await diagnostic.onCreated(event);
}
