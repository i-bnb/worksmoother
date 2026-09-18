import {
  EncryptedPayload,
  MedicalRecordDecrypted,
  MedicalRecordAAD,
} from '../types/index.js';

export type KeyUsage =
  | 'encrypt'
  | 'decrypt'
  | 'sign'
  | 'verify'
  | 'deriveKey'
  | 'deriveBits'
  | 'wrapKey'
  | 'unwrapKey';

export interface AesGcmParams {
  name: string;
  iv: Uint8Array | ArrayBuffer;
  additionalData?: Uint8Array | ArrayBuffer;
  tagLength?: number;
}

/**
 * Deterministically serializes Additional Authenticated Data (AAD) into a canonical byte array.
 * Cryptographically binds the medical ciphertext to {hospital_id, patient_id, record_id, field, kek_id}.
 */
export function serializeAAD(aad: MedicalRecordAAD): Uint8Array {
  // Canonical sorted key order
  const canonicalString = JSON.stringify({
    field: aad.field,
    hospital_id: aad.hospital_id,
    kek_id: aad.kek_id,
    patient_id: aad.patient_id,
    record_id: aad.record_id,
  });
  return new TextEncoder().encode(canonicalString);
}

/**
 * Converts a string to a non-extractable CryptoKey for AES-256-GCM.
 * Explicitly sets `extractable: false` to ensure the Key Encryption Key (KEK) cannot be exported from memory.
 */
export async function importKek(
  rawKek: string,
  usages: KeyUsage[] = ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const kekBytes = encoder.encode(rawKek);
  // Derive guaranteed 256 bits (32 bytes)
  const hash = await crypto.subtle.digest('SHA-256', kekBytes);

  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM', length: 256 },
    false, // explicitly non-extractable
    usages
  );
}

/**
 * Encrypts a medical record using an Envelope Encryption pattern:
 * 1. Generates a fresh, cryptographically random 32-byte (256-bit) Data Encryption Key (DEK) per record.
 * 2. Binds the medical ciphertext to its record by passing {hospital_id, patient_id, record_id, field, kek_id}
 *    as Additional Authenticated Data (AAD) to the AES-256-GCM function.
 * 3. Encrypts (wraps) the DEK using the non-extractable Secrets Store KEK (kek-2026-09).
 */
export async function encryptMedicalRecord(
  data: MedicalRecordDecrypted | Record<string, unknown>,
  kekSecret: string,
  aad?: MedicalRecordAAD
): Promise<EncryptedPayload> {
  const kek = await importKek(kekSecret, ['encrypt']);

  // 1. Generate fresh 32-byte (256-bit) cryptographically random DEK per record
  const rawDek = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey(
    'raw',
    rawDek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  // 2. Encrypt payload with DEK using AES-256-GCM and AAD binding
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedPayload = new TextEncoder().encode(JSON.stringify(data));

  const encryptAlgorithm: AesGcmParams = {
    name: 'AES-GCM',
    iv,
  };

  if (aad) {
    encryptAlgorithm.additionalData = serializeAAD(aad);
  }

  const ciphertextBuffer = await crypto.subtle.encrypt(
    encryptAlgorithm,
    dek,
    encodedPayload
  );

  // 3. Encrypt (wrap) 32-byte DEK with KEK using AES-256-GCM
  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedDekBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: dekIv },
    kek,
    rawDek
  );

  // Package encrypted DEK with its IV
  const combinedDek = new Uint8Array(dekIv.length + encryptedDekBuffer.byteLength);
  combinedDek.set(dekIv, 0);
  combinedDek.set(new Uint8Array(encryptedDekBuffer), dekIv.length);

  return {
    version: 'v2',
    iv: btoa(String.fromCharCode(...iv)),
    encryptedDek: btoa(String.fromCharCode(...combinedDek)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer))),
    alg: 'AES-256-GCM',
    aad,
  };
}

/**
 * Decrypts an encrypted medical record envelope:
 * 1. Decrypts the DEK using the non-extractable Secrets Store KEK (kek-2026-09).
 * 2. Verifies the AAD binding and decrypts the medical payload using the DEK.
 *    If the {hospital_id, patient_id, record_id, field, kek_id} does not match, decryption fails cryptographically.
 */
export async function decryptMedicalRecord(
  envelope: EncryptedPayload,
  kekSecret: string,
  aad?: MedicalRecordAAD
): Promise<MedicalRecordDecrypted> {
  // Import KEK as non-extractable CryptoKey (extractable: false)
  const kek = await importKek(kekSecret, ['decrypt']);

  // 1. Unwrap DEK using KEK
  const combinedDek = Uint8Array.from(atob(envelope.encryptedDek), (c) => c.charCodeAt(0));
  const dekIv = combinedDek.slice(0, 12);
  const encryptedDekData = combinedDek.slice(12);

  const rawDek = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: dekIv },
    kek,
    encryptedDekData
  );

  const dek = await crypto.subtle.importKey(
    'raw',
    rawDek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 2. Decrypt payload and verify AAD authentication tag
  const iv = Uint8Array.from(atob(envelope.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(envelope.ciphertext), (c) => c.charCodeAt(0));

  const decryptAlgorithm: AesGcmParams = {
    name: 'AES-GCM',
    iv,
  };

  const effectiveAAD = aad || envelope.aad;
  if (effectiveAAD) {
    decryptAlgorithm.additionalData = serializeAAD(effectiveAAD);
  }

  const decryptedBuffer = await crypto.subtle.decrypt(
    decryptAlgorithm,
    dek,
    ciphertext
  );

  const decodedJson = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decodedJson) as MedicalRecordDecrypted;
}
