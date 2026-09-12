import { Permissions, webMethod } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { diagnostic } from 'backend/promptDiagnostic';

export const startPromptDiagnostic = webMethod(Permissions.Admin, async (...args) => {
  if (args.length) return {status:'DENIED'};
  try {
    const member=await currentMember.getMember();
    return await diagnostic.start(member?._id);
  } catch { return {status:'DENIED'}; }
});
