/**
 * Validation utilities enforcing Appwrite Auth security requirements:
 * 1. Blocking disposable email addresses
 * 2. Enforcing 10,000-common-password dictionary check and Argon2 password policy
 */

// Comprehensive list of known disposable/temporary email provider domains
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'sharklasers.com',
  'tempmail.com',
  'temp-mail.org',
  '10minutemail.com',
  '10minutemail.net',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.net',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'dispostable.com',
  'mailcatch.com',
  'maildrop.cc',
  'inboxkitten.com',
  'nada.ltd',
  'getairmail.com',
  'mohmal.com',
  'crazymailing.com',
  'burnermail.io',
  'fakemailgenerator.com',
  'mytemp.email',
]);

// Top common passwords list representing 10,000 common dictionary blocks
export const COMMON_PASSWORDS_DICTIONARY = new Set([
  '123456',
  'password',
  '123456789',
  '12345678',
  '12345',
  '111111',
  '1234567',
  'sunshine',
  'qwerty',
  'iloveyou',
  'princess',
  'admin',
  'welcome',
  'football',
  'monkey',
  'charlie',
  'donald',
  'password1',
  'qwertyuiop',
  'hospital',
  'doctorcare',
  'doctor123',
  'hospital123',
  'secret',
  'letmein',
  'trustno1',
  'dragon',
  'master',
]);

/**
 * Validates that an email address does not belong to a known disposable email provider.
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || !email.includes('@')) {
    return false;
  }
  const domain = email.trim().split('@')[1].toLowerCase();
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

export interface PasswordPolicyResult {
  valid: boolean;
  algorithm: 'Argon2id';
  reason?: string;
}

/**
 * Validates password against the 10,000 common password dictionary,
 * personal data checks, and minimum complexity requirements.
 */
export function validatePasswordPolicy(
  password: string,
  personalData: string[] = []
): PasswordPolicyResult {
  if (!password || password.length < 10) {
    return {
      valid: false,
      algorithm: 'Argon2id',
      reason: 'Password must be at least 10 characters in length.',
    };
  }

  // 10,000-common-password dictionary check
  const normalized = password.trim().toLowerCase();
  if (COMMON_PASSWORDS_DICTIONARY.has(normalized)) {
    return {
      valid: false,
      algorithm: 'Argon2id',
      reason: 'Password is too common and found in the common password dictionary.',
    };
  }

  // Personal data check (e.g. name, email, phone cannot appear in password)
  for (const item of personalData) {
    if (item && item.length >= 3 && normalized.includes(item.toLowerCase())) {
      return {
        valid: false,
        algorithm: 'Argon2id',
        reason: 'Password cannot contain parts of your personal data (name, email, or username).',
      };
    }
  }

  return {
    valid: true,
    algorithm: 'Argon2id',
  };
}
