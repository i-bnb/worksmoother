import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  CustomerCreditNoteCreateDto,
  ApplyCreditNoteDto,
  DebitNoteCreateDto,
  SupplierCreditNoteCreateDto,
  ApplySupplierCreditNoteDto,
  validateCustomerCreditNoteCreate,
  validateApplyCreditNote,
  validateDebitNoteCreate,
  validateSupplierCreditNoteCreate,
  validateApplySupplierCreditNote,
} from '../schemas/credit-debit-note.schema.js';
import { DocumentNumberService } from './document-number.service.js';
import { JournalPostingService, JournalLineInput } from './journal-posting.service.js';

export class CreditDebitNoteService {
  // =========================================================================
  // 1. Customer Credit Notes
  // =========================================================================

  static async createCustomerCreditNote(
    client: SupabaseClient,
    rawDto: CustomerCreditNoteCreateDto,
    userId?: string
  ) {
    const dto = validateCustomerCreditNoteCreate(rawDto);

    // 1. Verify Customer
    const { data: customer, error: cErr } = await client
      .from('customers')
      .select('id, company_id, name')
      .eq('company_id', dto.companyId)
      .eq('id', dto.customerId)
      .single();

    if (cErr || !customer) {
      throw new Error(`Customer not found: ${cErr?.message || dto.customerId}`);
    }

    // 2. If referencing invoice, validate invoice and bounds
    let invoice = null;
    if (dto.invoiceId) {
      const { data: inv, error: iErr } = await client
        .from('invoices')
        .select('*')
        .eq('company_id', dto.companyId)
        .eq('id', dto.invoiceId)
        .single();

      if (iErr || !inv) {
        throw new Error(`Referenced invoice not found: ${iErr?.message || dto.invoiceId}`);
      }

      if (inv.status === 'void' || inv.status === 'cancelled') {
        throw new Error(`Cannot issue credit note against a ${inv.status} invoice`);
      }

      invoice = inv;
    }

    // 3. Calculate Lines & Taxes using Decimal
    let subtotalDec = Decimal.zero();
    let taxAmountDec = Decimal.zero();
    let grandTotalDec = Decimal.zero();

    const preparedLines = dto.lines.map((l, idx) => {
      const qtyDec = new Decimal(l.quantity);
      const priceDec = new Decimal(l.unitPrice);
      const lineSubtotalDec = qtyDec.times(priceDec).round(3);

      const cgstRateDec = new Decimal(l.cgstRate || 0);
      const sgstRateDec = new Decimal(l.sgstRate || 0);
      const igstRateDec = new Decimal(l.igstRate || 0);

      const hundred = new Decimal(100);
      const cgstAmtDec = lineSubtotalDec.times(cgstRateDec).dividedBy(hundred).round(3);
      const sgstAmtDec = lineSubtotalDec.times(sgstRateDec).dividedBy(hundred).round(3);
      const igstAmtDec = lineSubtotalDec.times(igstRateDec).dividedBy(hundred).round(3);
      const lineTaxDec = cgstAmtDec.plus(sgstAmtDec).plus(igstAmtDec);
      const lineTotalDec = lineSubtotalDec.plus(lineTaxDec);

      subtotalDec = subtotalDec.plus(lineSubtotalDec);
      taxAmountDec = taxAmountDec.plus(lineTaxDec);
      grandTotalDec = grandTotalDec.plus(lineTotalDec);

      return {
        line_number: idx + 1,
        item_id: l.itemId || null,
        description: l.description,
        quantity: qtyDec.toNumber(),
        unit_price: priceDec.toNumber(),
        tax_rate: l.taxRate || 0,
        cgst_rate: cgstRateDec.toNumber(),
        cgst_amount: cgstAmtDec.toNumber(),
        sgst_rate: sgstRateDec.toNumber(),
        sgst_amount: sgstAmtDec.toNumber(),
        igst_rate: igstRateDec.toNumber(),
        igst_amount: igstAmtDec.toNumber(),
        hsn_sac_code: l.hsnSacCode || null,
        line_total: lineTotalDec.toNumber(),
      };
    });

    // 4. Over-credit Guard against invoice
    if (invoice) {
      const invGrandTotalDec = new Decimal(invoice.grand_total || 0);
      const { data: existingCredits } = await client
        .from('credit_notes')
        .select('grand_total')
        .eq('invoice_id', invoice.id)
        .in('status', ['approved', 'issued', 'posted', 'applied']);

      let totalExistingDec = Decimal.zero();
      for (const ec of existingCredits || []) {
        totalExistingDec = totalExistingDec.plus(new Decimal(ec.grand_total || 0));
      }

      if (totalExistingDec.plus(grandTotalDec).greaterThan(invGrandTotalDec)) {
        throw new Error(
          `Total credits (${totalExistingDec.plus(grandTotalDec).toNumber()}) cannot exceed invoice grand total (${invGrandTotalDec.toNumber()})`
        );
      }
    }

    // 5. Generate document number
    const creditNoteNumber = await DocumentNumberService.generate(client, dto.companyId, 'CN');

    // 6. Insert credit note
    const cnPayload = {
      company_id: dto.companyId,
      branch_id: dto.branchId,
      customer_id: dto.customerId,
      invoice_id: dto.invoiceId,
      work_order_id: dto.workOrderId,
      credit_note_number: creditNoteNumber,
      credit_note_date: dto.creditNoteDate || new Date().toISOString().split('T')[0],
      credit_note_type: dto.creditNoteType || 'sales_return',
      currency: dto.currency || 'INR',
      subtotal: subtotalDec.toNumber(),
      taxable_amount: subtotalDec.toNumber(),
      tax_amount: taxAmountDec.toNumber(),
      grand_total: grandTotalDec.toNumber(),
      amount_applied: 0,
      refunded_amount: 0,
      reason: dto.reason,
      status: 'draft',
      created_by: userId || null,
    };

    const { data: creditNote, error: cnErr } = await client
      .from('credit_notes')
      .insert(cnPayload)
      .select('*')
      .single();

    if (cnErr || !creditNote) {
      throw new Error(`Failed to create credit note: ${cnErr?.message}`);
    }

    // 7. Insert credit note lines
    const linesPayload = preparedLines.map((pl) => ({
      credit_note_id: creditNote.id,
      ...pl,
    }));

    const { error: lineErr } = await client.from('credit_note_lines').insert(linesPayload);
    if (lineErr) {
      throw new Error(`Failed to create credit note lines: ${lineErr.message}`);
    }

    return {
      creditNote,
      lines: preparedLines,
    };
  }

  static async postCustomerCreditNoteToGl(
    client: SupabaseClient,
    companyId: string,
    creditNoteId: string,
    glAccounts: {
      salesReturnAccountId: string;
      arControlAccountId: string;
      cgstOutputAccountId?: string;
      sgstOutputAccountId?: string;
      igstOutputAccountId?: string;
    }
  ) {
    const { data: cn, error: cnErr } = await client
      .from('credit_notes')
      .select('*, credit_note_lines(*)')
      .eq('company_id', companyId)
      .eq('id', creditNoteId)
      .single();

    if (cnErr || !cn) throw new Error(`Credit note not found: ${creditNoteId}`);
    if (cn.is_posted_to_gl) throw new Error('Credit note is already posted to the General Ledger');

    const subtotalDec = new Decimal(cn.subtotal);
    const grandTotalDec = new Decimal(cn.grand_total);

    const journalLines: JournalLineInput[] = [];

    // 1. Debit Sales Returns (Revenue reduction)
    journalLines.push({
      accountId: glAccounts.salesReturnAccountId,
      debit: subtotalDec,
      credit: Decimal.zero(),
      customerId: cn.customer_id,
      description: `Sales Return Credit Note ${cn.credit_note_number}`,
    });

    // 2. Debit Tax Output Accounts (reversing output tax liability)
    let totalCgst = Decimal.zero();
    let totalSgst = Decimal.zero();
    let totalIgst = Decimal.zero();

    for (const line of cn.credit_note_lines || []) {
      totalCgst = totalCgst.plus(new Decimal(line.cgst_amount || 0));
      totalSgst = totalSgst.plus(new Decimal(line.sgst_amount || 0));
      totalIgst = totalIgst.plus(new Decimal(line.igst_amount || 0));
    }

    if (totalCgst.greaterThan(0) && glAccounts.cgstOutputAccountId) {
      journalLines.push({
        accountId: glAccounts.cgstOutputAccountId,
        debit: totalCgst,
        credit: Decimal.zero(),
        description: `CGST Output reversal for CN ${cn.credit_note_number}`,
      });
    }

    if (totalSgst.greaterThan(0) && glAccounts.sgstOutputAccountId) {
      journalLines.push({
        accountId: glAccounts.sgstOutputAccountId,
        debit: totalSgst,
        credit: Decimal.zero(),
        description: `SGST Output reversal for CN ${cn.credit_note_number}`,
      });
    }

    if (totalIgst.greaterThan(0) && glAccounts.igstOutputAccountId) {
      journalLines.push({
        accountId: glAccounts.igstOutputAccountId,
        debit: totalIgst,
        credit: Decimal.zero(),
        description: `IGST Output reversal for CN ${cn.credit_note_number}`,
      });
    }

    // 3. Credit Accounts Receivable (reducing customer balance)
    journalLines.push({
      accountId: glAccounts.arControlAccountId,
      debit: Decimal.zero(),
      credit: grandTotalDec,
      customerId: cn.customer_id,
      description: `Accounts Receivable credit for CN ${cn.credit_note_number}`,
    });

    const journalResult = await JournalPostingService.createJournalEntry(client, {
      companyId,
      journalDate: cn.credit_note_date,
      description: `Credit Note ${cn.credit_note_number}`,
      referenceType: 'credit_note',
      referenceId: cn.id,
      lines: journalLines,
      autoPost: true,
    });

    const now = new Date().toISOString();
    await client
      .from('credit_notes')
      .update({
        is_posted_to_gl: true,
        gl_posted_at: now,
        gl_journal_entry_id: journalResult.journal.id,
        status: cn.status === 'draft' ? 'posted' : cn.status,
        updated_at: now,
      })
      .eq('id', creditNoteId);

    return {
      creditNoteId,
      journalEntryId: journalResult.journal.id,
    };
  }

  static async applyCustomerCreditNoteToInvoice(
    client: SupabaseClient,
    companyId: string,
    rawDto: ApplyCreditNoteDto
  ) {
    const dto = validateApplyCreditNote(rawDto);
    const applyDec = new Decimal(dto.amountToApply);

    // 1. Fetch Credit Note
    const { data: cn, error: cnErr } = await client
      .from('credit_notes')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', dto.creditNoteId)
      .single();

    if (cnErr || !cn) throw new Error(`Credit note not found: ${dto.creditNoteId}`);

    const remainingCreditDec = new Decimal(cn.amount_remaining !== undefined ? cn.amount_remaining : (cn.grand_total - (cn.amount_applied || 0) - (cn.refunded_amount || 0)));
    if (applyDec.greaterThan(remainingCreditDec)) {
      throw new Error(
        `Applied amount (${applyDec.toNumber()}) exceeds available credit note balance (${remainingCreditDec.toNumber()})`
      );
    }

    // 2. Fetch Invoice
    const { data: invoice, error: iErr } = await client
      .from('invoices')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', dto.invoiceId)
      .single();

    if (iErr || !invoice) throw new Error(`Invoice not found: ${dto.invoiceId}`);

    const grandTotalDec = new Decimal(invoice.grand_total || 0);
    const currentPaidDec = new Decimal(invoice.amount_paid || 0);
    const currentDueDec = grandTotalDec.minus(currentPaidDec);

    if (applyDec.greaterThan(currentDueDec)) {
      throw new Error(
        `Applied amount (${applyDec.toNumber()}) exceeds invoice amount due (${currentDueDec.toNumber()})`
      );
    }

    const now = new Date().toISOString();

    // 3. Update Invoice
    const newPaidDec = currentPaidDec.plus(applyDec);
    const newDueDec = grandTotalDec.minus(newPaidDec);
    const newInvStatus = newDueDec.isZero() ? 'paid' : 'partially_paid';

    await client
      .from('invoices')
      .update({
        amount_paid: newPaidDec.toNumber(),
        status: newInvStatus,
        updated_at: now,
      })
      .eq('id', invoice.id);

    // 4. Update Credit Note
    const currentAppliedDec = new Decimal(cn.amount_applied || 0);
    const newAppliedDec = currentAppliedDec.plus(applyDec);
    const existingApps = Array.isArray(cn.applied_invoices) ? cn.applied_invoices : [];
    existingApps.push({
      invoice_id: invoice.id,
      amount: applyDec.toNumber(),
      applied_at: now,
    });

    const isFullyExhausted = remainingCreditDec.minus(applyDec).isZero();

    await client
      .from('credit_notes')
      .update({
        amount_applied: newAppliedDec.toNumber(),
        applied_invoices: existingApps,
        status: isFullyExhausted ? 'applied' : 'posted',
        updated_at: now,
      })
      .eq('id', cn.id);

    return {
      creditNoteId: cn.id,
      invoiceId: invoice.id,
      appliedAmount: applyDec.toNumber(),
      invoiceRemainingDue: newDueDec.toNumber(),
      creditNoteRemainingBalance: remainingCreditDec.minus(applyDec).toNumber(),
    };
  }

  // =========================================================================
  // 2. Customer & Supplier Debit Notes
  // =========================================================================

  static async createDebitNote(
    client: SupabaseClient,
    rawDto: DebitNoteCreateDto,
    userId?: string
  ) {
    const dto = validateDebitNoteCreate(rawDto);

    let subtotalDec = Decimal.zero();
    let taxAmountDec = Decimal.zero();
    let grandTotalDec = Decimal.zero();

    const preparedLines = dto.lines.map((l, idx) => {
      const qtyDec = new Decimal(l.quantity);
      const priceDec = new Decimal(l.unitPrice);
      const lineSubtotalDec = qtyDec.times(priceDec).round(3);

      const cgstRateDec = new Decimal(l.cgstRate || 0);
      const sgstRateDec = new Decimal(l.sgstRate || 0);
      const igstRateDec = new Decimal(l.igstRate || 0);

      const hundred = new Decimal(100);
      const cgstAmtDec = lineSubtotalDec.times(cgstRateDec).dividedBy(hundred).round(3);
      const sgstAmtDec = lineSubtotalDec.times(sgstRateDec).dividedBy(hundred).round(3);
      const igstAmtDec = lineSubtotalDec.times(igstRateDec).dividedBy(hundred).round(3);
      const lineTaxDec = cgstAmtDec.plus(sgstAmtDec).plus(igstAmtDec);
      const lineTotalDec = lineSubtotalDec.plus(lineTaxDec);

      subtotalDec = subtotalDec.plus(lineSubtotalDec);
      taxAmountDec = taxAmountDec.plus(lineTaxDec);
      grandTotalDec = grandTotalDec.plus(lineTotalDec);

      return {
        item_id: l.itemId || null,
        description: l.description,
        quantity: qtyDec.toNumber(),
        unit_price: priceDec.toNumber(),
        tax_rate: l.taxRate || 0,
        cgst_rate: cgstRateDec.toNumber(),
        cgst_amount: cgstAmtDec.toNumber(),
        sgst_rate: sgstRateDec.toNumber(),
        sgst_amount: sgstAmtDec.toNumber(),
        igst_rate: igstRateDec.toNumber(),
        igst_amount: igstAmtDec.toNumber(),
        hsn_sac_code: l.hsnSacCode || null,
        line_total: lineTotalDec.toNumber(),
      };
    });

    const debitNoteNumber = await DocumentNumberService.generate(client, dto.companyId, 'DBN');

    const dnPayload = {
      company_id: dto.companyId,
      branch_id: dto.branchId,
      party_type: dto.partyType,
      customer_id: dto.customerId,
      supplier_id: dto.supplierId,
      debit_note_number: debitNoteNumber,
      reference_invoice_id: dto.referenceInvoiceId,
      reference_bill_id: dto.referenceBillId,
      debit_note_date: dto.debitNoteDate || new Date().toISOString().split('T')[0],
      currency: dto.currency || 'INR',
      subtotal: subtotalDec.toNumber(),
      tax_amount: taxAmountDec.toNumber(),
      grand_total: grandTotalDec.toNumber(),
      amount_paid: 0,
      reason: dto.reason,
      status: 'draft',
      created_by: userId || null,
    };

    const { data: debitNote, error: dnErr } = await client
      .from('debit_notes')
      .insert(dnPayload)
      .select('*')
      .single();

    if (dnErr || !debitNote) {
      throw new Error(`Failed to create debit note: ${dnErr?.message}`);
    }

    const linesPayload = preparedLines.map((pl) => ({
      debit_note_id: debitNote.id,
      ...pl,
    }));

    await client.from('debit_note_lines').insert(linesPayload);

    return {
      debitNote,
      lines: preparedLines,
    };
  }

  static async postDebitNoteToGl(
    client: SupabaseClient,
    companyId: string,
    debitNoteId: string,
    glAccounts: {
      receivableOrPayableAccountId: string;
      incomeOrExpenseAccountId: string;
      taxAccountId?: string;
    }
  ) {
    const { data: dn, error: dErr } = await client
      .from('debit_notes')
      .select('*, debit_note_lines(*)')
      .eq('company_id', companyId)
      .eq('id', debitNoteId)
      .single();

    if (dErr || !dn) throw new Error(`Debit note not found: ${debitNoteId}`);
    if (dn.is_posted_to_gl) throw new Error('Debit note is already posted to the General Ledger');

    const subtotalDec = new Decimal(dn.subtotal);
    const taxDec = new Decimal(dn.tax_amount);
    const grandTotalDec = new Decimal(dn.grand_total);

    const journalLines: JournalLineInput[] = [];

    if (dn.party_type === 'customer') {
      // Customer Debit Note (Charging extra to customer)
      // Debit: Accounts Receivable (grandTotal)
      journalLines.push({
        accountId: glAccounts.receivableOrPayableAccountId,
        debit: grandTotalDec,
        credit: Decimal.zero(),
        customerId: dn.customer_id,
        description: `Customer Debit Note ${dn.debit_note_number}`,
      });

      // Credit: Income / Revenue (subtotal)
      journalLines.push({
        accountId: glAccounts.incomeOrExpenseAccountId,
        debit: Decimal.zero(),
        credit: subtotalDec,
        description: `Revenue for Debit Note ${dn.debit_note_number}`,
      });

      // Credit: Tax Output (tax)
      if (taxDec.greaterThan(0) && glAccounts.taxAccountId) {
        journalLines.push({
          accountId: glAccounts.taxAccountId,
          debit: Decimal.zero(),
          credit: taxDec,
          description: `Tax Output for Debit Note ${dn.debit_note_number}`,
        });
      }
    } else {
      // Supplier Debit Note (Debiting vendor for return/shortage)
      // Debit: Accounts Payable (grandTotal)
      journalLines.push({
        accountId: glAccounts.receivableOrPayableAccountId,
        debit: grandTotalDec,
        credit: Decimal.zero(),
        supplierId: dn.supplier_id,
        description: `Supplier Debit Note ${dn.debit_note_number}`,
      });

      // Credit: Expense / Inventory (subtotal)
      journalLines.push({
        accountId: glAccounts.incomeOrExpenseAccountId,
        debit: Decimal.zero(),
        credit: subtotalDec,
        description: `Adjustment for Debit Note ${dn.debit_note_number}`,
      });

      // Credit: Tax Input Reversal (tax)
      if (taxDec.greaterThan(0) && glAccounts.taxAccountId) {
        journalLines.push({
          accountId: glAccounts.taxAccountId,
          debit: Decimal.zero(),
          credit: taxDec,
          description: `ITC reversal for Debit Note ${dn.debit_note_number}`,
        });
      }
    }

    const journalResult = await JournalPostingService.createJournalEntry(client, {
      companyId,
      journalDate: dn.debit_note_date,
      description: `Debit Note ${dn.debit_note_number}`,
      referenceType: 'debit_note',
      referenceId: dn.id,
      lines: journalLines,
      autoPost: true,
    });

    const now = new Date().toISOString();
    await client
      .from('debit_notes')
      .update({
        is_posted_to_gl: true,
        gl_journal_entry_id: journalResult.journal.id,
        status: 'posted',
        updated_at: now,
      })
      .eq('id', debitNoteId);

    return {
      debitNoteId,
      journalEntryId: journalResult.journal.id,
    };
  }

  // =========================================================================
  // 3. Supplier Credit Notes (Vendor Credits)
  // =========================================================================

  static async createSupplierCreditNote(
    client: SupabaseClient,
    rawDto: SupplierCreditNoteCreateDto,
    userId?: string
  ) {
    const dto = validateSupplierCreditNoteCreate(rawDto);

    let subtotalDec = Decimal.zero();
    let taxAmountDec = Decimal.zero();
    let grandTotalDec = Decimal.zero();

    const preparedLines = dto.lines.map((l, idx) => {
      const qtyDec = new Decimal(l.quantity);
      const priceDec = new Decimal(l.unitPrice);
      const lineSubtotalDec = qtyDec.times(priceDec).round(3);

      const cgstRateDec = new Decimal(l.cgstRate || 0);
      const sgstRateDec = new Decimal(l.sgstRate || 0);
      const igstRateDec = new Decimal(l.igstRate || 0);

      const hundred = new Decimal(100);
      const cgstAmtDec = lineSubtotalDec.times(cgstRateDec).dividedBy(hundred).round(3);
      const sgstAmtDec = lineSubtotalDec.times(sgstRateDec).dividedBy(hundred).round(3);
      const igstAmtDec = lineSubtotalDec.times(igstRateDec).dividedBy(hundred).round(3);
      const lineTaxDec = cgstAmtDec.plus(sgstAmtDec).plus(igstAmtDec);
      const lineTotalDec = lineSubtotalDec.plus(lineTaxDec);

      subtotalDec = subtotalDec.plus(lineSubtotalDec);
      taxAmountDec = taxAmountDec.plus(lineTaxDec);
      grandTotalDec = grandTotalDec.plus(lineTotalDec);

      return {
        item_id: l.itemId || null,
        description: l.description,
        quantity: qtyDec.toNumber(),
        unit_price: priceDec.toNumber(),
        tax_rate: l.taxRate || 0,
        cgst_rate: cgstRateDec.toNumber(),
        cgst_amount: cgstAmtDec.toNumber(),
        sgst_rate: sgstRateDec.toNumber(),
        sgst_amount: sgstAmtDec.toNumber(),
        igst_rate: igstRateDec.toNumber(),
        igst_amount: igstAmtDec.toNumber(),
        hsn_sac_code: l.hsnSacCode || null,
        line_total: lineTotalDec.toNumber(),
        expense_account_id: l.expenseAccountId || null,
      };
    });

    const creditNoteNumber = await DocumentNumberService.generate(client, dto.companyId, 'SCN');

    const scnPayload = {
      company_id: dto.companyId,
      branch_id: dto.branchId,
      supplier_id: dto.supplierId,
      bill_id: dto.billId,
      po_id: dto.poId,
      credit_note_number: creditNoteNumber,
      vendor_credit_note_number: dto.vendorCreditNoteNumber,
      credit_note_date: dto.creditNoteDate || new Date().toISOString().split('T')[0],
      currency: dto.currency || 'INR',
      subtotal: subtotalDec.toNumber(),
      tax_amount: taxAmountDec.toNumber(),
      grand_total: grandTotalDec.toNumber(),
      amount_applied: 0,
      refunded_amount: 0,
      reason: dto.reason,
      status: 'draft',
      created_by: userId || null,
    };

    const { data: supplierCreditNote, error: sErr } = await client
      .from('supplier_credit_notes')
      .insert(scnPayload)
      .select('*')
      .single();

    if (sErr || !supplierCreditNote) {
      throw new Error(`Failed to create supplier credit note: ${sErr?.message}`);
    }

    const linesPayload = preparedLines.map((pl) => ({
      supplier_credit_note_id: supplierCreditNote.id,
      ...pl,
    }));

    await client.from('supplier_credit_note_lines').insert(linesPayload);

    return {
      supplierCreditNote,
      lines: preparedLines,
    };
  }

  static async postSupplierCreditNoteToGl(
    client: SupabaseClient,
    companyId: string,
    supplierCreditNoteId: string,
    glAccounts: {
      apControlAccountId: string;
      purchaseReturnAccountId: string;
      itcAccountId?: string;
    }
  ) {
    const { data: scn, error: scErr } = await client
      .from('supplier_credit_notes')
      .select('*, supplier_credit_note_lines(*)')
      .eq('company_id', companyId)
      .eq('id', supplierCreditNoteId)
      .single();

    if (scErr || !scn) throw new Error(`Supplier credit note not found: ${supplierCreditNoteId}`);
    if (scn.is_posted_to_gl) throw new Error('Supplier credit note is already posted to the General Ledger');

    const subtotalDec = new Decimal(scn.subtotal);
    const taxDec = new Decimal(scn.tax_amount);
    const grandTotalDec = new Decimal(scn.grand_total);

    const journalLines: JournalLineInput[] = [];

    // 1. Debit Accounts Payable (reduces liability owed to supplier)
    journalLines.push({
      accountId: glAccounts.apControlAccountId,
      debit: grandTotalDec,
      credit: Decimal.zero(),
      supplierId: scn.supplier_id,
      description: `Accounts Payable reduction for SCN ${scn.credit_note_number}`,
    });

    // 2. Credit Purchase Returns / Expense (reduces expenses or inventory)
    journalLines.push({
      accountId: glAccounts.purchaseReturnAccountId,
      debit: Decimal.zero(),
      credit: subtotalDec,
      description: `Purchase return credit for SCN ${scn.credit_note_number}`,
    });

    // 3. Credit Input Tax (reversing Input Tax Credit)
    if (taxDec.greaterThan(0) && glAccounts.itcAccountId) {
      journalLines.push({
        accountId: glAccounts.itcAccountId,
        debit: Decimal.zero(),
        credit: taxDec,
        description: `ITC reversal for SCN ${scn.credit_note_number}`,
      });
    }

    const journalResult = await JournalPostingService.createJournalEntry(client, {
      companyId,
      journalDate: scn.credit_note_date,
      description: `Supplier Credit Note ${scn.credit_note_number}`,
      referenceType: 'supplier_credit_note',
      referenceId: scn.id,
      lines: journalLines,
      autoPost: true,
    });

    const now = new Date().toISOString();
    await client
      .from('supplier_credit_notes')
      .update({
        is_posted_to_gl: true,
        gl_journal_entry_id: journalResult.journal.id,
        status: 'posted',
        updated_at: now,
      })
      .eq('id', supplierCreditNoteId);

    return {
      supplierCreditNoteId,
      journalEntryId: journalResult.journal.id,
    };
  }

  static async applySupplierCreditNoteToBill(
    client: SupabaseClient,
    companyId: string,
    rawDto: ApplySupplierCreditNoteDto
  ) {
    const dto = validateApplySupplierCreditNote(rawDto);
    const applyDec = new Decimal(dto.amountToApply);

    // 1. Fetch Supplier Credit Note
    const { data: scn, error: scErr } = await client
      .from('supplier_credit_notes')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', dto.supplierCreditNoteId)
      .single();

    if (scErr || !scn) throw new Error(`Supplier credit note not found: ${dto.supplierCreditNoteId}`);

    const remainingCreditDec = new Decimal(scn.amount_remaining !== undefined ? scn.amount_remaining : (scn.grand_total - (scn.amount_applied || 0) - (scn.refunded_amount || 0)));
    if (applyDec.greaterThan(remainingCreditDec)) {
      throw new Error(
        `Applied amount (${applyDec.toNumber()}) exceeds available supplier credit balance (${remainingCreditDec.toNumber()})`
      );
    }

    // 2. Fetch Supplier Bill
    const { data: bill, error: bErr } = await client
      .from('supplier_bills')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', dto.billId)
      .single();

    if (bErr || !bill) throw new Error(`Supplier bill not found: ${dto.billId}`);

    const grandTotalDec = new Decimal(bill.grand_total || 0);
    const currentPaidDec = new Decimal(bill.amount_paid || 0);
    const currentDueDec = grandTotalDec.minus(currentPaidDec);

    if (applyDec.greaterThan(currentDueDec)) {
      throw new Error(
        `Applied amount (${applyDec.toNumber()}) exceeds bill amount due (${currentDueDec.toNumber()})`
      );
    }

    const now = new Date().toISOString();

    // 3. Update Bill
    const newPaidDec = currentPaidDec.plus(applyDec);
    const newDueDec = grandTotalDec.minus(newPaidDec);
    const newBillStatus = newDueDec.isZero() ? 'paid' : 'partially_paid';

    await client
      .from('supplier_bills')
      .update({
        amount_paid: newPaidDec.toNumber(),
        status: newBillStatus,
        updated_at: now,
      })
      .eq('id', bill.id);

    // 4. Update Supplier Credit Note
    const currentAppliedDec = new Decimal(scn.amount_applied || 0);
    const newAppliedDec = currentAppliedDec.plus(applyDec);
    const existingBills = Array.isArray(scn.applied_bills) ? scn.applied_bills : [];
    existingBills.push({
      bill_id: bill.id,
      amount: applyDec.toNumber(),
      applied_at: now,
    });

    const isFullyExhausted = remainingCreditDec.minus(applyDec).isZero();

    await client
      .from('supplier_credit_notes')
      .update({
        amount_applied: newAppliedDec.toNumber(),
        applied_bills: existingBills,
        status: isFullyExhausted ? 'applied' : 'posted',
        updated_at: now,
      })
      .eq('id', scn.id);

    return {
      supplierCreditNoteId: scn.id,
      billId: bill.id,
      appliedAmount: applyDec.toNumber(),
      billRemainingDue: newDueDec.toNumber(),
      supplierCreditNoteRemainingBalance: remainingCreditDec.minus(applyDec).toNumber(),
    };
  }
}
