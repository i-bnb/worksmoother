import { R2PresignedUrlResult } from '../types/index.js';

export interface GeneratePresignedUrlOptions {
  bucketName?: string;
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  fileExtension?: string;
  contentType?: string;
  customPrefix?: string;
  expiresInSeconds?: number;
}

/**
 * SHA-256 helper returning lowercase hex
 */
async function sha256Hex(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * HMAC-SHA256 helper
 */
async function hmacSha256(key: Uint8Array | CryptoKey, message: string): Promise<Uint8Array> {
  let cryptoKey: CryptoKey;
  if (key instanceof Uint8Array) {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } else {
    cryptoKey = key;
  }

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(message)
  );
  return new Uint8Array(signature);
}

/**
 * Derives AWS SigV4 signing key
 */
async function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Promise<Uint8Array> {
  const kSecret = new TextEncoder().encode('AWS4' + key);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, regionName);
  const kService = await hmacSha256(kRegion, serviceName);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * Generates an S3/R2-compatible presigned PUT URL for Cloudflare R2.
 * 
 * Enforces:
 * 1. Strict five-minute (300 seconds) expiration window.
 * 2. Cryptographically random object key (`raw/${crypto.randomUUID()}.${ext}`).
 * 3. AWS SigV4 signed URL protocol for Cloudflare R2.
 */
export async function generateR2PresignedPutUrl(
  options: GeneratePresignedUrlOptions = {}
): Promise<R2PresignedUrlResult> {
  const bucketName = options.bucketName || 'doctorcare-patient-files';
  const accountId = options.accountId || 'doctorcare-cf-acc';
  const accessKeyId = options.accessKeyId || 'mock_r2_access_key';
  const secretAccessKey = options.secretAccessKey || 'mock_r2_secret_key';
  const contentType = options.contentType || 'application/octet-stream';
  
  // Clean file extension (only letters and numbers)
  const rawExt = options.fileExtension?.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const prefix = options.customPrefix ? `${options.customPrefix.replace(/\/$/, '')}/` : 'raw/';
  
  // Random cryptographic object key
  const randomId = crypto.randomUUID();
  const objectKey = `${prefix}${randomId}.${rawExt}`;

  // Strict 5-minute expiry (300 seconds)
  const expiresInSeconds = 300 as const;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();

  const isMock = accessKeyId.startsWith('mock_') || secretAccessKey.startsWith('mock_');

  // Format dates for AWS SigV4
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHmmssZ
  const dateStamp = amzDate.substring(0, 8); // YYYYMMDD
  const region = 'auto';
  const service = 's3';

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${bucketName}/${objectKey}`;

  // Canonical Query Parameters (must be sorted alphabetically)
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${dateStamp}/${region}/${service}/aws4_request`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '300',
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const canonicalRequestHash = await sha256Hex(canonicalRequest);

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    `${dateStamp}/${region}/${service}/aws4_request`,
    canonicalRequestHash,
  ].join('\n');

  // Derive signature
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  const signatureHex = Array.from(signatureBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const uploadUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signatureHex}`;

  return {
    uploadUrl,
    objectKey,
    method: 'PUT',
    expiresInSeconds: 300,
    expiresAt,
    headers: {
      'Content-Type': contentType,
    },
    mock: isMock,
  };
}
