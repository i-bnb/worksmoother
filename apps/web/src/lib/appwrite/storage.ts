/**
 * Frontend Appwrite Storage utilities.
 *
 * Handles file uploads and media retrieval exclusively via Appwrite Storage.
 * All other operations (auth, scheduling, directory) use the Cloudflare D1 / Better Auth stack.
 *
 * Bucket layout:
 * – public-assets      : Doctor photos and hospital logos (public read)
 * – clinical-documents : Patient clinical files (owner-scoped read/write)
 *
 * SECURITY: Files > 20 MB are rejected BEFORE upload because Appwrite silently
 * bypasses at-rest encryption for files exceeding that threshold.
 */
import { getStorage, ID } from './client';
import type { Models } from 'appwrite';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
export const BUCKET_PUBLIC_ASSETS = 'public-assets';
export const BUCKET_CLINICAL_DOCS = 'clinical-documents';

/** 20 MB in bytes — Appwrite's at-rest encryption threshold */
const MAX_ENCRYPTED_FILE_SIZE = 20 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Size guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Throws FILE_TOO_LARGE if the file exceeds the 20 MB encryption threshold.
 * Must be called before every upload to clinical-documents bucket.
 */
function enforceFileSizeLimit(file: File): void {
  if (file.size > MAX_ENCRYPTED_FILE_SIZE) {
    throw new Error(
      `FILE_TOO_LARGE: "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. ` +
      `Maximum allowed size is 20 MB to ensure at-rest encryption is applied.`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clinical Documents (restricted bucket)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a clinical document to the restricted `clinical-documents` bucket.
 * Enforces the 20 MB encrypted-file limit before touching the network.
 *
 * @param file - The File object selected by the patient
 * @param fileId - Optional Appwrite file ID; auto-generated if omitted
 * @returns Appwrite File metadata
 */
export async function uploadClinicalDocument(
  file: File,
  fileId: string = ID.unique()
): Promise<Models.File> {
  enforceFileSizeLimit(file);
  const storage = getStorage();
  return storage.createFile(BUCKET_CLINICAL_DOCS, fileId, file);
}

/**
 * Delete a clinical document.
 * Only the file owner or a server-side admin key can perform this.
 */
export async function deleteClinicalDocument(fileId: string): Promise<void> {
  const storage = getStorage();
  await storage.deleteFile(BUCKET_CLINICAL_DOCS, fileId);
}

/**
 * List clinical documents for the authenticated patient.
 * Appwrite enforces document-level permissions — patients only see their own files.
 */
export async function listClinicalDocuments(): Promise<Models.FileList> {
  const storage = getStorage();
  return storage.listFiles(BUCKET_CLINICAL_DOCS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Assets (doctor photos / hospital logos)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a doctor photo or hospital logo to the public-assets bucket.
 * Images are publicly readable but write access is restricted to admin roles.
 * No size limit enforced here (public, non-sensitive media), but keep < 10 MB in practice.
 *
 * @param file - Image file (JPEG/PNG/WebP)
 * @param fileId - Optional Appwrite file ID; auto-generated if omitted
 * @returns Appwrite File metadata
 */
export async function uploadDoctorPhoto(
  file: File,
  fileId: string = ID.unique()
): Promise<Models.File> {
  const storage = getStorage();
  return storage.createFile(BUCKET_PUBLIC_ASSETS, fileId, file);
}

/**
 * Get a public preview URL for a doctor photo or hospital logo.
 * Returns a string URL suitable for use in <img src>.
 *
 * @param fileId - Appwrite file ID stored in the D1 doctor record
 * @param width  - Optional resize width in pixels (default 256)
 * @param height - Optional resize height in pixels (default 256)
 */
export function getDoctorPhotoUrl(
  fileId: string,
  width: number = 256,
  height: number = 256
): string {
  const storage = getStorage();
  return storage.getFilePreview(BUCKET_PUBLIC_ASSETS, fileId, width, height).toString();
}

/**
 * Get the original download URL for a public asset.
 */
export function getDoctorPhotoDownloadUrl(fileId: string): string {
  const storage = getStorage();
  return storage.getFileDownload(BUCKET_PUBLIC_ASSETS, fileId).toString();
}
