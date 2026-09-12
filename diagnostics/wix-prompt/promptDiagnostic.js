import wixData from 'wix-data';
import { createDiagnostic } from 'backend/promptDiagnosticCore';

// Reviewed replacement needed after owner approval and exact identity binding.
// Blank identity and OFF are deliberate denials, NOT a site-owner inference.
export const diagnostic=createDiagnostic(wixData,{enabled:false,ownerId:''});
