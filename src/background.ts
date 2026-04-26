// Background service worker — normalizes scraped data and sends to ingest API

const API_ENDPOINT = 'https://vetted-self.vercel.app/api/ingest';
const INGEST_SECRET = '9f6e2b8d4c1a7e3f0a9d5b6c2e4f8a1d7c3b5e0f6a9d2c8e4b1a7d3f';

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
  rawVoyager?: Record<string, unknown>;
}

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

interface IngestPayload {
  linkedin_url: string;
  full_name: string;
  canonical_json: CanonicalProfile;
  raw_json: Record<string, unknown>;
}

// ─── Years-of-experience computation ───────────────────────────────────────

/** Parse an experience date string ("Jan 2020", "2018", etc) into {year, month}. */
function parseExpDate(s: string | undefined): { year: number; month: number } | null {
  if (!s) return null;
  const lo = s.trim().toLowerCase();
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  for (let i = 0; i < months.length; i++) {
    if (lo.startsWith(months[i])) {
      const y = lo.match(/(\d{4})/);
      if (y) return { year: parseInt(y[1]), month: i + 1 };
    }
  }
  if (/^\d{4}$/.test(lo)) return { year: parseInt(lo), month: 1 };
  return null;
}

function toMonthIndex(d: { year: number; month: number }): number {
  return d.year * 12 + (d.month - 1);
}

/**
 * Employment types that count toward years of experience.
 * User decision: keep full_time + unknown/blank; exclude advisory, board,
 * part_time, freelance, contract, internship.
 */
function isQualifyingEmployment(empType: string | undefined): boolean {
  const et = (empType || '').toLowerCase().trim();
  if (!et) return true; // blank → treat as full-time
  if (/^full[\s-]?time$/.test(et) || et === 'permanent') return true;
  if (/^(advisor|advisory|board|part[\s-]?time|freelance|freelancer|contract|contractor|consulting|consultant|intern|internship|co[\s-]?op|seasonal|apprenticeship|temporary)/.test(et)) return false;
  return true; // other unknown types → treat as full-time (err toward counting)
}

function isInternTitle(title: string | undefined): boolean {
  return !!title && /\bintern\b|\binternship\b|\bco-?op\b/i.test(title);
}

/**
 * Compute years of experience by merging overlapping date intervals of
 * qualifying (full-time) roles. This avoids double-counting concurrent
 * roles (e.g. a founder who also sits on 3 boards) and side gigs.
 */
function computeYearsOfExperience(experiences: RawExperience[]): number | null {
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();

  const intervals: [number, number][] = [];
  for (const exp of experiences) {
    if (isInternTitle(exp.title)) continue;
    if (!isQualifyingEmployment(exp.employment_type)) continue;

    const start = parseExpDate(exp.start_date);
    if (!start) continue;

    const startIdx = toMonthIndex(start);
    let endIdx: number;
    if (exp.is_current) {
      endIdx = nowIdx;
    } else {
      const end = parseExpDate(exp.end_date);
      endIdx = end ? toMonthIndex(end) : nowIdx;
    }
    if (endIdx < startIdx) continue;
    intervals.push([startIdx, endIdx]);
  }

  if (intervals.length === 0) return null;

  // Merge overlapping and adjacent intervals
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of intervals) {
    if (merged.length === 0) { merged.push([s, e]); continue; }
    const last = merged[merged.length - 1];
    if (s <= last[1] + 1) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const totalMonths = merged.reduce((sum, [s, e]) => sum + (e - s + 1), 0);
  const years = Math.round(totalMonths / 12);
  console.log('[Vetted] Years-of-experience:', { intervalsIn: intervals.length, mergedIntervals: merged.length, totalMonths, years });
  return years > 0 ? years : null;
}

// ─── Build canonical profile from scraped data ─────────────────────────────

function buildCanonical(data: ScrapedData): CanonicalProfile {
  const yearsExperience = computeYearsOfExperience(data.experiences);

  let yearsAtCurrent: number | null = null;
  if (data.experiences.length > 0) {
    const current = data.experiences.find(e => e.is_current) || data.experiences[0];
    if (current?.duration_months) {
      yearsAtCurrent = Math.round(current.duration_months / 12);
    }
  }

  return {
    full_name: data.fullName || undefined,
    location_resolved: data.location || null,
    headline_raw: data.headline || null,
    summary_raw: data.summary || null,
    current_company: data.currentCompany || null,
    current_title: data.currentTitle || null,
    employment_type: data.employmentType || null,
    years_experience: yearsExperience,
    years_at_current_company: yearsAtCurrent,
    skills_tags: data.skills_tags && data.skills_tags.length > 0 ? data.skills_tags : null,
    experiences: data.experiences.length > 0 ? data.experiences : undefined,
    education: data.education.length > 0 ? data.education : undefined,
  };
}

// ─── Send to API ───────────────────────────────────────────────────────────

interface SendResult {
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

async function sendToAPI(payload: IngestPayload, retry = 0): Promise<SendResult> {
  console.log('[Vetted] Sending to API:', payload.linkedin_url);

  try {
    const resp = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': INGEST_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[Vetted] API error', resp.status, text);
      return { success: false, message: `API ${resp.status}: ${text}` };
    }

    const body = await resp.json().catch(() => null);
    console.log('[Vetted] API success:', body);
    return {
      success: true,
      message: body?.message || 'Profile ingested successfully',
      person_id: body?.person_id,
      current_function: body?.current_function ?? null,
      current_specialty: body?.current_specialty ?? null,
      current_seniority: body?.current_seniority ?? null,
      current_title_normalized: body?.current_title_normalized ?? null,
      bucket: body?.bucket ?? null,
      total_score: body?.total_score ?? null,
    };
  } catch (err) {
    if (retry === 0) {
      await new Promise(r => setTimeout(r, 1000));
      return sendToAPI(payload, 1);
    }
    console.error('[Vetted] Network error after retry:', err);
    return { success: false, message: `Network error: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

function showBadge(text: string, color: string) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ─── Message handler ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'scrapeComplete') {
    const data: ScrapedData = message.data;

    const missing: string[] = [];
    if (!data?.fullName) missing.push('name');
    if (!data?.url) missing.push('URL');
    if (missing.length > 0) {
      const msg = `Scrape failed: missing ${missing.join(' and ')}. Reload the page and retry.`;
      showBadge('!', '#f44336');
      chrome.storage.local.set({ lastResult: { success: false, message: msg } });
      sendResponse({ success: false, message: msg });
      return true;
    }

    const canonical = buildCanonical(data);

    // raw_json gets the raw Voyager API responses (for future reprocessing)
    // plus our parsed fields as a fallback
    const rawJson: Record<string, unknown> = {};
    if (data.rawVoyager && Object.keys(data.rawVoyager).length > 0) {
      rawJson.voyager_responses = data.rawVoyager;
    }
    rawJson.parsed = {
      fullName: data.fullName,
      location: data.location,
      headline: data.headline,
      summary: data.summary,
      currentTitle: data.currentTitle,
      currentCompany: data.currentCompany,
      employmentType: data.employmentType,
      experiences: data.experiences,
      education: data.education,
    };

    const payload: IngestPayload = {
      linkedin_url: data.url,
      full_name: data.fullName,
      canonical_json: canonical,
      raw_json: rawJson,
    };

    // Store for popup preview
    chrome.storage.local.set({
      scrapedData: data,
      canonicalData: canonical,
      linkedinUrl: data.url,
      lastScrapeTime: Date.now(),
    });

    sendToAPI(payload).then(result => {
      chrome.storage.local.set({ lastResult: result });
      if (result.success) {
        showBadge('OK', '#4caf50');
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
      } else {
        showBadge('!', '#f44336');
      }
      sendResponse(result);
    });

    return true;
  }

  if (message.action === 'sendToDatabase') {
    const payload: IngestPayload = message.payload;
    sendToAPI(payload).then(result => {
      chrome.storage.local.set({ lastResult: result });
      if (result.success) {
        showBadge('OK', '#4caf50');
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
      } else {
        showBadge('!', '#f44336');
      }
      sendResponse(result);
    });
    return true;
  }

  if (message.action === 'getScrapedData') {
    chrome.storage.local.get(['scrapedData', 'canonicalData', 'linkedinUrl', 'lastResult', 'lastScrapeTime'], (items) => {
      sendResponse(items);
    });
    return true;
  }

  if (message.action === 'patchPerson') {
    // Body: { personId: string, updates: { current_function_normalized?, current_title_normalized?, current_specialty_normalized?, current_seniority_normalized? } }
    const url = `https://vetted-self.vercel.app/api/people/${encodeURIComponent(message.personId)}`;
    fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': INGEST_SECRET,
      },
      body: JSON.stringify(message.updates || {}),
    })
      .then(async resp => {
        const body = await resp.json().catch(() => null);
        if (!resp.ok) {
          sendResponse({ success: false, message: body?.error || `HTTP ${resp.status}` });
          return;
        }
        // Merge the new bucket/score into lastResult so the popup can reflect it
        chrome.storage.local.get(['lastResult'], (items) => {
          const updated = {
            ...(items.lastResult || {}),
            bucket: body?.bucket ?? items.lastResult?.bucket ?? null,
            total_score: body?.total_score ?? items.lastResult?.total_score ?? null,
          };
          chrome.storage.local.set({ lastResult: updated });
          sendResponse({ success: true, message: body?.message || 'Updated', bucket: body?.bucket, total_score: body?.total_score });
        });
      })
      .catch(err => {
        sendResponse({ success: false, message: err instanceof Error ? err.message : 'Network error' });
      });
    return true;
  }
});

console.log('[Vetted] Background service worker ready');
