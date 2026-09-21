-- =============================================================================
-- Migration 009: Storage Foundation & RLS Policies
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Configures private Supabase Storage buckets and security policies for:
--   - job-photos   (Technician before/during/after site maintenance photos)
--   - documents    (Vendor manuals, AMC contracts, compliance certificates)
--   - invoices     (Generated customer and vendor tax invoice PDFs)
--   - reports      (Preventive maintenance reports, inspection checklists)
--   - signatures   (Digital customer sign-offs and technician sign-offs)
--
-- Security Model:
--   1. All buckets are strictly private (public = false).
--   2. Files are accessed strictly via short-lived signed URLs.
--   3. Storage object paths enforce company tenant isolation:
--      Folder structure: <company_id>/<entity_type>/<entity_id>/<file_name>
--   4. RLS policies on storage.objects verify tenant membership and role permissions.

-- ---------------------------------------------------------------------------
-- 1. Register Private Storage Buckets
-- ---------------------------------------------------------------------------
-- Supabase stores bucket configurations in the storage.buckets table.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'job-photos',
    'job-photos',
    false,
    20971520, -- 20 MB max file size
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
  ),
  (
    'documents',
    'documents',
    false,
    52428800, -- 50 MB max file size
    ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png']
  ),
  (
    'invoices',
    'invoices',
    false,
    10485760, -- 10 MB max file size
    ARRAY['application/pdf']
  ),
  (
    'reports',
    'reports',
    false,
    26214400, -- 25 MB max file size
    ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  ),
  (
    'signatures',
    'signatures',
    false,
    5242880,  -- 5 MB max file size
    ARRAY['image/png', 'image/svg+xml']
  )
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Storage Access Log Table (Audit trail for sensitive document access)
-- ---------------------------------------------------------------------------
CREATE TABLE public.storage_access_log (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id     text          NOT NULL,
  object_path   text          NOT NULL,
  action        text          NOT NULL, -- 'UPLOAD', 'DOWNLOAD', 'DELETE', 'SIGN_URL'
  user_id       uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id    uuid          REFERENCES public.companies(id) ON DELETE CASCADE,
  ip_address    text,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_storage_log_company ON public.storage_access_log (company_id, created_at DESC);
CREATE INDEX idx_storage_log_object  ON public.storage_access_log (bucket_id, object_path);

ALTER TABLE public.storage_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_access_log FORCE ROW LEVEL SECURITY;

CREATE POLICY storage_access_log_select ON public.storage_access_log
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

-- ---------------------------------------------------------------------------
-- 3. Storage Object RLS Policies
-- ---------------------------------------------------------------------------
-- Note: Supabase Storage uses storage.objects table for all uploaded files.
-- Path format required: <company_id>/...

-- Policy 1: Read Access (SELECT)
-- Users can download/read objects if the first folder path matches their active company_id
CREATE POLICY "Tenant Isolated Storage Read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id IN ('job-photos', 'documents', 'invoices', 'reports', 'signatures')
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
  );

-- Policy 2: Job Photos Upload (INSERT)
-- Technicians, supervisors, and operations staff can upload job photos
CREATE POLICY "Job Photos Upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
    AND public.has_any_role(ARRAY[
      'owner_admin'::public.user_role,
      'operations_manager'::public.user_role,
      'supervisor'::public.user_role,
      'technician'::public.user_role
    ])
  );

-- Policy 3: Signatures Upload (INSERT)
-- Technicians, supervisors, and customers can upload sign-off signatures
CREATE POLICY "Signatures Upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
  );

-- Policy 4: Documents Upload (INSERT)
-- Admin, operations, supervisors, storekeepers
CREATE POLICY "Documents Upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
    AND public.has_any_role(ARRAY[
      'owner_admin'::public.user_role,
      'operations_manager'::public.user_role,
      'supervisor'::public.user_role,
      'storekeeper'::public.user_role
    ])
  );

-- Policy 5: Invoices and Reports Upload (INSERT)
-- Admin, operations, and accountants
CREATE POLICY "Invoices and Reports Upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id IN ('invoices', 'reports')
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
    AND public.has_any_role(ARRAY[
      'owner_admin'::public.user_role,
      'operations_manager'::public.user_role,
      'accountant'::public.user_role
    ])
  );

-- Policy 6: Delete Objects (DELETE)
-- Only owner_admin and operations_manager can delete stored files
CREATE POLICY "Tenant Storage Delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id IN ('job-photos', 'documents', 'invoices', 'reports', 'signatures')
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
    AND public.has_any_role(ARRAY[
      'owner_admin'::public.user_role,
      'operations_manager'::public.user_role
    ])
  );
