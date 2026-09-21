import { SupabaseClient } from '@supabase/supabase-js';
import { ReceivableService } from '../services/receivable.service.js';
import { PayableService } from '../services/payable.service.js';
import { validateStatementQuery } from '../schemas/statement.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class AccountingStatementsApiController {
  static async getCustomerStatement(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.params?.id;
      if (!customerId) return { status: 400, error: 'Customer ID is required' };

      const { fromDate, toDate } = validateStatementQuery(req.query);
      const data = await ReceivableService.getCustomerStatement(client, customerId, fromDate, toDate);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getSupplierStatement(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      if (!supplierId) return { status: 400, error: 'Supplier ID is required' };

      const { fromDate, toDate } = validateStatementQuery(req.query);
      const data = await PayableService.getSupplierStatement(client, supplierId, fromDate, toDate);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}
