import { DerivedFeeBreakdown } from '../types/index.js';

// Base specialty consultation rates in Indian Rupees (INR)
const SPECIALTY_BASE_FEES: Record<string, number> = {
  cardiology: 1500,
  neurology: 2000,
  orthopedics: 1200,
  pediatrics: 800,
  'general medicine': 800,
  oncology: 2500,
  dermatology: 1000,
};

const TYPE_MULTIPLIERS: Record<string, number> = {
  REGULAR: 1.0,
  SPECIALIST: 1.25,
  SURGICAL: 2.0,
  EMERGENCY: 1.5,
};

/**
 * Derives consultation fee securely on the server.
 * Prevents client-side price tampering by calculating base fee, GST, and total in paise.
 */
export function deriveConsultationFee(
  specialty: string = 'general medicine',
  consultationType: 'REGULAR' | 'SPECIALIST' | 'SURGICAL' | 'EMERGENCY' = 'REGULAR'
): DerivedFeeBreakdown {
  const normSpecialty = (specialty || '').toLowerCase().trim();
  const baseInr = SPECIALTY_BASE_FEES[normSpecialty] || 1000;
  const multiplier = TYPE_MULTIPLIERS[consultationType] || 1.0;

  const adjustedInr = Math.round(baseInr * multiplier);
  const baseFeePaise = adjustedInr * 100; // 1 INR = 100 paise
  const gstPaise = Math.round(baseFeePaise * 0.18); // 18% GST in paise
  const totalPaise = baseFeePaise + gstPaise;

  return {
    baseFee: baseFeePaise,
    gst: gstPaise,
    total: totalPaise,
  };
}

export interface RazorpayOrderInput {
  amount: number; // in paise
  currency?: 'INR';
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderOutput {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

/**
 * Creates a server-side order in Razorpay using the Orders API
 */
export async function createRazorpayOrder(
  keyId: string,
  keySecret: string,
  input: RazorpayOrderInput
): Promise<RazorpayOrderOutput> {
  const currency = input.currency || 'INR';

  // Offline / development / test mock mode if credentials not provided or mock/test prefix
  if (
    !keyId ||
    !keySecret ||
    keyId === 'mock_key_id' ||
    keyId.startsWith('mock_') ||
    keyId.includes('test_mock') ||
    keyId.includes('1234567890')
  ) {
    return {
      id: `order_${Math.random().toString(36).substring(2, 14)}`,
      amount: input.amount,
      currency,
      receipt: input.receipt,
      status: 'created',
    };
  }

  const basicAuth = btoa(`${keyId}:${keySecret}`);
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amount,
      currency,
      receipt: input.receipt,
      notes: input.notes,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Razorpay order creation failed: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as any;
  return {
    id: data.id,
    amount: data.amount,
    currency: data.currency,
    receipt: data.receipt,
    status: data.status,
  };
}

// Ensure crypto.subtle.timingSafeEqual is available in runtime (Node.js and Cloudflare Workers)
if (typeof crypto !== 'undefined' && crypto.subtle && !(crypto.subtle as any).timingSafeEqual) {
  (crypto.subtle as any).timingSafeEqual = function (
    a: ArrayBufferView,
    b: ArrayBufferView
  ): boolean {
    const viewA = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const viewB = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (viewA.byteLength !== viewB.byteLength) {
      return false;
    }
    try {
      // Use native timingSafeEqual when available via runtime loader
      const globalReq = (globalThis as any).require;
      if (typeof globalReq === 'function') {
        const nodeCrypto = globalReq('node:crypto');
        if (typeof nodeCrypto?.timingSafeEqual === 'function') {
          return nodeCrypto.timingSafeEqual(viewA, viewB);
        }
      }
    } catch {
      // Ignore if not available
    }

    // Constant-time bitwise comparison to prevent timing attacks
    let result = 0;
    for (let i = 0; i < viewA.byteLength; i++) {
      result |= viewA[i] ^ viewB[i];
    }
    return result === 0;
  };
}

/**
 * Verifies the Razorpay webhook signature using Web Crypto HMAC-SHA256
 * and constant-time comparison via crypto.subtle.timingSafeEqual().
 *
 * @param rawBodyBuffer Raw ArrayBuffer of request body
 * @param signatureHex Hex signature from 'x-razorpay-signature' header
 * @param webhookSecret Webhook secret configured in Razorpay dashboard
 */
export async function verifyRazorpayWebhookSignature(
  rawBodyBuffer: ArrayBuffer,
  signatureHex: string,
  webhookSecret: string
): Promise<boolean> {
  if (!signatureHex || !webhookSecret) {
    return false;
  }

  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(webhookSecret);

  // Import HMAC-SHA256 Key
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Compute HMAC over raw request body buffer
  const computedSignatureBuffer = await crypto.subtle.sign('HMAC', key, rawBodyBuffer);
  const computedBytes = new Uint8Array(computedSignatureBuffer);

  // Convert received signature (hex string) to Uint8Array
  const cleanHex = signatureHex.trim().toLowerCase();
  if (cleanHex.length !== computedBytes.length * 2) {
    return false;
  }

  const receivedBytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = parseInt(cleanHex.substring(i, i + 2), 16);
    if (isNaN(byte)) {
      return false;
    }
    receivedBytes[i / 2] = byte;
  }

  // Constant-time comparison using crypto.subtle.timingSafeEqual to prevent timing attacks
  return (crypto.subtle as any).timingSafeEqual(computedBytes, receivedBytes);
}
