import { SupabaseClient } from '@supabase/supabase-js';

export interface CreateAccountDto {
  companyId: string;
  branchId?: string | null;
  accountCode: string;
  accountName: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  accountGroupId?: string | null;
  parentAccountId?: string | null;
  currency?: string;
  isControlAccount?: boolean;
  openingBalanceDebit?: number;
  openingBalanceCredit?: number;
  notes?: string | null;
}

export interface UpdateAccountDto {
  accountName?: string;
  accountGroupId?: string | null;
  parentAccountId?: string | null;
  isActive?: boolean;
  notes?: string | null;
}

export class ChartOfAccountsService {
  /**
   * Lists chart of accounts with optional filtering by type, active status, or parent.
   */
  static async listAccounts(
    client: SupabaseClient,
    companyId: string,
    filters: { accountType?: string; isActive?: boolean } = {}
  ) {
    let query = client
      .from('chart_of_accounts')
      .select('*, group:account_groups(id, name, code)')
      .eq('company_id', companyId)
      .order('account_code', { ascending: true });

    if (filters.accountType) {
      query = query.eq('account_type', filters.accountType);
    }
    if (filters.isActive !== undefined) {
      query = query.eq('is_active', filters.isActive);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list accounts: ${error.message}`);
    return data;
  }

  /**
   * Retrieves single account details.
   */
  static async getAccount(client: SupabaseClient, accountId: string) {
    const { data, error } = await client
      .from('chart_of_accounts')
      .select('*, group:account_groups(*), parent:chart_of_accounts!parent_account_id(*)')
      .eq('id', accountId)
      .single();

    if (error) throw new Error(`Account fetch failed: ${error.message}`);
    return data;
  }

  /**
   * Creates a new general ledger account.
   */
  static async createAccount(client: SupabaseClient, dto: CreateAccountDto) {
    if (dto.parentAccountId) {
      // Validate parent exists and belongs to same company
      const { data: parent } = await client
        .from('chart_of_accounts')
        .select('id, company_id')
        .eq('id', dto.parentAccountId)
        .single();

      if (!parent || parent.company_id !== dto.companyId) {
        throw new Error('Parent account does not exist or belongs to another organization');
      }
    }

    const { data, error } = await client
      .from('chart_of_accounts')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        account_code: dto.accountCode.trim(),
        account_name: dto.accountName.trim(),
        account_type: dto.accountType,
        account_group_id: dto.accountGroupId || null,
        parent_account_id: dto.parentAccountId || null,
        currency: dto.currency || 'INR',
        is_control_account: dto.isControlAccount || false,
        opening_balance_debit: dto.openingBalanceDebit || 0.0,
        opening_balance_credit: dto.openingBalanceCredit || 0.0,
        notes: dto.notes || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw new Error(`Account creation failed: ${error.message}`);
    return data;
  }

  /**
   * Updates an existing account, validating against circular parent hierarchies.
   */
  static async updateAccount(client: SupabaseClient, accountId: string, dto: UpdateAccountDto) {
    if (dto.parentAccountId) {
      if (dto.parentAccountId === accountId) {
        throw new Error('An account cannot be its own parent');
      }

      // Check for circular reference by walking ancestor tree
      let currentParentId: string | null = dto.parentAccountId;
      const visited = new Set<string>([accountId]);

      while (currentParentId) {
        if (visited.has(currentParentId)) {
          throw new Error('Circular account hierarchy detected. An account cannot have a descendant as its parent.');
        }
        visited.add(currentParentId);

        const { data: parentRec }: { data: any } = await client
          .from('chart_of_accounts')
          .select('parent_account_id')
          .eq('id', currentParentId)
          .single();

        currentParentId = parentRec?.parent_account_id || null;
      }
    }

    const updatePayload: Record<string, any> = {};
    if (dto.accountName !== undefined) updatePayload.account_name = dto.accountName.trim();
    if (dto.accountGroupId !== undefined) updatePayload.account_group_id = dto.accountGroupId;
    if (dto.parentAccountId !== undefined) updatePayload.parent_account_id = dto.parentAccountId;
    if (dto.isActive !== undefined) updatePayload.is_active = dto.isActive;
    if (dto.notes !== undefined) updatePayload.notes = dto.notes;

    const { data, error } = await client
      .from('chart_of_accounts')
      .update(updatePayload)
      .eq('id', accountId)
      .select()
      .single();

    if (error) throw new Error(`Account update failed: ${error.message}`);
    return data;
  }

  /**
   * Safely deactivates an account (preferring deactivation over physical deletion).
   */
  static async deactivateAccount(client: SupabaseClient, accountId: string) {
    // Check if account has posted journal lines
    const { count } = await client
      .from('journal_lines')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);

    if (count && count > 0) {
      // Do not allow deleting; deactivate instead
      return this.updateAccount(client, accountId, { isActive: false });
    }

    const { data, error } = await client
      .from('chart_of_accounts')
      .update({ is_active: false })
      .eq('id', accountId)
      .select()
      .single();

    if (error) throw new Error(`Account deactivation failed: ${error.message}`);
    return data;
  }

  /**
   * Transforms flat account list into nested hierarchy tree.
   */
  static buildAccountTree(accounts: Array<{ id: string; parent_account_id?: string | null; [key: string]: any }>) {
    const map = new Map<string, any>();
    const roots: any[] = [];

    for (const acc of accounts) {
      map.set(acc.id, { ...acc, children: [] });
    }

    for (const acc of accounts) {
      const node = map.get(acc.id);
      if (acc.parent_account_id && map.has(acc.parent_account_id)) {
        map.get(acc.parent_account_id).children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}

