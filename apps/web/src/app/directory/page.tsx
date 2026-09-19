'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Stethoscope,
  Search,
  Building2,
  DoorClosed,
  ArrowRight,
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
    room: 'Consultation Suite 402, Block A',
    experienceYears: 18,
    consultationType: 'REGULAR',
    baseFeePaise: 150000,
    totalFeeInr: 1770,
    availableSlotsCount: 6,
  },
  {
    id: 'doc_priya_02',
    name: 'Dr. Priya V. Sharma',
    specialty: 'Pediatric Cardiology & Congenital Heart',
    department: 'Cardiology',
    room: 'Pediatric Wing OPD-12',
    experienceYears: 14,
    consultationType: 'SPECIALIST',
    baseFeePaise: 200000,
    totalFeeInr: 2360,
    availableSlotsCount: 4,
  },
  {
    id: 'doc_arun_03',
    name: 'Dr. Arun K. Sundaram',
    specialty: 'Cerebrovascular & Stroke Neurology',
    department: 'Neurology',
    room: 'Neurosciences Center Room 204',
    experienceYears: 22,
    consultationType: 'SPECIALIST',
    baseFeePaise: 250000,
    totalFeeInr: 2950,
    availableSlotsCount: 3,
  },
  {
    id: 'doc_ananya_04',
    name: 'Dr. Ananya Sen',
    specialty: 'Medical Oncology & Immunotherapy',
    department: 'Oncology',
    room: 'Cancer Care OPD Suite 101',
    experienceYears: 16,
    consultationType: 'SPECIALIST',
    baseFeePaise: 220000,
    totalFeeInr: 2596,
    availableSlotsCount: 5,
  },
  {
    id: 'doc_vikram_05',
    name: 'Dr. Vikramaditya Joshi',
    specialty: 'Orthopedic Joint Replacement',
    department: 'Orthopedics',
    room: 'Orthopedics Suite 305',
    experienceYears: 19,
    consultationType: 'REGULAR',
    baseFeePaise: 180000,
    totalFeeInr: 2124,
    availableSlotsCount: 7,
  },
  {
    id: 'doc_meera_06',
    name: 'Dr. Meera N. Swaminathan',
    specialty: 'Internal Medicine & Diabetology',
    department: 'Internal Medicine',
    room: 'Primary Care Clinic Room 108',
    experienceYears: 12,
    consultationType: 'REGULAR',
    baseFeePaise: 100000,
    totalFeeInr: 1180,
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
    <div className="space-y-8 py-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E9EEFE] text-[#2B59FF] border border-[#2B59FF]/20 text-xs font-bold font-mono">
          <Stethoscope className="h-3.5 w-3.5" />
          <span>Care Directory &bull; Cloudflare D1 OpsDB</span>
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-[#0B1533]">
          Physician & Specialist Directory
        </h1>
        <p className="text-sm sm:text-base text-[#4A5578] max-w-2xl leading-relaxed">
          Select a verified physician to review real-time availability slots sharded across
          the DoctorCare Slot Durable Object architecture.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Department Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {DEPARTMENTS.map((dept) => (
            <button
              key={dept}
              onClick={() => setSelectedDept(dept)}
              className={`px-4 py-2.5 min-h-[44px] rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer flex items-center justify-center ${
                selectedDept === dept
                  ? 'bg-[#2B59FF] text-white shadow-md shadow-blue-500/20'
                  : 'bg-white text-[#4A5578] hover:text-[#0B1533] hover:bg-[#F4F6FB] border border-[#0B1533]/[0.08]'
              }`}
            >
              {dept}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7596]" />
          <input
            type="text"
            placeholder="Search doctors, specialties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 min-h-[44px] rounded-full bg-white border border-[#0B1533]/[0.12] text-xs text-[#0B1533] placeholder-[#6B7596] focus:outline-none focus:border-[#2B59FF] shadow-sm transition-all"
          />
        </div>
      </div>

      {/* Doctor Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredDoctors.map((doctor) => (
          <div
            key={doctor.id}
            className="rounded-[26px] p-5 sm:p-6 bg-white flex flex-col justify-between space-y-6 border border-[#0B1533]/[0.08] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E9EEFE] text-[#2B59FF] flex-shrink-0">
                  <Stethoscope className="h-6 w-6" />
                </div>
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-[#E8F7EE] text-[#15803D] border border-[#15803D]/20">
                  {doctor.availableSlotsCount} slots open
                </span>
              </div>

              <div>
                <h3 className="text-lg font-extrabold text-[#0B1533] tracking-tight">{doctor.name}</h3>
                <p className="text-xs text-[#2B59FF] font-semibold mt-0.5">{doctor.specialty}</p>
                <p className="text-xs text-[#6B7596] mt-0.5">{doctor.experienceYears} years clinical experience</p>
              </div>

              <div className="pt-2 space-y-1.5 border-t border-[#0B1533]/[0.06] text-xs text-[#4A5578]">
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-[#6B7596]" />
                  <span>{doctor.department}</span>
                </div>
                <div className="flex items-center gap-2">
                  <DoorClosed className="h-3.5 w-3.5 text-[#6B7596]" />
                  <span>{doctor.room}</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[#0B1533]/[0.08] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] uppercase font-mono text-[#6B7596] block font-semibold">
                  Consultation Fee
                </span>
                <span className="text-lg font-bold text-[#0B1533] font-mono">₹{doctor.totalFeeInr}</span>
                <span className="text-[10px] text-[#6B7596] block">incl. 18% GST</span>
              </div>

              <Link
                href={`/booking?doctor_id=${doctor.id}&doctor_name=${encodeURIComponent(
                  doctor.name
                )}&specialty=${encodeURIComponent(doctor.specialty)}`}
                className="btn inline-flex items-center justify-center gap-1.5 py-2.5 px-5 min-h-[44px] rounded-full bg-[#2B59FF] hover:bg-[#1E45D9] text-white text-xs font-bold shadow-md shadow-blue-500/20 w-full sm:w-auto"
              >
                <span>Book Slot</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      {filteredDoctors.length === 0 && (
        <div className="rounded-[26px] bg-white border border-[#0B1533]/[0.08] p-8 sm:p-12 text-center space-y-3 shadow-sm">
          <p className="text-sm text-[#4A5578]">
            No doctors found matching &ldquo;{searchQuery}&rdquo; in {selectedDept}.
          </p>
          <button
            onClick={() => {
              setSelectedDept('All');
              setSearchQuery('');
            }}
            className="min-h-[44px] px-4 text-xs text-[#2B59FF] font-bold hover:underline font-mono cursor-pointer inline-flex items-center justify-center"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
