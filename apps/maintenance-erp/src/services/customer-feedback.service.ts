/**
 * =============================================================================
 * Customer Service Feedback & Ratings Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  CustomerFeedbackCreateDto,
  CustomerSafeFeedbackDto,
} from '../schemas/customer-feedback.schema.js';

export class CustomerFeedbackService {
  /**
   * Submits customer post-service feedback for a completed work order.
   * Enforces that the work order belongs to the customer and is completed.
   * Enforces unique constraint: exactly one feedback submission per completed job.
   */
  static async submitFeedback(
    client: SupabaseClient,
    dto: CustomerFeedbackCreateDto,
    userId?: string
  ): Promise<CustomerSafeFeedbackDto> {
    // 1. Verify work order ownership & status
    const { data: wo, error: woErr } = await client
      .from('work_orders')
      .select('id, company_id, customer_id, work_order_number, status')
      .eq('id', dto.workOrderId)
      .eq('customer_id', dto.customerId)
      .single();

    if (woErr || !wo) {
      throw new Error('Work order not found or does not belong to your account');
    }

    if (wo.status !== 'completed' && wo.status !== 'closed') {
      throw new Error(
        `Feedback can only be submitted for completed work orders. Current status is '${wo.status}'`
      );
    }

    // 2. Check for duplicate feedback
    const { data: existingFeedback } = await client
      .from('service_feedback')
      .select('id')
      .eq('work_order_id', dto.workOrderId)
      .eq('customer_id', dto.customerId)
      .maybeSingle();

    if (existingFeedback) {
      throw new Error('Feedback has already been submitted for this work order');
    }

    // 3. Insert feedback
    const { data: feedback, error: insErr } = await client
      .from('service_feedback')
      .insert({
        company_id: dto.companyId,
        customer_id: dto.customerId,
        work_order_id: dto.workOrderId,
        service_report_id: dto.serviceReportId || null,
        rating: dto.rating,
        timeliness_rating: dto.timelinessRating || null,
        technician_rating: dto.technicianRating || null,
        quality_rating: dto.qualityRating || null,
        comments: dto.comments || null,
        customer_contact_id: dto.customerContactId || null,
        submitted_by: userId || null,
        is_published: true,
      })
      .select('id, work_order_id, rating, timeliness_rating, technician_rating, quality_rating, comments, created_at')
      .single();

    if (insErr) {
      throw new Error(`Failed to submit feedback: ${insErr.message}`);
    }

    // 4. Publish domain event
    try {
      await client.from('domain_events').insert({
        company_id: dto.companyId,
        event_type: 'SERVICE_FEEDBACK_SUBMITTED',
        entity_type: 'service_feedback',
        entity_id: feedback.id,
        actor_id: userId || null,
        payload: {
          work_order_id: dto.workOrderId,
          work_order_number: wo.work_order_number,
          customer_id: dto.customerId,
          rating: dto.rating,
          comments: dto.comments,
        },
      });
    } catch {
      // ignore
    }

    return {
      id: feedback.id,
      workOrderId: feedback.work_order_id,
      workOrderNumber: wo.work_order_number,
      rating: feedback.rating,
      timelinessRating: feedback.timeliness_rating,
      technicianRating: feedback.technician_rating,
      qualityRating: feedback.quality_rating,
      comments: feedback.comments,
      createdAt: feedback.created_at,
    };
  }

  /**
   * Retrieves submitted feedback for a specific work order.
   */
  static async getFeedbackForWorkOrder(
    client: SupabaseClient,
    customerId: string,
    workOrderId: string
  ): Promise<CustomerSafeFeedbackDto | null> {
    if (!customerId) throw new Error('customerId is required');
    if (!workOrderId) throw new Error('workOrderId is required');

    const { data: fb, error } = await client
      .from('service_feedback')
      .select(`
        id,
        work_order_id,
        rating,
        timeliness_rating,
        technician_rating,
        quality_rating,
        comments,
        created_at,
        work_orders (
          work_order_number
        )
      `)
      .eq('work_order_id', workOrderId)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (error || !fb) return null;

    const wo = fb.work_orders as any;

    return {
      id: fb.id,
      workOrderId: fb.work_order_id,
      workOrderNumber: wo?.work_order_number,
      rating: fb.rating,
      timelinessRating: fb.timeliness_rating,
      technicianRating: fb.technician_rating,
      qualityRating: fb.quality_rating,
      comments: fb.comments,
      createdAt: fb.created_at,
    };
  }

  /**
   * Calculates overall customer satisfaction ratings.
   */
  static async getFeedbackSummary(
    client: SupabaseClient,
    customerId: string
  ): Promise<{ totalFeedbacks: number; averageRating: number }> {
    if (!customerId) throw new Error('customerId is required');

    const { data: list, error } = await client
      .from('service_feedback')
      .select('rating')
      .eq('customer_id', customerId);

    if (error) {
      throw new Error(`Failed to calculate feedback summary: ${error.message}`);
    }

    const items = list || [];
    if (items.length === 0) {
      return { totalFeedbacks: 0, averageRating: 0 };
    }

    const sum = items.reduce((acc, curr) => acc + curr.rating, 0);
    const avg = Math.round((sum / items.length) * 10) / 10;

    return {
      totalFeedbacks: items.length,
      averageRating: avg,
    };
  }
}
