import { SupabaseClient } from '@supabase/supabase-js';

export type DocumentType = 'QUO' | 'SO' | 'INV' | 'PAY' | 'CN' | 'WO' | 'JRN' | 'BILL' | 'SPAY' | 'EXP' | 'RNT' | 'AMC' | 'TRF' | 'STMT' | 'REC' | 'DBN' | 'SCN' | 'REF';

export class DocumentNumberService {
  /**
   * Generates collision-safe, transactional document number using PostgreSQL sequence logic.
   */
  static async generate(
    client: SupabaseClient,
    companyId: string,
    docType: DocumentType,
    branchId?: string | null
  ): Promise<string> {
    const { data, error } = await client.rpc('generate_document_number', {
      p_company_id: companyId,
      p_doc_type: docType,
      p_branch_id: branchId || null,
    });

    if (error || !data) {
      throw new Error(`Failed to generate document number for ${docType}: ${error?.message || 'No data'}`);
    }

    return data as string;
  }
}
