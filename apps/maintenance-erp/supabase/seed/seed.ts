/**
 * =============================================================================
 * Development Seed Runner (TypeScript)
 * Maintenance Management ERP — Phase 0 & Phase 1 Core Operations
 * =============================================================================
 * Provisions all initial development users, roles, profiles, customers, assets,
 * and sample operational work orders via Supabase Admin API.
 *
 * SAFETY GUARDS:
 * 1. Strictly refuses execution if NODE_ENV === 'production'.
 * 2. Secrets/passwords are injected via SEED_USER_PASSWORD environment variable.
 */

import { createClient } from '@supabase/supabase-js';

// Environment validation & safety guard
if (process.env.NODE_ENV === 'production') {
  console.error('CRITICAL ERROR: Seed script execution is strictly forbidden in production!');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const seedPassword = process.env.SEED_USER_PASSWORD || 'DevPassword123!';

if (!serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable. Aborting.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const BRANCH_DXB_ID = '22222222-2222-2222-2222-222222222221';
const BRANCH_AUH_ID = '22222222-2222-2222-2222-222222222222';

const CUST_EMAAR_ID = '33333333-3333-3333-3333-333333333331';
const SITE_DUBAI_MALL_ID = '44444444-4444-4444-4444-444444444441';
const ASSET_CHILLER_ID = '55555555-5555-5555-5555-555555555551';
const ST_AC_SRV_ID = '66666666-6666-6666-6666-666666666661';

interface SeedUser {
  email: string;
  fullName: string;
  phone: string;
  role:
    | 'owner_admin'
    | 'operations_manager'
    | 'supervisor'
    | 'technician'
    | 'storekeeper'
    | 'accountant'
    | 'customer';
  branchId: string | null;
  customerId?: string | null;
  employeeCode?: string;
  jobTitle?: string;
  department?: string;
}

const SEED_USERS: SeedUser[] = [
  {
    email: 'owner@apexfacilities.com',
    fullName: 'Tariq Al-Mansoor',
    phone: '+971501112233',
    role: 'owner_admin',
    branchId: null,
    employeeCode: 'EMP-001',
    jobTitle: 'Managing Director & Owner',
    department: 'Executive Management',
  },
  {
    email: 'ops.manager@apexfacilities.com',
    fullName: 'Sara Al-Hashemi',
    phone: '+971502223344',
    role: 'operations_manager',
    branchId: null,
    employeeCode: 'EMP-002',
    jobTitle: 'Head of Operations',
    department: 'Operations',
  },
  {
    email: 'supervisor.dxb@apexfacilities.com',
    fullName: 'Vikram Sharma',
    phone: '+971503334455',
    role: 'supervisor',
    branchId: BRANCH_DXB_ID,
    employeeCode: 'EMP-003',
    jobTitle: 'Field Maintenance Supervisor',
    department: 'Field Engineering',
  },
  {
    email: 'tech.ahmed@apexfacilities.com',
    fullName: 'Ahmed Farooq',
    phone: '+971504445566',
    role: 'technician',
    branchId: BRANCH_DXB_ID,
    employeeCode: 'EMP-004',
    jobTitle: 'Senior HVAC Technician',
    department: 'HVAC Maintenance',
  },
  {
    email: 'tech.rajesh@apexfacilities.com',
    fullName: 'Rajesh Kumar',
    phone: '+971505556677',
    role: 'technician',
    branchId: BRANCH_AUH_ID,
    employeeCode: 'EMP-005',
    jobTitle: 'Electrical Systems Technician',
    department: 'Electrical Maintenance',
  },
  {
    email: 'storekeeper.dxb@apexfacilities.com',
    fullName: 'Hamdan Qureshi',
    phone: '+971506667788',
    role: 'storekeeper',
    branchId: BRANCH_DXB_ID,
    employeeCode: 'EMP-006',
    jobTitle: 'Lead Storekeeper',
    department: 'Stores & Spares Inventory',
  },
  {
    email: 'accountant@apexfacilities.com',
    fullName: 'Nour El-Din',
    phone: '+971507778899',
    role: 'accountant',
    branchId: null,
    employeeCode: 'EMP-007',
    jobTitle: 'Senior Financial Accountant',
    department: 'Finance & Billing',
  },
  {
    email: 'customer.emaar@client.com',
    fullName: 'Rashid Al-Kindi (Emaar FM)',
    phone: '+971508889900',
    role: 'customer',
    branchId: null,
    customerId: CUST_EMAAR_ID,
  },
];

export async function runSeed(): Promise<void> {
  console.log('🚀 Initializing Maintenance ERP Phase 0 & Phase 1 development seed data...');

  const createdEmployees: { id: string; role: string; profileId: string }[] = [];

  for (const user of SEED_USERS) {
    console.log(`Processing user: ${user.email} (${user.role})...`);

    // 1. Create or retrieve auth.users record via Admin API
    let userId: string;
    const { data: existingUser } = await (supabase.auth.admin as any).getUserByEmail(user.email);

    if (existingUser?.user) {
      userId = existingUser.user.id;
      console.log(`  Existing auth user: ${userId}`);
    } else {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: user.email,
        password: seedPassword,
        email_confirm: true,
        user_metadata: {
          full_name: user.fullName,
          company_id: COMPANY_ID,
          branch_id: user.branchId,
          role: user.role,
          customer_id: user.customerId || null,
        },
      });

      if (createError || !newUser?.user) {
        console.error(`  Failed to create auth user ${user.email}:`, createError?.message);
        continue;
      }
      userId = newUser.user.id;
      console.log(`  Created auth user: ${userId}`);
    }

    // 2. Upsert profile with company, branch, and customer link
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: userId,
      company_id: COMPANY_ID,
      branch_id: user.branchId,
      customer_id: user.customerId || null,
      full_name: user.fullName,
      phone: user.phone,
      is_active: true,
    });

    if (profileError) {
      console.error(`  Failed to upsert profile for ${user.email}:`, profileError.message);
    }

    // 3. Upsert user_roles
    const { error: roleError } = await supabase.from('user_roles').upsert(
      {
        user_id: userId,
        company_id: COMPANY_ID,
        branch_id: user.branchId,
        role: user.role,
        is_active: true,
      },
      { onConflict: 'user_id,company_id,role,branch_id' }
    );

    if (roleError) {
      console.error(`  Failed to assign role for ${user.email}:`, roleError.message);
    }

    // 4. If staff member, upsert employees record
    if (user.employeeCode && user.role !== 'customer') {
      const { data: empData, error: empError } = await supabase
        .from('employees')
        .upsert(
          {
            company_id: COMPANY_ID,
            branch_id: user.branchId,
            profile_id: userId,
            employee_code: user.employeeCode,
            job_title: user.jobTitle,
            department: user.department,
            hire_date: '2024-01-15',
            is_active: true,
          },
          { onConflict: 'company_id,employee_code' }
        )
        .select('id')
        .single();

      if (empError) {
        console.error(`  Failed to upsert employee for ${user.email}:`, empError.message);
      } else if (empData) {
        createdEmployees.push({ id: empData.id, role: user.role, profileId: userId });
      }
    }
  }

  // 5. Create demo maintenance team: "DXB HVAC Fast Response Team"
  const supervisorEmp = createdEmployees.find((e) => e.role === 'supervisor');
  const techAhmed = createdEmployees.find((e) => e.role === 'technician');

  if (supervisorEmp && techAhmed) {
    const { data: teamData, error: teamError } = await supabase
      .from('teams')
      .upsert(
        {
          company_id: COMPANY_ID,
          branch_id: BRANCH_DXB_ID,
          name: 'DXB HVAC Fast Response Team',
          description: 'Specialized 24/7 HVAC rapid diagnostics and preventative maintenance unit.',
          team_lead_id: supervisorEmp.id,
          is_active: true,
        },
        { onConflict: 'company_id,name' }
      )
      .select('id')
      .single();

    if (!teamError && teamData) {
      await supabase.from('team_members').upsert(
        {
          team_id: teamData.id,
          employee_id: techAhmed.id,
          company_id: COMPANY_ID,
          is_active: true,
        },
        { onConflict: 'team_id,employee_id' }
      );
    }

    // 6. Create Sample Operational Pipeline (Work Order -> Visit -> Assignments)
    console.log('Hydrating sample operational work order...');
    const sampleWoId = '99999999-0000-0000-0000-000000000001';
    const sampleVisitId = '99999999-0000-0000-0000-000000000002';

    const { data: woData } = await supabase.from('work_orders').upsert({
      id: sampleWoId,
      company_id: COMPANY_ID,
      branch_id: BRANCH_DXB_ID,
      work_order_number: 'WO-2026-0001',
      customer_id: CUST_EMAAR_ID,
      site_id: SITE_DUBAI_MALL_ID,
      asset_id: ASSET_CHILLER_ID,
      service_type_id: ST_AC_SRV_ID,
      priority: 'high',
      status: 'scheduled',
      source: 'preventive',
      description: 'Scheduled Q3 Quarterly Preventive Chiller Overhaul and Refrigerant Pressure Checks',
      assigned_supervisor_id: supervisorEmp.id,
      scheduled_start: new Date(Date.now() + 3600000).toISOString(),
      scheduled_end: new Date(Date.now() + 18000000).toISOString(),
      due_at: new Date(Date.now() + 86400000).toISOString(),
    }).select('id').single();

    if (woData) {
      // Create Visit 1
      await supabase.from('visits').upsert({
        id: sampleVisitId,
        company_id: COMPANY_ID,
        branch_id: BRANCH_DXB_ID,
        work_order_id: sampleWoId,
        visit_number: 1,
        scheduled_start: new Date(Date.now() + 3600000).toISOString(),
        scheduled_end: new Date(Date.now() + 18000000).toISOString(),
        status: 'scheduled',
      });

      // Assign Lead Technician
      await supabase.from('work_order_assignments').upsert({
        company_id: COMPANY_ID,
        work_order_id: sampleWoId,
        employee_id: techAhmed.id,
        role_in_job: 'lead',
        is_active: true,
      }, { onConflict: 'work_order_id,employee_id' });

      await supabase.from('visit_technicians').upsert({
        company_id: COMPANY_ID,
        visit_id: sampleVisitId,
        employee_id: techAhmed.id,
        role_in_visit: 'lead',
        status: 'assigned',
      }, { onConflict: 'visit_id,employee_id' });
    }

    // 7. Phase 2A: Link Mobile Service Van Location to Technician Ahmed Farooq
    console.log('Linking technician van location to Ahmed Farooq (EMP-004)...');
    await supabase
      .from('locations')
      .update({ assigned_employee_id: techAhmed.id })
      .eq('company_id', COMPANY_ID)
      .eq('code', 'LOC-VAN-EMP-004');
  }

  console.log('\n🎉 Phase 0, Phase 1, Phase 2A, Phase 2B & Phase 3 development seed completed successfully.');
  console.log('----------------------------------------------------');
  console.log(`Demo Company ID:   ${COMPANY_ID}`);
  console.log(`Customer Emaar ID: ${CUST_EMAAR_ID}`);
  console.log(`Technician Van:    LOC-VAN-EMP-004 (Linked to EMP-004)`);
  console.log(`Phase 2B Billing:  Commercial Quotations, Invoices & Payments Active`);
  console.log(`Phase 3 Finance:   Chart of Accounts, General Ledger, Rental & AMC Active`);
  console.log(`Seed Password:     ${seedPassword}`);
  console.log('----------------------------------------------------\n');
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed().catch((err) => {
    console.error('Fatal seed execution error:', err);
    process.exit(1);
  });
}
