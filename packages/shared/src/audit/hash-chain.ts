import {
  HashChainedAuditBlock,
  AuditChainVerificationResult,
  RecordAccessLog,
} from '../types/index.js';

/**
 * Canonical Genesis Hash: 64 zeroes representing the root of the hash chain.
 */
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Computes deterministic canonical JSON string with strictly sorted keys
 */
export function canonicalizeBlockData(
  data: Omit<HashChainedAuditBlock, 'current_hash'>
): string {
  return JSON.stringify({
    accessor_id: data.accessor_id,
    accessor_role: data.accessor_role,
    action: data.action,
    hospital_id: data.hospital_id,
    ip_address: data.ip_address,
    log_id: data.log_id,
    patient_id: data.patient_id,
    previous_hash: data.previous_hash,
    purpose: data.purpose,
    record_id: data.record_id,
    sequence_number: data.sequence_number,
    status: data.status,
    timestamp: data.timestamp,
    user_agent: data.user_agent,
  });
}

/**
 * Computes SHA-256 digest over the canonical block contents
 */
export async function computeAuditBlockHash(
  blockData: Omit<HashChainedAuditBlock, 'current_hash'>
): Promise<string> {
  const canonical = canonicalizeBlockData(blockData);
  const msgUint8 = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface CreateAuditBlockOptions {
  entry: RecordAccessLog | {
    log_id: string;
    record_id: string;
    patient_id: string;
    hospital_id: string;
    accessor_id: string;
    accessor_role: string;
    action?: string;
    purpose?: string;
    ip_address?: string;
    user_agent?: string;
    status?: string;
    created_at?: string;
  };
  previousHash?: string;
  sequenceNumber?: number;
}

/**
 * Creates and cryptographically seals a new HashChainedAuditBlock.
 * Links to previous_hash and computes the SHA-256 current_hash.
 */
export async function createAuditBlock(
  options: CreateAuditBlockOptions
): Promise<HashChainedAuditBlock> {
  const seqNum = options.sequenceNumber ?? 1;
  const prevHash = options.previousHash || GENESIS_HASH;
  const entry = options.entry;
  const timestamp = entry.created_at || new Date().toISOString();

  const blockData: Omit<HashChainedAuditBlock, 'current_hash'> = {
    sequence_number: seqNum,
    timestamp,
    previous_hash: prevHash,
    log_id: entry.log_id,
    record_id: entry.record_id,
    patient_id: entry.patient_id,
    hospital_id: entry.hospital_id,
    accessor_id: entry.accessor_id,
    accessor_role: entry.accessor_role,
    action: entry.action || 'READ',
    purpose: entry.purpose || 'CLINICAL_TREATMENT',
    ip_address: entry.ip_address || '127.0.0.1',
    user_agent: entry.user_agent || 'DoctorCare-Records-Worker',
    status: entry.status || 'RECORDED',
  };

  const currentHash = await computeAuditBlockHash(blockData);

  return {
    ...blockData,
    current_hash: currentHash,
  };
}

/**
 * Verifies a sequential array of HashChainedAuditBlocks for mathematical tamper-evidence.
 * 
 * Rules enforced:
 * 1. Block 1 must link to GENESIS_HASH.
 * 2. Sequence numbers must be strictly sequential (1, 2, 3...).
 * 3. Each block's previous_hash must exactly match the preceding block's current_hash.
 * 4. Each block's current_hash must match the recomputed SHA-256 digest of its canonical contents.
 */
export async function verifyAuditChain(
  blocks: HashChainedAuditBlock[]
): Promise<AuditChainVerificationResult> {
  if (!blocks || blocks.length === 0) {
    return {
      valid: true,
      totalBlocks: 0,
      genesisHash: GENESIS_HASH,
    };
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const expectedSeq = i + 1;

    // Check sequence number
    if (block.sequence_number !== expectedSeq) {
      return {
        valid: false,
        totalBlocks: blocks.length,
        genesisHash: GENESIS_HASH,
        error: `SEQUENCE_GAP: Expected sequence ${expectedSeq} at index ${i}, but found ${block.sequence_number}`,
        tamperedIndex: i,
        brokenBlock: block,
      };
    }

    // Check previous_hash linkage
    const expectedPrevHash = i === 0 ? GENESIS_HASH : blocks[i - 1].current_hash;
    if (block.previous_hash !== expectedPrevHash) {
      return {
        valid: false,
        totalBlocks: blocks.length,
        genesisHash: GENESIS_HASH,
        error: `BROKEN_HASH_LINK: Block ${block.sequence_number} previous_hash does not match preceding current_hash`,
        tamperedIndex: i,
        brokenBlock: block,
      };
    }

    // Recompute block digest to verify content integrity
    const recomputedHash = await computeAuditBlockHash({
      sequence_number: block.sequence_number,
      timestamp: block.timestamp,
      previous_hash: block.previous_hash,
      log_id: block.log_id,
      record_id: block.record_id,
      patient_id: block.patient_id,
      hospital_id: block.hospital_id,
      accessor_id: block.accessor_id,
      accessor_role: block.accessor_role,
      action: block.action,
      purpose: block.purpose,
      ip_address: block.ip_address,
      user_agent: block.user_agent,
      status: block.status,
    });

    if (recomputedHash !== block.current_hash) {
      return {
        valid: false,
        totalBlocks: blocks.length,
        genesisHash: GENESIS_HASH,
        error: `TAMPER_DETECTED: Block ${block.sequence_number} content hash mismatch (computed: ${recomputedHash.substring(0, 16)}..., recorded: ${block.current_hash.substring(0, 16)}...)`,
        tamperedIndex: i,
        brokenBlock: block,
      };
    }
  }

  const latest = blocks[blocks.length - 1];
  return {
    valid: true,
    totalBlocks: blocks.length,
    genesisHash: GENESIS_HASH,
    latestHash: latest.current_hash,
    latestSequenceNumber: latest.sequence_number,
  };
}
