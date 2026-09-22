'use client';

import React, { useState, useEffect, Suspense } from 'react';
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
    <div className="space-y-8 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E9EEFE] text-[#2B59FF] border border-[#2B59FF]/20 text-xs font-bold font-mono">
          <CalendarIcon className="h-3.5 w-3.5" />
          <span>Guaranteed OPD Slot &bull; Bengaluru Campus</span>
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-[#0B1533]">
          Reserve Consultation Slot
        </h1>
        <p className="text-sm sm:text-base text-[#4A5578] leading-relaxed">
          Select a consultation time. Your appointment is held exclusively for 10 minutes while you confirm your details,
          guaranteeing you are never double-booked.
        </p>
      </div>

      {/* Doctor Info Card */}
      <div className="rounded-[26px] p-5 sm:p-6 bg-white border border-[#0B1533]/[0.08] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-[#E9EEFE] flex items-center justify-center text-[#2B59FF] flex-shrink-0">
            <User className="h-7 w-7" />
          </div>
          <div>
            <span className="text-[11px] font-mono text-[#2B59FF] font-bold block uppercase tracking-wider">
              Selected Specialist
            </span>
            <h2 className="text-lg sm:text-xl font-extrabold text-[#0B1533]">{doctorName}</h2>
            <p className="text-xs text-[#6B7596]">{specialty} &bull; Suite 402</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-2xl bg-[#F4F6FB] border border-[#0B1533]/[0.06] text-right flex-1 sm:flex-initial">
            <span className="text-[10px] text-[#6B7596] block font-mono font-semibold">CONSULTATION FEE</span>
            <span className="text-base sm:text-lg font-bold text-[#0B1533] font-mono">₹1,500</span>
            <span className="text-[10px] text-[#0D8244] block font-semibold">0% GST (Clinical Exemption)</span>
          </div>
          <div className="px-3.5 py-2.5 rounded-2xl bg-[#E8F7EE] text-[#15803D] border border-[#15803D]/20 text-xs font-mono font-bold flex items-center justify-center gap-1.5 flex-1 sm:flex-initial">
            <ShieldCheck className="h-4 w-4" />
            <span>GUARANTEED SLOT</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Slots & Hold Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Slot Selection (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#0B1533] uppercase tracking-wider font-mono">
              Available Windows &bull; Today
            </h3>
            <span className="text-xs text-[#6B7596]">UTC+05:30 (IST)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AVAILABLE_SLOTS.map((slot) => {
              const isSelected = selectedSlot?.startIso === slot.startIso;
              return (
                <button
                  key={slot.startIso}
                  disabled={!slot.isAvailable || isHeld}
                  onClick={() => setSelectedSlot(slot)}
                  className={`p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between min-h-[72px] sm:min-h-[88px] cursor-pointer disabled:cursor-not-allowed ${
                    !slot.isAvailable
                      ? 'bg-zinc-100/60 border-zinc-200 text-zinc-400 opacity-60'
                      : isSelected
                      ? 'bg-[#EEF2FF] border-[#2B59FF] shadow-md shadow-blue-500/15'
                      : 'bg-white border-[#0B1533]/[0.08] hover:border-[#2B59FF] shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-mono font-bold text-[#0B1533]">
                      {slot.time.split(' - ')[0]}
                    </span>
                    {slot.isAvailable ? (
                      <span className="h-2 w-2 rounded-full bg-[#15803D]" />
                    ) : (
                      <span className="text-[10px] text-zinc-400 uppercase font-mono">Booked</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#6B7596] pt-2">
                    <span>30-min slot</span>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-[#2B59FF]" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Patient Details Form */}
          <div className="rounded-[26px] p-5 sm:p-6 bg-white border border-[#0B1533]/[0.08] shadow-sm space-y-4 mt-6">
            <h3 className="text-sm font-bold text-[#0B1533] uppercase tracking-wider font-mono">
              Patient Identification
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#4A5578] font-semibold">Patient Name</label>
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  disabled={isHeld}
                  className="w-full px-4 py-2.5 min-h-[44px] rounded-xl bg-white border border-[#0B1533]/[0.12] text-sm text-[#0B1533] focus:outline-none focus:border-[#2B59FF]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[#4A5578] font-semibold">Patient ID</label>
                <input
                  type="text"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  disabled={isHeld}
                  className="w-full px-4 py-2.5 min-h-[44px] rounded-xl bg-white border border-[#0B1533]/[0.12] text-sm font-mono text-[#0B1533] focus:outline-none focus:border-[#2B59FF]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Hold & Payment Action Panel (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-[26px] p-5 sm:p-6 bg-white border border-[#0B1533]/[0.08] shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-[#0B1533]/[0.06] pb-4">
              <h3 className="text-sm font-bold text-[#0B1533] uppercase tracking-wider font-mono">
                Reservation State
              </h3>
              {isHeld ? (
                <span className="flex items-center gap-1.5 text-xs font-mono text-[#2B59FF] font-bold">
                  <Lock className="h-3.5 w-3.5" />
                  HELD
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-mono text-[#6B7596]">
                  <Unlock className="h-3.5 w-3.5" />
                  UNLOCKED
                </span>
              )}
            </div>

            {/* Countdown State */}
            {isHeld && !isConfirmed && (
              <div className="p-4 rounded-2xl bg-[#EEF2FF] border border-[#2B59FF]/30 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#2B59FF]">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Clock className="h-4 w-4" />
                    Slot Reservation Hold
                  </span>
                  <span className="text-xs font-semibold">Hold Active</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="mono text-3xl font-extrabold text-[#0B1533]">
                    {formatTimer(secondsRemaining)}
                  </span>
                  <span className="text-[11px] text-[#4A5578]">releases on expiry</span>
                </div>
              </div>
            )}

            {/* Confirmation State */}
            {isConfirmed && (
              <div className="p-4 rounded-2xl bg-[#E8F7EE] border border-[#15803D]/30 space-y-2 text-[#15803D]">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Appointment Confirmed!</span>
                </div>
                <p className="text-xs text-[#15803D] leading-relaxed">
                  Your appointment has been successfully scheduled. A confirmation SMS, WhatsApp update, and clinic receipt
                  have been dispatched to your registered contact.
                </p>
              </div>
            )}

            {/* Summary details */}
            <div className="space-y-2.5 text-xs text-[#4A5578]">
              <div className="flex justify-between">
                <span>Physician:</span>
                <span className="font-bold text-[#0B1533]">{doctorName}</span>
              </div>
              <div className="flex justify-between">
                <span>Timeslot:</span>
                <span className="font-bold text-[#0B1533]">
                  {selectedSlot ? selectedSlot.time : 'None Selected'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Hold Duration:</span>
                <span className="font-mono text-[#0B1533]">10 Minutes (600s)</span>
              </div>
              <div className="flex justify-between">
                <span>Consultation Fee:</span>
                <span className="font-mono font-bold text-[#0B1533]">
                  ₹1,500 <span className="text-[10px] text-[#0D8244] font-semibold">(0% GST Exempt)</span>
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3 pt-2">
              {!isHeld && !isConfirmed && (
                <button
                  disabled={!selectedSlot}
                  onClick={handleHoldSlot}
                  className="btn w-full py-3.5 min-h-[48px] rounded-full bg-[#2B59FF] hover:bg-[#1E45D9] text-white text-xs sm:text-sm font-bold transition-all shadow-md shadow-blue-500/20 disabled:bg-[#AEB6CF] disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>Hold Slot for 10 Minutes</span>
                </button>
              )}

              {isHeld && !isConfirmed && (
                <>
                  <button
                    onClick={handleConfirmAndPay}
                    disabled={paymentStatus === 'PROCESSING'}
                    className="btn w-full py-3.5 min-h-[48px] rounded-full bg-[#15803D] hover:bg-[#166534] text-white text-xs sm:text-sm font-bold transition-all shadow-md shadow-emerald-500/20 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>{paymentStatus === 'PROCESSING' ? 'Processing...' : 'Pay ₹1,500 & Confirm'}</span>
                  </button>

                  <button
                    onClick={handleReleaseSlot}
                    className="w-full py-3 min-h-[44px] rounded-full border border-[#0B1533]/[0.12] bg-white text-[#4A5578] hover:text-[#0B1533] text-xs font-semibold cursor-pointer transition-all flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Release Slot Lock</span>
                  </button>
                </>
              )}

              {isConfirmed && (
                <button
                  onClick={() => {
                    setIsConfirmed(false);
                    setIsHeld(false);
                    setSelectedSlot(null);
                  }}
                  className="btn w-full py-3.5 min-h-[48px] rounded-full bg-[#2B59FF] hover:bg-[#1E45D9] text-white text-xs sm:text-sm font-bold transition-all shadow-md shadow-blue-500/20 cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>Book Another Consultation</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookingSkeleton() {
  return (
    <div className="space-y-8 py-6 max-w-7xl mx-auto animate-fade-in">
      {/* Page Header */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E9EEFE] text-[#2B59FF] border border-[#2B59FF]/20 text-xs font-bold font-mono">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Guaranteed OPD Timings &bull; 10-Minute Hold</span>
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-[#0B1533]">
          Reserve Consultation Slot
        </h1>
        <p className="text-sm sm:text-base text-[#4A5578] max-w-2xl leading-relaxed">
          Select a consultation window. Each reservation is held exclusively for 10 minutes to ensure
          you have ample time to confirm without double-booking.
        </p>
      </div>

      {/* Doctor Header Banner Placeholder */}
      <div className="rounded-[26px] p-5 sm:p-6 bg-white border border-[#0B1533]/[0.08] shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-[#E9EEFE] text-[#2B59FF] flex items-center justify-center font-bold text-lg flex-shrink-0">
            DR
          </div>
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[#0B1533]">Dr. Suresh R. Nair</h2>
            <p className="text-xs text-[#2B59FF] font-semibold">Interventional Cardiology &bull; OPD Suite 402</p>
            <p className="text-[11px] text-[#6B7596]">Campus: DoctorCare Bengaluru Central Campus</p>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <span className="text-[10px] uppercase font-mono text-[#6B7596] block">Consultation Fee</span>
          <span className="text-lg font-bold text-[#0B1533] font-mono">₹1,500</span>
          <span className="text-[10px] text-[#0D8244] block font-semibold">0% GST (Exempt)</span>
        </div>
      </div>

      {/* Main Grid: Slots & Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-[26px] p-5 sm:p-6 bg-white border border-[#0B1533]/[0.08] shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#0B1533]/[0.06] pb-3">
              <span className="text-sm font-bold text-[#0B1533]">Available Slots (Today)</span>
              <span className="text-xs text-[#2B59FF] font-semibold animate-pulse">Initializing engine...</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {['09:00 AM', '10:00 AM', '02:00 PM', '03:30 PM', '04:30 PM'].map((t, idx) => (
                <div key={idx} className="p-3 sm:p-4 rounded-2xl border border-[#0B1533]/[0.06] bg-[#F4F6FB] flex flex-col items-center justify-center min-h-[72px] sm:min-h-[88px] space-y-1">
                  <span className="font-mono text-xs font-bold text-[#0B1533]">{t}</span>
                  <span className="text-[10px] text-[#15803D] font-bold">Ready</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl p-4 bg-[#FAFBFD] border border-[#0B1533]/[0.06] text-xs text-[#4A5578] flex items-center justify-between flex-wrap gap-2">
            <span>Direct OPD Desk Assistance: <strong className="text-[#0B1533]">+91 (080) 6192 4000</strong></span>
            <span className="text-[11px] text-[#6B7596]">Mon–Sat, 8:00 AM – 8:00 PM IST</span>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[26px] p-5 sm:p-6 bg-white border border-[#0B1533]/[0.08] shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-[#0B1533]">Reservation Summary</h3>
            <div className="space-y-2 text-xs text-[#4A5578]">
              <div className="flex justify-between">
                <span>Hold Period:</span>
                <span className="font-mono text-[#0B1533]">10 Minutes</span>
              </div>
              <div className="flex justify-between">
                <span>Consultation Fee:</span>
                <span className="font-mono font-bold text-[#0B1533]">₹1,500 (0% GST)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BookingPage() {
  return (
    <Suspense fallback={<BookingSkeleton />}>
      <BookingContent />
    </Suspense>
  );
}
