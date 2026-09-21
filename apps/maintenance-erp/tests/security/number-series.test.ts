/**
 * =============================================================================
 * Security & Integrity Test: Concurrency-Safe Number Series
 * Maintenance Management ERP — Phase 0 Foundation
 * =============================================================================
 * Tests that high-concurrency requests to generate_document_number:
 *   1. Strictly generate unique document numbers without collision or duplicates
 *   2. Follow sequential formatting (e.g. WO-2026-0001, WO-2026-0002)
 *   3. Are safe against race conditions via row-level locks (SELECT ... FOR UPDATE)
 */

import { describe, it, expect } from 'vitest';
import { getAuthenticatedClient, DEMO_COMPANY_A } from './helpers.js';

describe('Integrity & Concurrency: Number Series Generation', () => {
  it('concurrent document generation produces zero duplicate numbers', async () => {
    const { client } = await getAuthenticatedClient('ops.manager@apexfacilities.com');

    const CONCURRENT_REQUESTS = 10;

    // Dispatch 10 concurrent requests to PostgreSQL generate_document_number RPC
    const promises = Array.from({ length: CONCURRENT_REQUESTS }).map(() =>
      client.rpc('generate_document_number', {
        p_company_id: DEMO_COMPANY_A,
        p_doc_type: 'WO',
        p_branch_id: null,
      })
    );

    const results = await Promise.all(promises);

    // Verify all calls succeeded
    for (const res of results) {
      expect(res.error).toBeNull();
      expect(res.data).toBeDefined();
      expect(typeof res.data).toBe('string');
      expect(res.data).toMatch(/^WO-\d{4}-\d{4}$/);
    }

    const generatedNumbers = results.map((r) => r.data as string);

    // Ensure all 10 generated numbers are distinct (Set size equals array length)
    const uniqueSet = new Set(generatedNumbers);
    expect(uniqueSet.size).toBe(CONCURRENT_REQUESTS);
  });
});
