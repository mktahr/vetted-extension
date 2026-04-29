// Popup — displays scraped profile data, editable tags, and a Send button

interface RawExperience {
  company_name?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  duration_months?: number;
  description?: string;
  employment_type?: string;
}

interface RawEducation {
  school_name?: string;
  degree?: string;
  field_of_study?: string;
  start_year?: number;
  end_year?: number;
}

interface ScrapedData {
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
}

interface CanonicalProfile {
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

interface LastResult {
  success: boolean;
  message: string;
  person_id?: string;
  current_function?: string | null;
  current_specialty?: string | null;
  current_seniority?: string | null;
  current_title_normalized?: string | null;
  bucket?: string | null;
  total_score?: number | null;
}

// ─── Dictionary options (hardcoded from the backend seed data) ─────────────
// Keep in sync with supabase/migrations/002_vetted_seed_data.sql

const FUNCTIONS: string[] = [
  'engineering', 'product', 'design', 'data_science', 'sales', 'marketing',
  'operations', 'finance', 'legal', 'recruiting', 'people_hr',
  'customer_success', 'research', 'communications', 'founder', 'investing',
  'consulting', 'unknown',
];

const SPECIALTIES: string[] = [
  'backend', 'frontend', 'fullstack', 'mobile_ios', 'mobile_android',
  'infrastructure', 'ml_engineering', 'data_engineering', 'security', 'embedded',
  'ai_research', 'analytics',
  'product_b2b', 'product_consumer', 'product_platform', 'product_growth',
  'ux_design', 'product_design', 'brand_design',
  'enterprise_sales', 'smb_sales', 'sales_engineering', 'partnerships',
  'growth_marketing', 'content_marketing', 'brand_marketing',
];

// Enum from supabase seniority_level (9 active values, rank_order 0–8)
const SENIORITIES: string[] = [
  'unknown', 'intern', 'entry', 'individual_contributor', 'senior_ic',
  'lead_ic', 'founder', 'manager', 'executive',
];

const VETTED_APP_BASE = 'https://vetted-self.vercel.app';

// ─── Helpers ───────────────────────────────────────────────────────────────

function $(id: string): HTMLElement | null { return document.getElementById(id); }
function show(id: string) { $(id)?.classList.remove('hidden'); }
function hide(id: string) { $(id)?.classList.add('hidden'); }

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtDuration(m: number | undefined): string {
  if (!m) return '';
  const y = Math.floor(m / 12);
  const mo = m % 12;
  if (y > 0 && mo > 0) return `${y} yr${y > 1 ? 's' : ''} ${mo} mo${mo > 1 ? 's' : ''}`;
  if (y > 0) return `${y} yr${y > 1 ? 's' : ''}`;
  return `${mo} mo${mo > 1 ? 's' : ''}`;
}

function profileKey(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^\/\?#]+)/);
  return m ? m[1].toLowerCase() : null;
}

const TAG_LABELS: Record<string, string> = {
  senior_ic: 'Senior IC',
  lead_ic: 'Lead IC',
};

function humanizeTag(raw: string): string {
  if (TAG_LABELS[raw]) return TAG_LABELS[raw];
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fillSelect(selectId: string, options: string[], currentValue: string | null | undefined) {
  const sel = $(selectId) as HTMLSelectElement | null;
  if (!sel) return;
  sel.innerHTML = '';

  // Leading "—" option for null/blank
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '—';
  sel.appendChild(blank);

  // If currentValue isn't in the list, add it so we don't silently lose it
  const values = [...options];
  if (currentValue && !values.includes(currentValue)) {
    values.push(currentValue);
  }

  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = humanizeTag(v);
    sel.appendChild(opt);
  }
  sel.value = currentValue || '';
}

// ─── Render ────────────────────────────────────────────────────────────────

// Track dropdown baseline values so we know when to enable "Update Tags".
let tagBaseline = { fn: '', sp: '', sr: '' };
let currentPersonId: string | null = null;

function render(data: ScrapedData, canonical: CanonicalProfile | null, lastResult: LastResult | null) {
  hide('empty');
  show('preview');

  // Status banner
  const banner = $('statusBanner');
  if (lastResult && banner) {
    banner.textContent = lastResult.success ? 'Sent to database' : lastResult.message;
    banner.className = `status-banner ${lastResult.success ? 'success' : 'error'}`;
    banner.classList.remove('hidden');
  } else if (banner) {
    banner.classList.add('hidden');
  }

  // View-in-Vetted link
  const linkEl = $('vettedLink') as HTMLAnchorElement | null;
  if (linkEl) {
    if (lastResult?.success && lastResult.person_id) {
      linkEl.href = `${VETTED_APP_BASE}/profile/${encodeURIComponent(lastResult.person_id)}`;
      linkEl.classList.remove('hidden');
      currentPersonId = lastResult.person_id;
    } else {
      linkEl.classList.add('hidden');
      currentPersonId = null;
    }
  }

  // Profile header
  const nameEl = $('prevName');
  if (nameEl) nameEl.textContent = data.fullName || '—';

  const headlineEl = $('prevHeadline');
  if (headlineEl) {
    headlineEl.textContent = data.headline || '';
    headlineEl.style.display = data.headline ? '' : 'none';
  }

  const locEl = $('prevLocation');
  if (locEl) locEl.textContent = data.location || '';

  const urlEl = $('prevUrl') as HTMLAnchorElement | null;
  if (urlEl) {
    urlEl.href = data.url;
    urlEl.textContent = data.url.replace('https://www.linkedin.com', '');
  }

  // ── Preview stats ────────────────────────────────────────────────────
  // Pull years-of-experience from canonical (computed by background with
  // interval merge — authoritative). Falls back to 0 if missing.
  const yearsExp = canonical?.years_experience ?? 0;
  const yearsEl = $('statYears');
  if (yearsEl) {
    yearsEl.textContent = yearsExp > 0 ? String(yearsExp) : '—';
    yearsEl.classList.toggle('warn', yearsExp === 0);
  }

  const expCountEl = $('statExpCount');
  if (expCountEl) {
    expCountEl.textContent = String(data.experiences.length);
    expCountEl.classList.toggle('warn', data.experiences.length === 0);
    expCountEl.parentElement?.classList.toggle('warn', data.experiences.length === 0);
  }

  const eduCountEl = $('statEduCount');
  if (eduCountEl) {
    eduCountEl.textContent = String(data.education.length);
    eduCountEl.classList.toggle('warn', data.education.length === 0);
    eduCountEl.parentElement?.classList.toggle('warn', data.education.length === 0);
  }

  // Warnings
  const warnings: string[] = [];
  if (data.experiences.length === 0) warnings.push('No experience captured — profile may be incomplete');
  if (data.education.length === 0) warnings.push('No education captured');
  if (!data.location) warnings.push('No location captured');
  const warnEl = $('warnings');
  if (warnEl) {
    if (warnings.length > 0) {
      warnEl.textContent = warnings.join(' · ');
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
    }
  }

  // Current role
  const roleEl = $('prevCurrentRole');
  if (roleEl) {
    const parts: string[] = [];
    if (data.currentTitle) parts.push(data.currentTitle);
    if (data.currentCompany) parts.push(`at ${data.currentCompany}`);
    roleEl.textContent = parts.join(' ') || data.headline || '—';
  }

  // ── Editable tags ────────────────────────────────────────────────────
  const fnVal = lastResult?.current_function || '';
  const spVal = lastResult?.current_specialty || '';
  const srVal = lastResult?.current_seniority || '';

  fillSelect('tagFunction', FUNCTIONS, fnVal);
  fillSelect('tagSpecialty', SPECIALTIES, spVal);
  fillSelect('tagSeniority', SENIORITIES, srVal);

  tagBaseline = { fn: fnVal, sp: spVal, sr: srVal };
  updateTagsDirtyState();

  // Bucket pill next to the Tags title
  const bucketEl = $('tagsBucket');
  if (bucketEl) {
    const bucket = lastResult?.bucket;
    if (bucket) {
      bucketEl.textContent = humanizeTag(bucket);
      bucketEl.className = `bucket-pill ${bucket}`;
    } else {
      bucketEl.className = 'bucket-pill hidden';
    }
  }

  // Experience cards
  if (data.experiences.length > 0) {
    show('experienceSection');
    const countEl = $('expCount');
    if (countEl) countEl.textContent = String(data.experiences.length);

    const list = $('experienceList');
    if (list) {
      list.innerHTML = '';
      for (const exp of data.experiences) {
        const card = document.createElement('div');
        card.className = 'card';

        const title = exp.title || '—';
        const company = exp.company_name || '';
        const empType = exp.employment_type ? ` · ${exp.employment_type}` : '';
        const dateParts: string[] = [];
        if (exp.start_date) dateParts.push(exp.start_date);
        if (dateParts.length > 0 || exp.is_current || exp.end_date) {
          dateParts.push(exp.is_current ? 'Present' : (exp.end_date || ''));
        }
        const dateStr = dateParts.filter(Boolean).join(' – ');
        const dur = fmtDuration(exp.duration_months);
        const meta = [dateStr, dur].filter(Boolean).join(' · ');

        let html = `<div class="card-title">${esc(title)}</div>`;
        if (company) html += `<div class="card-sub">${esc(company)}${esc(empType)}</div>`;
        if (meta) html += `<div class="card-meta">${esc(meta)}</div>`;
        card.innerHTML = html;
        list.appendChild(card);
      }
    }
  } else {
    hide('experienceSection');
  }

  // Education cards
  if (data.education.length > 0) {
    show('educationSection');
    const countEl = $('eduCount');
    if (countEl) countEl.textContent = String(data.education.length);

    const list = $('educationList');
    if (list) {
      list.innerHTML = '';
      for (const edu of data.education) {
        const card = document.createElement('div');
        card.className = 'card';

        const school = edu.school_name || '—';
        const parts: string[] = [];
        if (edu.degree) parts.push(edu.degree);
        if (edu.field_of_study) parts.push(edu.field_of_study);
        const degreeStr = parts.join(', ');
        const years = edu.start_year && edu.end_year
          ? `${edu.start_year} – ${edu.end_year}`
          : (edu.end_year ? String(edu.end_year) : '');

        let html = `<div class="card-title">${esc(school)}</div>`;
        if (degreeStr) html += `<div class="card-sub">${esc(degreeStr)}</div>`;
        if (years) html += `<div class="card-meta">${esc(years)}</div>`;
        card.innerHTML = html;
        list.appendChild(card);
      }
    }
  } else {
    hide('educationSection');
  }

  // Summary
  if (data.summary) {
    show('summarySection');
    const el = $('prevSummary');
    if (el) el.textContent = data.summary;
  } else {
    hide('summarySection');
  }
}

function renderEmpty(message?: string) {
  hide('preview');
  show('empty');
  if (message) {
    const emptyEl = $('empty');
    if (emptyEl) {
      const p = emptyEl.querySelector('p');
      if (p) p.innerHTML = message;
    }
  }
}

// ─── Tag edit handling ─────────────────────────────────────────────────────

function getTagSelections(): { fn: string; sp: string; sr: string } {
  return {
    fn: ($('tagFunction') as HTMLSelectElement)?.value || '',
    sp: ($('tagSpecialty') as HTMLSelectElement)?.value || '',
    sr: ($('tagSeniority') as HTMLSelectElement)?.value || '',
  };
}

function updateTagsDirtyState() {
  const cur = getTagSelections();
  const dirty =
    cur.fn !== tagBaseline.fn ||
    cur.sp !== tagBaseline.sp ||
    cur.sr !== tagBaseline.sr;
  const btn = $('updateTagsBtn') as HTMLButtonElement | null;
  if (!btn) return;
  // Only show the Update button if tags are dirty AND we have a person_id to PATCH
  if (dirty && currentPersonId) {
    btn.classList.remove('hidden');
    btn.disabled = false;
  } else {
    btn.classList.add('hidden');
  }
}

function handleUpdateTags() {
  if (!currentPersonId) return;
  const cur = getTagSelections();
  const updates: Record<string, string | null> = {};
  if (cur.fn !== tagBaseline.fn) updates.current_function_normalized = cur.fn || null;
  if (cur.sp !== tagBaseline.sp) updates.current_specialty_normalized = cur.sp || null;
  if (cur.sr !== tagBaseline.sr) updates.current_seniority_normalized = cur.sr || null;

  if (Object.keys(updates).length === 0) return;

  const btn = $('updateTagsBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Updating...';

  chrome.runtime.sendMessage(
    { action: 'patchPerson', personId: currentPersonId, updates },
    (resp) => {
      btn.disabled = false;
      btn.textContent = 'Update Tags';

      const banner = $('statusBanner');
      if (banner) {
        if (resp?.success) {
          banner.textContent = resp.bucket
            ? `Updated — bucket: ${humanizeTag(resp.bucket)}`
            : 'Tags updated';
          banner.className = 'status-banner success';
          banner.classList.remove('hidden');
        } else {
          banner.textContent = resp?.message || 'Update failed';
          banner.className = 'status-banner error';
          banner.classList.remove('hidden');
        }
      }

      if (resp?.success) {
        // Baseline catches up to the saved values so button hides
        tagBaseline = cur;
        updateTagsDirtyState();

        // Refresh bucket pill
        const bucketEl = $('tagsBucket');
        if (bucketEl && resp.bucket) {
          bucketEl.textContent = humanizeTag(resp.bucket);
          bucketEl.className = `bucket-pill ${resp.bucket}`;
        }
      }
    }
  );
}

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  chrome.action.setBadgeText({ text: '' });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeUrl = tabs[0]?.url || '';
    const activeKey = profileKey(activeUrl);

    chrome.storage.local.get(
      ['scrapedData', 'canonicalData', 'linkedinUrl', 'lastResult'],
      (items) => {
        const data = items.scrapedData as ScrapedData | undefined;
        const canonical = items.canonicalData as CanonicalProfile | undefined;
        const storedKey = profileKey(items.linkedinUrl);

        if (!activeKey) {
          renderEmpty('Navigate to a LinkedIn profile and click <strong>Vetted</strong> to scrape.');
          return;
        }
        if (!data || !storedKey || storedKey !== activeKey) {
          renderEmpty('Click <strong>Vetted</strong> on this profile to scrape it.');
          return;
        }

        render(data, canonical || null, items.lastResult || null);
      }
    );
  });

  // Tag dropdown change → update dirty state
  for (const id of ['tagFunction', 'tagSpecialty', 'tagSeniority']) {
    $(id)?.addEventListener('change', updateTagsDirtyState);
  }
  $('updateTagsBtn')?.addEventListener('click', handleUpdateTags);

  // Send-to-Database button
  $('sendBtn')?.addEventListener('click', () => {
    chrome.storage.local.get(['scrapedData', 'canonicalData', 'linkedinUrl'], (items) => {
      const data = items.scrapedData as ScrapedData | undefined;
      const canonical = items.canonicalData as CanonicalProfile | undefined;
      if (!data || !canonical || !items.linkedinUrl) return;

      const btn = $('sendBtn') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Sending...';

      const payload = {
        linkedin_url: items.linkedinUrl,
        full_name: data.fullName,
        canonical_json: canonical,
        raw_json: data as unknown as Record<string, unknown>,
      };

      chrome.runtime.sendMessage({ action: 'sendToDatabase', payload }, (resp) => {
        btn.disabled = false;
        btn.textContent = 'Send to Database';

        // Re-render with the new lastResult so link + tags appear
        render(data, canonical, resp as LastResult);
      });
    });
  });
});
