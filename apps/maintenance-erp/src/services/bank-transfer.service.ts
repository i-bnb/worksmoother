import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  BankTransferCreateDto,
  validateBankTransferCreate,
} from '../schemas/banking.schema.js';
import { DocumentNumberService } from './document-number.service.js';
import { JournalPostingService, JournalLineInput } from './journal-posting.service.js';

export class BankTransferService {
  /**
   * Executes an atomic transfer between two internal bank accounts with double-entry GL posting.
   */
  static async executeTransfer(
    client: SupabaseClient,
    rawDto: BankTransferCreateDto,
    userId?: string
  ) {
    const dto = validateBankTransferCreate(rawDto);
    const amountDec = new Decimal(dto.amount);
    const feeDec = new Decimal(dto.transferFee || 0);
    const totalDeductionDec = amountDec.plus(feeDec);
    const exchangeRateDec = new Decimal(dto.exchangeRate || 1.0);
    const destAmountDec = amountDec.times(exchangeRateDec).round(3);

    // 1. Fetch Source Account
    const { data: sourceAcc, error: srcErr } = await client
      .from('bank_accounts')
      .select('*')
      .eq('company_id', dto.companyId)
      .eq('id', dto.sourceAccountId)
      .single();

    if (srcErr || !sourceAcc) {
      throw new Error(`Source bank account not found: ${srcErr?.message || dto.sourceAccountId}`);
    }

    if (!sourceAcc.is_active) {
      throw new Error(`Source bank account "${sourceAcc.account_name}" is inactive`);
    }

    // 2. Fetch Destination Account
    const { data: destAcc, error: dstErr } = await client
      .from('bank_accounts')
      .select('*')
      .eq('company_id', dto.companyId)
      .eq('id', dto.destinationAccountId)
      .single();

    if (dstErr || !destAcc) {
      throw new Error(`Destination bank account not found: ${dstErr?.message || dto.destinationAccountId}`);
    }

    if (!destAcc.is_active) {
      throw new Error(`Destination bank account "${destAcc.account_name}" is inactive`);
    }

    // 3. Balance verification
    const srcBalanceDec = new Decimal(sourceAcc.current_balance || 0);
    if (srcBalanceDec.lessThan(totalDeductionDec)) {
      throw new Error(
        `Insufficient funds in source account "${sourceAcc.account_name}". Balance: ${srcBalanceDec.toNumber()}, Required: ${totalDeductionDec.toNumber()}`
      );
    }

    // 4. Generate transfer number
    const transferNumber = await DocumentNumberService.generate(client, dto.companyId, 'TRF');

    // 5. Create GL Journal Entry (if both accounts have gl_account_id configured)
    let journalEntryId: string | null = null;

    if (sourceAcc.gl_account_id && destAcc.gl_account_id) {
      const journalLines: JournalLineInput[] = [];

      // Destination: Debit Asset
      journalLines.push({
        accountId: destAcc.gl_account_id,
        debit: destAmountDec,
        credit: Decimal.zero(),
        description: `Transfer in from ${sourceAcc.account_name} (${transferNumber})`,
      });

      // Transfer Fee (if applicable)
      if (feeDec.greaterThan(0)) {
        if (!dto.feeAccountId) {
          throw new Error('feeAccountId is required when transferFee is greater than 0');
        }
        journalLines.push({
          accountId: dto.feeAccountId,
          debit: feeDec,
          credit: Decimal.zero(),
          description: `Bank transfer fee (${transferNumber})`,
        });
      }

      // Source: Credit Asset (Transfer amount + Fee)
      journalLines.push({
        accountId: sourceAcc.gl_account_id,
        debit: Decimal.zero(),
        credit: totalDeductionDec,
        description: `Transfer out to ${destAcc.account_name} (${transferNumber})`,
      });

      const journalResult = await JournalPostingService.createJournalEntry(client, {
        companyId: dto.companyId,
        journalDate: dto.transferDate || new Date().toISOString().split('T')[0],
        description: `Bank Transfer ${transferNumber}: ${sourceAcc.account_name} -> ${destAcc.account_name}`,
        referenceType: 'bank_transfer',
        referenceId: null,
        lines: journalLines,
        autoPost: true,
      });

      journalEntryId = journalResult.journal.id;
    }

    // 6. Create bank_transfers record
    const transferPayload = {
      company_id: dto.companyId,
      transfer_number: transferNumber,
      source_account_id: dto.sourceAccountId,
      destination_account_id: dto.destinationAccountId,
      transfer_date: dto.transferDate || new Date().toISOString().split('T')[0],
      amount: amountDec.toNumber(),
      transfer_fee: feeDec.toNumber(),
      fee_account_id: dto.feeAccountId || null,
      exchange_rate: exchangeRateDec.toNumber(),
      reference_number: dto.referenceNumber || null,
      status: 'completed',
      gl_journal_entry_id: journalEntryId,
      notes: dto.notes || null,
      created_by: userId || null,
    };

    const { data: transferRecord, error: trfErr } = await client
      .from('bank_transfers')
      .insert(transferPayload)
      .select('*')
      .single();

    if (trfErr || !transferRecord) {
      throw new Error(`Failed to record bank transfer: ${trfErr?.message}`);
    }

    // 7. Update balances atomically
    const newSrcBal = srcBalanceDec.minus(totalDeductionDec).toNumber();
    await client
      .from('bank_accounts')
      .update({
        current_balance: newSrcBal,
        updated_at: new Date().toISOString(),
      })
      .eq('id', dto.sourceAccountId);

    const destBalDec = new Decimal(destAcc.current_balance || 0);
    const newDstBal = destBalDec.plus(destAmountDec).toNumber();
    await client
      .from('bank_accounts')
      .update({
        current_balance: newDstBal,
        updated_at: new Date().toISOString(),
      })
      .eq('id', dto.destinationAccountId);

    return {
      transfer: transferRecord,
      sourceAccount: {
        id: sourceAcc.id,
        name: sourceAcc.account_name,
        previousBalance: srcBalanceDec.toNumber(),
        newBalance: newSrcBal,
      },
      destinationAccount: {
        id: destAcc.id,
        name: destAcc.account_name,
        previousBalance: destBalDec.toNumber(),
        newBalance: newDstBal,
      },
      journalEntryId,
    };
  }
}
