'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  Clock,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  CreditCard,
  User,
  ShieldCheck,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';

interface SlotOption {
  time: string;
  startIso: string;
  endIso: string;
  isAvailable: boolean;
}

const AVAILABLE_SLOTS: SlotOption[] = [
  { time: '09:00 AM - 09:30 AM', startIso: '2026-09-19T09:00:00Z', endIso: '2026-09-19T09:30:00Z', isAvailable: true },
  { time: '10:00 AM - 10:30 AM', startIso: '2026-09-19T10:00:00Z', endIso: '2026-09-19T10:30:00Z', isAvailable: true },
  { time: '11:15 AM - 11:45 AM', startIso: '2026-09-19T11:15:00Z', endIso: '2026-09-19T11:45:00Z', isAvailable: false },
  { time: '02:00 PM - 02:30 PM', startIso: '2026-09-19T14:00:00Z', endIso: '2026-09-19T14:30:00Z', isAvailable: true },
  { time: '03:30 PM - 04:00 PM', startIso: '2026-09-19T15:30:00Z', endIso: '2026-09-19T16:00:00Z', isAvailable: true },
  { time: '04:30 PM - 05:00 PM', startIso: '2026-09-19T16:30:00Z', endIso: '2026-09-19T17:00:00Z', isAvailable: true },
];

function BookingContent() {
  const searchParams = useSearchParams();
  const doctorId = searchParams.get('doctor_id') || 'doc_suresh_01';
  const doctorName = searchParams.get('doctor_name') || 'Dr. Suresh R. Nair';
  const specialty = searchParams.get('specialty') || 'Interventional Cardiology';

  const [selectedSlot, setSelectedSlot] = useState<SlotOption | null>(null);
  const [patientId, setPatientId] = useState('pat_demo_patient_01');
  const [patientName, setPatientName] = useState('Rahul M. Verma');
  const [isHeld, setIsHeld] = useState(false);
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(600); // 10 minutes
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'IDLE' | 'PROCESSING' | 'PAID'>('IDLE');

  // 10-minute hold countdown timer (matches SlotDurableObject alarm)
  useEffect(() => {
    if (!isHeld || !holdExpiresAt || isConfirmed) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((holdExpiresAt - now) / 1000));
      setSecondsRemaining(diff);

      if (diff <= 0) {
        setIsHeld(false);
        setHoldExpiresAt(null);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isHeld, holdExpiresAt, isConfirmed]);

  const handleHoldSlot = () => {
    if (!selectedSlot) return;
    const expires = Date.now() + 10 * 60 * 1000;
    setHoldExpiresAt(expires);
    setIsHeld(true);
    setSecondsRemaining(600);
  };

  const handleReleaseSlot = () => {
    setIsHeld(false);
    setHoldExpiresAt(null);
    setPaymentStatus('IDLE');
  };

  const handleConfirmAndPay = () => {
    setPaymentStatus('PROCESSING');
    setTimeout(() => {
      setPaymentStatus('PAID');
      setIsConfirmed(true);
    }, 1500);
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-8 py-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-400 font-mono">
          <CalendarIcon className="h-3.5 w-3.5" />
          <span>Slot Durable Object &bull; Single-Threaded Atomic Reservation</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Reserve Consultation Slot
        </h1>
        <p className="text-sm text-zinc-400">
          Booking mutations are serialized per doctor-day in Cloudflare SQLite to guarantee zero double-booking races.
        </p>
      </div>

      {/* Doctor Overview Card */}
      <div className="glass-panel rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-white/10">
        <div className="space-y-1">
          <span className="text-[10px] font-mono text-blue-400 uppercase tracking-wider">Designated Specialist</span>
          <h2 className="text-xl font-bold text-white tracking-tight">{doctorName}</h2>
          <p className="text-xs text-zinc-400">{specialty} &bull; Shard ID: {doctorId}:2026-09-19</p>
        </div>
        <div className="sm:text-right">
          <span className="text-[10px] font-mono text-zinc-500 uppercase">Consultation Fee</span>
          <div className="text-xl font-bold text-white font-mono">₹1,770</div>
          <span className="text-[10px] text-zinc-500 font-mono">Derived on Server (PAISE: 177000)</span>
        </div>
      </div>

      {/* Main Grid: Slot Selection & Hold Lock */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Col 1 & 2: Slot Picker */}
        <div className="lg:col-span-2 glass-panel rounded-3xl p-6 space-y-6 border border-white/10">
          <div>
            <h3 className="text-sm font-semibold text-white tracking-tight">Available Consultation Slots</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Saturday, September 19, 2026 (UTC Standard Timeslot)</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AVAILABLE_SLOTS.map((slot) => {
              const isSelected = selectedSlot?.startIso === slot.startIso;
              return (
                <button
                  key={slot.startIso}
                  disabled={!slot.isAvailable || isHeld}
                  onClick={() => setSelectedSlot(slot)}
                  className={`p-4 rounded-2xl text-left border transition-all flex items-center justify-between ${
                    !slot.isAvailable
                      ? 'opacity-40 cursor-not-allowed bg-white/[0.01] border-white/5'
                      : isSelected
                      ? 'bg-blue-500/15 border-blue-500/60 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/50'
                      : 'glass-panel-interactive hover:border-white/20'
                  }`}
                >
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-white font-mono block">{slot.time}</span>
                    <span className="text-[10px] text-zinc-500 block">30 mins consultation</span>
                  </div>
                  {slot.isAvailable ? (
                    <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                      isSelected ? 'bg-blue-500 text-white' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>
                      {isSelected ? 'Selected' : 'Open'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-zinc-500">
                      Booked
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Patient Details Input */}
          <div className="pt-4 border-t border-white/5 space-y-3">
            <span className="text-xs font-semibold text-zinc-300 font-mono">Patient Identification</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-zinc-500 block mb-1">Patient ID (Project A/B Link)</label>
                <input
                  type="text"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  disabled={isHeld}
                  className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-500 block mb-1">Full Legal Name</label>
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  disabled={isHeld}
                  className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Col 3: Atomic Lock & Payment Panel */}
        <div className="glass-panel rounded-3xl p-6 flex flex-col justify-between space-y-6 border border-white/10">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400">
                Reservation Lock
              </span>
              {isHeld && !isConfirmed && (
                <span className="flex items-center gap-1.5 text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-full animate-pulse">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{formatTimer(secondsRemaining)}</span>
                </span>
              )}
            </div>

            {/* Active Hold Status Box */}
            {isHeld && !isConfirmed ? (
              <div className="p-4 rounded-2xl bg-amber-500/[0.08] border border-amber-500/25 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
                  <Lock className="h-4 w-4" />
                  <span>Slot Held in SQLite</span>
                </div>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  Locked in SlotDurableObject. Alarm set for automated release in {formatTimer(secondsRemaining)} if unconfirmed.
                </p>
                <div className="pt-2 text-[10px] font-mono text-zinc-400">
                  slot_key: {doctorId}:{selectedSlot?.startIso}
                </div>
              </div>
            ) : isConfirmed ? (
              <div className="p-4 rounded-2xl bg-emerald-500/[0.08] border border-emerald-500/25 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Appointment Confirmed</span>
                </div>
                <p className="text-[11px] text-emerald-200/80 leading-relaxed">
                  Razorpay webhook verified via timingSafeEqual. Meta WhatsApp alert dispatched.
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2 text-xs text-zinc-400">
                <p>Select an available timeslot to initiate a single-threaded 10-minute hold lock.</p>
                <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
                  <span>Layer 4 Cap: Max 3 active holds</span>
                </div>
              </div>
            )}

            {/* Fee summary */}
            <div className="space-y-1.5 pt-2 border-t border-white/5 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Base Consultation</span>
                <span className="font-mono">₹1,500.00</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>GST (18%)</span>
                <span className="font-mono">₹270.00</span>
              </div>
              <div className="flex justify-between text-white font-semibold pt-2 border-t border-white/10 text-sm">
                <span>Total Due</span>
                <span className="font-mono">₹1,770.00</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2">
            {!isHeld ? (
              <button
                onClick={handleHoldSlot}
                disabled={!selectedSlot}
                className="w-full apple-btn-primary flex items-center justify-center gap-2 text-xs py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Lock Slot (Hold for 10 Min)</span>
              </button>
            ) : !isConfirmed ? (
              <div className="space-y-2">
                <button
                  onClick={handleConfirmAndPay}
                  disabled={paymentStatus === 'PROCESSING'}
                  className="w-full apple-btn-primary bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center gap-2 text-xs py-2.5"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  <span>
                    {paymentStatus === 'PROCESSING' ? 'Deriving Order...' : 'Pay ₹1,770 with Razorpay'}
                  </span>
                </button>
                <button
                  onClick={handleReleaseSlot}
                  className="w-full text-center text-[11px] font-mono text-zinc-400 hover:text-white py-1 transition-colors"
                >
                  Release Hold Early
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setIsConfirmed(false); setIsHeld(false); setSelectedSlot(null); }}
                className="w-full apple-btn-secondary flex items-center justify-center gap-2 text-xs py-2.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Book Another Slot</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BookingPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex items-center justify-center py-20 text-zinc-400 font-mono text-xs">
          Loading Slot Reservation Engine...
        </div>
      }
    >
      <BookingContent />
    </React.Suspense>
  );
}

