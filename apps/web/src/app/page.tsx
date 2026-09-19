'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

export default function HomePage() {
  // Theme settings
  const primary = '#2B59FF';
  const ink = '#0B1533';

  // Typewriter words
  const words = useMemo(
    () => [
      { w: 'patients', c: '#2B59FF' },
      { w: 'family', c: '#0E7C86' },
      { w: 'hospital', c: '#4338CA' },
      { w: 'records', c: '#0B1533' },
    ],
    []
  );

  // Typewriter state
  const [wordIdx, setWordIdx] = useState(0);
  const [charLen, setCharLen] = useState(8);
  const [isDeleting, setIsDeleting] = useState(false);
  const [typeWait, setTypeWait] = useState(22);

  // Live telemetry & hold timer state
  const [hold, setHold] = useState(598);
  const [appts, setAppts] = useState(47);
  const [reminderSent, setReminderSent] = useState(false);

  // Wizard state
  const [step, setStep] = useState(0);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [dpdpAgreed, setDpdpAgreed] = useState(false);
  const [isDone, setIsDone] = useState(false);

  // FAQ state
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // AI Assistant state
  const [chatOpen, setChatOpen] = useState(false);
  const [bubbleGone, setBubbleGone] = useState(false);

  // Typewriter effect
  useEffect(() => {
    const timer = setInterval(() => {
      const currentWord = words[wordIdx].w;
      if (typeWait > 0) {
        setTypeWait((prev) => prev - 1);
        return;
      }

      if (!isDeleting) {
        if (charLen < currentWord.length) {
          setCharLen((prev) => prev + 1);
        } else {
          setIsDeleting(true);
          setTypeWait(24);
        }
      } else {
        if (charLen > 0) {
          setCharLen((prev) => prev - 1);
        } else {
          setIsDeleting(false);
          setWordIdx((prev) => (prev + 1) % words.length);
          setTypeWait(3);
        }
      }
    }, 75);

    return () => clearInterval(timer);
  }, [wordIdx, charLen, isDeleting, typeWait, words]);

  // Hold timer & live counter clock
  useEffect(() => {
    const clock = setInterval(() => {
      setHold((prev) => (prev <= 0 ? 600 : prev - 1));
      if (Math.random() < 0.25) {
        setAppts((prev) => prev + 1);
      }
    }, 1000);

    return () => clearInterval(clock);
  }, []);

  // Format hold label
  const holdMinutes = String(Math.floor(hold / 60)).padStart(2, '0');
  const holdSeconds = String(hold % 60).padStart(2, '0');
  const holdLabel = `${holdMinutes}:${holdSeconds}`;

  // Current typed word & pill style
  const currentWordObj = words[wordIdx];
  const typedWord = currentWordObj.w.slice(0, charLen);
  const pillColor = wordIdx === 0 ? primary : currentWordObj.c;
  const pillWidth = `calc(${Math.max(charLen, 1) * 0.62}em + 0.5em)`;

  // Dashboard bar heights
  const barHeights = [38, 52, 44, 66, 58, 74, 62, 88, 80];
  const bars = barHeights.map((h, i) => ({
    h: `${h}%`,
    d: `${(0.35 + i * 0.07).toFixed(2)}s`,
    c: i === barHeights.length - 2 ? primary : '#C9D5FF',
  }));

  // Specialties
  const specialties = [
    'Cardiology',
    'Neurology',
    'Oncology',
    'Pediatrics',
    'Orthopedics',
    'Dermatology',
    'Gynecology',
    'ENT',
    'General Medicine',
  ];
  const specialtiesLoop = [...specialties, ...specialties];

  // Core Architecture Modules
  const modules = [
    {
      tag: '01 · CARE NETWORK',
      title: 'Doctor directory',
      body: 'Verified specialists with fees pulled straight from the hospital system.',
      href: '/directory',
    },
    {
      tag: '02 · SLOT LOCK',
      title: 'Atomic booking',
      body: 'One lock per doctor-day. 10-minute holds release on their own.',
      href: '/booking',
    },
    {
      tag: '03 · HIPAA VAULT',
      title: 'Medical Vault',
      body: 'Per-record keys, fail-closed audit logs and a tamper-evident hash chain.',
      href: '/records',
    },
    {
      tag: '04 · DPDP 2023',
      title: 'Consent ledger',
      body: 'Purpose notices, versioned consent and instant right-to-withdraw.',
      href: '/consent',
    },
  ];

  // Wizard data
  const reasonList = [
    'New consultation',
    'Follow-up visit',
    'Lab or scan reports',
    'Second opinion',
    'Child health',
    'Teleconsultation',
  ];

  const deptList = [
    'General Medicine',
    'Cardiology',
    'Neurology',
    'Oncology',
    'Pediatrics',
    'Orthopedics',
  ];

  const toggleReason = (label: string) => {
    setSelectedReasons((prev) =>
      prev.includes(label) ? prev.filter((r) => r !== label) : [...prev, label]
    );
  };

  const canProceed =
    step === 0
      ? selectedReasons.length > 0
      : step === 1
      ? !!selectedDept
      : step === 2
      ? patientName.trim().length > 0 && patientPhone.trim().length > 0 && dpdpAgreed
      : true;

  const handleNext = () => {
    if (!canProceed) return;
    if (step === 2) {
      setIsDone(true);
    } else {
      setStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep((prev) => prev - 1);
  };

  const handleRestart = () => {
    setStep(0);
    setSelectedReasons([]);
    setSelectedDept(null);
    setPatientName('');
    setPatientPhone('');
    setDpdpAgreed(false);
    setIsDone(false);
  };

  const handleSendReminder = () => {
    setReminderSent(true);
    setTimeout(() => setReminderSent(false), 2400);
  };

  // FAQ items
  const faqs = [
    {
      q: 'How do I book an appointment?',
      a: 'Pick a doctor in the directory and tap a free time. The slot is held for 10 minutes while you confirm your details.',
    },
    {
      q: 'What if I don’t confirm in time?',
      a: 'The hold expires automatically and the slot goes back on the calendar, so nobody can block time they won’t use.',
    },
    {
      q: 'Who can see my medical records?',
      a: 'Only you and the clinicians treating you. Each record has its own encryption key, and every access is logged before anything is decrypted.',
    },
    {
      q: 'Can I withdraw my consent?',
      a: 'Yes. The consent page shows what your data is used for and which version you agreed to. Withdrawal takes effect immediately.',
    },
    {
      q: 'Can I reschedule or cancel?',
      a: 'Yes, from the app or the booking page, up to 2 hours before your slot. The freed slot is offered to other patients straight away.',
    },
    {
      q: 'I’m hospital staff. Where do I sign in?',
      a: 'Use the Staff portal at /login. Access is role-based and every clinical access is fail-closed and audit-logged.',
    },
  ];

  // Footer letter wordmark
  const footerWord = 'DoctorCare';
  const letters = footerWord.split('').map((ch, i) => ({
    ch,
    range: `entry ${i * 4}% entry ${40 + i * 5}%`,
  }));

  return (
    <div className="w-full min-w-[1200px] bg-[#F4F6FB] text-[#0B1533]">
      {/* ================= HEADER / FLOATING NAV ================= */}
      <header className="sticky top-3 z-50 flex justify-center px-6 pt-3">
        <nav
          aria-label="Main"
          className="nav w-full max-w-[1040px] flex items-center justify-between gap-5 p-2 pl-5 border border-[#0B1533]/[0.08] rounded-full bg-white/80 backdrop-blur-xl shadow-lg shadow-[#0B1533]/5"
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 font-extrabold text-lg tracking-tight text-[#0B1533]"
          >
            <span
              style={{ background: primary }}
              className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white shadow-sm"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            DoctorCare
          </Link>

          <div className="flex items-center gap-6 text-sm font-medium text-[#3A4566]">
            <Link className="navlink" href="/directory">
              Doctors
            </Link>
            <Link className="navlink" href="/booking">
              Book a slot
            </Link>
            <Link className="navlink" href="/records">
              Medical Vault
            </Link>
            <Link className="navlink" href="/consent">
              Consent
            </Link>
            <a className="navlink" href="#faq">
              FAQ
            </a>
          </div>

          <a
            className="btn inline-flex items-center gap-2.5 h-11 px-2 pr-5 rounded-full text-white text-sm font-bold shadow-md shadow-blue-500/20"
            href="#book"
            style={{ background: primary }}
          >
            <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
              <svg
                className="arrow"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
            <span className="roll">
              <span>Book appointment</span>
              <span>Book appointment</span>
            </span>
          </a>
        </nav>
      </header>

      {/* ================= HERO SECTION ================= */}
      <section
        id="top"
        className="relative flex flex-col items-center px-6 pt-20 pb-4"
      >
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[900px] pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(rgba(11,21,51,0.08) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            WebkitMaskImage:
              'radial-gradient(ellipse 60% 55% at 50% 30%, #000 25%, transparent 75%)',
            maskImage:
              'radial-gradient(ellipse 60% 55% at 50% 30%, #000 25%, transparent 75%)',
          }}
        />

        <div className="hero-copy relative flex flex-col items-center gap-6 text-center max-w-[1000px]">
          <div className="rise d1 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E9EEFE] text-[#2B59FF] text-xs font-bold tracking-wider uppercase">
            <span className="live" />
            Zero-trust hospital platform &bull; HIPAA &amp; DPDP-ready
          </div>

          <h1 className="rise d2 m-0 text-[76px] leading-[1.08] font-extrabold tracking-tight text-[#0B1533]">
            The safest way to book
            <br />
            care for your{' '}
            <span
              className="pill"
              style={{ width: pillWidth, backgroundColor: pillColor }}
            >
              {typedWord}
              <span className="caret" />
            </span>
          </h1>

          <p className="rise d3 m-0 max-w-[620px] text-[19px] leading-relaxed text-[#4A5578]">
            Verified doctors, 10-minute slot holds and an encrypted medical vault, in one hospital
            platform. Consent is built in from day one.
          </p>

          <div className="rise d4 flex gap-3 pt-2">
            <a
              className="btn inline-flex items-center gap-3 h-14 px-7 rounded-full text-white text-base font-bold shadow-xl shadow-blue-500/30"
              href="#book"
              style={{ background: primary }}
            >
              <span className="roll">
                <span>Book an appointment</span>
                <span>Book an appointment</span>
              </span>
              <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-[#0B1533]">
                <svg
                  className="arrow"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0B1533"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </a>

            <Link
              className="btn inline-flex items-center h-14 px-7 rounded-full bg-white border border-[#0B1533]/[0.12] text-[#0B1533] text-base font-semibold shadow-sm hover:border-[#0B1533]/30"
              href="/directory"
            >
              <span className="roll">
                <span>Browse doctors</span>
                <span>Browse doctors</span>
              </span>
            </Link>
          </div>
        </div>

        {/* 3D Dashboard Perspective Container */}
        <div className="rise d5 w-full max-w-[1180px] mt-16 [perspective:1600px]">
          <div className="dash [transform-origin:50%_0%] rounded-[26px] bg-[#1A2340] p-3 shadow-2xl shadow-[#0B1533]/40">
            {/* Top Bar */}
            <div className="flex items-center gap-3.5 px-2.5 pt-2 pb-3.5">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#3A4466]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#3A4466]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#3A4466]" />
              </div>
              <span className="text-sm font-bold text-white">DoctorCare &bull; OPD console</span>
              <span className="ml-auto w-64 h-8 rounded-full bg-white/[0.08] flex items-center gap-2 px-3.5 text-xs text-[#8C95B3]">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#8C95B3"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                Search patient or doctor
              </span>
              <Link
                href="/booking"
                className="h-8 px-3.5 rounded-full bg-white text-[#0B1533] text-xs font-bold flex items-center hover:bg-zinc-100 transition-colors"
              >
                Open queue
              </Link>
            </div>

            {/* Dashboard 2x2 Grid */}
            <div className="grid grid-cols-2 gap-3 p-4 rounded-[18px] bg-[#F4F6FB]">
              {/* Card 1: Live Telemetry */}
              <div className="fly fa flex flex-col gap-4 p-5 rounded-[18px] bg-white shadow-sm">
                <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-bold tracking-wider uppercase text-[#6B7596]">
                      Today &bull; Cardiology OPD
                    </span>
                    <span className="text-base font-extrabold text-[#0B1533]">Live dashboard</span>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E8F7EE] text-[#15803D] text-xs font-bold">
                    <span className="live" />
                    Live
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-[#6B7596]">Appointments</span>
                    <span className="mono text-2xl font-bold text-[#0B1533]">{appts}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-[#6B7596]">Avg. wait</span>
                    <span className="mono text-2xl font-bold text-[#0B1533]">
                      8.2<span className="text-sm font-normal">m</span>
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-[#6B7596]">Teleconsults</span>
                    <span className="mono text-2xl font-bold text-[#0B1533]">23</span>
                  </div>
                </div>
                <div className="flex items-end gap-2 h-20">
                  {bars.map((b, i) => (
                    <div
                      key={i}
                      className="bar flex-1 rounded-t-md"
                      style={{
                        height: b.h,
                        animationDelay: b.d,
                        background: b.c,
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Card 2: Appointment Reminder Desk */}
              <div className="fly fb flex flex-col gap-3.5 p-5 rounded-[18px] bg-white shadow-sm">
                <div className="flex flex-col gap-1">
                  <span className="text-base font-extrabold text-[#0B1533]">
                    Appointment reminder
                  </span>
                  <span className="text-xs text-[#6B7596]">
                    Send the patient an SMS and email straight from the desk.
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-xl bg-[#F4F6FB]">
                  <span className="mono text-xs text-[#0B1533] font-medium">
                    #DC-28457 &bull; Menon, K.
                  </span>
                  <span className="text-xs text-[#6B7596]">09:40 &bull; Dr. Anjali R.</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-[#6B7596]">Hold expires in</span>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-[#E6EAF5] overflow-hidden">
                      <div
                        className="drain h-full rounded-full"
                        style={{ background: primary }}
                      />
                    </div>
                    <span className="mono text-xs font-bold text-[#0B1533]">{holdLabel}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSendReminder}
                  className="btn self-start h-10 px-4 border-0 rounded-lg text-white text-xs font-bold cursor-pointer transition-colors"
                  style={{ background: reminderSent ? '#15803D' : primary }}
                >
                  {reminderSent ? 'Reminder sent ✓' : 'Send reminder'}
                </button>
              </div>

              {/* Card 3: Slot Capacity Breakdown */}
              <div className="fly fc flex flex-col gap-3.5 p-5 rounded-[18px] bg-white shadow-sm">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold tracking-wider uppercase text-[#6B7596]">
                    Slot capacity &bull; Today
                  </span>
                  <span className="text-xs font-bold text-[#15803D]">Healthy</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="mono text-3xl font-bold text-[#0B1533]">87%</span>
                  <span className="text-xs text-[#6B7596]">142 / 164 slots filled</span>
                </div>
                <div className="flex gap-1 h-2.5">
                  <div
                    className="bar rounded-l-full"
                    style={{ flexGrow: 34, background: primary, animationDelay: '0.3s' }}
                  />
                  <div
                    className="bar"
                    style={{ flexGrow: 22, background: '#0E7C86', animationDelay: '0.4s' }}
                  />
                  <div
                    className="bar"
                    style={{ flexGrow: 18, background: '#7C8CF8', animationDelay: '0.5s' }}
                  />
                  <div
                    className="bar"
                    style={{ flexGrow: 13, background: '#F59E0B', animationDelay: '0.6s' }}
                  />
                  <div className="rounded-r-full bg-[#E6EAF5]" style={{ flexGrow: 13 }} />
                </div>
                <div className="flex gap-3 text-xs text-[#6B7596]">
                  <span>Cardiology</span>
                  <span>Neurology</span>
                  <span>Pediatrics</span>
                  <span>Oncology</span>
                </div>
              </div>

              {/* Card 4: AI Care Assistant Preview */}
              <div className="fly fd flex items-center gap-4 p-5 rounded-[18px] bg-white shadow-sm">
                <div className="flex-1 flex flex-col gap-2">
                  <span className="text-base font-extrabold text-[#0B1533]">
                    Care Assistant is live
                  </span>
                  <span className="text-xs leading-relaxed text-[#6B7596]">
                    Patients get answers about slots, fees and visiting hours around the clock.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setChatOpen(true);
                      setBubbleGone(true);
                    }}
                    className="btn self-start h-9 px-4 border-0 rounded-lg bg-[#0B1533] text-white text-xs font-bold cursor-pointer"
                  >
                    Try the assistant
                  </button>
                </div>
                <div
                  className="bot w-16 h-16 flex-shrink-0 rounded-2xl flex items-center justify-center text-white"
                  style={{ background: primary }}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="4" y="7" width="16" height="12" rx="4" />
                    <path d="M12 7V4M9 13h.01M15 13h.01M10 16h4" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= SPECIALTY MARQUEE ================= */}
      <section
        aria-label="Specialties"
        className="py-20 flex flex-col items-center gap-5 overflow-hidden"
      >
        <span className="text-xs font-bold tracking-widest uppercase text-[#6B7596]">
          Verified specialists across every department
        </span>
        <div className="marquee-wrap w-full overflow-hidden">
          <div className="marquee">
            {specialtiesLoop.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2.5 mr-3.5 px-5 py-3 bg-white border border-[#0B1533]/[0.08] rounded-full text-sm font-semibold text-[#26304F] whitespace-nowrap shadow-sm"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: primary }}
                />
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ================= STICKY STATS (CIRCLE WIPES) ================= */}
      <section className="stats relative h-[2800px]">
        <div className="sticky top-0 h-[min(100vh,900px)] overflow-hidden">
          {/* Panel 1: Medical Vault 256-bit AES-GCM */}
          <div className="absolute inset-0 bg-[#F4F6FB] flex flex-col items-center justify-center gap-4 text-center px-6">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E9EEFE] text-[#2B59FF] text-xs font-bold tracking-wider uppercase">
              <span className="live" />
              Medical Vault
            </span>
            <h2 className="m-0 text-5xl leading-tight font-extrabold tracking-tight text-[#0B1533]">
              Every record, locked
              <br />
              by default.
            </h2>
            <div className="flex items-end gap-2 text-[#0B1533]">
              <span className="num1 text-[170px] leading-[0.9] font-extrabold tracking-tighter" />
              <span className="text-2xl font-bold pb-3.5">-bit</span>
            </div>
            <span className="text-base font-semibold text-[#3A4566]">
              AES-256-GCM encryption, a fresh key per record
            </span>
            <p className="m-0 max-w-[520px] text-sm leading-relaxed text-[#6B7596]">
              Reports are encrypted before they are stored in D1. Every access is written to the audit
              log first, and if the log fails, zero clinical notes are decrypted.
            </p>
          </div>

          {/* Panel 2: Slot Lock 10-Minute Hold */}
          <div
            className="wipe2 absolute inset-0 text-white flex flex-col items-center justify-center gap-4 text-center px-6"
            style={{ background: primary }}
          >
            <div className="lift2 flex flex-col items-center gap-4">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-bold tracking-wider uppercase">
                <span className="live" />
                Slot booking
              </span>
              <h2 className="m-0 text-5xl leading-tight font-extrabold tracking-tight text-white">
                Slots that can&apos;t be
                <br />
                double-booked.
              </h2>
              <div className="flex items-end gap-2 text-white">
                <span className="num2 text-[170px] leading-[0.9] font-extrabold tracking-tighter" />
                <span className="text-2xl font-bold pb-3.5">min</span>
              </div>
              <span className="text-base font-semibold text-[#E3E9FF]">
                Your slot is held while you confirm
              </span>
              <p className="m-0 max-w-[520px] text-sm leading-relaxed text-[#DCE4FF]">
                One booking lock per doctor-day in SQLite Durable Objects. Two patients can never take
                the same time, and expired holds release automatically.
              </p>
            </div>
          </div>

          {/* Panel 3: 4 Layers of Rate Limiting & Cloudflare Pro Zone WAF */}
          <div className="wipe3 absolute inset-0 bg-[#0B1533] text-white flex flex-col items-center justify-center gap-4 text-center px-6">
            <div className="lift3 flex flex-col items-center gap-4">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs font-bold tracking-wider uppercase text-[#C7D3FF]">
                <span className="live" />
                All subsystems nominal
              </span>
              <h2 className="m-0 text-5xl leading-tight font-extrabold tracking-tight text-white">
                Defence in depth,
                <br />
                at the edge.
              </h2>
              <div className="flex items-end gap-2 text-white">
                <span className="num3 text-[170px] leading-[0.9] font-extrabold tracking-tighter" />
                <span className="text-2xl font-bold pb-3.5">layers</span>
              </div>
              <span className="text-base font-semibold text-[#C7D3FF]">
                of rate limiting, from WAF to healthcare business caps
              </span>
              <p className="m-0 max-w-[560px] text-sm leading-relaxed text-[#AEB8D6]">
                Cloudflare Pro Zone WAF (OWASP CRS v3.3), Worker rate-limit bindings, exact Durable
                Object sliding-window counters, and hospital business quotas protect clinical operations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= APP PREVIEW (PHONE MOCKUP) ================= */}
      <section className="flex justify-center px-6 py-28">
        <div
          className="grow w-full max-w-[1200px] h-[560px] rounded-[32px] text-white grid grid-cols-2 gap-10 px-16 overflow-hidden relative"
          style={{ background: primary }}
        >
          <div
            aria-hidden="true"
            className="absolute -right-40 -top-52 w-[620px] h-[620px] rounded-full border border-white/15 pointer-events-none"
          />
          <div className="flex flex-col justify-center gap-5 relative z-10">
            <span className="self-start inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-bold tracking-wider uppercase">
              <span className="live" />
              Patient app preview
            </span>
            <h2 className="m-0 text-5xl leading-tight font-extrabold tracking-tight">
              Your hospital,
              <br />
              in your pocket.
            </h2>
            <p className="m-0 max-w-[420px] text-base leading-relaxed text-[#E3E9FF]">
              Book, reschedule and access encrypted health charts from your phone. Zero front-desk
              paperwork.
            </p>
            <Link
              className="btn self-start inline-flex items-center gap-2.5 h-12 px-2 pr-6 rounded-full bg-white text-[#0B1533] text-sm font-bold shadow-lg"
              href="/booking"
            >
              <span
                style={{ background: primary }}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white"
              >
                <svg
                  className="arrow"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
              <span className="roll">
                <span>Try it now</span>
                <span>Try it now</span>
              </span>
            </Link>
          </div>

          <div className="flex justify-center items-end relative">
            <div className="phone w-[290px] h-[510px] -mb-10 rounded-[44px] bg-[#0B1533] p-2.5 shadow-2xl">
              <div className="w-full h-full rounded-[36px] bg-[#F4F6FB] overflow-hidden flex flex-col">
                <div className="p-6 pb-4 bg-[#0B1533] text-white flex flex-col gap-1">
                  <span className="text-xs text-[#9FB4FF]">Good morning</span>
                  <span className="text-lg font-extrabold">Hi, Rahul</span>
                  <span className="mt-2.5 h-8 rounded-full bg-white/10 flex items-center px-3.5 text-xs text-[#AEB8D6]">
                    Search doctors, specialties
                  </span>
                </div>
                <div className="p-3.5 flex flex-col gap-2.5">
                  <div className="p-3.5 rounded-2xl bg-white flex flex-col gap-1.5 text-[#0B1533] shadow-sm">
                    <span className="text-[11px] font-bold text-[#15803D]">
                      UPCOMING &bull; CONFIRMED
                    </span>
                    <span className="text-sm font-extrabold">Dr. Anjali R. &bull; Cardiology</span>
                    <span className="text-xs text-[#6B7596]">Tomorrow, 09:40 &bull; OPD Block B</span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-white flex items-center gap-2.5 text-[#0B1533] shadow-sm">
                    <span className="w-8 h-8 rounded-lg bg-[#E9EEFE] flex items-center justify-center text-[#2B59FF]">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#2B59FF"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                      </svg>
                    </span>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold">ECG_report.pdf</span>
                      <span className="text-[10px] text-[#6B7596]">Encrypted &bull; in vault</span>
                    </div>
                  </div>

                  <span className="text-xs font-bold text-[#6B7596] pt-1">Departments</span>
                  <div className="grid grid-cols-4 gap-2">
                    <span className="h-12 rounded-xl bg-white flex items-center justify-center text-[10px] font-bold text-[#2B59FF] shadow-sm">
                      Cardio
                    </span>
                    <span className="h-12 rounded-xl bg-white flex items-center justify-center text-[10px] font-bold text-[#0E7C86] shadow-sm">
                      Neuro
                    </span>
                    <span className="h-12 rounded-xl bg-white flex items-center justify-center text-[10px] font-bold text-[#B45309] shadow-sm">
                      Peds
                    </span>
                    <span className="h-12 rounded-xl bg-white flex items-center justify-center text-[10px] font-bold text-[#B42318] shadow-sm">
                      Onco
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= ARCHITECTURE MODULES ================= */}
      <section className="flex justify-center px-6 pb-28">
        <div className="w-full max-w-[1200px] flex flex-col gap-12">
          <div className="reveal flex flex-col items-center gap-3.5 text-center">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E9EEFE] text-[#2B59FF] text-xs font-bold tracking-wider uppercase">
              <span className="live" />
              One platform
            </span>
            <h2 className="m-0 text-5xl leading-tight font-extrabold tracking-tight text-[#0B1533]">
              Everything a visit needs,
              <br />
              <span className="serif text-[#2B59FF]">in one place.</span>
            </h2>
          </div>

          <div className="grid grid-cols-4 gap-4">
            {modules.map((m, i) => (
              <Link
                key={i}
                href={m.href}
                className="card reveal flex flex-col justify-between gap-12 min-h-[300px] p-7 rounded-[26px] bg-white border border-[#0B1533]/[0.08] shadow-sm"
              >
                <div className="flex justify-between items-start">
                  <span className="mono text-xs font-bold text-[#6B7596]">{m.tag}</span>
                  <span className="go w-10 h-10 rounded-full bg-[#F4F6FB] flex items-center justify-center text-[#0B1533]">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#0B1533"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  <h3 className="m-0 text-xl font-extrabold tracking-tight text-[#0B1533]">
                    {m.title}
                  </h3>
                  <p className="m-0 text-sm leading-relaxed text-[#4A5578]">{m.body}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ================= INTERACTIVE BOOKING WIZARD ================= */}
      <section id="book" className="flex justify-center px-6 pb-28">
        <div className="reveal w-full max-w-[1200px] grid grid-cols-2 gap-14 items-start">
          {/* Left Column: Context */}
          <div className="flex flex-col gap-5 pt-4">
            <span className="self-start inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E9EEFE] text-[#2B59FF] text-xs font-bold tracking-wider uppercase">
              <span className="live" />
              Let&apos;s get you seen
            </span>
            <h2 className="m-0 text-6xl leading-none font-extrabold tracking-tight text-[#0B1533]">
              Ready for your
              <br />
              <span className="serif text-[#2B59FF]">next visit?</span>
            </h2>
            <p className="m-0 max-w-[440px] text-base leading-relaxed text-[#4A5578]">
              Tell us what you need and we will find the right department. It takes under a minute.
            </p>

            <div className="flex flex-col gap-3.5 pt-2">
              <div className="flex items-center gap-3.5">
                <span className="w-10 h-10 rounded-xl bg-white border border-[#0B1533]/[0.08] flex items-center justify-center text-[#2B59FF]">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#2B59FF"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
                  </svg>
                </span>
                <div className="flex flex-col">
                  <span className="text-xs text-[#6B7596]">Front desk &bull; WhatsApp</span>
                  <span className="text-sm font-bold text-[#0B1533]">+91 80 4567 8900</span>
                </div>
              </div>

              <div className="flex items-center gap-3.5">
                <span className="w-10 h-10 rounded-xl bg-white border border-[#0B1533]/[0.08] flex items-center justify-center text-[#2B59FF]">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#2B59FF"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M3 7l9 6 9-6" />
                  </svg>
                </span>
                <div className="flex flex-col">
                  <span className="text-xs text-[#6B7596]">Clinical enquiries</span>
                  <span className="text-sm font-bold text-[#0B1533]">care@doctorcare.health</span>
                </div>
              </div>

              <div className="flex items-center gap-3.5">
                <span className="w-10 h-10 rounded-xl bg-white border border-[#0B1533]/[0.08] flex items-center justify-center text-[#2B59FF]">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#2B59FF"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                </span>
                <div className="flex flex-col">
                  <span className="text-xs text-[#6B7596]">Campus</span>
                  <span className="text-sm font-bold text-[#0B1533]">
                    DoctorCare Super Specialty Hospital, Bangalore
                  </span>
                </div>
              </div>
            </div>

            <div className="inline-flex items-center gap-2.5 p-3 px-4 rounded-xl bg-[#E8F7EE] text-[#15803D] text-xs font-semibold self-start">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#15803D"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              DPDP-compliant: your details are only used for this booking
            </div>
          </div>

          {/* Right Column: Interactive Card Form */}
          <div className="rounded-[28px] bg-white border border-[#0B1533]/[0.08] shadow-2xl shadow-[#0B1533]/10 p-8 flex flex-col gap-6 min-h-[520px]">
            <div className="flex justify-between items-center">
              <span className="text-sm font-extrabold text-[#0B1533]">DoctorCare</span>
              <span className="mono text-xs text-[#6B7596]">
                {isDone ? 'Done' : `Step ${step + 1} of 3`}
              </span>
            </div>

            <div className="h-1 rounded-full bg-[#E6EAF5] overflow-hidden">
              <div
                className="progress h-full rounded-full"
                style={{
                  width: isDone ? '100%' : `${((step + 1) / 3) * 100}%`,
                  background: primary,
                }}
              />
            </div>

            {/* Step 0: Reasons */}
            {!isDone && step === 0 && (
              <div className="rise flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h3 className="m-0 text-2xl font-extrabold text-[#0B1533]">What brings you in?</h3>
                  <span className="text-sm text-[#6B7596]">Choose everything that applies.</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {reasonList.map((r, i) => {
                    const isSelected = selectedReasons.includes(r);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleReason(r)}
                        className="chip flex items-center gap-2.5 min-h-[52px] p-3 px-3.5 rounded-xl border text-sm font-semibold text-left cursor-pointer"
                        style={{
                          borderColor: isSelected ? primary : '#DDE2EF',
                          background: isSelected ? '#EEF2FF' : '#ffffff',
                          color: '#0B1533',
                        }}
                      >
                        <span
                          className="w-5 h-5 flex-shrink-0 rounded-md border flex items-center justify-center"
                          style={{
                            borderColor: isSelected ? primary : '#DDE2EF',
                            background: isSelected ? primary : '#ffffff',
                          }}
                        >
                          {isSelected && (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#fff"
                              strokeWidth="3.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M5 12l5 5 9-10" />
                            </svg>
                          )}
                        </span>
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 1: Departments */}
            {!isDone && step === 1 && (
              <div className="rise flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h3 className="m-0 text-2xl font-extrabold text-[#0B1533]">Which department?</h3>
                  <span className="text-sm text-[#6B7596]">
                    Not sure? Pick General Medicine and we will route you.
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {deptList.map((d, i) => {
                    const isSelected = selectedDept === d;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedDept(d)}
                        className="chip flex items-center justify-between min-h-[52px] p-3 px-4 rounded-xl border text-sm font-semibold cursor-pointer"
                        style={{
                          borderColor: isSelected ? primary : '#DDE2EF',
                          background: isSelected ? '#EEF2FF' : '#ffffff',
                          color: '#0B1533',
                        }}
                      >
                        {d}
                        <span
                          className="w-4 h-4 rounded-full border"
                          style={{
                            borderColor: isSelected ? primary : '#DDE2EF',
                            background: isSelected ? primary : '#ffffff',
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Patient Info */}
            {!isDone && step === 2 && (
              <div className="rise flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h3 className="m-0 text-2xl font-extrabold text-[#0B1533]">How do we reach you?</h3>
                  <span className="text-sm text-[#6B7596]">
                    We will send your slot options by SMS and WhatsApp.
                  </span>
                </div>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#3A4566]">
                  Full name
                  <input
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="e.g. Rahul Menon"
                    className="h-12 px-4 rounded-xl border border-[#DDE2EF] text-sm text-[#0B1533] focus:outline-none focus:border-[#2B59FF]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#3A4566]">
                  Mobile number
                  <input
                    type="tel"
                    value={patientPhone}
                    onChange={(e) => setPatientPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="h-12 px-4 rounded-xl border border-[#DDE2EF] text-sm text-[#0B1533] focus:outline-none focus:border-[#2B59FF]"
                  />
                </label>
                <label className="flex items-start gap-2.5 text-xs leading-relaxed text-[#4A5578] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dpdpAgreed}
                    onChange={(e) => setDpdpAgreed(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded text-[#2B59FF] focus:ring-0 cursor-pointer"
                  />
                  I agree to DoctorCare using these details to arrange my appointment under the Digital
                  Personal Data Protection Act 2023.
                </label>
              </div>
            )}

            {/* Done Screen */}
            {isDone && (
              <div className="pop flex flex-col items-center justify-center gap-3.5 text-center py-10">
                <span className="w-16 h-16 rounded-full bg-[#E8F7EE] flex items-center justify-center text-[#15803D]">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#15803D"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                </span>
                <h3 className="m-0 text-2xl font-extrabold text-[#0B1533]">Request received</h3>
                <p className="m-0 max-w-[340px] text-sm leading-relaxed text-[#4A5578]">
                  We will text you open slots for {selectedDept || 'your department'} shortly. You can
                  also book instantly in our live directory.
                </p>
                <button
                  type="button"
                  onClick={handleRestart}
                  className="btn h-11 px-5 rounded-full border border-[#0B1533]/[0.14] bg-white text-[#0B1533] text-sm font-semibold cursor-pointer"
                >
                  Start over
                </button>
              </div>
            )}

            {/* Wizard Nav Controls */}
            {!isDone && (
              <div className="mt-auto flex justify-between items-center gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={step === 0}
                  className="h-12 px-5 rounded-full border border-[#0B1533]/[0.14] bg-white text-[#0B1533] text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Back
                </button>
                <span className="text-xs text-[#6B7596]">
                  {canProceed ? '' : step === 0 ? 'Choose at least one' : 'Complete fields'}
                </span>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!canProceed}
                  className="btn h-12 px-6 rounded-full text-white text-sm font-bold cursor-pointer disabled:bg-[#AEB6CF] disabled:cursor-not-allowed transition-colors"
                  style={{ background: canProceed ? primary : '#AEB6CF' }}
                >
                  {step === 2 ? 'Send request' : 'Continue'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ================= FAQ SECTION ================= */}
      <section id="faq" className="flex justify-center px-6 pb-32">
        <div className="w-full max-w-[1200px] flex flex-col gap-11">
          <div className="reveal flex flex-col items-center gap-3.5 text-center">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E9EEFE] text-[#2B59FF] text-xs font-bold tracking-wider uppercase">
              FAQ
            </span>
            <h2 className="m-0 text-5xl leading-tight font-extrabold tracking-tight text-[#0B1533]">
              More questions about
              <br />
              <span className="serif text-[#2B59FF]">your appointment?</span>
            </h2>
            <p className="m-0 max-w-[520px] text-base leading-relaxed text-[#4A5578]">
              If something isn&apos;t clear, call the front desk. We&apos;re happy to help.
            </p>
          </div>

          <div className="reveal grid grid-cols-2 gap-3 items-start">
            {faqs.map((f, i) => {
              const isOpen = openFaq === i;
              return (
                <div
                  key={i}
                  className="rounded-[18px] bg-white border border-[#0B1533]/[0.08] overflow-hidden shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="faq-q w-full flex items-center justify-between gap-4 min-h-[64px] p-5 border-0 bg-transparent cursor-pointer text-left font-bold text-base text-[#0B1533]"
                  >
                    {f.q}
                    <span
                      className="faq-plus w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center transition-transform"
                      style={{
                        background: isOpen ? primary : '#F4F6FB',
                        transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={isOpen ? '#ffffff' : '#0B1533'}
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </button>

                  <div
                    className="faq-body"
                    style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden">
                      <p className="m-0 px-5 pb-5 text-sm leading-relaxed text-[#4A5578]">
                        {f.a}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer
        className="text-white flex flex-col items-center pt-20 px-6 overflow-hidden"
        style={{ background: primary }}
      >
        <div className="w-full max-w-[1200px] grid grid-cols-5 gap-8">
          <div className="col-span-2 flex flex-col gap-4">
            <div className="flex gap-2">
              <span className="text-[11px] font-bold tracking-wider px-2.5 py-1 rounded-full bg-white/15">
                HIPAA § 164.312
              </span>
              <span className="text-[11px] font-bold tracking-wider px-2.5 py-1 rounded-full bg-white/15">
                DPDP ACT 2023
              </span>
            </div>
            <h3 className="m-0 text-4xl leading-tight font-extrabold tracking-tight">
              Hospital care,
              <br />
              built zero-trust.
            </h3>
            <p className="m-0 max-w-[380px] text-sm leading-relaxed text-[#E3E9FF]">
              Appointments and medical records on Cloudflare&apos;s edge. Every clinical record is
              encrypted end-to-end.
            </p>
          </div>

          <div className="flex flex-col gap-3 text-sm text-[#E3E9FF]">
            <span className="text-xs font-bold tracking-widest uppercase text-white">Patients</span>
            <Link className="navlink self-start" href="/directory">
              Find a doctor
            </Link>
            <Link className="navlink self-start" href="/booking">
              Book a slot
            </Link>
            <Link className="navlink self-start" href="/records">
              Medical Vault
            </Link>
          </div>

          <div className="flex flex-col gap-3 text-sm text-[#E3E9FF]">
            <span className="text-xs font-bold tracking-widest uppercase text-white">Hospital</span>
            <Link className="navlink self-start" href="/login">
              Staff portal
            </Link>
            <Link className="navlink self-start" href="/consent">
              Consent ledger
            </Link>
            <a className="navlink self-start" href="#faq">
              FAQ
            </a>
          </div>

          <div className="flex flex-col gap-3 text-sm text-[#E3E9FF]">
            <span className="text-xs font-bold tracking-widest uppercase text-white">Security</span>
            <Link className="navlink self-start" href="/records">
              AES-256-GCM AEAD
            </Link>
            <span className="text-xs text-blue-200">Cloudflare Secrets Store</span>
            <span className="text-xs text-blue-200">Cloudflare D1 Physical Isolation</span>
          </div>
        </div>

        <div className="w-full max-w-[1200px] flex justify-between py-10 pb-5 text-xs text-[#DCE4FF] border-b border-white/20">
          <span>&copy; 2026 DoctorCare Platform &bull; itsmesyaam</span>
          <span className="inline-flex items-center gap-2">
            <span className="live" />
            Edge network online &bull; Global Anycast
          </span>
        </div>

        {/* Big Wordmark Artwork */}
        <div
          aria-hidden="true"
          className="flex items-center gap-6 pt-7 -mb-9 pointer-events-none select-none"
        >
          <span className="letter w-44 h-44 rounded-3xl bg-white flex items-center justify-center shadow-2xl">
            <svg
              width="96"
              height="96"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2B59FF"
              strokeWidth="3.2"
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <div className="flex text-[230px] leading-[0.9] font-extrabold tracking-tighter text-white">
            {letters.map((l, i) => (
              <span
                key={i}
                className="letter inline-block"
                style={{ animationRange: l.range }}
              >
                {l.ch}
              </span>
            ))}
          </div>
        </div>
      </footer>

      {/* ================= FLOATING AI CARE ASSISTANT ================= */}
      <div className="fixed right-6 bottom-6 z-50 flex flex-col items-end gap-3">
        {chatOpen && (
          <div
            role="dialog"
            aria-label="Care Assistant"
            className="pop w-[360px] rounded-3xl bg-white shadow-2xl shadow-[#0B1533]/50 overflow-hidden flex flex-col border border-[#0B1533]/10"
          >
            <div className="p-4 bg-[#0B1533] text-white flex items-center gap-3">
              <span
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
                style={{ background: primary }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="4" y="7" width="16" height="12" rx="4" />
                  <path d="M12 7V4M9 13h.01M15 13h.01M10 16h4" />
                </svg>
              </span>
              <div className="flex-1 flex flex-col">
                <span className="text-sm font-extrabold">Care Assistant</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-[#AEB8D6]">
                  <span className="live" />
                  Online &bull; replies instantly
                </span>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Close assistant"
                className="w-8 h-8 border-0 rounded-full bg-white/10 text-white cursor-pointer flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="p-4 flex flex-col gap-2.5 bg-[#F4F6FB] min-h-[220px]">
              <div className="rise self-start max-w-[85%] p-3 rounded-2xl rounded-bl-sm bg-white text-xs leading-relaxed text-[#0B1533] shadow-sm">
                Hi, I&apos;m the DoctorCare assistant. I can help you find a doctor, check slots or
                explain your reports&apos; privacy.
              </div>
              <div className="rise d3 self-start p-3 rounded-2xl rounded-bl-sm bg-white flex gap-1.5 shadow-sm">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>

            <div className="p-3.5 flex flex-wrap gap-2 border-t border-[#0B1533]/5">
              <Link
                href="/booking"
                className="px-3.5 py-2 rounded-full border border-[#0B1533]/[0.12] text-xs font-semibold text-[#0B1533] hover:bg-[#F4F6FB] transition-colors"
              >
                Book a slot
              </Link>
              <Link
                href="/directory"
                className="px-3.5 py-2 rounded-full border border-[#0B1533]/[0.12] text-xs font-semibold text-[#0B1533] hover:bg-[#F4F6FB] transition-colors"
              >
                Find a doctor
              </Link>
              <a
                href="#faq"
                className="px-3.5 py-2 rounded-full border border-[#0B1533]/[0.12] text-xs font-semibold text-[#0B1533] hover:bg-[#F4F6FB] transition-colors"
              >
                Visiting hours
              </a>
            </div>
          </div>
        )}

        {!chatOpen && !bubbleGone && (
          <div className="bubble max-w-[250px] p-3 px-3.5 rounded-2xl rounded-br-sm bg-white shadow-xl shadow-[#0B1533]/15 text-xs leading-relaxed text-[#0B1533] border border-[#0B1533]/5">
            <strong>Hi, need a doctor?</strong> I can find you a slot in seconds.
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setChatOpen(!chatOpen);
            setBubbleGone(true);
          }}
          aria-label="Open Care Assistant"
          className="bot w-16 h-16 border-0 rounded-2xl text-white shadow-xl shadow-blue-500/40 cursor-pointer flex items-center justify-center hover:scale-105 transition-transform"
          style={{ background: primary }}
        >
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="7" width="16" height="12" rx="4" />
            <path d="M12 7V4M9 13h.01M15 13h.01M10 16h4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
