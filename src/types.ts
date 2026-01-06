export interface CanonicalProfile {
  linkedin_url: string;
  full_name: string | null;
  location_resolved: string | null;
  current_company: string | null;
  current_title: string | null;
  years_experience: number | null;
  years_at_current_company: number | null;
  undergrad_university: string | null;
  secondary_university: string | null;
  phd_university: string | null;
  skills_tags: string[] | null;
  focus_area_tags: string[] | null;
  excellence_tags: string[] | null;
  domain_tags: string[] | null;
  notes: string | null;
}

export interface RawProfile {
  [key: string]: any;
}

export interface IngestPayload {
  linkedin_url: string;
  raw_json: RawProfile;
  canonical_json: CanonicalProfile;
}

export interface ScrapedData {
  name?: string;
  fullName?: string;
  location?: string;
  currentCompany?: string;
  currentTitle?: string;
  experience?: {
    years?: number;
    yearsAtCurrent?: number;
  };
  education?: {
    undergraduate?: string;
    masters?: string;
    phd?: string;
  };
  skills?: string[];
  [key: string]: any;
}

