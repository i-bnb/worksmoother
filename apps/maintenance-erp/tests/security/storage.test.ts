/**
 * =============================================================================
 * Security Test: Private Storage & Tenant Isolation
 * Maintenance Management ERP — Phase 0 Foundation
 * =============================================================================
 * Verifies:
 *   - Unauthenticated requests cannot read files from private buckets
 *   - Company A users cannot access files prefixed with Company B ID
 *   - Role-based restrictions on bucket uploads (e.g. Technician cannot upload to 'invoices')
 */

import { describe, it, expect } from 'vitest';
import {
  getAnonClient,
  getAuthenticatedClient,
  DEMO_COMPANY_A,
  DEMO_COMPANY_B,
} from './helpers.js';

describe('Security: Private Storage Buckets & Policies', () => {
  it('unauthenticated requests cannot download files from private buckets', async () => {
    const anon = getAnonClient();

    const { data, error } = await anon
      .storage
      .from('invoices')
      .download(`${DEMO_COMPANY_A}/2026/invoice-001.pdf`);

    // Must be blocked by RLS
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('Company A user cannot access files stored under Company B tenant folder', async () => {
    const { client } = await getAuthenticatedClient('ops.manager@apexfacilities.com');

    const { data, error } = await client
      .storage
      .from('documents')
      .download(`${DEMO_COMPANY_B}/contracts/master-agreement.pdf`);

    // Storage RLS evaluates (storage.foldername(name))[1] = get_current_company_id()
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('technician cannot upload files into the invoices bucket', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    const fakePdfBytes = new TextEncoder().encode('%PDF-1.4 Mock Invoice File');

    const { error } = await client
      .storage
      .from('invoices')
      .upload(`${DEMO_COMPANY_A}/INV-001.pdf`, fakePdfBytes, {
        contentType: 'application/pdf',
      });

    // Invoices upload policy permits only owner_admin, operations_manager, and accountant
    expect(error).not.toBeNull();
  });
});
