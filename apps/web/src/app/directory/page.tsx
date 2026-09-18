'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Stethoscope,
  Search,
  Building2,
  DoorClosed,
  Clock,
  ArrowRight,
  ShieldCheck,
  Check,
} from 'lucide-react';

interface DoctorItem {
  id: string;
  name: string;
  specialty: string;
  department: string;
  room: string;
  experienceYears: number;
  consultationType: 'REGULAR' | 'SPECIALIST' | 'SURGICAL' | 'EMERGENCY';
  baseFeePaise: number;
  totalFeeInr: number;
  availableSlotsCount: number;
}

const SAMPLE_DOCTORS: DoctorItem[] = [
  {
    id: 'doc_suresh_01',
    name: 'Dr. Suresh R. Nair',
    specialty: 'Interventional Cardiology',
    department: 'Cardiology',
    room: 'Room 304, Tower B',
    experienceYears: 16,
    consultationType: 'SPECIALIST',
    baseFeePaise: 150000,
    totalFeeInr: 1770,
    availableSlotsCount: 4,
  },
  {
    id: 'doc_priya_02',
    name: 'Dr. Priya V. Sharma',
    specialty: 'Pediatric Neurology',
    department: 'Neurology',
    room: 'Room 212, Tower A',
    experienceYears: 12,
    consultationType: 'SPECIALIST',
    baseFeePaise: 150000,
    totalFeeInr: 1770,
    availableSlotsCount: 6,
  },
  {
    id: 'doc_arun_03',
    name: 'Dr. Arun M. Thomas',
    specialty: 'Trauma & Emergency Care',
    department: 'Emergency',
    room: 'ER Suite 01',
    experienceYears: 14,
    consultationType: 'EMERGENCY',
    baseFeePaise: 200000,
    totalFeeInr: 2360,
    availableSlotsCount: 2,
  },
  {
    id: 'doc_ananya_04',
    name: 'Dr. Ananya K. Sengupta',
    specialty: 'Orthopedic Spine Surgery',
    department: 'Orthopedics',
    room: 'Room 408, Tower C',
    experienceYears: 18,
    consultationType: 'SURGICAL',
    baseFeePaise: 350000,
    totalFeeInr: 4130,
    availableSlotsCount: 3,
  },
  {
    id: 'doc_vikram_05',
    name: 'Dr. Vikram D. Malhotra',
    specialty: 'Medical Oncology',
    department: 'Oncology',
    room: 'Room 501, Tower B',
    experienceYears: 20,
    consultationType: 'SPECIALIST',
    baseFeePaise: 150000,
    totalFeeInr: 1770,
    availableSlotsCount: 5,
  },
  {
    id: 'doc_meera_06',
    name: 'Dr. Meera G. Iyer',
    specialty: 'General Internal Medicine',
    department: 'Internal Medicine',
    room: 'Room 105, Clinic Wing',
    experienceYears: 9,
    consultationType: 'REGULAR',
    baseFeePaise: 80000,
    totalFeeInr: 944,
    availableSlotsCount: 8,
  },
];

const DEPARTMENTS = [
  'All',
  'Cardiology',
  'Neurology',
  'Emergency',
  'Orthopedics',
  'Oncology',
  'Internal Medicine',
];

export default function DirectoryPage() {
  const [selectedDept, setSelectedDept] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDoctors = SAMPLE_DOCTORS.filter((doc) => {
    const matchesDept = selectedDept === 'All' || doc.department === selectedDept;
    const matchesSearch =
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.specialty.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.department.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDept && matchesSearch;
  });

  return (
    <div className="space-y-8 py-4">
      {/* Page Header */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-400 font-mono">
          <Stethoscope className="h-3.5 w-3.5" />
          <span>Care Directory &bull; Appwrite Project A TablesDB</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Physician & Specialist Directory
        </h1>
        <p className="text-sm text-zinc-400 max-w-2xl leading-relaxed">
          Select a verified physician to review real-time availability slots sharded across
          the DoctorCare Slot Durable Object architecture.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Department Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {DEPARTMENTS.map((dept) => (
            <button
              key={dept}
              onClick={() => setSelectedDept(dept)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                selectedDept === dept
                  ? 'bg-white text-black font-semibold shadow-md'
                  : 'bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/[0.08] border border-white/5'
              }`}
            >
              {dept}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[260px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search doctors, specialties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-full bg-white/[0.05] border border-white/10 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
          />
        </div>
      </div>

      {/* Doctor Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredDoctors.map((doctor) => (
          <div
            key={doctor.id}
            className="glass-panel-interactive rounded-3xl p-6 flex flex-col justify-between space-y-5 border border-white/10"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/10 border border-white/15 text-blue-400">
                  <Stethoscope className="h-5 w-5" />
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {doctor.availableSlotsCount} slots open
                </span>
              </div>

              <div>
                <h3 className="text-base font-semibold text-white tracking-tight">{doctor.name}</h3>
                <p className="text-xs text-blue-400 font-medium mt-0.5">{doctor.specialty}</p>
                <p className="text-xs text-zinc-500">{doctor.experienceYears} years clinical experience</p>
              </div>

              <div className="pt-2 space-y-1.5 border-t border-white/5 text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-zinc-500" />
                  <span>{doctor.department}</span>
                </div>
                <div className="flex items-center gap-2">
                  <DoorClosed className="h-3.5 w-3.5 text-zinc-500" />
                  <span>{doctor.room}</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono text-zinc-500 block">Consultation Fee</span>
                <span className="text-base font-bold text-white font-mono">₹{doctor.totalFeeInr}</span>
                <span className="text-[10px] text-zinc-500 block">incl. 18% GST</span>
              </div>

              <Link
                href={`/booking?doctor_id=${doctor.id}&doctor_name=${encodeURIComponent(doctor.name)}&specialty=${encodeURIComponent(doctor.specialty)}`}
                className="apple-btn-primary text-xs flex items-center gap-1.5 py-2 px-3.5"
              >
                <span>Book Slot</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      {filteredDoctors.length === 0 && (
        <div className="glass-panel rounded-3xl p-12 text-center space-y-3">
          <p className="text-sm text-zinc-400">No doctors found matching "{searchQuery}" in {selectedDept}.</p>
          <button
            onClick={() => { setSelectedDept('All'); setSearchQuery(''); }}
            className="text-xs text-blue-400 hover:underline font-mono"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
