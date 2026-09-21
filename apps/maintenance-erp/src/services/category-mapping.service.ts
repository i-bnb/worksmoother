import { SupabaseClient } from '@supabase/supabase-js';

export class CategoryMappingService {
  /**
   * Lists all operational category-to-GL mappings for an organization.
   */
  static async listMappings(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('financial_category_mappings')
      .select('*, account:chart_of_accounts(id, account_code, account_name, account_type)')
      .eq('company_id', companyId)
      .order('category_code', { ascending: true });

    if (error) throw new Error(`Failed to list category mappings: ${error.message}`);
    return data;
  }

  /**
   * Sets or updates an operational category mapping.
   */
  static async setMapping(
    client: SupabaseClient,
    companyId: string,
    categoryCode: string,
    accountId: string,
    description?: string
  ) {
    const { data, error } = await client
      .from('financial_category_mappings')
      .upsert(
        {
          company_id: companyId,
          category_code: categoryCode.toUpperCase().trim(),
          account_id: accountId,
          description: description || null,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id, category_code' }
      )
      .select()
      .single();

    if (error) throw new Error(`Failed to set category mapping: ${error.message}`);
    return data;
  }

  /**
   * Resolves the linked GL account ID for an operational category.
   */
  static async getAccountForCategory(
    client: SupabaseClient,
    companyId: string,
    categoryCode: string
  ): Promise<string | null> {
    const { data, error } = await client
      .from('financial_category_mappings')
      .select('account_id')
      .eq('company_id', companyId)
      .eq('category_code', categoryCode.toUpperCase().trim())
      .eq('is_active', true)
      .single();

    if (error || !data) return null;
    return data.account_id;
  }
}
