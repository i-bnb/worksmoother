/**
 * =============================================================================
 * Security Test: Branch Scope & Isolation
 * Maintenance Management ERP — Phase 0 Foundation
 * =============================================================================
 * Enforces branch boundary constraints:
 *   - Branch-scoped users can only access their authorized branch records
 *   - Company-wide managers/admins bypass branch restrictions
 */

import { describe, it, expect } from 'vitest';
import {
  getAuthenticatedClient,
  DEMO_BRANCH_DXB,
  DEMO_BRANCH_AUH,
} from './helpers.js';

describe('Security: Branch Scope & Isolation', () => {
  it('branch-restricted supervisor can only see their permitted branch', async () => {
    // Vikram Sharma is assigned exclusively to DXB branch
    const { client } = await getAuthenticatedClient('supervisor.dxb@apexfacilities.com');

    const { data: dxbData } = await client
      .from('branches')
      .select('*')
      .eq('id', DEMO_BRANCH_DXB);

    expect(dxbData?.length).toBe(1);

    // Attempt to access Abu Dhabi branch
    const { data: auhData } = await client
      .from('branches')
      .select('*')
      .eq('id', DEMO_BRANCH_AUH);

    // RLS can_access_branch function denies AUH branch to DXB supervisor
    expect(auhData?.length ?? 0).toBe(0);
  });

  it('company-wide operations manager can see all branches within company', async () => {
    // Sara Al-Hashemi has company-wide operations_manager role
    const { client } = await getAuthenticatedClient('ops.manager@apexfacilities.com');

    const { data: allBranches } = await client.from('branches').select('*');

    const branchIds = (allBranches ?? []).map((b) => b.id);
    expect(branchIds).toContain(DEMO_BRANCH_DXB);
    expect(branchIds).toContain(DEMO_BRANCH_AUH);
  });
});
