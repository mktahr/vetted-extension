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
  experiences?: RawExperience[];
  education?: RawEducation[];
}

interface IngestPayload {
  linkedin_url: string;
  full_name: string;
  canonical_json: CanonicalProfile;
  raw_json: Record<string, unknown>;
}

// ─── Build canonical profile from scraped data ─────────────────────────────

function buildCanonical(data: ScrapedData): CanonicalProfile {
  let totalMonths = 0;
  for (const exp of data.experiences) {
    if (exp.title && /\bintern\b|\binternship\b|\bco-?op\b/i.test(exp.title)) continue;
    if (exp.duration_months) totalMonths += exp.duration_months;
  }

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
    years_experience: totalMonths > 0 ? Math.round(totalMonths / 12) : null,
    years_at_current_company: yearsAtCurrent,
    experiences: data.experiences.length > 0 ? data.experiences : undefined,
    education: data.education.length > 0 ? data.education : undefined,
  };
}

// ─── Send to API ───────────────────────────────────────────────────────────

async function sendToAPI(payload: IngestPayload, retry = 0): Promise<{ success: boolean; message: string }> {
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
    return { success: true, message: body?.message || 'Profile ingested successfully' };
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
});

console.log('[Vetted] Background service worker ready');
