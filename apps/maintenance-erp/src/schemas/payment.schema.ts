export interface PaymentCreateDto {
  companyId: string;
  branchId?: string | null;
  customerId: string;
  amount: number;
  paymentMethod?: string;
  paymentMethodId?: string | null;
  paymentDate?: string;
  referenceNumber?: string | null;
  bankName?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  autoAllocateToInvoiceId?: string | null;
}

export interface PaymentAllocateDto {
  paymentId: string;
  invoiceId: string;
  allocatedAmount: number;
}

export interface PaymentDetailDto {
  id: string;
  paymentNumber: string;
  customerId: string;
  amount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber?: string | null;
  status: string;
}

export function validatePaymentCreate(body: any): PaymentCreateDto {
  if (!body) throw new Error('Payment request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.customerId) throw new Error('customerId is required');
  if (typeof body.amount !== 'number' || body.amount <= 0) {
    throw new Error('Payment amount must be a strictly positive number');
  }

  return body as PaymentCreateDto;
}
