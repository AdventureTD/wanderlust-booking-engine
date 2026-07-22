import { collections } from 'wix-data.v2';
import { Permissions, webMethod } from 'wix-web-module';

async function fetchNativeCollections() {
  const result = await collections.listDataCollections();
  const collectionsList = result.collections || [];

  return collectionsList
    .filter((c) => c.collectionType === 'NATIVE')
    .map((c) => ({
      collectionId: c._id,
      displayName: c.displayName,
      collectionType: c.collectionType,
      fields: (c.fields || []).map((f) => ({
        key: f.key,
        displayName: f.displayName,
        type: f.type,
        systemField: !!f.systemField,
        referencedCollection: f.referencedCollection || null,
      })),
      permissions: c.permissions || null,
    }));
}

export async function getNativeCollections() {
  try {
    const data = await fetchNativeCollections();
    return { ok: true, collections: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export const getNativeCollectionsWeb = webMethod(
  Permissions.Admin,
  async () => {
    return getNativeCollections();
  }
);
