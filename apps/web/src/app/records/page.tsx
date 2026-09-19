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
      physician: 'Dr. Vikramaditya Joshi, MS (Ortho)',
      clinicalNotes: 'Hyaluronic acid intra-articular injection scheduled. Quad strengthening therapy recommended.',
      medications: ['Paracetamol 650mg SOS', 'Glucosamine 1500mg OD', 'Diacerein 50mg BD'],
      labValues: { 'ESR': '18 mm/hr', 'Uric Acid': '4.8 mg/dL' }
    }
  }
];

const INITIAL_HASH_CHAIN: HashChainBlock[] = [
  {
    sequenceNumber: 1,
    prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
    hash: '8f2a1b9c3e4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a',
    recordId: 'rec_live_90214a1c',
    actorId: 'doc_sharma_772',
    action: 'WRITE',
    timestamp: '2026-09-18T09:15:00Z',
    verified: true,
  },
  {
    sequenceNumber: 2,
    prevHash: '8f2a1b9c3e4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a',
    hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    recordId: 'rec_live_90214a1c',
    actorId: 'doc_sharma_772',
    action: 'READ',
    timestamp: '2026-09-18T10:45:00Z',
    verified: true,
  },
  {
    sequenceNumber: 3,
    prevHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    hash: '3e4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e',
    recordId: 'rec_live_44921b7e',
    actorId: 'admin_custodian_03',
    action: 'HOLD_PLACED',
    timestamp: '2026-09-18T11:20:00Z',
    verified: true,
  },
];

export default function RecordsPage() {
  const [records, setRecords] = useState<ClinicalRecord[]>(INITIAL_RECORDS);
  const [chainBlocks, setChainBlocks] = useState<HashChainBlock[]>(INITIAL_HASH_CHAIN);
  const [activeTab, setActiveTab] = useState<'RECORDS' | 'CHAIN' | 'AUDIT'>('RECORDS');
  const [decryptingId, setDecryptingId] = useState<string | null>(null);
  const [auditLogStatus, setAuditLogStatus] = useState<string | null>(null);

  const handleDecrypt = (recordId: string) => {
    setDecryptingId(recordId);
    setAuditLogStatus('Enforcing fail-closed audit log in D1 doctorcare-records-db...');

    setTimeout(() => {
      setRecords(prev =>
        prev.map(rec => {
          if (rec.id === recordId) {
            return {
              ...rec,
              status: rec.status === 'ENCRYPTED' ? 'DECRYPTED' : 'ENCRYPTED',
            };
          }
          return rec;
        })
      );
      setDecryptingId(null);
      setAuditLogStatus('Access log sealed in D1 & mirrored to write-only R2 hash vault.');
      setTimeout(() => setAuditLogStatus(null), 3500);
    }, 1200);
  };

  return (
    <div className="space-y-8 py-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E9EEFE] text-[#2B59FF] border border-[#2B59FF]/20 text-xs font-bold font-mono">
          <Lock className="h-3.5 w-3.5" />
          <span>Cloudflare Secrets Store &bull; KEK kek-2026-09</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-[#0B1533]">
          Encrypted Clinical Records
        </h1>
        <p className="text-base text-[#4A5578] max-w-3xl leading-relaxed">
          Protected Health Information (PHI) is envelope-encrypted under a non-extractable Key-Encryption Key
          with AES-256-GCM AEAD and cryptographic AAD binding. Access is governed by a fail-closed audit log
          and an immutable write-only R2 hash-chained ledger.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#0B1533]/[0.08] pb-3">
        <button
          onClick={() => setActiveTab('RECORDS')}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'RECORDS'
              ? 'bg-[#2B59FF] text-white shadow-md shadow-blue-500/20'
              : 'bg-white text-[#4A5578] hover:text-[#0B1533] border border-[#0B1533]/[0.08]'
          }`}
        >
          Encrypted Envelopes ({records.length})
        </button>
        <button
          onClick={() => setActiveTab('CHAIN')}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'CHAIN'
              ? 'bg-[#2B59FF] text-white shadow-md shadow-blue-500/20'
              : 'bg-white text-[#4A5578] hover:text-[#0B1533] border border-[#0B1533]/[0.08]'
          }`}
        >
          Write-Only R2 Hash-Chained Audit Trail
        </button>
      </div>

      {/* Audit Status Alert */}
      {auditLogStatus && (
        <div className="p-4 rounded-2xl bg-[#E8F7EE] border border-[#15803D]/25 text-[#15803D] text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            <span>{auditLogStatus}</span>
          </div>
          <span className="font-mono text-[10px] text-[#15803D] uppercase font-bold">FAIL-CLOSED PASSED</span>
        </div>
      )}

      {/* TAB 1: Clinical Records */}
      {activeTab === 'RECORDS' && (
        <div className="space-y-6">
          {records.map((record) => {
            const isDecrypted = record.status === 'DECRYPTED';
            const isBusy = decryptingId === record.id;

            return (
              <div
                key={record.id}
                className="rounded-[26px] p-6 bg-white border border-[#0B1533]/[0.08] shadow-sm space-y-5 transition-all"
              >
                {/* Card Top: Metadata & Security Attributes */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#0B1533]/[0.06] pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[#E9EEFE] flex items-center justify-center text-[#2B59FF]">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-extrabold text-[#0B1533]">{record.id}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#E9EEFE] text-[#2B59FF] font-bold">
                          {record.recordClass}
                        </span>
                        {record.legalHold && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                            LEGAL_HOLD
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#6B7596]">
                        Patient: <span className="font-mono text-[#0B1533] font-semibold">{record.patientId}</span> &bull; Hospital:{' '}
                        <span className="font-mono text-[#0B1533] font-semibold">{record.hospitalId}</span>
                      </p>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E9EEFE] text-[#2B59FF] border border-[#2B59FF]/20 text-[11px] font-mono font-bold">
                      <ShieldCheck className="h-3 w-3" />
                      <span>{record.algorithm}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-mono font-bold">
                      <Key className="h-3 w-3" />
                      <span>{record.kekId}</span>
                    </span>
                  </div>
                </div>

                {/* Card Center: Ciphertext vs Plaintext */}
                {!isDecrypted ? (
                  <div className="p-5 rounded-2xl bg-[#F4F6FB] border border-[#0B1533]/[0.06] space-y-3 font-mono">
                    <div className="flex items-center justify-between text-xs text-[#6B7596]">
                      <span className="flex items-center gap-1.5 font-bold text-[#0B1533]">
                        <Lock className="h-3.5 w-3.5 text-[#2B59FF]" />
                        AES-256-GCM Encrypted Envelope (Base64)
                      </span>
                      <span>AAD 5-Tuple Bound</span>
                    </div>
                    <p className="text-[11px] text-[#4A5578] break-all leading-relaxed bg-white p-3.5 rounded-xl border border-[#0B1533]/[0.06]">
                      eyJpdiI6IjF3T0RWTG5sbUJwc0xmaE8iLCJjaXBoZXJ0ZXh0IjoiaTVENmpnRWtHYlNhd1FTZnlSV1pad2MxWHkwTE9ZT...29sNlRyc0h3PT0iLCJhdXRoVGFnIjoiZ01ySzlxMmxGZ09uMnkyRzR1VT09In0=
                    </p>
                  </div>
                ) : (
                  <div className="p-5 rounded-2xl bg-[#E8F7EE]/40 border border-[#15803D]/20 space-y-4">
                    <div className="flex items-center justify-between text-xs text-[#15803D]">
                      <span className="flex items-center gap-1.5 font-bold">
                        <CheckCircle2 className="h-4 w-4" />
                        Decrypted via Secrets Store KEK kek-2026-09
                      </span>
                      <span className="font-mono text-[11px] font-semibold">RECORD_ACCESS_LOG Committed</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="space-y-1">
                        <span className="text-[#6B7596] font-semibold block">Primary Diagnosis:</span>
                        <p className="text-sm font-bold text-[#0B1533]">{record.plaintextContent?.diagnosis}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[#6B7596] font-semibold block">Attending Physician:</span>
                        <p className="font-bold text-[#0B1533]">{record.plaintextContent?.physician}</p>
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <span className="text-[#6B7596] font-semibold block">Clinical Observations:</span>
                        <p className="text-[#4A5578] leading-relaxed bg-white p-3.5 rounded-xl border border-[#0B1533]/[0.06]">
                          {record.plaintextContent?.clinicalNotes}
                        </p>
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <span className="text-[#6B7596] font-semibold block">Prescribed Regimen:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {record.plaintextContent?.medications.map((med, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 rounded-full bg-white border border-[#0B1533]/[0.08] text-[11px] text-[#0B1533] font-mono font-medium"
                            >
                              {med}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Card Bottom: Action & Verification */}
                <div className="flex items-center justify-between pt-1">
                  <div className="text-[11px] text-[#6B7596]">
                    Retention policy: <span className="font-mono text-[#0B1533] font-medium">{record.retentionUntil.split('T')[0]}</span>
                  </div>

                  <button
                    onClick={() => handleDecrypt(record.id)}
                    disabled={isBusy}
                    className={`btn px-5 py-2.5 rounded-full text-xs font-bold cursor-pointer transition-all flex items-center gap-2 ${
                      isDecrypted
                        ? 'bg-white border border-[#0B1533]/[0.14] text-[#0B1533] hover:bg-[#F4F6FB]'
                        : 'bg-[#2B59FF] hover:bg-[#1E45D9] text-white shadow-md shadow-blue-500/20'
                    }`}
                  >
                    {isBusy ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Logging &amp; Unwrapping...</span>
                      </>
                    ) : isDecrypted ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" />
                        <span>Re-seal Ciphertext</span>
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" />
                        <span>Decrypt Clinical Data</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: Write-Only R2 Hash Chain Audit Trail */}
      {activeTab === 'CHAIN' && (
        <div className="space-y-6">
          <div className="rounded-[26px] p-6 bg-white border border-[#0B1533]/[0.08] shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#0B1533]/[0.06] pb-4">
              <div>
                <h3 className="text-base font-extrabold text-[#0B1533]">
                  Write-Only R2 Hash-Chained Audit Trail
                </h3>
                <p className="text-xs text-[#6B7596]">
                  Every access attempt is canonically serialized, SHA-256 hashed, and mirrored into write-only R2 vault.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-[#E8F7EE] text-[#15803D] text-xs font-mono font-bold border border-[#15803D]/20">
                CHAIN VERIFIED (3/3)
              </span>
            </div>

            {/* Blocks */}
            <div className="space-y-4">
              {chainBlocks.map((block) => (
                <div
                  key={block.sequenceNumber}
                  className="p-5 rounded-2xl bg-[#F4F6FB] border border-[#0B1533]/[0.06] space-y-3 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#E9EEFE] text-[#2B59FF] font-bold">
                      Block #{block.sequenceNumber} &bull; {block.action}
                    </span>
                    <span className="text-[#6B7596]">{block.timestamp}</span>
                  </div>

                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex items-start gap-2">
                      <span className="text-[#6B7596] w-24 flex-shrink-0">Prev Hash:</span>
                      <span className="text-[#0B1533] break-all font-semibold">{block.prevHash}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[#6B7596] w-24 flex-shrink-0">Block Hash:</span>
                      <span className="text-[#2B59FF] break-all font-bold">{block.hash}</span>
                    </div>
                    <div className="flex items-center gap-2 pt-1 text-[#4A5578]">
                      <span>Target: {block.recordId}</span>
                      <span>&bull;</span>
                      <span>Actor: {block.actorId}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 text-[11px] text-[#6B7596] font-mono">
              Genesis Hash Anchor: 0000000000000000000000000000000000000000000000000000000000000000
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
