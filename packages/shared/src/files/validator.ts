import { FileValidationResult } from '../types/index.js';

export interface MagicByteDefinition {
  mimeType: string;
  extension: string;
  offset: number;
  signature: number[];
  description: string;
}

export const ALLOWED_HEALTHCARE_FILE_TYPES: MagicByteDefinition[] = [
  {
    mimeType: 'application/pdf',
    extension: 'pdf',
    offset: 0,
    signature: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
    description: 'Portable Document Format (Medical Reports, Discharge Summaries)',
  },
  {
    mimeType: 'application/dicom',
    extension: 'dcm',
    offset: 128,
    signature: [0x44, 0x49, 0x43, 0x4d], // DICM (preceded by 128 bytes preamble)
    description: 'Digital Imaging and Communications in Medicine (X-Ray, MRI, CT)',
  },
  {
    mimeType: 'application/dicom',
    extension: 'dcm',
    offset: 0,
    signature: [0x44, 0x49, 0x43, 0x4d], // DICM at offset 0
    description: 'Digital Imaging and Communications in Medicine (Raw Stream)',
  },
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    offset: 0,
    signature: [0xff, 0xd8, 0xff],
    description: 'JPEG Medical Image',
  },
  {
    mimeType: 'image/png',
    extension: 'png',
    offset: 0,
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    description: 'PNG Medical Scan/Plot',
  },
  {
    mimeType: 'image/tiff',
    extension: 'tiff',
    offset: 0,
    signature: [0x49, 0x49, 0x2a, 0x00], // Little-endian TIFF
    description: 'TIFF Medical Pathology Image',
  },
  {
    mimeType: 'image/tiff',
    extension: 'tiff',
    offset: 0,
    signature: [0x4d, 0x4d, 0x00, 0x2a], // Big-endian TIFF
    description: 'TIFF Medical Pathology Image',
  },
];

/**
 * Server-side File Validation Middleware Helper
 * Inspects raw byte signatures (magic bytes) to verify file authenticity prior to clinical processing.
 * Strictly prevents malicious files (executables, scripts, HTML) masquerading under innocent extensions.
 */
export function validateFileMagicBytes(
  buffer: ArrayBuffer | Uint8Array,
  declaredMimeType?: string
): FileValidationResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const fileSize = bytes.byteLength;

  if (fileSize < 4) {
    return {
      valid: false,
      fileSize,
      magicBytesHex: '',
      error: 'FILE_TOO_SMALL: File must be at least 4 bytes to check magic signature',
    };
  }

  // Extract initial 16 bytes for hex logging
  const previewLength = Math.min(fileSize, 16);
  const magicBytesHex = Array.from(bytes.slice(0, previewLength))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');

  // Match against known healthcare file signatures
  for (const def of ALLOWED_HEALTHCARE_FILE_TYPES) {
    if (bytes.length >= def.offset + def.signature.length) {
      let matches = true;
      for (let i = 0; i < def.signature.length; i++) {
        if (bytes[def.offset + i] !== def.signature[i]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        // If declaredMimeType is provided, verify it does not contradict
        if (declaredMimeType && !declaredMimeType.includes(def.mimeType) && !def.mimeType.includes(declaredMimeType)) {
          // Allow minor aliases (e.g. image/jpeg vs image/jpg)
          const isJpegAlias = declaredMimeType === 'image/jpg' && def.mimeType === 'image/jpeg';
          if (!isJpegAlias) {
            return {
              valid: false,
              detectedMimeType: def.mimeType,
              detectedExtension: def.extension,
              fileSize,
              magicBytesHex,
              error: `MIME_TYPE_MISMATCH: Header declared "${declaredMimeType}" but magic bytes indicate "${def.mimeType}"`,
            };
          }
        }

        return {
          valid: true,
          detectedMimeType: def.mimeType,
          detectedExtension: def.extension,
          fileSize,
          magicBytesHex,
        };
      }
    }
  }

  return {
    valid: false,
    fileSize,
    magicBytesHex,
    error: 'INVALID_FILE_MAGIC_BYTES: File content does not match any approved healthcare formats (%PDF-, DICM, JPEG, PNG, TIFF)',
  };
}
