'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Key,
  Database,
  FileCheck2,
  FileText,
  AlertTriangle,
  Fingerprint,
  Layers,
  CheckCircle2,
  Eye,
  EyeOff,
  Server,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';

interface ClinicalRecord {
  id: string;
  patientId: string;
  hospitalId: string;
  recordClass: 'PRESCRIPTION' | 'DISCHARGE_SUMMARY' | 'LAB_REPORT' | 'IMAGING_STUDY';
  kekId: string;
  retentionUntil: string;
  legalHold: boolean;
  algorithm: string;
  status: 'ENCRYPTED' | 'DECRYPTED';
  plaintextContent?: {
    diagnosis: string;
    physician: string;
    clinicalNotes: string;
    medications: string[];
    labValues?: Record<string, string>;
  };
}

interface HashChainBlock {
  sequenceNumber: number;
  prevHash: string;
  hash: string;
  recordId: string;
  actorId: string;
  action: 'READ' | 'WRITE' | 'EXPORT' | 'HOLD_PLACED';
  timestamp: string;
  verified: boolean;
}

const INITIAL_RECORDS: ClinicalRecord[] = [
  {
    id: 'rec_live_90214a1c',
    patientId: 'pat_enc_892348',
    hospitalId: 'hosp_mumbai_apex_01',
    recordClass: 'DISCHARGE_SUMMARY',
    kekId: 'kek-2026-09',
    retentionUntil: '2036-09-18T12:00:00Z',
    legalHold: false,
    algorithm: 'AES-256-GCM',
    status: 'ENCRYPTED',
    plaintextContent: {
      diagnosis: 'Acute Coronary Syndrome (Stabilized Post-PTCA)',
      physician: 'Dr. Priya Sharma, MD (Cardiology)',
      clinicalNotes: 'Successful drug-eluting stent placement in proximal LAD. Hemodynamically stable. Dual antiplatelet therapy prescribed.',
      medications: ['Aspirin 75mg OD', 'Ticagrelor 90mg BD', 'Rosuvastatin 40mg HS'],
      labValues: { 'Troponin I': '<0.01 ng/mL', 'LVEF': '55%', 'Creatinine': '0.9 mg/dL' }
    }
  },
  {
    id: 'rec_live_44921b7e',
    patientId: 'pat_enc_110943',
    hospitalId: 'hosp_mumbai_apex_01',
    recordClass: 'LAB_REPORT',
    kekId: 'kek-2026-09',
    retentionUntil: '2034-03-12T08:00:00Z',
    legalHold: true,
    algorithm: 'AES-256-GCM',
    status: 'ENCRYPTED',
    plaintextContent: {
      diagnosis: 'Type 2 Diabetes Mellitus with Microalbuminuria',
      physician: 'Dr. Arjun Mehta, DM (Endocrinology)',
      clinicalNotes: 'HbA1c shows improved glycemic control under SGLT2i + Metformin regimen. Renal markers stable.',
      medications: ['Empagliflozin 10mg OD', 'Metformin 1000mg BD', 'Telmisartan 40mg OD'],
      labValues: { 'HbA1c': '6.7%', 'Fasting Plasma Glucose': '108 mg/dL', 'eGFR': '>90 mL/min' }
    }
  },
  {
    id: 'rec_live_77189c93',
    patientId: 'pat_enc_554190',
    hospitalId: 'hosp_delhi_maxima_02',
    recordClass: 'PRESCRIPTION',
    kekId: 'kek-2026-09',
    retentionUntil: '2031-11-25T14:30:00Z',
    legalHold: false,
    algorithm: 'AES-256-GCM',
    status: 'ENCRYPTED',
    plaintextContent: {
      diagnosis: 'Severe Degenerative Osteoarthritis (Bilateral Knees)',
      physician: 'Dr. Rajesh Nair, MS (Orthopedics)',
      clinicalNotes: 'Conservative management with intra-articular hyaluronic acid injection scheduled. Physical therapy continued.',
      medications: ['Paracetamol 650mg PRN', 'Glucosamine Sulfate 1500mg OD'],
      labValues: { 'ESR': '14 mm/hr', 'Uric Acid': '4.8 mg/dL' }
    }
  }
];

const INITIAL_HASH_CHAIN: HashChainBlock[] = [
  {
    sequenceNumber: 1,
    prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
    hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    recordId: 'rec_live_90214a1c',
    actorId: 'usr_staff_dr_priya_01',
    action: 'WRITE',
    timestamp: '2026-09-18 10:14:02 UTC',
    verified: true,
  },
  {
    sequenceNumber: 2,
    prevHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    hash: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
    recordId: 'rec_live_44921b7e',
    actorId: 'usr_staff_dr_arjun_02',
    action: 'HOLD_PLACED',
    timestamp: '2026-09-18 11:45:30 UTC',
    verified: true,
  },
  {
    sequenceNumber: 3,
    prevHash: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
    hash: 'bf5b3b55577cc0773cb20a4be359873d1f0535e61bf5f2d7f451f28b4d081f9b',
    recordId: 'rec_live_77189c93',
    actorId: 'usr_staff_dr_rajesh_03',
    action: 'WRITE',
    timestamp: '2026-09-18 12:20:18 UTC',
    verified: true,
  },
];

export default function RecordsPage() {
  const [records, setRecords] = useState<ClinicalRecord[]>(INITIAL_RECORDS);
  const [selectedRecord, setSelectedRecord] = useState<ClinicalRecord | null>(null);
  const [decryptedState, setDecryptedState] = useState<Record<string, boolean>>({});
  const [isDecrypting, setIsDecrypting] = useState<string | null>(null);
  const [auditLogEvents, setAuditLogEvents] = useState<HashChainBlock[]>(INITIAL_HASH_CHAIN);

  const handleDecrypt = (record: ClinicalRecord) => {
    if (decryptedState[record.id]) {
      // Re-seal
      setDecryptedState(prev => ({ ...prev, [record.id]: false }));
      return;
    }

    setIsDecrypting(record.id);

    // Simulate fail-closed audit log write before returning decrypted payload
    setTimeout(() => {
      // 1. Append to hash chain
      const lastBlock = auditLogEvents[auditLogEvents.length - 1];
      const newSeq = auditLogEvents.length + 1;
      const fakeHash = 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592';

      const newBlock: HashChainBlock = {
        sequenceNumber: newSeq,
        prevHash: lastBlock.hash,
        hash: fakeHash,
        recordId: record.id,
        actorId: 'usr_current_session',
        action: 'READ',
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
        verified: true,
      };

      setAuditLogEvents(prev => [...prev, newBlock]);
      setDecryptedState(prev => ({ ...prev, [record.id]: true }));
      setSelectedRecord(record);
      setIsDecrypting(null);
    }, 600);
  };

  return (
    <div className="space-y-10 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="apple-pill border-emerald-500/30 text-emerald-400 bg-emerald-950/20 font-mono text-xs">
            PROJECT B: MEDICAL RECORDS VAULT
          </span>
          <span className="apple-pill border-blue-500/30 text-blue-400 bg-blue-950/20 font-mono text-xs">
            ISOLATED CREDENTIAL BOUNDARY
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-[#f5f5f7]">
          Encrypted Clinical Records
        </h1>
        <p className="text-[#86868b] mt-1 text-sm max-w-2xl">
          Zero-trust clinical data storage encrypted with AES-256-GCM envelope encryption.
          Decryption keys are non-extractable Web Crypto CryptoKeys strictly confined to the records Worker.
        </p>
      </div>

      {/* Security Architectural Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-panel p-4 rounded-xl border border-white/[0.08] space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
            <Key className="w-3.5 h-3.5" />
            <span>KEK Identifier</span>
          </div>
          <p className="font-mono text-sm font-semibold text-[#f5f5f7]">kek-2026-09</p>
          <p className="text-[11px] text-[#86868b]">Cloudflare Secrets Store hardware root</p>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-white/[0.08] space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
            <Fingerprint className="w-3.5 h-3.5" />
            <span>Envelope AEAD</span>
          </div>
          <p className="font-mono text-sm font-semibold text-[#f5f5f7]">AES-256-GCM + AAD</p>
          <p className="text-[11px] text-[#86868b]">Fresh 32-byte DEK per record envelope</p>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-white/[0.08] space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-purple-400">
            <Server className="w-3.5 h-3.5" />
            <span>Network Exposure</span>
          </div>
          <p className="font-mono text-sm font-semibold text-[#f5f5f7]">Private Service Binding</p>
          <p className="text-[11px] text-[#86868b]">No public ingress route on records Worker</p>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-white/[0.08] space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Audit Enforcement</span>
          </div>
          <p className="font-mono text-sm font-semibold text-[#f5f5f7]">Fail-Closed Ledger</p>
          <p className="text-[11px] text-[#86868b]">Log write must succeed before data return</p>
        </div>
      </div>

      {/* Clinical Vault Records Table */}
      <div className="glass-panel rounded-2xl p-6 border border-white/[0.08] space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-[#f5f5f7] flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" />
              Patient Clinical Envelopes
            </h2>
            <p className="text-xs text-[#86868b] mt-0.5">
              Encrypted payloads with cryptographically bound additional authenticated data (AAD)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="apple-pill border-white/10 text-[#86868b] text-xs">
              {records.length} Protected Envelopes
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {records.map((rec) => {
            const isDecrypted = decryptedState[rec.id];
            const loading = isDecrypting === rec.id;

            return (
              <div
                key={rec.id}
                className={`p-5 rounded-xl border transition-all ${
                  isDecrypted
                    ? 'border-emerald-500/30 bg-emerald-950/10'
                    : 'border-white/[0.06] bg-[#0c0c10]/60 hover:border-white/15'
                }`}
              >
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-white/90 font-semibold">
                        {rec.id}
                      </span>
                      <span className="apple-pill text-[11px] border-blue-500/30 text-blue-400 bg-blue-950/20">
                        {rec.recordClass}
                      </span>
                      {rec.legalHold && (
                        <span className="apple-pill text-[11px] border-red-500/30 text-red-400 bg-red-950/20 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          LEGAL HOLD ACTIVE
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[#86868b] font-mono">
                      <span>Patient: {rec.patientId}</span>
                      <span>•</span>
                      <span>Hospital: {rec.hospitalId}</span>
                      <span>•</span>
                      <span>Retain until: {rec.retentionUntil.substring(0, 10)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                    <div className="text-right hidden sm:block">
                      <div className="text-[11px] font-mono text-emerald-400">
                        {rec.algorithm}
                      </div>
                      <div className="text-[10px] text-[#86868b] font-mono">
                        Key: {rec.kekId}
                      </div>
                    </div>

                    <button
                      onClick={() => handleDecrypt(rec)}
                      disabled={loading}
                      className={`px-3.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-all ${
                        isDecrypted
                          ? 'bg-white/10 hover:bg-white/15 text-white border border-white/20'
                          : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      }`}
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Verifying AAD & Log...
                        </>
                      ) : isDecrypted ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          Seal Envelope
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          Decrypt & View Payload
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Plaintext Clinical Payload Preview when Decrypted */}
                {isDecrypted && rec.plaintextContent && (
                  <div className="mt-4 pt-4 border-t border-emerald-500/20 space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-emerald-400 font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        DECRYPTED VIA RECORDS WORKER SERVICE BINDING
                      </span>
                      <span className="font-mono text-[10px] text-[#86868b]">
                        AAD: &#123; hospital_id: &quot;{rec.hospitalId}&quot;, patient_id: &quot;{rec.patientId}&quot;, record_id: &quot;{rec.id}&quot; &#125;
                      </span>
                    </div>

                    <div className="bg-black/50 p-4 rounded-lg border border-white/5 space-y-2 text-xs">
                      <div>
                        <span className="text-[#86868b] font-mono uppercase tracking-wider text-[10px]">Diagnosis:</span>
                        <p className="text-white font-medium mt-0.5">{rec.plaintextContent.diagnosis}</p>
                      </div>
                      <div>
                        <span className="text-[#86868b] font-mono uppercase tracking-wider text-[10px]">Attending Physician:</span>
                        <p className="text-white mt-0.5">{rec.plaintextContent.physician}</p>
                      </div>
                      <div>
                        <span className="text-[#86868b] font-mono uppercase tracking-wider text-[10px]">Clinical Findings:</span>
                        <p className="text-[#86868b] mt-0.5 leading-relaxed">{rec.plaintextContent.clinicalNotes}</p>
                      </div>
                      <div>
                        <span className="text-[#86868b] font-mono uppercase tracking-wider text-[10px]">Prescriptions & Dosing:</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {rec.plaintextContent.medications.map((m, idx) => (
                            <span key={idx} className="apple-pill border-emerald-500/20 text-emerald-300 bg-emerald-950/30 text-[11px]">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cryptographic Hash Chain Audit Ledger */}
      <div className="glass-panel rounded-2xl p-6 border border-white/[0.08] space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-[#f5f5f7] flex items-center gap-2">
              <Layers className="w-5 h-5 text-purple-400" />
              Write-Only R2 Hash-Chained Audit Trail
            </h2>
            <p className="text-xs text-[#86868b] mt-0.5">
              Tamper-evident append-only ledger mirroring all access events with SHA-256 sequential linking
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="apple-pill border-purple-500/30 text-purple-400 bg-purple-950/20 text-xs flex items-center gap-1.5 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
              CHAIN INTEGRITY VERIFIED
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {auditLogEvents.map((block) => (
            <div
              key={block.sequenceNumber}
              className="p-4 rounded-xl border border-white/[0.05] bg-[#0c0c10]/40 font-mono text-xs space-y-2 hover:border-purple-500/20 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[11px] font-bold">
                    BLOCK #{block.sequenceNumber.toString().padStart(4, '0')}
                  </span>
                  <span className="text-[#86868b] text-[11px]">{block.timestamp}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="apple-pill text-[10px] border-white/10 text-white/80">
                    ACTION: {block.action}
                  </span>
                  <span className="apple-pill text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-950/30">
                    VALID
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-[#86868b] pt-1">
                <div>
                  <span className="text-[#86868b]/60">Prev Hash: </span>
                  <span className="text-white/70">{block.prevHash.substring(0, 24)}...</span>
                </div>
                <div>
                  <span className="text-[#86868b]/60">Block Hash: </span>
                  <span className="text-purple-400 font-semibold">{block.hash.substring(0, 24)}...</span>
                </div>
              </div>

              <div className="text-[11px] text-[#86868b]/70 flex items-center gap-4 pt-0.5">
                <span>Record: <span className="text-white/80">{block.recordId}</span></span>
                <span>Actor: <span className="text-white/80">{block.actorId}</span></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
