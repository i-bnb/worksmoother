-- =============================================================================
-- Development Seed Data: Demo Company, Operational Data & Field Workflow
-- Maintenance Management ERP — Phase 0 & Phase 1 Core Operations
-- =============================================================================
-- WARNING: FOR LOCAL AND STAGING DEVELOPMENT ONLY. NEVER RUN IN PRODUCTION.
-- User credentials are provisioned securely via seed.ts using Supabase Admin API.

DO $$
DECLARE
  v_company_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  v_branch_dxb_id uuid := '22222222-2222-2222-2222-222222222221'::uuid;
  v_branch_auh_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;

  -- Phase 1 IDs
  v_cust_emaar_id uuid := '33333333-3333-3333-3333-333333333331'::uuid;
  v_cust_damac_id uuid := '33333333-3333-3333-3333-333333333332'::uuid;

  v_site_dubai_mall_id uuid := '44444444-4444-4444-4444-444444444441'::uuid;
  v_site_downtown_id   uuid := '44444444-4444-4444-4444-444444444442'::uuid;
  v_site_business_bay_id uuid := '44444444-4444-4444-4444-444444444443'::uuid;

  v_asset_chiller_id   uuid := '55555555-5555-5555-5555-555555555551'::uuid;
  v_asset_ahu_id       uuid := '55555555-5555-5555-5555-555555555552'::uuid;
  v_asset_split_ac_id  uuid := '55555555-5555-5555-5555-555555555553'::uuid;
  v_asset_compressor_id uuid := '55555555-5555-5555-5555-555555555554'::uuid;

  v_st_ac_srv_id uuid := '66666666-6666-6666-6666-666666666661'::uuid;
  v_st_ac_rep_id uuid := '66666666-6666-6666-6666-666666666662'::uuid;
  v_st_elec_id   uuid := '66666666-6666-6666-6666-666666666663'::uuid;
  v_st_plumb_id  uuid := '66666666-6666-6666-6666-666666666664'::uuid;

  v_sla_urgent_id   uuid := '77777777-7777-7777-7777-777777777771'::uuid;
  v_sla_standard_id uuid := '77777777-7777-7777-7777-777777777772'::uuid;

  v_chk_tpl_id uuid := '88888888-8888-8888-8888-888888888881'::uuid;
  v_chk_item1_id uuid := '88888888-8888-8888-8888-888888888891'::uuid;
  v_chk_item2_id uuid := '88888888-8888-8888-8888-888888888892'::uuid;
  v_chk_item3_id uuid := '88888888-8888-8888-8888-888888888893'::uuid;

  -- Phase 2A Inventory & Purchasing IDs
  v_uom_pcs_id uuid := 'a1111111-1111-1111-1111-111111111111'::uuid;
  v_uom_mtr_id uuid := 'a1111111-1111-1111-1111-111111111112'::uuid;
  v_uom_kg_id  uuid := 'a1111111-1111-1111-1111-111111111113'::uuid;
  v_uom_box_id uuid := 'a1111111-1111-1111-1111-111111111114'::uuid;

  v_cat_hvac_id   uuid := 'b1111111-1111-1111-1111-111111111111'::uuid;
  v_cat_refrig_id uuid := 'b1111111-1111-1111-1111-111111111112'::uuid;
  v_cat_elec_id   uuid := 'b1111111-1111-1111-1111-111111111113'::uuid;
  v_cat_consum_id uuid := 'b1111111-1111-1111-1111-111111111114'::uuid;

  v_item_comp_id uuid := 'c1111111-1111-1111-1111-111111111111'::uuid;
  v_item_gas_id  uuid := 'c1111111-1111-1111-1111-111111111112'::uuid;
  v_item_cap_id  uuid := 'c1111111-1111-1111-1111-111111111113'::uuid;
  v_item_pipe_id uuid := 'c1111111-1111-1111-1111-111111111114'::uuid;

  v_loc_wh_dxb_id     uuid := 'd1111111-1111-1111-1111-111111111111'::uuid;
  v_loc_van_ahmed_id  uuid := 'd1111111-1111-1111-1111-111111111112'::uuid;
  v_loc_quar_dxb_id   uuid := 'd1111111-1111-1111-1111-111111111113'::uuid;
  v_loc_scrap_dxb_id  uuid := 'd1111111-1111-1111-1111-111111111114'::uuid;

  v_supp_alfuttaim_id uuid := 'e1111111-1111-1111-1111-111111111111'::uuid;
  v_emp_ahmed_id      uuid;

  -- Phase 2B Sales, Invoicing & Payments IDs
  v_tax_vat5_id   uuid := 'f1111111-1111-1111-1111-111111111111'::uuid;
  v_tax_zero_id   uuid := 'f1111111-1111-1111-1111-111111111112'::uuid;
  v_tax_exempt_id uuid := 'f1111111-1111-1111-1111-111111111113'::uuid;

  v_pm_bank_id   uuid := 'f2222222-2222-2222-2222-222222222221'::uuid;
  v_pm_cash_id   uuid := 'f2222222-2222-2222-2222-222222222222'::uuid;
  v_pm_card_id   uuid := 'f2222222-2222-2222-2222-222222222223'::uuid;
  v_pm_cheque_id uuid := 'f2222222-2222-2222-2222-222222222224'::uuid;

  v_quote_emaar_id uuid := 'f3333333-3333-3333-3333-333333333331'::uuid;
  v_inv_emaar_id   uuid := 'f4444444-4444-4444-4444-444444444441'::uuid;
  v_pmt_emaar_id   uuid := 'f5555555-5555-5555-5555-555555555551'::uuid;

  -- Phase 3 Double-Entry Finance, Rental & AMC IDs
  v_ag_cur_asset_id uuid := '91111111-1111-1111-1111-111111111111'::uuid;
  v_ag_fix_asset_id uuid := '91111111-1111-1111-1111-111111111112'::uuid;
  v_ag_cur_liab_id  uuid := '91111111-1111-1111-1111-111111111113'::uuid;
  v_ag_equity_id    uuid := '91111111-1111-1111-1111-111111111114'::uuid;
  v_ag_revenue_id   uuid := '91111111-1111-1111-1111-111111111115'::uuid;
  v_ag_cogs_id      uuid := '91111111-1111-1111-1111-111111111116'::uuid;
  v_ag_expense_id   uuid := '91111111-1111-1111-1111-111111111117'::uuid;

  v_acc_cash_id     uuid := '92222222-2222-2222-2222-222222222221'::uuid;
  v_acc_bank_id     uuid := '92222222-2222-2222-2222-222222222222'::uuid;
  v_acc_ar_id       uuid := '92222222-2222-2222-2222-222222222223'::uuid;
  v_acc_inv_id      uuid := '92222222-2222-2222-2222-222222222224'::uuid;
  v_acc_tax_in_id   uuid := '92222222-2222-2222-2222-222222222225'::uuid;
  v_acc_ap_id       uuid := '92222222-2222-2222-2222-222222222226'::uuid;
  v_acc_tax_out_id  uuid := '92222222-2222-2222-2222-222222222227'::uuid;
  v_acc_deposit_id  uuid := '92222222-2222-2222-2222-222222222228'::uuid;
  v_acc_capital_id  uuid := '92222222-2222-2222-2222-222222222229'::uuid;
  v_acc_retained_id uuid := '92222222-2222-2222-2222-222222222230'::uuid;
  v_acc_rev_srv_id  uuid := '92222222-2222-2222-2222-222222222231'::uuid;
  v_acc_rev_sale_id uuid := '92222222-2222-2222-2222-222222222232'::uuid;
  v_acc_rev_rnt_id  uuid := '92222222-2222-2222-2222-222222222233'::uuid;
  v_acc_rev_amc_id  uuid := '92222222-2222-2222-2222-222222222234'::uuid;
  v_acc_cogs_id     uuid := '92222222-2222-2222-2222-222222222235'::uuid;
  v_acc_exp_labor_id uuid := '92222222-2222-2222-2222-222222222236'::uuid;
  v_acc_exp_fuel_id uuid := '92222222-2222-2222-2222-222222222237'::uuid;
  v_acc_exp_rent_id uuid := '92222222-2222-2222-2222-222222222238'::uuid;

  v_bank_acct_id    uuid := '93333333-3333-3333-3333-333333333331'::uuid;
  v_cc_hvac_id      uuid := '94444444-4444-4444-4444-444444444441'::uuid;
  v_cc_elec_id      uuid := '94444444-4444-4444-4444-444444444442'::uuid;

  v_rnt_gen_id      uuid := '95555555-5555-5555-5555-555555555551'::uuid;
  v_rnt_dehum_id    uuid := '95555555-5555-5555-5555-555555555552'::uuid;
  v_rnt_scaf_id     uuid := '95555555-5555-5555-5555-555555555553'::uuid;
  v_rnt_contract_id uuid := '96666666-6666-6666-6666-666666666661'::uuid;

  v_amc_contract_id uuid := '97777777-7777-7777-7777-777777777771'::uuid;
BEGIN
  -- 1. Demo Company: Apex Facility & Maintenance Services LLC
  INSERT INTO public.companies (
    id, name, slug, legal_name, registration_no, tax_id,
    country, timezone, default_currency, address, city, is_active
  ) VALUES (
    v_company_id,
    'Apex Facility Services',
    'apex-facility-services',
    'Apex Facility & Maintenance Services LLC',
    'REG-DXB-98765',
    'TRN-100293847500003',
    'AE',
    'Asia/Dubai',
    'AED',
    'Al Quoz Industrial Area 3, Street 18',
    'Dubai',
    true
  ) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now();

  -- 2. Branches: Dubai HQ and Abu Dhabi Operations
  INSERT INTO public.branches (
    id, company_id, name, code, address, city, country, phone, is_main, is_active
  ) VALUES (
    v_branch_dxb_id, v_company_id, 'Dubai Central Operations', 'DXB',
    'Warehouse 4, Al Quoz 3', 'Dubai', 'AE', '+97143001122', true, true
  ) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now();

  INSERT INTO public.branches (
    id, company_id, name, code, address, city, country, phone, is_main, is_active
  ) VALUES (
    v_branch_auh_id, v_company_id, 'Abu Dhabi Capital Branch', 'AUH',
    'Mussafah Industrial Area M-12', 'Abu Dhabi', 'AE', '+97125003344', false, true
  ) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now();

  -- 3. Initial Company Settings
  INSERT INTO public.settings (
    company_id, currency, timezone, language, country, tax_rate, tax_name,
    tax_inclusive, enabled_modules, ai_model_ids, notification_config, numbering_config
  ) VALUES (
    v_company_id, 'AED', 'Asia/Dubai', 'en', 'AE', 5.00, 'VAT', false,
    '["work_orders", "assets", "preventive_maintenance", "inventory", "invoicing", "customer_portal", "technician_pwa"]'::jsonb,
    '{"default_chat": "gemini-1.5-flash", "vision_diagnostics": "gemini-1.5-pro", "report_summary": "gemini-1.5-flash", "ocr_parts_catalog": "gemini-1.5-pro", "embedding": "text-embedding-004"}'::jsonb,
    '{"in_app_enabled": true, "push_enabled": true, "email_enabled": true, "whatsapp_enabled": false, "sms_enabled": false}'::jsonb,
    '{"yearly_reset": true, "include_branch_code": false, "delimiter": "-"}'::jsonb
  ) ON CONFLICT (company_id) DO NOTHING;

  -- 4. Initial Number Series for Core ERP Documents
  INSERT INTO public.number_series (
    company_id, branch_id, doc_type, prefix, current_year, current_sequence, pad_length, yearly_reset, include_branch, is_active
  ) VALUES
    (v_company_id, NULL, 'WO'::public.document_type, 'WO', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'INV'::public.document_type, 'INV', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'QUO'::public.document_type, 'QUO', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'PO'::public.document_type, 'PO', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'SR'::public.document_type, 'SR', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'AMC'::public.document_type, 'AMC', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'GRN'::public.document_type, 'GRN', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'TRN'::public.document_type, 'TRN', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'SO'::public.document_type,  'SO',  2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'CN'::public.document_type,  'CN',  2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'PAY'::public.document_type, 'PAY', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'JRN'::public.document_type, 'JRN', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'BILL'::public.document_type,'BILL',2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'SPAY'::public.document_type,'SPAY',2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'EXP'::public.document_type, 'EXP', 2026, 0, 4, true, false, true),
    (v_company_id, NULL, 'RNT'::public.document_type, 'RNT', 2026, 0, 4, true, false, true)
  ON CONFLICT DO NOTHING;

  -- 5. Master Service Types
  INSERT INTO public.service_types (id, company_id, name, code, multilingual_name, description, is_active)
  VALUES
    (v_st_ac_srv_id, v_company_id, 'AC Routine Service', 'AC-SRV', '{"en": "AC Routine Service", "ar": "خدمة تكييف دورية", "ml": "എസി സർവീസ്"}'::jsonb, 'Comprehensive filter, coil, and pressure checks', true),
    (v_st_ac_rep_id, v_company_id, 'AC Breakdown Repair', 'AC-REP', '{"en": "AC Breakdown Repair", "ar": "إصلاح عطل التكييف", "ml": "എസി റിപ്പയർ"}'::jsonb, 'Diagnosis and component replacements for non-cooling units', true),
    (v_st_elec_id, v_company_id, 'Electrical Maintenance', 'ELEC', '{"en": "Electrical Maintenance", "ar": "صيانة كهربائية", "ml": "ഇലക്ട്രിക്കൽ മെയിന്റനൻസ്"}'::jsonb, 'Distribution boards, breakers, and wiring inspections', true),
    (v_st_plumb_id, v_company_id, 'Plumbing & Drainage', 'PLUMB', '{"en": "Plumbing & Drainage", "ar": "سباكة وصرف صحي", "ml": "പ്ലംബിംഗ്"}'::jsonb, 'Pumps, water lines, leak isolation', true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 6. Master SLA Policies
  INSERT INTO public.sla_policies (id, company_id, service_type_id, priority, name, response_time_hours, resolution_time_hours, is_active)
  VALUES
    (v_sla_urgent_id, v_company_id, v_st_ac_rep_id, 'critical', 'Critical 2h/4h SLA', 2.00, 4.00, true),
    (v_sla_standard_id, v_company_id, v_st_ac_srv_id, 'medium', 'Standard 8h/24h SLA', 8.00, 24.00, true)
  ON CONFLICT DO NOTHING;

  -- 7. Checklist Template for AC Routine Service
  INSERT INTO public.checklist_templates (id, company_id, service_type_id, name, description, is_active)
  VALUES (v_chk_tpl_id, v_company_id, v_st_ac_srv_id, 'AC Preventive Maintenance Checklist', 'Mandatory 10-point inspection', true)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.checklist_items (id, template_id, company_id, sequence, title, response_type, is_required)
  VALUES
    (v_chk_item1_id, v_chk_tpl_id, v_company_id, 1, 'Air filters thoroughly washed and disinfected', 'pass_fail', true),
    (v_chk_item2_id, v_chk_tpl_id, v_company_id, 2, 'Evaporator and condenser coils cleaned', 'pass_fail', true),
    (v_chk_item3_id, v_chk_tpl_id, v_company_id, 3, 'Suction gas pressure within operating range (PSI)', 'numeric', true)
  ON CONFLICT DO NOTHING;

  -- 8. Demo Customers
  INSERT INTO public.customers (id, company_id, branch_id, name, code, customer_type, tax_id, email, phone, currency, is_active)
  VALUES
    (v_cust_emaar_id, v_company_id, v_branch_dxb_id, 'Emaar Properties PJSC', 'CUST-EMAAR', 'commercial', 'TRN-100456789000003', 'facilities@emaar.ae', '+97143673333', 'AED', true),
    (v_cust_damac_id, v_company_id, v_branch_dxb_id, 'Damac Facilities Management', 'CUST-DAMAC', 'commercial', 'TRN-100987654300003', 'support@damacgroup.com', '+97143731000', 'AED', true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 9. Customer Sites
  INSERT INTO public.customer_sites (id, company_id, customer_id, branch_id, name, code, address, city, latitude, longitude, contact_name, contact_phone, is_active)
  VALUES
    (v_site_dubai_mall_id, v_company_id, v_cust_emaar_id, v_branch_dxb_id, 'Dubai Mall Plant Room Block A', 'SITE-DM-A', 'Financial Centre Road, Downtown Dubai', 'Dubai', 25.1972, 55.2797, 'Rashid Al-Kindi', '+971501234567', true),
    (v_site_downtown_id, v_company_id, v_cust_emaar_id, v_branch_dxb_id, 'Downtown Tower 1 Mechanical Floor', 'SITE-DT-1', 'Sheikh Mohammed bin Rashid Blvd', 'Dubai', 25.1931, 55.2763, 'Farah Mansoor', '+971502345678', true),
    (v_site_business_bay_id, v_company_id, v_cust_damac_id, v_branch_auh_id, 'Damac Executive Heights AUH', 'SITE-DH-AUH', 'Corniche Sector W5', 'Abu Dhabi', 24.4820, 54.3510, 'Johnathan Vance', '+971503456789', true)
  ON CONFLICT (company_id, customer_id, name) DO NOTHING;

  -- 10. Customer Assets (with Parent-Child Equipment Hierarchy)
  INSERT INTO public.customer_assets (id, company_id, customer_id, site_id, parent_asset_id, name, asset_code, asset_type, category, brand, model, serial_number, capacity, capacity_unit, refrigerant_type, status)
  VALUES
    -- Parent Chiller
    (v_asset_chiller_id, v_company_id, v_cust_emaar_id, v_site_dubai_mall_id, NULL, 'Central Chiller Unit 1', 'AST-CHL-001', 'HVAC', 'Water-Cooled Chiller', 'Carrier', 'AquaEdge 19XR', 'SN-CAR-99120', 500.00, 'TR', 'R134a', 'active'),
    -- Sub-assembly Rooftop AHU
    (v_asset_ahu_id, v_company_id, v_cust_emaar_id, v_site_dubai_mall_id, v_asset_chiller_id, 'Rooftop Air Handling Unit AHU-2', 'AST-AHU-002', 'HVAC', 'Air Handling Unit', 'Trane', 'Climate Changer', 'SN-TRN-44810', 12000.00, 'CFM', NULL, 'active'),
    -- Split AC System
    (v_asset_split_ac_id, v_company_id, v_cust_emaar_id, v_site_downtown_id, NULL, 'Server Room Split AC Primary', 'AST-SPLIT-003', 'HVAC', 'Ductless Split', 'Daikin', 'FTKM50', 'SN-DKN-77312', 2.50, 'TR', 'R32', 'active'),
    -- Child Compressor component of Split AC
    (v_asset_compressor_id, v_company_id, v_cust_emaar_id, v_site_downtown_id, v_asset_split_ac_id, 'Inverter Scroll Compressor Unit', 'AST-COMP-004', 'HVAC Component', 'Compressor', 'Daikin', '1YC23A', 'SN-COMP-88219', 2.50, 'TR', 'R32', 'active')
  ON CONFLICT (company_id, asset_code) DO NOTHING;

  -- =========================================================================
  -- PHASE 2A: INVENTORY, PURCHASING & TECHNICIAN VAN STOCK
  -- =========================================================================

  -- 11. Master Units of Measurement (UOM)
  INSERT INTO public.uoms (id, company_id, code, name, allow_decimals)
  VALUES
    (v_uom_pcs_id, v_company_id, 'PCS', 'Pieces', false),
    (v_uom_mtr_id, v_company_id, 'MTR', 'Meters', true),
    (v_uom_kg_id,  v_company_id, 'KG',  'Kilograms', true),
    (v_uom_box_id, v_company_id, 'BOX', 'Boxes', false)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 12. Master Item Categories (Hierarchical)
  INSERT INTO public.item_categories (id, company_id, parent_category_id, code, name, description, is_active)
  VALUES
    (v_cat_hvac_id,   v_company_id, NULL,            'HVAC-PARTS',  'HVAC Spare Parts', 'Compressors, motors, fan assemblies', true),
    (v_cat_refrig_id, v_company_id, v_cat_hvac_id,   'HVAC-REFRIG', 'Refrigerants & Gases', 'Fluorinated and hydrocarbon gases', true),
    (v_cat_elec_id,   v_company_id, NULL,            'ELEC-PARTS',  'Electrical Spares', 'Capacitors, contactors, relays, breakers', true),
    (v_cat_consum_id, v_company_id, NULL,            'CONSUMABLES', 'General Consumables', 'Copper pipes, insulation, brazing rods', true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 13. Master Catalogue Items
  INSERT INTO public.items (
    id, company_id, sku, name, multilingual_name, description,
    category_id, uom_id, item_type, track_serial, track_batch,
    standard_cost, sale_price, reorder_level, reorder_quantity, is_active
  ) VALUES
    (
      v_item_comp_id, v_company_id, 'SKU-COMP-25TR',
      'Scroll Compressor 2.5 TR R410A',
      '{"en": "Scroll Compressor 2.5 TR R410A", "ar": "ضاغط لولبي 2.5 طن تبريد"}'::jsonb,
      'Heavy-duty hermetic scroll compressor suitable for commercial package and split AC units.',
      v_cat_hvac_id, v_uom_pcs_id, 'spare'::public.item_type,
      true, false, -- track_serial = true, track_batch = false
      1850.00, 2400.00, 5.00, 10.00, true
    ),
    (
      v_item_gas_id, v_company_id, 'SKU-GAS-R410A',
      'Refrigerant Gas R410A (11.3 KG Cylinder)',
      '{"en": "Refrigerant Gas R410A (11.3 KG Cylinder)", "ar": "غاز تبريد R410A أسطوانة 11.3 كغ"}'::jsonb,
      'Virgin non-ozone depleting HFC refrigerant gas cylinder with batch certification.',
      v_cat_refrig_id, v_uom_pcs_id, 'material'::public.item_type,
      false, true, -- track_serial = false, track_batch = true
      320.00, 480.00, 10.00, 20.00, true
    ),
    (
      v_item_cap_id, v_company_id, 'SKU-CAP-45UF',
      'Dual Run Capacitor 45+5 uF 440V',
      '{"en": "Dual Run Capacitor 45+5 uF 440V", "ar": "مكثف تشغيل ثنائي 45+5 ميكروفاراد"}'::jsonb,
      'High-grade round motor run capacitor for condenser fans and compressors.',
      v_cat_elec_id, v_uom_pcs_id, 'spare'::public.item_type,
      false, false,
      45.00, 95.00, 15.00, 30.00, true
    ),
    (
      v_item_pipe_id, v_company_id, 'SKU-COP-PIPE-12',
      'Copper Refrigeration Tubing 1/2 inch (Per Meter)',
      '{"en": "Copper Refrigeration Tubing 1/2 inch", "ar": "أنابيب نحاسية للتبريد 1/2 بوصة"}'::jsonb,
      'Seamless deoxidized high-phosphorus copper pipe for HVAC line sets.',
      v_cat_consum_id, v_uom_mtr_id, 'material'::public.item_type,
      false, false,
      18.00, 32.00, 50.00, 100.00, true
    )
  ON CONFLICT (company_id, sku) DO NOTHING;

  -- 14. Master Supplier (Vendor Master)
  INSERT INTO public.suppliers (
    id, company_id, code, name, contact_name, email, phone,
    tax_id, currency, payment_terms_days, address, is_active
  ) VALUES (
    v_supp_alfuttaim_id, v_company_id, 'SUP-ALFUTTAIM',
    'Al-Futtaim Engineering Supplies LLC', 'Kareem Zaki',
    'procurement@alfuttaim-engineering.ae', '+97142131000',
    'TRN-100234567800003', 'AED', 30,
    'Airport Road, Al Garhoud, Dubai, UAE', true
  ) ON CONFLICT (company_id, code) DO NOTHING;

  -- Look up Ahmed Farooq (EMP-004) if provisioned
  SELECT id INTO v_emp_ahmed_id FROM public.employees WHERE employee_code = 'EMP-004' LIMIT 1;

  -- 15. Inventory Locations
  INSERT INTO public.locations (
    id, company_id, branch_id, code, name, location_type,
    assigned_employee_id, address, is_active
  ) VALUES
    (
      v_loc_wh_dxb_id, v_company_id, v_branch_dxb_id, 'LOC-WH-DXB-MAIN',
      'Al Quoz Central Parts Distribution Warehouse', 'warehouse'::public.location_type,
      NULL, 'Street 18, Warehouse Bay 4, Al Quoz 3, Dubai', true
    ),
    (
      v_loc_van_ahmed_id, v_company_id, v_branch_dxb_id, 'LOC-VAN-EMP-004',
      'Mobile Service Van 04 (Ahmed Farooq)', 'technician_van'::public.location_type,
      v_emp_ahmed_id, 'Toyota HiAce - Plate DXB-H-44812', true
    ),
    (
      v_loc_quar_dxb_id, v_company_id, v_branch_dxb_id, 'LOC-QUAR-DXB',
      'Al Quoz Quality Inspection & Quarantine Yard', 'quarantine'::public.location_type,
      NULL, 'Quarantine Holding Zone Q-1, Al Quoz 3, Dubai', true
    ),
    (
      v_loc_scrap_dxb_id, v_company_id, v_branch_dxb_id, 'LOC-SCRAP-DXB',
      'Al Quoz Equipment Disposal & Scrap Yard', 'scrap'::public.location_type,
      NULL, 'Disposal Holding Zone S-2, Al Quoz 3, Dubai', true
    )
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 16. Reorder Rules
  INSERT INTO public.reorder_rules (
    company_id, item_id, location_id, min_level, max_level,
    reorder_quantity, preferred_supplier_id, is_active
  ) VALUES
    (v_company_id, v_item_comp_id, v_loc_wh_dxb_id, 5.00, 20.00, 10.00, v_supp_alfuttaim_id, true),
    (v_company_id, v_item_gas_id,  v_loc_wh_dxb_id, 10.00, 40.00, 20.00, v_supp_alfuttaim_id, true),
    (v_company_id, v_item_cap_id,  v_loc_van_ahmed_id, 2.00, 15.00, 5.00, NULL, true)
  ON CONFLICT (company_id, item_id, location_id) DO NOTHING;

  -- 17. Seed Initial Opening Stock Balances via Central Atomic Engine
  -- Warehouse Stock
  PERFORM public.record_stock_movement(
    v_company_id, v_branch_dxb_id, v_item_comp_id, v_loc_wh_dxb_id,
    'opening_balance'::public.stock_movement_type,
    'in'::public.stock_movement_direction,
    10.0000, 1850.0000,
    'opening_balance', v_loc_wh_dxb_id,
    'SN-COMP-2026-001', NULL, 'Initial opening balance for Central Warehouse', 'INIT-COMP-001'
  );
  PERFORM public.record_stock_movement(
    v_company_id, v_branch_dxb_id, v_item_gas_id, v_loc_wh_dxb_id,
    'opening_balance'::public.stock_movement_type,
    'in'::public.stock_movement_direction,
    25.0000, 320.0000,
    'opening_balance', v_loc_wh_dxb_id,
    NULL, 'BATCH-2026-Q1', 'Initial opening balance for R410A Gas', 'INIT-GAS-001'
  );
  PERFORM public.record_stock_movement(
    v_company_id, v_branch_dxb_id, v_item_cap_id, v_loc_wh_dxb_id,
    'opening_balance'::public.stock_movement_type,
    'in'::public.stock_movement_direction,
    50.0000, 45.0000,
    'opening_balance', v_loc_wh_dxb_id,
    NULL, NULL, 'Initial opening balance for Capacitors', 'INIT-CAP-001'
  );
  PERFORM public.record_stock_movement(
    v_company_id, v_branch_dxb_id, v_item_pipe_id, v_loc_wh_dxb_id,
    'opening_balance'::public.stock_movement_type,
    'in'::public.stock_movement_direction,
    150.0000, 18.0000,
    'opening_balance', v_loc_wh_dxb_id,
    NULL, NULL, 'Initial opening balance for Copper Tubing', 'INIT-PIPE-001'
  );

  -- Technician Van Stock (Ahmed Farooq's Van)
  PERFORM public.record_stock_movement(
    v_company_id, v_branch_dxb_id, v_item_comp_id, v_loc_van_ahmed_id,
    'opening_balance'::public.stock_movement_type,
    'in'::public.stock_movement_direction,
    1.0000, 1850.0000,
    'opening_balance', v_loc_van_ahmed_id,
    'SN-VAN-COMP-001', NULL, 'Initial van stock compressor', 'INIT-VAN-COMP-001'
  );
  PERFORM public.record_stock_movement(
    v_company_id, v_branch_dxb_id, v_item_cap_id, v_loc_van_ahmed_id,
    'opening_balance'::public.stock_movement_type,
    'in'::public.stock_movement_direction,
    5.0000, 45.0000,
    'opening_balance', v_loc_van_ahmed_id,
    NULL, NULL, 'Initial van stock capacitors', 'INIT-VAN-CAP-001'
  );

  -- =========================================================================
  -- PHASE 2B: SALES, INVOICING, CREDIT NOTES & PAYMENTS
  -- =========================================================================

  -- 18. Master Tax Codes
  INSERT INTO public.tax_codes (id, company_id, code, name, rate, is_inclusive, is_active)
  VALUES
    (v_tax_vat5_id,   v_company_id, 'VAT-5',   'Standard VAT 5%', 5.00, false, true),
    (v_tax_zero_id,   v_company_id, 'ZERO-0',  'Zero Rated 0%',   0.00, false, true),
    (v_tax_exempt_id, v_company_id, 'EXEMPT',  'Exempt from VAT', 0.00, false, true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 19. Master Payment Methods
  INSERT INTO public.payment_methods (id, company_id, code, name, requires_reference, is_active)
  VALUES
    (v_pm_bank_id,   v_company_id, 'BANK_TRANSFER', 'Bank Wire Transfer',  true,  true),
    (v_pm_cash_id,   v_company_id, 'CASH',          'Cash Collection',     false, true),
    (v_pm_card_id,   v_company_id, 'CARD',          'Credit / Debit Card', true,  true),
    (v_pm_cheque_id, v_company_id, 'CHEQUE',        'Corporate Cheque',    true,  true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 20. Demo Approved Quotation (Chiller Quarterly Preventive Overhaul)
  INSERT INTO public.quotations (
    id, company_id, branch_id, customer_id, site_id,
    quotation_number, version, is_latest_version, quotation_date, valid_until,
    currency, subtotal, discount_percent, discount_amount, taxable_amount, tax_amount, grand_total,
    status, notes, terms_and_conditions, created_at, updated_at
  ) VALUES (
    v_quote_emaar_id, v_company_id, v_branch_dxb_id, v_cust_emaar_id, v_site_dubai_mall_id,
    'QUO-2026-0001', 1, true, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    'AED', 4850.000, 0.00, 0.000, 4850.000, 242.500, 5092.500,
    'approved', 'Annual preventive maintenance and compressor coil sanitization quotation',
    'Standard commercial terms: payment within 30 days of completion.', now(), now()
  ) ON CONFLICT (company_id, quotation_number, version) DO NOTHING;

  INSERT INTO public.quotation_lines (
    quotation_id, line_number, line_type, item_id, description,
    quantity, uom_id, unit_price, tax_rate, taxable_amount, tax_amount, line_total
  ) VALUES
    (
      v_quote_emaar_id, 1, 'service', NULL, 'Chiller Annual Deep Inspection & Coil Sanitization',
      1.0000, v_uom_pcs_id, 2450.000, 5.00, 2450.000, 122.500, 2572.500
    ),
    (
      v_quote_emaar_id, 2, 'spare', v_item_comp_id, 'Scroll Compressor 2.5 TR R410A Supply & Mount',
      1.0000, v_uom_pcs_id, 2400.000, 5.00, 2400.000, 120.000, 2520.000
    )
  ON CONFLICT DO NOTHING;

  -- 21. Demo Issued Commercial Invoice
  INSERT INTO public.invoices (
    id, company_id, branch_id, customer_id, site_id, quotation_id,
    invoice_number, invoice_date, due_date, currency,
    subtotal, discount_amount, taxable_amount, tax_amount, grand_total,
    amount_paid, amount_credited, status, notes, issued_at, created_at, updated_at
  ) VALUES (
    v_inv_emaar_id, v_company_id, v_branch_dxb_id, v_cust_emaar_id, v_site_dubai_mall_id, v_quote_emaar_id,
    'INV-2026-0001', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'AED',
    4850.000, 0.000, 4850.000, 242.500, 5092.500,
    2500.000, 0.000, 'partially_paid', 'Initial maintenance billing for Dubai Mall Plant Room',
    now(), now(), now()
  ) ON CONFLICT (company_id, invoice_number) DO NOTHING;

  INSERT INTO public.invoice_lines (
    invoice_id, line_number, line_type, item_id, description,
    quantity, uom_id, unit_price, tax_rate, taxable_amount, tax_amount, line_total
  ) VALUES
    (
      v_inv_emaar_id, 1, 'service', NULL, 'Chiller Annual Deep Inspection & Coil Sanitization',
      1.0000, v_uom_pcs_id, 2450.000, 5.00, 2450.000, 122.500, 2572.500
    ),
    (
      v_inv_emaar_id, 2, 'part', v_item_comp_id, 'Scroll Compressor 2.5 TR R410A Supply & Mount',
      1.0000, v_uom_pcs_id, 2400.000, 5.00, 2400.000, 120.000, 2520.000
    )
  ON CONFLICT DO NOTHING;

  -- 22. Demo Customer Payment & Partial Allocation (AED 2,500 allocated against INV-2026-0001)
  INSERT INTO public.payments (
    id, company_id, branch_id, customer_id, payment_number, payment_date,
    currency, amount, payment_method_id, payment_method, reference_number,
    allocated_amount, status, notes, created_at, updated_at
  ) VALUES (
    v_pmt_emaar_id, v_company_id, v_branch_dxb_id, v_cust_emaar_id, 'PAY-2026-0001', CURRENT_DATE,
    'AED', 2500.000, v_pm_bank_id, 'bank_transfer', 'FT-DXB-998231',
    2500.000, 'received', 'Advance bank transfer 50% deposit for Chiller Overhaul', now(), now()
  ) ON CONFLICT (company_id, payment_number) DO NOTHING;

  INSERT INTO public.payment_allocations (
    company_id, payment_id, invoice_id, allocated_amount, allocation_date, created_at
  ) VALUES (
    v_company_id, v_pmt_emaar_id, v_inv_emaar_id, 2500.000, now(), now()
  ) ON CONFLICT (payment_id, invoice_id) DO NOTHING;

  -- 23. Phase 3: Master Account Groups
  INSERT INTO public.account_groups (id, company_id, code, name, account_type, sequence_order)
  VALUES
    (v_ag_cur_asset_id, v_company_id, 'CURRENT_ASSETS',      'Current Assets',              'asset',     10),
    (v_ag_fix_asset_id, v_company_id, 'FIXED_ASSETS',        'Fixed Assets',                'asset',     20),
    (v_ag_cur_liab_id,  v_company_id, 'CURRENT_LIABILITIES', 'Current Liabilities',         'liability', 30),
    (v_ag_equity_id,    v_company_id, 'EQUITY_CAPITAL',      'Capital & Retained Earnings', 'equity',    40),
    (v_ag_revenue_id,   v_company_id, 'OPERATING_REVENUE',   'Operating Revenue',           'revenue',   50),
    (v_ag_cogs_id,      v_company_id, 'COGS_DIRECT',         'Direct Cost of Goods Sold',   'expense',   60),
    (v_ag_expense_id,   v_company_id, 'OPERATING_EXPENSES',  'Operating Expenses',          'expense',   70)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 24. Phase 3: Master Chart of Accounts (COA)
  INSERT INTO public.chart_of_accounts (
    id, company_id, branch_id, account_code, account_name, account_type,
    account_group_id, is_control_account, opening_balance_debit, opening_balance_credit
  ) VALUES
    (v_acc_cash_id,      v_company_id, NULL, '1010', 'Cash on Hand',                          'asset',     v_ag_cur_asset_id, false, 5000.000,   0.000),
    (v_acc_bank_id,      v_company_id, NULL, '1020', 'Emirates NBD Operating Account',        'asset',     v_ag_cur_asset_id, false, 150000.000, 0.000),
    (v_acc_ar_id,        v_company_id, NULL, '1200', 'Accounts Receivable Control',           'asset',     v_ag_cur_asset_id, true,  0.000,      0.000),
    (v_acc_inv_id,       v_company_id, NULL, '1300', 'Spare Parts & Materials Inventory',     'asset',     v_ag_cur_asset_id, true,  0.000,      0.000),
    (v_acc_tax_in_id,    v_company_id, NULL, '1400', 'Input VAT Recoverable (5%)',            'asset',     v_ag_cur_asset_id, false, 0.000,      0.000),
    (v_acc_ap_id,        v_company_id, NULL, '2010', 'Accounts Payable Control',              'liability', v_ag_cur_liab_id,  true,  0.000,      0.000),
    (v_acc_tax_out_id,   v_company_id, NULL, '2020', 'Output VAT Payable (5%)',               'liability', v_ag_cur_liab_id,  false, 0.000,      0.000),
    (v_acc_deposit_id,   v_company_id, NULL, '2050', 'Customer Rental Security Deposits',     'liability', v_ag_cur_liab_id,  false, 0.000,      0.000),
    (v_acc_capital_id,   v_company_id, NULL, '3010', 'Owner Capital Investment',              'equity',    v_ag_equity_id,    false, 0.000,      100000.000),
    (v_acc_retained_id,  v_company_id, NULL, '3020', 'Retained Earnings',                     'equity',    v_ag_equity_id,    false, 0.000,      55000.000),
    (v_acc_rev_srv_id,   v_company_id, NULL, '4010', 'Maintenance & Repair Service Revenue', 'revenue',   v_ag_revenue_id,   false, 0.000,      0.000),
    (v_acc_rev_sale_id,  v_company_id, NULL, '4020', 'Spare Parts & Material Sales Revenue',  'revenue',   v_ag_revenue_id,   false, 0.000,      0.000),
    (v_acc_rev_rnt_id,   v_company_id, NULL, '4030', 'Equipment Rental Revenue',              'revenue',   v_ag_revenue_id,   false, 0.000,      0.000),
    (v_acc_rev_amc_id,   v_company_id, NULL, '4040', 'Annual Maintenance Contract Revenue',   'revenue',   v_ag_revenue_id,   false, 0.000,      0.000),
    (v_acc_cogs_id,      v_company_id, NULL, '5010', 'Cost of Goods Sold - Parts & Materials','expense',   v_ag_cogs_id,      false, 0.000,      0.000),
    (v_acc_exp_labor_id, v_company_id, NULL, '6010', 'Field Technician Direct Labor Cost',    'expense',   v_ag_expense_id,   false, 0.000,      0.000),
    (v_acc_exp_fuel_id,  v_company_id, NULL, '6020', 'Service Fleet Fuel & Transportation',   'expense',   v_ag_expense_id,   false, 0.000,      0.000),
    (v_acc_exp_rent_id,  v_company_id, NULL, '6030', 'Facility & Yard Operating Lease',       'expense',   v_ag_expense_id,   false, 0.000,      0.000)
  ON CONFLICT (company_id, account_code) DO NOTHING;

  -- 25. Phase 3: Link Tax Codes & Payment Methods to GL Accounts
  UPDATE public.tax_codes
  SET
    gl_output_tax_account_id = v_acc_tax_out_id,
    gl_input_tax_account_id  = v_acc_tax_in_id
  WHERE company_id = v_company_id;

  UPDATE public.payment_methods
  SET gl_account_id = v_acc_bank_id
  WHERE company_id = v_company_id AND code IN ('BANK_TRANSFER', 'CARD', 'CHEQUE');

  UPDATE public.payment_methods
  SET gl_account_id = v_acc_cash_id
  WHERE company_id = v_company_id AND code = 'CASH';

  -- 26. Phase 3: Accounting Periods (2026 Fiscal Year)
  INSERT INTO public.accounting_periods (company_id, fiscal_year, period_number, period_name, start_date, end_date, status)
  VALUES
    (v_company_id, 2026, 1,  'January 2026',   '2026-01-01', '2026-01-31', 'open'),
    (v_company_id, 2026, 2,  'February 2026',  '2026-02-01', '2026-02-28', 'open'),
    (v_company_id, 2026, 3,  'March 2026',     '2026-03-01', '2026-03-31', 'open'),
    (v_company_id, 2026, 4,  'April 2026',     '2026-04-01', '2026-04-30', 'open'),
    (v_company_id, 2026, 5,  'May 2026',       '2026-05-01', '2026-05-31', 'open'),
    (v_company_id, 2026, 6,  'June 2026',      '2026-06-01', '2026-06-30', 'open'),
    (v_company_id, 2026, 7,  'July 2026',      '2026-07-01', '2026-07-31', 'open'),
    (v_company_id, 2026, 8,  'August 2026',    '2026-08-01', '2026-08-31', 'open'),
    (v_company_id, 2026, 9,  'September 2026', '2026-09-01', '2026-09-30', 'open'),
    (v_company_id, 2026, 10, 'October 2026',   '2026-10-01', '2026-10-31', 'open'),
    (v_company_id, 2026, 11, 'November 2026',  '2026-11-01', '2026-11-30', 'open'),
    (v_company_id, 2026, 12, 'December 2026',  '2026-12-01', '2026-12-31', 'open')
  ON CONFLICT (company_id, fiscal_year, period_number) DO NOTHING;

  -- 27. Phase 3: Cost Centers & Treasury Bank Accounts
  INSERT INTO public.cost_centers (id, company_id, branch_id, code, name, department, is_active)
  VALUES
    (v_cc_hvac_id, v_company_id, v_branch_dxb_id, 'CC-HVAC', 'HVAC Maintenance Division', 'Operations', true),
    (v_cc_elec_id, v_company_id, v_branch_dxb_id, 'CC-ELEC', 'Electrical Systems Division', 'Operations', true)
  ON CONFLICT (company_id, code) DO NOTHING;

  INSERT INTO public.bank_accounts (
    id, company_id, branch_id, account_name, account_number_last4,
    bank_name, currency, gl_account_id, opening_balance, current_balance, is_active
  ) VALUES (
    v_bank_acct_id, v_company_id, v_branch_dxb_id, 'Emirates NBD Operating Account',
    '4821', 'Emirates NBD PJSC', 'AED', v_acc_bank_id, 150000.000, 150000.000, true
  ) ON CONFLICT (company_id, account_name) DO NOTHING;

  -- 28. Phase 3: Rental Assets & Sample Contract
  INSERT INTO public.rental_assets (
    id, company_id, branch_id, asset_code, name, category,
    rental_status, current_location_id, daily_rate, weekly_rate, monthly_rate,
    deposit_amount, condition, meter_reading, is_active
  ) VALUES
    (v_rnt_gen_id,   v_company_id, v_branch_dxb_id, 'RNT-GEN-01',   'Perkins 50 kVA Mobile Soundproof Generator', 'Generators',     'available', v_loc_wh_dxb_id, 450.000, 2500.000, 8000.000, 3000.000, 'excellent', 124.50, true),
    (v_rnt_dehum_id, v_company_id, v_branch_dxb_id, 'RNT-DEHUM-01', 'Industrial Heavy-Duty Dehumidifier 90L/D',  'Dehumidifiers',  'available', v_loc_wh_dxb_id, 150.000, 850.000,  2800.000, 1000.000, 'good',      350.00, true),
    (v_rnt_scaf_id,  v_company_id, v_branch_dxb_id, 'RNT-SCAF-01',  'Mobile Aluminum Double-Width Tower 6.2m',   'Access Equipment','available', v_loc_wh_dxb_id, 120.000, 650.000,  2200.000, 800.000,  'excellent', 0.00,   true)
  ON CONFLICT (company_id, asset_code) DO NOTHING;

  INSERT INTO public.rental_contracts (
    id, company_id, branch_id, contract_number, customer_id, site_id,
    start_date, expected_return_date, billing_frequency, deposit_amount,
    subtotal, tax_amount, grand_total, status, notes
  ) VALUES (
    v_rnt_contract_id, v_company_id, v_branch_dxb_id, 'RNT-2026-0001', v_cust_damac_id, v_site_downtown_id,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days', 'weekly', 3000.000,
    2500.000, 125.000, 2625.000, 'active', 'Emergency backup generator rental during transformer maintenance'
  ) ON CONFLICT (company_id, contract_number) DO NOTHING;

  -- 29. Phase 3: Annual Maintenance Contract (AMC) & Schedules
  INSERT INTO public.amc_contracts (
    id, company_id, branch_id, contract_number, customer_id, site_id,
    start_date, end_date, contract_value, tax_amount, billing_frequency,
    service_frequency, response_sla_hours, included_visits, included_labour,
    included_materials, status, notes
  ) VALUES (
    v_amc_contract_id, v_company_id, v_branch_dxb_id, 'AMC-2026-0001', v_cust_emaar_id, v_site_dubai_mall_id,
    '2026-01-01', '2026-12-31', 48000.000, 2400.000, 'quarterly',
    'quarterly', 2, 4, true, false, 'active',
    'Comprehensive Annual HVAC Preventive Maintenance for Dubai Mall Central Chiller'
  ) ON CONFLICT (company_id, contract_number) DO NOTHING;

  INSERT INTO public.amc_contract_assets (
    amc_contract_id, customer_asset_id, service_coverage, visit_frequency, included_services
  ) VALUES (
    v_amc_contract_id, v_asset_chiller_id, 'preventive_only', 'quarterly',
    ARRAY['Compressor inspection', 'Refrigerant pressure check', 'Condenser coil chemical wash']
  ) ON CONFLICT (amc_contract_id, customer_asset_id) DO NOTHING;

  INSERT INTO public.amc_schedules (
    amc_contract_id, scheduled_date, period_label, status
  ) VALUES
    (v_amc_contract_id, '2026-01-15', 'Q1-2026 (Jan 2026)', 'completed'),
    (v_amc_contract_id, '2026-04-15', 'Q2-2026 (Apr 2026)', 'scheduled'),
    (v_amc_contract_id, '2026-07-15', 'Q3-2026 (Jul 2026)', 'scheduled'),
    (v_amc_contract_id, '2026-10-15', 'Q4-2026 (Oct 2026)', 'scheduled')
  ON CONFLICT (amc_contract_id, period_label, COALESCE(amc_contract_asset_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

END $$;


