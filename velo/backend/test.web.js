import { Permissions, webMethod } from 'wix-web-module';

export const hello = webMethod(
  Permissions.Anyone,
  async () => {
    return { ok: true, message: 'backend works' };
  }
);
