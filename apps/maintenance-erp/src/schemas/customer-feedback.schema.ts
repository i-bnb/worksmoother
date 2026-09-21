/**
 * =============================================================================
 * Customer Feedback, Rescheduling, AMC & Rental Schemas
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

export interface CustomerFeedbackCreateDto {
  companyId: string;
  customerId: string;
  workOrderId: string;
  serviceReportId?: string | null;
  rating: number;
  timelinessRating?: number | null;
  technicianRating?: number | null;
  qualityRating?: number | null;
  comments?: string | null;
  customerContactId?: string | null;
}

export interface AppointmentRescheduleRequestDto {
  companyId: string;
  customerId: string;
  appointmentId: string;
  requestedDate: string;
  preferredTimeSlot?: 'morning' | 'afternoon' | 'evening' | 'anytime';
  reason: string;
}

export interface AmcRenewalRequestDto {
  companyId: string;
  customerId: string;
  contractId: string;
  notes?: string | null;
}

export interface RentalReturnOrExtensionDto {
  companyId: string;
  customerId: string;
  rentalContractId: string;
  action: 'extend' | 'return_pickup';
  requestedEndDate?: string | null;
  pickupAddress?: string | null;
  notes?: string | null;
}

export interface CustomerSafeFeedbackDto {
  id: string;
  workOrderId: string;
  workOrderNumber?: string;
  rating: number;
  timelinessRating?: number | null;
  technicianRating?: number | null;
  qualityRating?: number | null;
  comments?: string | null;
  createdAt: string;
}

export interface CustomerSafeWorkOrderDto {
  id: string;
  workOrderNumber: string;
  status: string;
  priority: string;
  description: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  siteName?: string;
  siteAddress?: string;
  assetName?: string | null;
  assetCode?: string | null;
  assignedTechnicianName?: string | null;
  createdAt: string;
  completedAt?: string | null;
  hasFeedbackSubmitted: boolean;
}

export interface CustomerSafeServiceReportDto {
  id: string;
  reportNumber: string;
  workOrderNumber: string;
  assetName?: string | null;
  problemReported: string;
  diagnosis: string;
  workPerformed: string;
  recommendations?: string | null;
  completionStatus: string;
  technicianName?: string | null;
  partsReplaced: Array<{
    partName: string;
    quantity: number;
  }>;
  createdAt: string;
}

export interface CustomerSafeAmcContractDto {
  id: string;
  contractNumber: string;
  contractName: string;
  startDate: string;
  endDate: string;
  status: string;
  billingFrequency: string;
  totalPreventiveVisits: number;
  completedVisits: number;
  remainingVisits: number;
  coveredAssetsCount: number;
  coveredAssets: Array<{
    assetId: string;
    assetName: string;
    assetCode: string;
    siteName?: string;
  }>;
}

export interface CustomerSafeRentalDto {
  id: string;
  contractNumber: string;
  status: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  itemsCount: number;
  items: Array<{
    assetName: string;
    serialNumber?: string | null;
    dailyRate: number;
    quantity: number;
  }>;
}

export function validateCustomerFeedbackCreate(body: any): CustomerFeedbackCreateDto {
  if (!body) throw new Error('Feedback body is required');
  const companyId = body.companyId || body.company_id;
  const customerId = body.customerId || body.customer_id;
  const workOrderId = body.workOrderId || body.work_order_id;
  const rating = Number(body.rating);

  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!workOrderId) throw new Error('workOrderId is required');

  if (isNaN(rating) || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    throw new Error('Rating must be an integer between 1 and 5');
  }

  const validateSubRating = (val: any, name: string) => {
    if (val === undefined || val === null || val === '') return null;
    const n = Number(val);
    if (isNaN(n) || n < 1 || n > 5 || !Number.isInteger(n)) {
      throw new Error(`${name} must be an integer between 1 and 5`);
    }
    return n;
  };

  return {
    companyId,
    customerId,
    workOrderId,
    serviceReportId: body.serviceReportId || body.service_report_id || null,
    rating,
    timelinessRating: validateSubRating(body.timelinessRating || body.timeliness_rating, 'timelinessRating'),
    technicianRating: validateSubRating(body.technicianRating || body.technician_rating, 'technicianRating'),
    qualityRating: validateSubRating(body.qualityRating || body.quality_rating, 'qualityRating'),
    comments: body.comments ? String(body.comments).trim() : null,
    customerContactId: body.customerContactId || body.customer_contact_id || null,
  };
}

export function validateAppointmentRescheduleRequest(body: any): AppointmentRescheduleRequestDto {
  if (!body) throw new Error('Rescheduling request body is required');
  const companyId = body.companyId || body.company_id;
  const customerId = body.customerId || body.customer_id;
  const appointmentId = body.appointmentId || body.appointment_id;
  const requestedDate = body.requestedDate || body.requested_date;
  const reason = (body.reason || '').trim();

  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!appointmentId) throw new Error('appointmentId is required');
  if (!requestedDate) throw new Error('requestedDate is required');
  if (!reason) throw new Error('A reason for rescheduling is required');

  const slot = (body.preferredTimeSlot || body.preferred_time_slot || 'anytime').toLowerCase();
  const validSlots = ['morning', 'afternoon', 'evening', 'anytime'];
  if (!validSlots.includes(slot)) {
    throw new Error(`Invalid preferred time slot: ${slot}`);
  }

  return {
    companyId,
    customerId,
    appointmentId,
    requestedDate,
    preferredTimeSlot: slot as any,
    reason,
  };
}

export function validateAmcRenewalRequest(body: any): AmcRenewalRequestDto {
  if (!body) throw new Error('AMC renewal body is required');
  const companyId = body.companyId || body.company_id;
  const customerId = body.customerId || body.customer_id;
  const contractId = body.contractId || body.contract_id;

  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!contractId) throw new Error('contractId is required');

  return {
    companyId,
    customerId,
    contractId,
    notes: body.notes ? String(body.notes).trim() : null,
  };
}

export function validateRentalReturnOrExtension(body: any): RentalReturnOrExtensionDto {
  if (!body) throw new Error('Rental request body is required');
  const companyId = body.companyId || body.company_id;
  const customerId = body.customerId || body.customer_id;
  const rentalContractId = body.rentalContractId || body.rental_contract_id || body.rentalAgreementId || body.rental_agreement_id;
  const action = (body.action || '').toLowerCase();

  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!rentalContractId) throw new Error('rentalContractId is required');

  if (action !== 'extend' && action !== 'return_pickup') {
    throw new Error('Action must be either "extend" or "return_pickup"');
  }

  if (action === 'extend' && !body.requestedEndDate && !body.requested_end_date) {
    throw new Error('requestedEndDate is required when requesting rental extension');
  }

  return {
    companyId,
    customerId,
    rentalContractId,
    action,
    requestedEndDate: body.requestedEndDate || body.requested_end_date || null,
    pickupAddress: body.pickupAddress || body.pickup_address || null,
    notes: body.notes ? String(body.notes).trim() : null,
  };
}
