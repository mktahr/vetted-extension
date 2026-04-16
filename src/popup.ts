// Popup — displays scraped profile data with a Send button

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
  experiences?: RawExperience[];
  education?: RawEducation[];
}

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

// ─── Render ────────────────────────────────────────────────────────────────

function render(data: ScrapedData, lastResult: { success: boolean; message: string } | null) {
  hide('empty');
  show('preview');

  // Status
  if (lastResult) {
    const b = $('statusBanner');
    if (b) {
      b.textContent = lastResult.success ? 'Sent to database' : lastResult.message;
      b.className = `status-banner ${lastResult.success ? 'success' : 'error'}`;
    }
  }

  // Profile header
  const nameEl = $('prevName');
  if (nameEl) nameEl.textContent = data.fullName || '—';

  const headlineEl = $('prevHeadline');
  if (headlineEl) headlineEl.textContent = data.headline || '';
  if (!data.headline && headlineEl) headlineEl.style.display = 'none';

  const locEl = $('prevLocation');
  if (locEl) locEl.textContent = data.location || '';

  const urlEl = $('prevUrl') as HTMLAnchorElement | null;
  if (urlEl) { urlEl.href = data.url; urlEl.textContent = data.url.replace('https://www.linkedin.com', ''); }

  // ── Preview stats ────────────────────────────────────────────────────
  // Compute years of experience from the experience list (excluding internships)
  let totalMonths = 0;
  for (const exp of data.experiences) {
    if (exp.title && /\bintern\b|\binternship\b|\bco-?op\b/i.test(exp.title)) continue;
    if (exp.duration_months) totalMonths += exp.duration_months;
  }
  const yearsExp = totalMonths > 0 ? Math.round(totalMonths / 12) : 0;

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

  // Warnings banner
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

  // Experience
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

        // Build date string
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
  }

  // Education
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
  }

  // Summary
  if (data.summary) {
    show('summarySection');
    const el = $('prevSummary');
    if (el) el.textContent = data.summary;
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────

/**
 * Extract the /in/<vanity> path from a LinkedIn URL for comparing "same profile".
 * Returns null if the URL isn't a LinkedIn profile page.
 */
function profileKey(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^\/\?#]+)/);
  return m ? m[1].toLowerCase() : null;
}

function renderEmpty(message?: string) {
  hide('preview');
  show('empty');
  if (message) {
    const emptyEl = $('empty');
    if (emptyEl) {
      // The empty element uses a <p> child — update only the message line
      const p = emptyEl.querySelector('p');
      if (p) p.innerHTML = message;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.action.setBadgeText({ text: '' });

  // First, figure out what profile the user is currently viewing.
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeUrl = tabs[0]?.url || '';
    const activeKey = profileKey(activeUrl);

    chrome.storage.local.get(
      ['scrapedData', 'canonicalData', 'linkedinUrl', 'lastResult'],
      (items) => {
        const data = items.scrapedData as ScrapedData | undefined;
        const storedKey = profileKey(items.linkedinUrl);

        // Not on a LinkedIn profile page at all
        if (!activeKey) {
          renderEmpty('Navigate to a LinkedIn profile and click <strong>Vetted</strong> to scrape.');
          return;
        }

        // Stored data is for a different profile (or missing)
        if (!data || !storedKey || storedKey !== activeKey) {
          renderEmpty('Click <strong>Vetted</strong> on this profile to scrape it.');
          return;
        }

        // Storage matches the active profile — render it
        render(data, items.lastResult || null);
      }
    );
  });

  // Send button
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

        const banner = $('statusBanner');
        if (banner && resp) {
          banner.textContent = resp.success ? 'Sent to database' : resp.message;
          banner.className = `status-banner ${resp.success ? 'success' : 'error'}`;
        }
      });
    });
  });
});
