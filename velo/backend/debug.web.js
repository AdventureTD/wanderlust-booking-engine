import wixData from 'wix-data';
     import { Permissions, webMethod } from 'wix-web-module';

     export const testQuery = webMethod(
       Permissions.Admin,
       async (collectionName) => {
         try {
           const res = await wixData.query(collectionName).limit(1).find();
           return {
             ok: true,
             totalCount: res.items.length,
             hasNext: res.hasNext(),
             firstItemKeys: res.items.length ? Object.keys(res.items[0]) : [],
           };
         } catch (e) {
           return { ok: false, error: e.message };
         }
       }
     );