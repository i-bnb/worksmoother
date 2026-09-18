/**
 * Layer 4: Business-Logic Caps (Domain & Healthcare Policy Quotas)
 * 
 * Enforces healthcare-specific semantic rules and anti-abuse policies:
 * 1. Slot Hoarding Prevention: Max 3 active unconfirmed slot holds per patient.
 * 2. Doctor Exfiltration Prevention: Max 50 clinical record decryptions per doctor per hour (with ER override).
 * 3. File Upload Quota: Max 10 presigned upload URLs per patient per 24 hours.
 * 4. Payment Order Generation Quota: Max 5 order creations per appointment within 15 minutes.
 */

import { BusinessCapViolation } from '../types/index.js';

export const BUSINESS_CAP_LIMITS = {
  MAX_ACTIVE_SLOT_HOLDS_PER_PATIENT: 3,
  MAX_HOURLY_DOCTOR_RECORD_DECRYPTIONS: 50,
  MAX_DAILY_PATIENT_FILE_UPLOADS: 10,
  MAX_PAYMENT_ORDERS_PER_APPOINTMENT: 5,
} as const;

/**
 * Validates that a patient does not exceed maximum concurrent active slot holds.
 */
export function assertActiveSlotHoldCap(
  patientId: string,
  currentActiveHolds: number,
  maxHolds: number = BUSINESS_CAP_LIMITS.MAX_ACTIVE_SLOT_HOLDS_PER_PATIENT
): BusinessCapViolation | null {
  if (currentActiveHolds >= maxHolds) {
    return {
      allowed: false,
      quota: 'ACTIVE_SLOT_HOLDS',
      limit: maxHolds,
      current: currentActiveHolds,
      message: `Patient ${patientId} has reached the maximum allowed concurrent slot holds (${maxHolds}). Please confirm or release an existing reservation before holding additional slots.`,
      actionRequired: 'CONFIRM_OR_RELEASE_EXISTING_HOLD',
    };
  }
  return null;
}

/**
 * Validates clinical record decryption velocity for a doctor account.
 * HIPAA § 164.312 anti-exfiltration measure.
 * Can be bypassed in emergency care when hasEmergencyOverride = true.
 */
export function assertDoctorDecryptionVelocityCap(
  doctorId: string,
  hourlyCount: number,
  maxPerHour: number = BUSINESS_CAP_LIMITS.MAX_HOURLY_DOCTOR_RECORD_DECRYPTIONS,
  hasEmergencyOverride: boolean = false
): BusinessCapViolation | null {
  if (hourlyCount >= maxPerHour) {
    if (hasEmergencyOverride) {
      // Emergency override permitted, but must be explicitly logged in audit trail
      return null;
    }
    return {
      allowed: false,
      quota: 'DOCTOR_DECRYPTION_HOURLY',
      limit: maxPerHour,
      current: hourlyCount,
      message: `Doctor ${doctorId} has exceeded the standard hourly clinical record decryption limit (${maxPerHour}/hour). Emergency clinical override justification required.`,
      actionRequired: 'PROVIDE_EMERGENCY_OVERRIDE_HEADER',
    };
  }
  return null;
}

/**
 * Validates daily patient file upload URL requests.
 */
export function assertPatientFileUploadCap(
  patientId: string,
  dailyCount: number,
  maxPerDay: number = BUSINESS_CAP_LIMITS.MAX_DAILY_PATIENT_FILE_UPLOADS
): BusinessCapViolation | null {
  if (dailyCount >= maxPerDay) {
    return {
      allowed: false,
      quota: 'DAILY_FILE_UPLOADS',
      limit: maxPerDay,
      current: dailyCount,
      message: `Patient ${patientId} has reached the maximum daily file upload limit (${maxPerDay}/day). Please contact hospital records administration for high-volume file transfers.`,
      actionRequired: 'CONTACT_HOSPITAL_ADMIN',
    };
  }
  return null;
}

/**
 * Validates payment order creation attempts per appointment to prevent Razorpay order spam.
 */
export function assertPaymentOrderCap(
  appointmentId: string,
  attemptCount: number,
  maxAttempts: number = BUSINESS_CAP_LIMITS.MAX_PAYMENT_ORDERS_PER_APPOINTMENT
): BusinessCapViolation | null {
  if (attemptCount >= maxAttempts) {
    return {
      allowed: false,
      quota: 'PAYMENT_ORDERS_PER_APPOINTMENT',
      limit: maxAttempts,
      current: attemptCount,
      message: `Maximum payment attempts (${maxAttempts}) reached for appointment ${appointmentId}. Please contact billing support.`,
      actionRequired: 'CONTACT_BILLING_SUPPORT',
    };
  }
  return null;
}
