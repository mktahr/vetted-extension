-- Complete fix for upsert_profile_from_snapshot function
-- Deploy this to: Supabase Dashboard → SQL Editor → Run this query

CREATE OR REPLACE FUNCTION public.upsert_profile_from_snapshot(
  p_linkedin_url text,
  p_full_name text,
  p_raw_json jsonb,
  p_canonical_json jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  -- 1) Upsert base profile row with ALL fields from canonical_json
  INSERT INTO public.profiles (
    linkedin_url,
    full_name,
    location_resolved,
    current_company,
    current_title,
    years_experience,
    years_at_current_company,
    undergrad_university,
    secondary_university,
    phd_university,
    focus_area_tags,
    skills_tags,
    excellence_tags,
    domain_tags,
    notes
  )
  VALUES (
    p_linkedin_url,
    COALESCE(p_canonical_json->>'full_name', p_full_name),
    p_canonical_json->>'location_resolved',
    p_canonical_json->>'current_company',
    p_canonical_json->>'current_title',
    (p_canonical_json->>'years_experience')::numeric,
    (p_canonical_json->>'years_at_current_company')::numeric,
    p_canonical_json->>'undergrad_university',
    p_canonical_json->>'secondary_university',
    p_canonical_json->>'phd_university',
    COALESCE(
      (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(p_canonical_json->'focus_area_tags') AS elem),
      '{}'::text[]
    ),
    COALESCE(
      (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(p_canonical_json->'skills_tags') AS elem),
      '{}'::text[]
    ),
    COALESCE(
      (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(p_canonical_json->'excellence_tags') AS elem),
      '{}'::text[]
    ),
    COALESCE(
      (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(p_canonical_json->'domain_tags') AS elem),
      '{}'::text[]
    ),
    p_canonical_json->>'notes'
  )
  ON CONFLICT (linkedin_url)
  DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    location_resolved = COALESCE(EXCLUDED.location_resolved, profiles.location_resolved),
    current_company = COALESCE(EXCLUDED.current_company, profiles.current_company),
    current_title = COALESCE(EXCLUDED.current_title, profiles.current_title),
    years_experience = COALESCE(EXCLUDED.years_experience, profiles.years_experience),
    years_at_current_company = COALESCE(EXCLUDED.years_at_current_company, profiles.years_at_current_company),
    undergrad_university = COALESCE(EXCLUDED.undergrad_university, profiles.undergrad_university),
    secondary_university = COALESCE(EXCLUDED.secondary_university, profiles.secondary_university),
    phd_university = COALESCE(EXCLUDED.phd_university, profiles.phd_university),
    focus_area_tags = CASE
      WHEN cardinality(EXCLUDED.focus_area_tags) > 0 THEN EXCLUDED.focus_area_tags
      ELSE profiles.focus_area_tags
    END,
    skills_tags = CASE
      WHEN cardinality(EXCLUDED.skills_tags) > 0 THEN EXCLUDED.skills_tags
      ELSE profiles.skills_tags
    END,
    excellence_tags = CASE
      WHEN cardinality(EXCLUDED.excellence_tags) > 0 THEN EXCLUDED.excellence_tags
      ELSE profiles.excellence_tags
    END,
    domain_tags = CASE
      WHEN cardinality(EXCLUDED.domain_tags) > 0 THEN EXCLUDED.domain_tags
      ELSE profiles.domain_tags
    END,
    notes = COALESCE(EXCLUDED.notes, profiles.notes),
    updated_at = now()
  RETURNING id INTO v_profile_id;

  -- 2) Insert snapshot (preserves both raw_json and canonical_json for future use)
  INSERT INTO public.profile_snapshots (
    profile_id,
    raw_json,
    canonical_json
  )
  VALUES (
    v_profile_id,
    p_raw_json,
    p_canonical_json
  );

  RETURN v_profile_id;
END;
$$;

-- Verify the function was created
SELECT
  proname AS function_name,
  pg_get_function_arguments(oid) AS arguments,
  pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname = 'upsert_profile_from_snapshot';
