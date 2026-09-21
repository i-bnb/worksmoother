import { SupabaseClient } from '@supabase/supabase-js';
import { RecipientType } from '../schemas/notification-rule.schema.js';

export interface ResolvedRecipient {
  recipientId?: string;
  recipientType: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
}

export class RecipientResolverService {
  /**
   * Pure recipient resolution against provided entity data maps.
   */
  static resolvePure(params: {
    recipientType: RecipientType;
    recipientRole?: string | null;
    entityPayload: Record<string, any>;
    technicians?: Array<{ id: string; name: string; email?: string; phone?: string; userId?: string }>;
    customers?: Array<{ id: string; name: string; email?: string; phone?: string }>;
    managers?: Array<{ id: string; name: string; email?: string; phone?: string; role: string; userId: string }>;
  }): ResolvedRecipient[] {
    const { recipientType, recipientRole, entityPayload, technicians = [], customers = [], managers = [] } = params;

    switch (recipientType) {
      case 'technician': {
        const techId = entityPayload.technician_id || entityPayload.assigned_technician_id;
        const match = technicians.find((t) => t.id === techId || t.userId === techId);
        if (match) {
          return [{
            recipientId: match.id,
            recipientType: 'technician',
            name: match.name,
            email: match.email || null,
            phone: match.phone || null,
            userId: match.userId || match.id,
          }];
        }
        if (entityPayload.technician_name || entityPayload.technician_email) {
          return [{
            recipientType: 'technician',
            name: entityPayload.technician_name || 'Technician',
            email: entityPayload.technician_email || null,
            phone: entityPayload.technician_phone || null,
            userId: entityPayload.technician_user_id || null,
          }];
        }
        return [];
      }

      case 'customer': {
        const custId = entityPayload.customer_id;
        const match = customers.find((c) => c.id === custId);
        if (match) {
          return [{
            recipientId: match.id,
            recipientType: 'customer',
            name: match.name,
            email: match.email || null,
            phone: match.phone || null,
          }];
        }
        if (entityPayload.customer_name || entityPayload.customer_email) {
          return [{
            recipientType: 'customer',
            name: entityPayload.customer_name || 'Valued Customer',
            email: entityPayload.customer_email || null,
            phone: entityPayload.customer_phone || null,
          }];
        }
        return [];
      }

      case 'service_manager': {
        const matchingManagers = managers.filter(
          (m) => ['operations_manager', 'supervisor'].includes(m.role)
        );
        return matchingManagers.map((m) => ({
          recipientId: m.id,
          recipientType: 'service_manager',
          name: m.name,
          email: m.email || null,
          phone: m.phone || null,
          userId: m.userId,
        }));
      }

      case 'role': {
        if (!recipientRole) return [];
        const matchingRole = managers.filter((m) => m.role === recipientRole);
        return matchingRole.map((m) => ({
          recipientId: m.id,
          recipientType: 'role',
          name: m.name,
          email: m.email || null,
          phone: m.phone || null,
          userId: m.userId,
        }));
      }

      case 'user': {
        if (entityPayload.user_id) {
          return [{
            recipientId: entityPayload.user_id,
            recipientType: 'user',
            name: entityPayload.user_name || 'User',
            email: entityPayload.user_email || null,
            userId: entityPayload.user_id,
          }];
        }
        return [];
      }

      default:
        return [];
    }
  }

  /**
   * Resolves target recipients dynamically from the live database for a given event.
   */
  static async resolveRecipients(
    client: SupabaseClient,
    companyId: string,
    recipientType: RecipientType,
    recipientRole: string | null | undefined,
    entityType: string,
    entityId: string,
    payload: Record<string, any>
  ): Promise<ResolvedRecipient[]> {
    switch (recipientType) {
      case 'technician': {
        // Look up technician from payload or entity
        let technicianId = payload.technician_id || payload.assigned_technician_id;

        if (!technicianId && entityType === 'work_order') {
          const { data: wo } = await client
            .from('work_orders')
            .select('assigned_technician_id')
            .eq('id', entityId)
            .maybeSingle();
          technicianId = wo?.assigned_technician_id;
        } else if (!technicianId && entityType === 'service_appointment') {
          const { data: appt } = await client
            .from('service_appointments')
            .select('assigned_technician_id')
            .eq('id', entityId)
            .maybeSingle();
          technicianId = appt?.assigned_technician_id;
        }

        if (technicianId) {
          const { data: tech } = await client
            .from('employees')
            .select('id, display_name, email, phone, user_id')
            .eq('id', technicianId)
            .maybeSingle();

          if (tech) {
            return [{
              recipientId: tech.id,
              recipientType: 'technician',
              name: tech.display_name,
              email: tech.email || null,
              phone: tech.phone || null,
              userId: tech.user_id || null,
            }];
          }
        }
        return [];
      }

      case 'customer': {
        let customerId = payload.customer_id;
        if (!customerId) {
          const { data: entity } = await client
            .from(entityType === 'invoice' ? 'invoices' : 'work_orders')
            .select('customer_id')
            .eq('id', entityId)
            .maybeSingle();
          customerId = entity?.customer_id;
        }

        if (customerId) {
          const { data: cust } = await client
            .from('customers')
            .select('id, name, email, phone')
            .eq('id', customerId)
            .maybeSingle();

          if (cust) {
            return [{
              recipientId: cust.id,
              recipientType: 'customer',
              name: cust.name,
              email: cust.email || null,
              phone: cust.phone || null,
            }];
          }
        }
        return [];
      }

      case 'service_manager': {
        // Look up company members holding operations_manager role
        const { data: roles } = await client
          .from('user_roles')
          .select('user_id, role, profile:profiles(display_name, email)')
          .eq('company_id', companyId)
          .in('role', ['operations_manager', 'supervisor']);

        return (roles || []).map((r: any) => ({
          recipientId: r.user_id,
          recipientType: 'service_manager',
          name: r.profile?.display_name || 'Operations Manager',
          email: r.profile?.email || null,
          userId: r.user_id,
        }));
      }

      case 'role': {
        if (!recipientRole) return [];
        const { data: roles } = await client
          .from('user_roles')
          .select('user_id, role, profile:profiles(display_name, email)')
          .eq('company_id', companyId)
          .eq('role', recipientRole);

        return (roles || []).map((r: any) => ({
          recipientId: r.user_id,
          recipientType: 'role',
          name: r.profile?.display_name || recipientRole,
          email: r.profile?.email || null,
          userId: r.user_id,
        }));
      }

      case 'user': {
        const userId = payload.user_id;
        if (userId) {
          const { data: prof } = await client
            .from('profiles')
            .select('id, display_name, email')
            .eq('id', userId)
            .maybeSingle();

          if (prof) {
            return [{
              recipientId: prof.id,
              recipientType: 'user',
              name: prof.display_name,
              email: prof.email || null,
              userId: prof.id,
            }];
          }
        }
        return [];
      }

      default:
        return [];
    }
  }
}
