import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  ReconciliationSessionStartDto,
  ReconciliationManualMatchDto,
  ReconciliationAutoMatchDto,
  validateReconciliationSessionStart,
  validateReconciliationManualMatch,
} from '../schemas/banking.schema.js';
import { DocumentNumberService } from './document-number.service.js';

export class BankReconciliationService {
  /**
   * Starts a new reconciliation session for a bank account.
   */
  static async startSession(
    client: SupabaseClient,
    rawDto: ReconciliationSessionStartDto,
    userId?: string
  ) {
    const dto = validateReconciliationSessionStart(rawDto);

    // 1. Fetch bank account & current system book balance
    const { data: bankAccount, error: bErr } = await client
      .from('bank_accounts')
      .select('id, company_id, current_balance, statement_balance, cleared_balance')
      .eq('company_id', dto.companyId)
      .eq('id', dto.bankAccountId)
      .single();

    if (bErr || !bankAccount) {
      throw new Error(`Bank account not found: ${bErr?.message || dto.bankAccountId}`);
    }

    const sessionNumber = await DocumentNumberService.generate(client, dto.companyId, 'REC');

    const stmtCloseDec = new Decimal(dto.statementClosingBalance);
    const initialClearedDec = new Decimal(dto.statementOpeningBalance);
    const initialDiff = stmtCloseDec.minus(initialClearedDec);

    const sessionPayload = {
      company_id: dto.companyId,
      bank_account_id: dto.bankAccountId,
      session_number: sessionNumber,
      statement_date: dto.statementDate,
      statement_opening_balance: dto.statementOpeningBalance,
      statement_closing_balance: dto.statementClosingBalance,
      system_opening_balance: bankAccount.cleared_balance || dto.statementOpeningBalance,
      system_closing_balance: bankAccount.current_balance,
      cleared_balance: initialClearedDec.toNumber(),
      uncleared_debits: 0,
      uncleared_credits: 0,
      difference: initialDiff.toNumber(),
      status: 'in_progress',
      notes: dto.notes,
      created_by: userId || null,
    };

    const { data: session, error: sErr } = await client
      .from('bank_reconciliation_sessions')
      .insert(sessionPayload)
      .select('*')
      .single();

    if (sErr || !session) {
      throw new Error(`Failed to start reconciliation session: ${sErr?.message}`);
    }

    return session;
  }

  /**
   * Manually matches a bank transaction line to an ERP transaction entity.
   */
  static async manualMatch(
    client: SupabaseClient,
    rawDto: ReconciliationManualMatchDto
  ) {
    const dto = validateReconciliationManualMatch(rawDto);

    // 1. Fetch session
    const { data: session, error: sErr } = await client
      .from('bank_reconciliation_sessions')
      .select('*')
      .eq('company_id', dto.companyId)
      .eq('id', dto.sessionId)
      .single();

    if (sErr || !session) {
      throw new Error(`Reconciliation session not found: ${sErr?.message || dto.sessionId}`);
    }

    if (session.status === 'reconciled' || session.status === 'cancelled') {
      throw new Error(`Cannot modify a ${session.status} reconciliation session`);
    }

    // 2. Fetch bank transaction
    const { data: bankTx, error: txErr } = await client
      .from('bank_transactions')
      .select('*')
      .eq('id', dto.bankTransactionId)
      .single();

    if (txErr || !bankTx) {
      throw new Error(`Bank transaction not found: ${txErr?.message || dto.bankTransactionId}`);
    }

    if (bankTx.reconciliation_status === 'RECONCILED') {
      throw new Error('Bank transaction is already reconciled in another session');
    }

    const matchAmountDec = new Decimal(dto.matchedAmount);
    const txAmountDec = new Decimal(bankTx.amount);

    if (matchAmountDec.greaterThan(txAmountDec)) {
      throw new Error(`Matched amount (${matchAmountDec.toNumber()}) exceeds bank transaction amount (${txAmountDec.toNumber()})`);
    }

    // 3. Create match record
    const matchPayload = {
      company_id: dto.companyId,
      session_id: dto.sessionId,
      bank_transaction_id: dto.bankTransactionId,
      matched_entity_type: dto.matchedEntityType,
      matched_entity_id: dto.matchedEntityId,
      matched_amount: matchAmountDec.toNumber(),
      match_type: 'manual',
      notes: dto.notes,
    };

    const { data: matchRecord, error: mErr } = await client
      .from('bank_reconciliation_matches')
      .insert(matchPayload)
      .select('*')
      .single();

    if (mErr || !matchRecord) {
      throw new Error(`Failed to create reconciliation match: ${mErr?.message}`);
    }

    // 4. Update bank transaction status
    await client
      .from('bank_transactions')
      .update({
        reconciliation_status: matchAmountDec.equals(txAmountDec) ? 'MATCHED' : 'PARTIALLY_MATCHED',
        matched_entity_type: dto.matchedEntityType,
        matched_entity_id: dto.matchedEntityId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', dto.bankTransactionId);

    // 5. Update session cleared balance and difference
    // Credit adds to bank balance, Debit subtracts from bank balance
    const currentClearedDec = new Decimal(session.cleared_balance || 0);
    const delta = bankTx.transaction_type === 'credit' ? matchAmountDec : Decimal.zero().minus(matchAmountDec);
    const newClearedDec = currentClearedDec.plus(delta);

    const stmtClosingDec = new Decimal(session.statement_closing_balance);
    const newDiffDec = stmtClosingDec.minus(newClearedDec);

    const { data: updatedSession, error: uErr } = await client
      .from('bank_reconciliation_sessions')
      .update({
        cleared_balance: newClearedDec.toNumber(),
        difference: newDiffDec.toNumber(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', dto.sessionId)
      .select('*')
      .single();

    if (uErr) {
      throw new Error(`Failed to update session balance: ${uErr.message}`);
    }

    return {
      match: matchRecord,
      session: updatedSession,
    };
  }

  /**
   * Automatically matches bank transactions against open ERP payments, bills, and transfers.
   */
  static async autoMatch(
    client: SupabaseClient,
    dto: ReconciliationAutoMatchDto
  ) {
    const { data: session, error: sErr } = await client
      .from('bank_reconciliation_sessions')
      .select('*')
      .eq('company_id', dto.companyId)
      .eq('id', dto.sessionId)
      .single();

    if (sErr || !session) {
      throw new Error(`Reconciliation session not found: ${dto.sessionId}`);
    }

    if (session.status === 'reconciled' || session.status === 'cancelled') {
      throw new Error(`Session is ${session.status} and cannot be auto-matched`);
    }

    // Fetch unmatched bank transactions for this account
    const { data: unmatchedTxs, error: tErr } = await client
      .from('bank_transactions')
      .select('*')
      .eq('bank_account_id', session.bank_account_id)
      .in('reconciliation_status', ['UNMATCHED', 'PARTIALLY_MATCHED']);

    if (tErr) throw new Error(`Failed to fetch unmatched bank transactions: ${tErr.message}`);

    let matchCount = 0;
    let runningCleared = new Decimal(session.cleared_balance || 0);

    for (const tx of unmatchedTxs || []) {
      const txAmt = new Decimal(tx.amount).toNumber();

      if (tx.transaction_type === 'credit') {
        // Look for customer payments matching amount or reference number
        let q = client
          .from('payments')
          .select('id, amount, payment_number, payment_date')
          .eq('company_id', dto.companyId)
          .eq('amount', txAmt)
          .eq('status', 'received')
          .limit(1);

        if (tx.reference_number) {
          q = q.eq('reference_number', tx.reference_number);
        }

        const { data: custPayments } = await q;
        if (custPayments && custPayments.length > 0) {
          const match = custPayments[0];
          await client.from('bank_reconciliation_matches').insert({
            company_id: dto.companyId,
            session_id: dto.sessionId,
            bank_transaction_id: tx.id,
            matched_entity_type: 'customer_payment',
            matched_entity_id: match.id,
            matched_amount: txAmt,
            match_type: 'auto',
            notes: `Auto-matched to Customer Payment ${match.payment_number}`,
          });

          await client.from('bank_transactions').update({
            reconciliation_status: 'MATCHED',
            matched_entity_type: 'customer_payment',
            matched_entity_id: match.id,
            updated_at: new Date().toISOString(),
          }).eq('id', tx.id);

          runningCleared = runningCleared.plus(new Decimal(txAmt));
          matchCount++;
          continue;
        }
      } else if (tx.transaction_type === 'debit') {
        // Look for supplier payments or expenses matching amount
        let q = client
          .from('supplier_payments')
          .select('id, amount, payment_number')
          .eq('company_id', dto.companyId)
          .eq('amount', txAmt)
          .limit(1);

        if (tx.reference_number) {
          q = q.eq('reference_number', tx.reference_number);
        }

        const { data: suppPayments } = await q;
        if (suppPayments && suppPayments.length > 0) {
          const match = suppPayments[0];
          await client.from('bank_reconciliation_matches').insert({
            company_id: dto.companyId,
            session_id: dto.sessionId,
            bank_transaction_id: tx.id,
            matched_entity_type: 'supplier_payment',
            matched_entity_id: match.id,
            matched_amount: txAmt,
            match_type: 'auto',
            notes: `Auto-matched to Supplier Payment ${match.payment_number}`,
          });

          await client.from('bank_transactions').update({
            reconciliation_status: 'MATCHED',
            matched_entity_type: 'supplier_payment',
            matched_entity_id: match.id,
            updated_at: new Date().toISOString(),
          }).eq('id', tx.id);

          runningCleared = runningCleared.minus(new Decimal(txAmt));
          matchCount++;
          continue;
        }
      }
    }

    const stmtClosingDec = new Decimal(session.statement_closing_balance);
    const newDiff = stmtClosingDec.minus(runningCleared);

    await client
      .from('bank_reconciliation_sessions')
      .update({
        cleared_balance: runningCleared.toNumber(),
        difference: newDiff.toNumber(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', dto.sessionId);

    return {
      autoMatchedCount: matchCount,
      newClearedBalance: runningCleared.toNumber(),
      newDifference: newDiff.toNumber(),
    };
  }

  /**
   * Finalizes and completes a reconciliation session.
   * STRICT GUARD: Difference between statement closing balance and cleared balance MUST be exactly zero.
   */
  static async completeSession(
    client: SupabaseClient,
    companyId: string,
    sessionId: string,
    userId?: string
  ) {
    const { data: session, error: sErr } = await client
      .from('bank_reconciliation_sessions')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', sessionId)
      .single();

    if (sErr || !session) {
      throw new Error(`Reconciliation session not found: ${sessionId}`);
    }

    if (session.status === 'reconciled') {
      throw new Error('Reconciliation session is already finalized and completed');
    }

    // STRICT ZERO-DIFFERENCE GUARD
    const diffDec = new Decimal(session.difference || 0).abs();
    if (diffDec.greaterThan(new Decimal('0.001'))) {
      throw new Error(
        `Cannot complete reconciliation session: Difference must be 0.000 before completing (Current difference: ${session.difference})`
      );
    }

    const now = new Date().toISOString();

    // 1. Mark session as reconciled
    const { data: updatedSession, error: uErr } = await client
      .from('bank_reconciliation_sessions')
      .update({
        status: 'reconciled',
        reconciled_at: now,
        reconciled_by: userId || null,
        updated_at: now,
      })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (uErr) {
      throw new Error(`Failed to finalize reconciliation session: ${uErr.message}`);
    }

    // 2. Mark all matched bank transactions as RECONCILED
    const { data: matches } = await client
      .from('bank_reconciliation_matches')
      .select('bank_transaction_id')
      .eq('session_id', sessionId);

    if (matches && matches.length > 0) {
      const txIds = matches.map((m: any) => m.bank_transaction_id);
      await client
        .from('bank_transactions')
        .update({
          reconciliation_status: 'RECONCILED',
          updated_at: now,
        })
        .in('id', txIds);
    }

    // 3. Update bank account last_reconciled_date and balances
    await client
      .from('bank_accounts')
      .update({
        cleared_balance: session.cleared_balance,
        statement_balance: session.statement_closing_balance,
        last_reconciled_date: session.statement_date,
        updated_at: now,
      })
      .eq('id', session.bank_account_id);

    return updatedSession;
  }
}
