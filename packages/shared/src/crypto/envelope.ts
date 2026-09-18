import { EncryptedPayload, MedicalRecordDecrypted } from '../types/index.js';

/**
 * Converts a string (hex, base64, or raw utf-8) to a CryptoKey for AES-GCM
 */
async function importKek(rawKek: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  // Derive or hash to guaranteed 256 bits (32 bytes)
  const kekBytes = encoder.encode(rawKek);
  const hash = await crypto.subtle.digest('SHA-256', kekBytes);

  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

/**
 * Encrypts a medical record using an Envelope Encryption pattern:
 * 1. Generates an ephemeral Data Encryption Key (DEK) via AES-GCM 256.
 * 2. Encrypts the sensitive medical payload with the DEK.
 * 3. Encrypts (wraps) the DEK using the Secrets Store KEK (kek-2026-09).
 */
export async function encryptMedicalRecord(
  data: MedicalRecordDecrypted,
  kekSecret: string
): Promise<EncryptedPayload> {
  const kek = await importKek(kekSecret);

  // 1. Generate ephemeral DEK
  const dek = (await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )) as CryptoKey;

  // 2. Encrypt payload with DEK
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedPayload = new TextEncoder().encode(JSON.stringify(data));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    dek,
    encodedPayload
  );

  // 3. Encrypt DEK with KEK
  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const exportedDek = (await crypto.subtle.exportKey('raw', dek)) as ArrayBuffer;
  const encryptedDekBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: dekIv },
    kek,
    exportedDek
  );

  // Package encrypted envelope with IVs
  const combinedDek = new Uint8Array(dekIv.length + encryptedDekBuffer.byteLength);
  combinedDek.set(dekIv, 0);
  combinedDek.set(new Uint8Array(encryptedDekBuffer), dekIv.length);

  return {
    version: 'v1',
    iv: btoa(String.fromCharCode(...iv)),
    encryptedDek: btoa(String.fromCharCode(...combinedDek)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer))),
  };
}

/**
 * Decrypts an encrypted medical record envelope:
 * 1. Decrypts the DEK using the Secrets Store KEK (kek-2026-09).
 * 2. Decrypts the medical payload using the DEK.
 */
export async function decryptMedicalRecord(
  envelope: EncryptedPayload,
  kekSecret: string
): Promise<MedicalRecordDecrypted> {
  const kek = await importKek(kekSecret);

  // 1. Unwrap DEK
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
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // 2. Decrypt payload
  const iv = Uint8Array.from(atob(envelope.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(envelope.ciphertext), (c) => c.charCodeAt(0));

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    dek,
    ciphertext
  );

  const decodedJson = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decodedJson) as MedicalRecordDecrypted;
}
