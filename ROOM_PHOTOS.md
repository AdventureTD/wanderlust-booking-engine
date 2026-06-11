# Wanderlust Booking Engine — Room Photos (native Wix Media Gallery)

Each room category (Adventure Suite, Penthouse Apartment, Two-Bedroom Apartment)
has its own photo gallery stored in the native Wix **Media Gallery** field on the
`Rooms` collection. You upload and manage photos in the Wix Content Manager —
no external hosting, no broken links — and they display natively on the site.

## Rooms collection fields for photos
| Field        | Type          | Notes                                              |
|--------------|---------------|----------------------------------------------------|
| photoGallery | Media Gallery | Multiple photos per room (the gallery shown on the room/detail page) |
| mainPhoto    | Image         | Single hero/thumbnail used in lists + search results |

## How to add photos (in Wix, no code)
1. Content Manager → open the `Rooms` collection.
2. If the fields don't exist yet: Manage Fields → add `photoGallery`
   (type **Media Gallery**) and `mainPhoto` (type **Image**).
3. Open each room row (Adventure Suite, Penthouse, Two-Bedroom):
   - Click `photoGallery` → upload that room's photos (drag several in; reorder
     by dragging; the first is used as fallback thumbnail).
   - Click `mainPhoto` → choose/upload the hero shot for list views.
4. Save. Done — the booking page reads them automatically via the backend below.

(Your room photos can come from your Google Drive Hotel folder — just download
and upload them into these fields. We kept this native to Wix per your choice so
you control them in the Content Manager.)

## Backend (serves photos to the page)
`velo/backend/rooms.web.js`:
- `getRoomsWithPhotos()` — all rooms with details + full gallery (room-list page).
- `getRoomMedia(roomCode)` — one room's details + gallery (room-detail view).
- `getRoomThumbnails()` — roomCode → { mainPhoto, photoCount } map.

`velo/backend/search.web.js` now also returns `mainPhoto` on every availability
result, so the search results list can show a thumbnail with each option.

## Booking page display code (Velo)

### Search results with a thumbnail per room
```js
// (inside the searchAvailability handler from SEARCH.md)
$w('#roomsRepeater').data = bookable.map(x => ({
  _id: x.roomCode,
  roomName: x.roomName,
  mainPhoto: x.mainPhoto,          // bind to an Image element in the repeater
  offer: x.status === 'full'
    ? `Available for your full ${r.requestedNights} nights`
    : `Available for ${x.availableNights} nights`,
}));
// In the repeater's onItemReady, bind the image:
$w('#roomsRepeater').onItemReady(($item, data) => {
  $item('#roomName').text = data.roomName;
  if (data.mainPhoto) $item('#roomThumb').src = data.mainPhoto;
});
```

### Full gallery on a room-detail view
```js
import { getRoomMedia } from 'backend/rooms.web';

async function showRoom(roomCode) {
  const room = await getRoomMedia(roomCode);
  $w('#roomTitle').text = room.name;
  $w('#roomDesc').text = room.description;
  // Bind to a Wix Pro Gallery element (#roomGallery):
  $w('#roomGallery').items = room.photos.map(p => ({
    type: 'image', src: p.src, title: p.title, description: p.description,
  }));
}
```

## Status
- Built: schema (photoGallery + mainPhoto), backend serving (getRoomsWithPhotos /
  getRoomMedia / getRoomThumbnails), photos folded into search results, and the
  page display snippets above.
- Needs you (in Wix): add the two fields + upload each room's photos.
- Needs live testing in Wix: the gallery binding (Wix Media + Pro Gallery only
  run inside Wix).
