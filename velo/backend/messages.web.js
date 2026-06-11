import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

const COLLECTION = 'Messages';

export const getActiveMessages = webMethod(
  Permissions.Anyone,
  async (page, todayISO) => {
    const today = todayISO ? new Date(todayISO) : new Date();
    today.setHours(0, 0, 0, 0);

    const res = await wixData.query(COLLECTION)
      .eq('active', true)
      .eq('displayPage', page)
      .limit(1000)
      .find();

    const filtered = res.items.filter((item) => {
      const s = item.startDate;
      const e = item.endDate;
      if (s && e) return today >= s && today <= e;
      if (s) return today >= s;
      if (e) return today <= e;
      return true;
    });

    filtered.sort((a, b) => {
      const pri = (b.priority || 0) - (a.priority || 0);
      if (pri !== 0) return pri;
      return (a.title || '').localeCompare(b.title || '');
    });

    return filtered;
  }
);

export const createMessage = webMethod(
  Permissions.Admin,
  async (msg) => {
    const toInsert = {
      title: msg.title || '',
      body: msg.body || '',
      startDate: msg.startDate ? new Date(msg.startDate) : null,
      endDate: msg.endDate ? new Date(msg.endDate) : null,
      active: msg.active !== undefined ? msg.active : true,
      displayPage: msg.displayPage || 'search',
      priority: msg.priority || 0,
    };
    return wixData.insert(COLLECTION, toInsert);
  }
);

export const updateMessage = webMethod(
  Permissions.Admin,
  async (msgId, updates) => {
    const row = await wixData.get(COLLECTION, msgId);
    if (!row) throw new Error('No message ' + msgId);
    if (updates.title !== undefined) row.title = updates.title;
    if (updates.body !== undefined) row.body = updates.body;
    if (updates.startDate !== undefined) {
      row.startDate = updates.startDate ? new Date(updates.startDate) : null;
    }
    if (updates.endDate !== undefined) {
      row.endDate = updates.endDate ? new Date(updates.endDate) : null;
    }
    if (updates.active !== undefined) row.active = updates.active;
    if (updates.displayPage !== undefined) row.displayPage = updates.displayPage;
    if (updates.priority !== undefined) row.priority = updates.priority;
    return wixData.update(COLLECTION, row);
  }
);

export const deleteMessage = webMethod(
  Permissions.Admin,
  async (msgId) => {
    return wixData.remove(COLLECTION, msgId);
  }
);

export const listMessages = webMethod(
  Permissions.Admin,
  async () => {
    const res = await wixData.query(COLLECTION).limit(1000).find();
    return res.items;
  }
);
