// ─── Types matching the ingest API contract ───────────────────────────────

export interface RawExperience {
  company_name?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  duration_months?: number;
  description?: string;
  employment_type?: string;
}

export interface RawEducation {
  school_name?: string;
  degree?: string;
  field_of_study?: string;
  start_year?: number;
  end_year?: number;
  description?: string;     // free-text notes under the entry
  activities?: string;      // LinkedIn "Activities and Societies"
  grade?: string;           // GPA, Latin honors, class rank, etc.
}

export interface CanonicalProfile {
  full_name?: string;
  location_resolved?: string | null;
  headline_raw?: string | null;
  summary_raw?: string | null;
  current_company?: string | null;
  current_title?: string | null;
  employment_type?: string | null;
  years_experience?: number | null;
  years_at_current_company?: number | null;
  skills_tags?: string[] | null;
  experiences?: RawExperience[];
  education?: RawEducation[];
}

export interface IngestPayload {
  linkedin_url: string;
  full_name: string;
  canonical_json: CanonicalProfile;
  raw_json: Record<string, unknown>;
  source: string;
  source_version?: string;
}

export interface ScrapedData {
  url: string;
  fullName: string;
  location: string;
  headline: string;
  summary: string;
  currentTitle: string;
  currentCompany: string;
  employmentType: string;
  skills_tags?: string[];
  experiences: RawExperience[];
  education: RawEducation[];
  rawVoyager?: Record<string, unknown>;
}
