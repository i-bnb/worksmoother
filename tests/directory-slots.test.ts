import * as fs from 'fs';
import * as path from 'path';
import { SlotDurableObject } from '../workers/api/src/durable-objects/SlotDurableObject.js';
import {
  HoldSlotSchema,
  ConfirmSlotSchema,
  CreateDoctorSchema,
  validateStrictJson,
} from '../workers/api/src/schemas/index.js';

// In-memory mock for DurableObjectState with alarm and SQLite simulation
class MockSlotDurableObjectState {
  storage: {
    scheduledAlarm: number | null;
    setAlarm: (timestamp: number) => Promise<void>;
    getAlarm: () => Promise<number | null>;
    deleteAlarm: () => Promise<void>;
  };

  constructor() {
    let alarmTime: number | null = null;
    this.storage = {
      scheduledAlarm: null,
      setAlarm: async (timestamp: number) => {
        alarmTime = timestamp;
        this.storage.scheduledAlarm = timestamp;
      },
      getAlarm: async () => alarmTime,
      deleteAlarm: async () => {
        alarmTime = null;
        this.storage.scheduledAlarm = null;
      },
    };
  }
}

async function runDirectoryAndSlotsTest() {
  console.log('================================================================');
  console.log('   RUNNING DIRECTORY MODULE, SLOT DO & STRICT ZOD TEST SUITE    ');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Appwrite Directory & Slot Schema in Project A
  // --------------------------------------------------------------------------
  console.log('[Test 1] Verifying Directory, AVAILABILITY_SLOT & BOOKING schema in Project A...');

  const config = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../infra/appwrite/appwrite.config.json'), 'utf8')
  );

  const operationalDb = config.projectA.databases.find((d: any) => d.id === 'operational_db');
  if (!operationalDb) {
    throw new Error('FAILED: operational_db missing from Project A!');
  }

  const collections = operationalDb.collections.map((c: any) => c.id);
  const requiredCollections = ['HOSPITAL', 'DEPARTMENT', 'DOCTOR', 'ROOM', 'AVAILABILITY_SLOT', 'BOOKING'];

  for (const req of requiredCollections) {
    if (!collections.includes(req)) {
      throw new Error(`FAILED: Collection "${req}" missing from Project A schema!`);
    }
  }
  console.log(`  -> PASSED: Relational Directory collections verified: [${requiredCollections.join(', ')}].`);

  // Verify AVAILABILITY_SLOT plaintext unique index on slot_key
  const slotCol = operationalDb.collections.find((c: any) => c.id === 'AVAILABILITY_SLOT');
  const slotKeyAttr = slotCol.attributes.find((a: any) => a.key === 'slot_key');
  if (!slotKeyAttr || slotKeyAttr.type !== 'string') {
    throw new Error('FAILED: slot_key attribute missing in AVAILABILITY_SLOT!');
  }

  const slotKeyUniqueIndex = slotCol.indexes?.find(
    (idx: any) => idx.type === 'unique' && idx.attributes.includes('slot_key')
  );
  if (!slotKeyUniqueIndex) {
    throw new Error('FAILED: Plaintext unique index on slot_key missing in AVAILABILITY_SLOT!');
  }
  console.log(`  -> PASSED: AVAILABILITY_SLOT has plaintext unique index on slot_key (${slotKeyUniqueIndex.key}).`);

  // Verify BOOKING collection fields: hold_expires_at and idempotency_key
  const bookingCol = operationalDb.collections.find((c: any) => c.id === 'BOOKING');
  const hasHoldExpiresAt = bookingCol.attributes.some((a: any) => a.key === 'hold_expires_at');
  const hasIdempotencyKey = bookingCol.attributes.some((a: any) => a.key === 'idempotency_key');

  if (!hasHoldExpiresAt || !hasIdempotencyKey) {
    throw new Error('FAILED: BOOKING collection missing hold_expires_at or idempotency_key attributes!');
  }
  console.log('  -> PASSED: BOOKING collection schema includes hold_expires_at and idempotency_key.');

  // --------------------------------------------------------------------------
  // TEST 2: Strict Zod Routing Layer (.strict() dropping unexpected fields)
  // --------------------------------------------------------------------------
  console.log('\n[Test 2] Testing Strict Zod Routing Layer (.strict() enforcement)...');

  // 2a. Valid HoldSlot request
  const validHoldPayload = {
    doctor_id: 'doc_cardio_101',
    start_time_utc: '2026-09-18T14:00:00.000Z',
    end_time_utc: '2026-09-18T14:30:00.000Z',
    patient_id: 'pat_sarah_99',
    idempotency_key: 'idem_hold_test_001',
  };

  const parsedValid = HoldSlotSchema.safeParse(validHoldPayload);
  if (!parsedValid.success) {
    throw new Error(`FAILED: Valid HoldSlot payload was rejected: ${JSON.stringify(parsedValid.error)}`);
  }
  console.log('  -> PASSED: Valid payload parsed successfully.');

  // 2b. Payload containing UNEXPECTED / extra fields -> MUST BE REJECTED!
  const maliciousPayload = {
    ...validHoldPayload,
    admin_override: true,
    unexpected_extra_field: 'exploit',
  };

  const parsedMalicious = HoldSlotSchema.safeParse(maliciousPayload);
  if (parsedMalicious.success) {
    throw new Error('SECURITY BREACH: Strict Zod failed to reject unexpected payload fields!');
  }

  const unrecognizedKeys = parsedMalicious.error.errors.filter((e) => e.code === 'unrecognized_keys');
  if (unrecognizedKeys.length === 0) {
    throw new Error('FAILED: Expected unrecognized_keys error for unexpected fields!');
  }
  console.log(`  -> PASSED: Unexpected fields [admin_override, unexpected_extra_field] cleanly rejected with code: unrecognized_keys.`);

  // 2c. Test validateStrictJson helper response
  const mockReqWithExtras = new Request('https://api.yourhospital.com/api/v1/slots/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(maliciousPayload),
  });

  const strictRes = await validateStrictJson(mockReqWithExtras, HoldSlotSchema);
  if (!strictRes.errorResponse || strictRes.errorResponse.status !== 400) {
    throw new Error('FAILED: validateStrictJson did not return 400 Bad Request for unexpected fields!');
  }
  const errorJson = await strictRes.errorResponse.json();
  if (errorJson.error !== 'STRICT_VALIDATION_FAILED') {
    throw new Error('FAILED: Expected STRICT_VALIDATION_FAILED error');
  }
  console.log('  -> PASSED: validateStrictJson helper returned HTTP 400 with strict validation issue details.');

  // --------------------------------------------------------------------------
  // TEST 3: Slot Durable Object - Doctor-Day Sharding & Single-Threaded Locking
  // --------------------------------------------------------------------------
  console.log('\n[Test 3] Testing Slot Durable Object (Doctor-Day Sharding & SQLite Locking)...');

  const mockState = new MockSlotDurableObjectState();
  const slotDo = new SlotDurableObject(mockState as unknown as DurableObjectState, {});

  // 3a. Initial hold on timeslot
  const hold1 = await slotDo.hold({
    doctor_id: 'doc_cardio_101',
    start_time_utc: '2026-09-18T14:00:00.000Z',
    end_time_utc: '2026-09-18T14:30:00.000Z',
    patient_id: 'pat_sarah_99',
    idempotency_key: 'idem_key_patient1',
  });

  if (!hold1.success || (hold1 as any).status !== 'HELD') {
    throw new Error('FAILED: Initial slot hold failed!');
  }
  console.log(`  -> Slot locked in SQLite: ${(hold1 as any).slot_key}, Status: ${(hold1 as any).status}, Hold Expires: ${(hold1 as any).hold_expires_at}`);

  // Verify alarm was scheduled
  if (!mockState.storage.scheduledAlarm) {
    throw new Error('FAILED: setAlarm() was not called when locking slot!');
  }
  console.log(`  -> setAlarm() scheduled for: ${new Date(mockState.storage.scheduledAlarm).toISOString()}`);

  // 3b. Concurrent conflict: Another patient attempts to hold the same slot -> 409 Conflict
  console.log('  -> Simulating race condition: Second client attempts to hold the same slot...');
  const holdConflict = await slotDo.hold({
    doctor_id: 'doc_cardio_101',
    start_time_utc: '2026-09-18T14:00:00.000Z',
    end_time_utc: '2026-09-18T14:30:00.000Z',
    patient_id: 'pat_attacker_22',
    idempotency_key: 'idem_key_patient2',
  });

  if (holdConflict.success || (holdConflict as any).status !== 409) {
    throw new Error('RACE CONDITION BUG: Competing patient was able to acquire an already held slot!');
  }
  console.log(`  -> PASSED: Concurrent request rejected with 409: ${(holdConflict as any).error}`);

  // 3c. Idempotent replay: First patient re-submits with identical idempotency_key
  const holdReplay = await slotDo.hold({
    doctor_id: 'doc_cardio_101',
    start_time_utc: '2026-09-18T14:00:00.000Z',
    end_time_utc: '2026-09-18T14:30:00.000Z',
    patient_id: 'pat_sarah_99',
    idempotency_key: 'idem_key_patient1',
  });

  if (!holdReplay.success || !(holdReplay as any).idempotent_replay) {
    throw new Error('FAILED: Idempotent hold request was not recognized!');
  }
  console.log('  -> PASSED: Idempotent replay succeeded without altering existing lock.');

  // --------------------------------------------------------------------------
  // TEST 4: Automatic 10-Minute Hold Release via alarm()
  // --------------------------------------------------------------------------
  console.log('\n[Test 4] Testing Automatic 10-Minute Hold Release via alarm()...');

  // Fast forward time: simulate 11 minutes having passed
  const originalDateNow = Date.now;
  try {
    Date.now = () => originalDateNow() + 11 * 60 * 1000;

    // Trigger Cloudflare Workers alarm()
    console.log('  -> Triggering DO alarm() at T+11 minutes...');
    await slotDo.alarm();

    // Check slot status: should now be AVAILABLE
    const slots = await slotDo.getSlots();
    const releasedSlot = slots.find((s) => s.slot_key === 'doc_cardio_101:2026-09-18T14:00:00.000Z');

    if (!releasedSlot || releasedSlot.status !== 'AVAILABLE') {
      throw new Error(`FAILED: Expired hold was not released back to AVAILABLE! Status: ${releasedSlot?.status}`);
    }
    console.log('  -> PASSED: Expired timeslot automatically released to AVAILABLE after 10 minutes.');

    // Now another patient can acquire the newly available slot
    const secondPatientHold = await slotDo.hold({
      doctor_id: 'doc_cardio_101',
      start_time_utc: '2026-09-18T14:00:00.000Z',
      end_time_utc: '2026-09-18T14:30:00.000Z',
      patient_id: 'pat_david_88',
      idempotency_key: 'idem_key_patient_david',
    });

    if (!secondPatientHold.success || (secondPatientHold as any).status !== 'HELD') {
      throw new Error('FAILED: New patient could not hold slot after alarm release!');
    }
    console.log('  -> PASSED: New patient successfully acquired timeslot after automatic hold expiration.');
  } finally {
    Date.now = originalDateNow;
  }

  console.log('\n================================================================');
  console.log('ALL DIRECTORY, SLOT DO & STRICT ZOD TESTS PASSED PERFECTLY!     ');
  console.log('================================================================\n');
}

runDirectoryAndSlotsTest().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
