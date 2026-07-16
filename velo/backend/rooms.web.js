/*
 * Wanderlust Booking Engine — Velo backend: room media (photos).
 * File location in Wix Editor: backend/rooms.web.js
 *
 * Serves room details + photos from the Rooms collection to the booking page.
 * Photos live in the native Wix `photoGallery` (Media Gallery) field — uploaded
 * and managed in the Content Manager, served natively (no external hosting).
 *
 * photoGallery is an array of media items; each item has a `src` (wix:image://
 * descriptor) plus optional title/description. `mainPhoto` is a single Image
 * field for list/thumbnail views.
 *
 * NOTE (2026-06-03): baseRate has been REMOVED from the Rooms collection.
 * Room metadata only.
 * of stay. Use roomPricing.web.js → getBaseRate(roomCode, nights) to look up.
 */

import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

const ROOMS = 'Rooms';

// Normalize a room row into what the page needs (details + photos).
// NOTE: baseRate is NOT included — it now varies by stay length and must be
function roomToView(room) {
  const gallery = Array.isArray(room.photoGallery) ? room.photoGallery : [];
  return {
    roomCode: room.roomCode,
    name: room.name,
    description: room.description || '',
    units: room.units,
    baseOccupancy: room.baseOccupancy,
    maxOccupancy: room.maxOccupancy,
    extraGuestFee: room.extraGuestFee || 0,
    mainPhoto: room.mainPhoto || (gallery[0] && gallery[0].src) || null,
    photos: gallery.map((g) => ({
      src: g.src,
      title: g.title || '',
      description: g.description || '',
    })),
  };
}

// All rooms with their photos (for a room-list / gallery page).
export const getRoomsWithPhotos = webMethod(
  Permissions.Anyone,
  async () => {
    const res = await wixData.query(ROOMS).limit(50).find();
    return res.items.map(roomToView);
  }
);

// One room's full detail + photo gallery (for a room-detail view).
export const getRoomMedia = webMethod(
  Permissions.Anyone,
  async (roomCode) => {
    const res = await wixData.query(ROOMS).eq('roomCode', roomCode).limit(1).find();
    if (!res.items.length) throw new Error(`Unknown room: ${roomCode}`);
    return roomToView(res.items[0]);
  }
);

// Return mapping of roomCode -> display name (for booking summary / checkout.
export const getRoomNames = webMethod(
  Permissions.Anyone,
  async () => {
    const res = await wixData.query(ROOMS).limit(50).find();
    const map = {};
    for (const room of res.items) {
      map[room.roomCode] = {
        name: room.name || room.roomCode,
        roomFee: Number(room.roomFee) || 0,
        occupancy: Number(room.maxOccupancy) || 2,
        baseOccupancy: Number(room.baseOccupancy) || 2,
      };
    }
    return map;
  }
);

// Helper used by search: map roomCode -> { mainPhoto, photoCount } in one query,
// so availability results can show a thumbnail without N extra calls.
export const getRoomThumbnails = webMethod(
  Permissions.Anyone,
  async () => {
    const res = await wixData.query(ROOMS).limit(50).find();
    const map = {};
    for (const room of res.items) {
      const gallery = Array.isArray(room.photoGallery) ? room.photoGallery : [];
      map[room.roomCode] = {
        mainPhoto: room.mainPhoto || (gallery[0] && gallery[0].src) || null,
        photoCount: gallery.length,
      };
    }
    return map;
  }
);
