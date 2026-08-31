// Structural contract test for Wix room-level calendar synchronization.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message);
  console.log('PASS: ' + message);
}

const availability = read('velo/backend/availability.web.js');
const page = read('velo/page-booking-summary.js');
const calendarSync = read('velo/backend/calendarSync.js');
const dataHooks = read('velo/backend/data.js');
const roomAssignments = read('velo/backend/roomAssignments.js');
const ownerBlocks = read('velo/backend/ownerBlocks.js');
const search = read('velo/backend/search.web.js');
const reconciler = read('velo/backend/calendarReconciler.web.js');
const admin = read('velo/backend/adminConsole.web.js');
const jobs = read('velo/backend/jobs.config');
const service = read('invoice_service.py');

assert(availability.includes("import { syncBookingCalendarRooms } from 'backend/calendarSync';"), 'availability imports room calendar synchronization');
assert(availability.includes('room_calendar_sync: true'), 'invoice request disables the legacy booking-level event');
assert(/for\s*\(let\s+unitIndex\s*=\s*0;\s*unitIndex\s*<\s*quantity;\s*unitIndex\+\+\)/.test(availability), 'backend inserts one row for each requested physical room');
assert(/quantity:\s*1/.test(availability), 'every inserted Bookings row has quantity 1');
assert(availability.includes('assignedRoom: assignedUnits[unitIndex]'), 'each physical booking row receives an automatic unit assignment');
assert(availability.includes('export const createBookingBundle'), 'guest booking creation uses one backend bundle command');
assert(!availability.includes('export const createBooking = webMethod'), 'raw single-room creation is not publicly exposed');
assert(availability.includes('rollbackBookingBuild'), 'failed bundle creation compensates the complete booking build');
assert(availability.includes('error.bookingRolledBack = true'), 'first-room financial or summary failure is also compensated');
assert(page.includes('createBookingBundle'), 'Booking Summary submits all selected rooms in one request');
assert(availability.includes('invoiceCapabilityHash'), 'invoice completion uses a hashed expiring capability');
assert(availability.includes('acquireInvoiceClaim'), 'invoice capability consumption has an insert-only concurrency claim');
assert(availability.includes("'ic-' +") && availability.includes("'op-' +"), 'custom Wix claim IDs stay within 36 characters');
assert(availability.includes('BOOKING_OPERATIONS'), 'booking bundles persist an idempotent operation state');
assert(page.includes('invoiceCapability'), 'Booking Summary supplies the one-time invoice capability');
assert(page.includes('operationId:'), 'Booking Summary reuses a client booking operation ID');
assert(roomAssignments.includes('assertPropertyCapacity'), 'global guest/block occupancy is capped before and after insertion');
assert(search.includes('maxAutomaticQuantity'), 'Booking Search reports only automatically assignable room quantities');
assert(search.includes('if (bk.autoOwnerBlock) continue;'), 'movable owner blocks do not create false search unavailability');
assert(search.includes("['confirmed', 'hold', 'blocked', 'in-house'].indexOf(s) === -1"), 'Pending Confirmation rows do not reduce search availability');
assert([availability, roomAssignments, ownerBlocks, dataHooks].every(source => source.includes("'In-House'")), 'In-House rows remain active inventory across every assignment path');
assert(roomAssignments.includes('chooseAutomaticUnits'), 'assignment uses the tested physical-unit rules');
assert(roomAssignments.includes('autoOwnerBlock'), 'movable derived owner blocks do not masquerade as guest occupancy');
assert(ownerBlocks.includes('ownerUnitForOccupiedUnits'), 'owner blocks are derived from nightly physical occupancy');
assert(ownerBlocks.includes("const OWNER_BLOCK_KIND = 'owner_auto'") && ownerBlocks.includes('inventoryKind: OWNER_BLOCK_KIND'), 'automatic owner blocks are stored as physical inventory rows');
assert(ownerBlocks.includes('syncBookingRoomCalendar'), 'automatic owner blocks are visible in Google Calendar');
assert(ownerBlocks.includes('duplicateRows'), 'duplicate automatic owner blocks are soft-cancelled deterministically');
assert(availability.includes('await syncBookingCalendarRooms('), 'invoice completion synchronizes every room event');
assert(calendarSync.includes("'/sync-calendar-room'"), 'Wix calendar module calls the protected room sync endpoint');
assert(calendarSync.includes('calendarEventId'), 'calendar event ID is persisted on the Bookings row');
assert(calendarSync.includes('suppressHooks: true'), 'event-ID persistence cannot recurse through data hooks');
assert(dataHooks.includes('export async function Bookings_afterUpdate'), 'Bookings updates trigger calendar synchronization');
assert(dataHooks.includes('reconcileCommittedAssignmentUpdate'), 'direct updates receive post-commit deterministic arbitration');
assert(dataHooks.includes('export async function Bookings_afterInsert'), 'direct inserts receive post-commit arbitration and synchronization');
assert(dataHooks.includes('Bookings_beforeRemove(itemId, context)'), 'beforeRemove follows the Wix itemId hook contract');
assert(dataHooks.includes('syncBookingRoomCalendar'), 'assignment/date/status updates use the shared synchronizer');
assert(dataHooks.includes("penthouse_apartment: [1]"), 'Unit 1 is restricted to the Penthouse Apartment');
assert(dataHooks.includes("two_bedroom_apartment: [2]"), 'Unit 2 is restricted to the Two-Bedroom Apartment');
assert(dataHooks.includes("adventure_suite: [3, 4, 5]"), 'Units 3, 4, and 5 are restricted to Adventure Suites');
assert(dataHooks.includes("already assigned to"), 'overlapping physical-room assignments are rejected');
assert(dataHooks.includes('assertPropertyCapacity'), 'direct CMS assignment changes preserve one owner room');
assert(service.includes('room_calendar_sync: bool = False'), 'Render retains safe staged-deployment compatibility');
assert(service.includes('@app.post("/sync-calendar-room")'), 'Render exposes the protected room sync endpoint');
assert(!service.includes('@app.get("/calendar-debug")'), 'Render no longer exposes the mutating calendar debug endpoint');
assert(service.includes('_download_token_valid'), 'invoice downloads require a signed expiring token');
assert(roomAssignments.includes('assertInventoryMigrationReady'), 'booking creation fails closed until active inventory is migrated');
assert(ownerBlocks.includes('acquireOwnerLock'), 'owner-block reconciliation is serialized with an expiring lock');
assert(reconciler.includes('calendarNextRetryAt'), 'calendar errors have a durable scheduled retry path');
assert(ownerBlocks.includes('existing.ownerId === ownerId'), 'owner lock release cannot delete a successor lock');
assert(service.includes('idempotency_key'), 'Render receives and enforces the Wix invoice idempotency key');
assert(availability.includes('export const issueBookingInvoiceAdmin') && availability.includes('Permissions.Admin'), 'admin invoice issuance uses a separate immutable Admin permission boundary');
assert(admin.includes('financialVersion') && admin.includes('issueBookingInvoiceAdmin'), 'admin edits use versioned authenticated invoice claims');
assert(!admin.includes('requireAdmin') && !admin.includes('currentUser'), 'Admin web methods rely only on immutable Permissions.Admin');
assert(availability.includes("'financialVersion'"), 'summary refreshes preserve invoice financialVersion');
assert(reconciler.includes("state = 'manual_review'"), 'stale ambiguous invoice claims transition to manual review without automatic resend');
assert(jobs.includes('"cronExpression": "0 * * * *"'), 'calendar reconciliation uses Wix-supported hourly scheduling');
