// Content script — intercepts LinkedIn's Voyager API responses
//
// Architecture:
// 1. Inject a <script> into the page's MAIN world to monkey-patch fetch()
// 2. The patch saves the ORIGINAL fetch and only intercepts LinkedIn's own calls
// 3. Our direct API calls use the original unpatched fetch (via postMessage request)
// 4. Content script (ISOLATED world) listens for captured data and stores it
// 5. On button click, parse captured JSON into ScrapedData and send to background

// ─── Interfaces ────────────────────────────────────────────────────────────

interface ScrapedExperience {
  company_name?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  duration_months?: number;
  description?: string;
  employment_type?: string;
}

interface ScrapedEducation {
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
  experiences: ScrapedExperience[];
  education: ScrapedEducation[];
  rawVoyager?: Record<string, unknown>;
}

// ─── Voyager data cache ────────────────────────────────────────────────────

const voyagerCache: Record<string, unknown> = {};

function getViewedVanityName(): string {
  return window.location.pathname.match(/\/in\/([^\/\?]+)/)?.[1] || '';
}

// ─── Inject fetch interceptor into page's main world ───────────────────────

function injectFetchInterceptor() {
  const vanity = getViewedVanityName();

  // This code runs in the PAGE's JS context (main world).
  // It patches fetch() but keeps a reference to the original.
  // Key anti-loop measures:
  //   - Saves original fetch as window.__vettedOriginalFetch
  //   - Checks a custom header '__vetted_bypass' to skip our own calls
  //   - Only intercepts URLs matching specific Voyager API path patterns
  //   - The clone().json() call uses the ORIGINAL fetch internally (Response.clone
  //     doesn't re-fetch), so no loop there
  const code = `
(function() {
  if (window.__vettedInterceptorInstalled) return;
  window.__vettedInterceptorInstalled = true;

  var _origFetch = window.fetch;
  window.__vettedOriginalFetch = _origFetch;

  var VIEWED_VANITY = ${JSON.stringify(vanity)};

  // Specific Voyager API path patterns we care about
  var VOYAGER_PATTERNS = [
    '/voyager/api/identity/dash/profile',
    '/voyager/api/identity/dash/profilePositionGroups',
    '/voyager/api/identity/dash/profilePositions',
    '/voyager/api/identity/dash/profileEducation',
    '/voyager/api/identity/dash/profileSkill',
    '/voyager/api/graphql'
  ];

  function isVoyagerProfileUrl(url) {
    for (var i = 0; i < VOYAGER_PATTERNS.length; i++) {
      if (url.indexOf(VOYAGER_PATTERNS[i]) !== -1) return true;
    }
    return false;
  }

  function isForViewedProfile(url) {
    if (!VIEWED_VANITY) return true;
    if (url.indexOf(VIEWED_VANITY) !== -1) return true;
    if (url.indexOf('memberIdentity=') !== -1 || url.indexOf('profileUrn=') !== -1) {
      return url.indexOf(VIEWED_VANITY) !== -1;
    }
    return true;
  }

  window.fetch = function() {
    var args = Array.prototype.slice.call(arguments);
    var input = args[0];
    var init = args[1] || {};

    // BYPASS: if our extension set the bypass header, use original fetch directly
    if (init && init.headers) {
      var h = init.headers;
      // Headers can be a Headers object, an array, or a plain object
      var hasBypass = false;
      if (h instanceof Headers) {
        hasBypass = h.has('x-vetted-bypass');
        if (hasBypass) h.delete('x-vetted-bypass');
      } else if (typeof h === 'object' && !Array.isArray(h)) {
        hasBypass = !!h['x-vetted-bypass'];
        if (hasBypass) {
          delete h['x-vetted-bypass'];
        }
      }
      if (hasBypass) {
        return _origFetch.apply(this, args);
      }
    }

    var url = (typeof input === 'string') ? input : (input && input.url || '');

    // Only intercept specific Voyager profile endpoints
    if (!isVoyagerProfileUrl(url) || !isForViewedProfile(url)) {
      return _origFetch.apply(this, args);
    }

    // Intercept: call original fetch, clone response, forward data
    return _origFetch.apply(this, args).then(function(response) {
      try {
        var clone = response.clone();
        clone.json().then(function(data) {
          window.postMessage({
            type: 'VETTED_VOYAGER_RESPONSE',
            url: url,
            data: data
          }, '*');
        }).catch(function() {});
      } catch(e) {}
      return response;
    });
  };

  // Listen for vanity name updates on SPA navigation
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'VETTED_SET_VANITY') {
      VIEWED_VANITY = event.data.vanity || '';
    }
  });

  console.log('[Vetted] Fetch interceptor installed for:', VIEWED_VANITY);
})();
`;

  const script = document.createElement('script');
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
  console.log('[Vetted] Interceptor injected, filtering for vanity:', vanity);
}

// ─── Listen for intercepted Voyager responses ──────────────────────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'VETTED_VOYAGER_RESPONSE') return;

  const url: string = event.data.url || '';
  const data = event.data.data;
  const vanity = getViewedVanityName();

  // Final vanity check on the response body
  if (vanity) {
    const sample = JSON.stringify(data).slice(0, 5000);
    if (!url.includes(vanity) && !sample.includes(vanity)) {
      console.log('[Vetted] Skipping response (wrong profile):', url.slice(0, 80));
      return;
    }
  }

  if (url.includes('profilePositionGroups') || url.includes('profilePositions')) {
    voyagerCache.positions = data;
    console.log('[Vetted] Captured positions for', vanity);
  } else if (url.includes('profileEducation')) {
    voyagerCache.educations = data;
    console.log('[Vetted] Captured education for', vanity);
  } else if (url.includes('profileSkill')) {
    voyagerCache.skills = data;
    console.log('[Vetted] Captured skills for', vanity);
  } else if (url.includes('/profile')) {
    voyagerCache.profile = data;
    console.log('[Vetted] Captured profile for', vanity);
  }
});

// ─── CSRF token extraction ─────────────────────────────────────────────────

function getCsrfToken(): string {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) {
    const content = meta.getAttribute('content');
    if (content) return content;
  }
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'JSESSIONID') {
      return (value || '').replace(/"/g, '');
    }
  }
  return '';
}

// ─── Direct Voyager API calls ──────────────────────────────────────────────
// Uses XMLHttpRequest instead of fetch so it bypasses the patched window.fetch
// entirely. Content scripts with host_permissions for linkedin.com can make
// same-origin XHR requests with cookies included — no postMessage bridge needed.

function fetchVoyagerAPI(path: string): Promise<unknown | null> {
  const csrf = getCsrfToken();
  if (!csrf) {
    console.warn('[Vetted] No CSRF token — cannot call Voyager API');
    return Promise.resolve(null);
  }

  const url = `https://www.linkedin.com/voyager/api${path}`;
  console.log('[Vetted] XHR Voyager API:', path.slice(0, 80));

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.setRequestHeader('csrf-token', csrf);
    xhr.setRequestHeader('x-restli-protocol-version', '2.0.0');
    xhr.setRequestHeader('accept', 'application/vnd.linkedin.normalized+json+2.1');
    xhr.withCredentials = true;
    xhr.timeout = 15000;

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          console.log('[Vetted] XHR success:', path.slice(0, 40), '| keys:', Object.keys(data).join(','));
          resolve(data);
        } catch (e) {
          console.error('[Vetted] XHR JSON parse error:', e);
          resolve(null);
        }
      } else {
        console.error('[Vetted] XHR error:', xhr.status, xhr.statusText, 'for', path.slice(0, 60));
        resolve(null);
      }
    };

    xhr.onerror = function () {
      console.error('[Vetted] XHR network error for', path.slice(0, 60));
      resolve(null);
    };

    xhr.ontimeout = function () {
      console.error('[Vetted] XHR timeout for', path.slice(0, 60));
      resolve(null);
    };

    xhr.send();
  });
}

async function fetchProfileData(vanityName: string): Promise<void> {
  const [profile, positions, education] = await Promise.all([
    fetchVoyagerAPI(`/identity/dash/profiles?q=memberIdentity&memberIdentity=${vanityName}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-19`),
    fetchVoyagerAPI(`/identity/dash/profilePositionGroups?q=viewee&profileUrn=urn%3Ali%3Afsd_profile%3A${vanityName}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.TopCardSupplementary-163`),
    fetchVoyagerAPI(`/identity/dash/profileEducations?q=viewee&profileUrn=urn%3Ali%3Afsd_profile%3A${vanityName}`),
  ]);

  if (profile) voyagerCache.profile = profile;
  if (positions) voyagerCache.positions = positions;
  if (education) voyagerCache.educations = education;
}

// ─── Parse Voyager JSON into ScrapedData ───────────────────────────────────

function findIncluded(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.included)) return d.included;
  if (Array.isArray(d.elements)) return d.elements;
  if (d.data && typeof d.data === 'object') {
    const inner = d.data as Record<string, unknown>;
    if (Array.isArray(inner.included)) return inner.included;
  }
  return [];
}

function formatDate(dateObj: unknown): string | null {
  if (!dateObj || typeof dateObj !== 'object') return null;
  const d = dateObj as Record<string, number>;
  const month = d.month;
  const year = d.year;
  if (!year) return null;
  if (month) {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${monthNames[month - 1] || month} ${year}`;
  }
  return String(year);
}

function computeDurationMonths(start: unknown, end: unknown): number | undefined {
  if (!start || typeof start !== 'object') return undefined;
  const s = start as Record<string, number>;
  if (!s.year) return undefined;
  let eYear: number, eMonth: number;
  if (end && typeof end === 'object') {
    const e = end as Record<string, number>;
    eYear = e.year || new Date().getFullYear();
    eMonth = e.month || 1;
  } else {
    eYear = new Date().getFullYear();
    eMonth = new Date().getMonth() + 1;
  }
  return (eYear - s.year) * 12 + (eMonth - (s.month || 1));
}

function parseVoyagerData(): ScrapedData {
  const url = window.location.href.split('?')[0];
  const vanity = getViewedVanityName();

  const data: ScrapedData = {
    url, fullName: '', location: '', headline: '', summary: '',
    currentTitle: '', currentCompany: '', employmentType: '',
    experiences: [], education: [],
    rawVoyager: { ...voyagerCache },
  };

  const allIncluded: unknown[] = [];
  for (const val of Object.values(voyagerCache)) {
    allIncluded.push(...findIncluded(val));
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      allIncluded.push(val);
    }
  }

  console.log('[Vetted] Entities:', allIncluded.length, '| vanity:', vanity);

  // Log a sample of entity types to understand the response shape
  const entityTypes: Record<string, number> = {};
  for (const item of allIncluded) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const type = (obj['$type'] || obj.entityUrn || 'unknown') as string;
    const shortType = type.slice(0, 60);
    entityTypes[shortType] = (entityTypes[shortType] || 0) + 1;
  }
  console.log('[Vetted] Entity types:', entityTypes);

  function isViewedProfileEntity(obj: Record<string, unknown>): boolean {
    if (!vanity) return true;
    if (obj.publicIdentifier === vanity) return true;
    const urn = (obj.entityUrn || obj['$id'] || '') as string;
    if (urn.includes(vanity)) return true;
    const pUrn = (obj.profileUrn || obj.memberUrn || '') as string;
    if (pUrn && pUrn.includes(vanity)) return true;
    return false;
  }

  let viewedMemberUrn = '';
  for (const item of allIncluded) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (obj.publicIdentifier === vanity && obj.entityUrn) {
      viewedMemberUrn = obj.entityUrn as string;
      break;
    }
  }

  function isForViewedProfile(obj: Record<string, unknown>): boolean {
    if (isViewedProfileEntity(obj)) return true;
    if (!viewedMemberUrn) return false;
    const memberIdMatch = viewedMemberUrn.match(/\d{5,}/);
    if (!memberIdMatch) return false;
    const memberId = memberIdMatch[0];
    const urn = (obj.entityUrn || obj['$id'] || '') as string;
    const pUrn = (obj.profileUrn || obj.memberUrn || '') as string;
    return urn.includes(memberId) || pUrn.includes(memberId);
  }

  // Extract profile info
  for (const item of allIncluded) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (obj.firstName && obj.lastName) {
      if (!isViewedProfileEntity(obj)) continue;
      if (!data.fullName) {
        data.fullName = `${obj.firstName} ${obj.lastName}`.trim();
      }
    }
    if (!isForViewedProfile(obj)) continue;
    if (obj.headline && typeof obj.headline === 'string' && !data.headline) data.headline = obj.headline;
    if (!data.location) {
      const loc = obj.locationName || obj.geoLocationName || obj.geoLocation;
      if (loc && typeof loc === 'string') data.location = loc;
      else if (loc && typeof loc === 'object') {
        const l = loc as Record<string, string>;
        data.location = l.full || l.city || '';
      }
    }
    if (obj.summary && typeof obj.summary === 'string' && !data.summary) data.summary = obj.summary;
  }

  // Extract experiences
  for (const item of allIncluded) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const urn = (obj.entityUrn || obj['$type'] || '') as string;
    const isPosition = urn.includes('position') || urn.includes('Position') ||
                       (obj.title && obj.companyName) || (obj.title && obj.company);
    if (!isPosition) continue;
    if (urn.includes('positionGroup') || urn.includes('PositionGroup')) continue;
    if (!isForViewedProfile(obj)) continue;

    const exp: ScrapedExperience = {};
    if (obj.title && typeof obj.title === 'string') exp.title = obj.title;

    if (obj.companyName && typeof obj.companyName === 'string') {
      exp.company_name = obj.companyName;
    } else if (obj.company && typeof obj.company === 'object') {
      const c = obj.company as Record<string, unknown>;
      exp.company_name = (c.name || c.companyName || '') as string;
    } else if (obj.companyUrn && typeof obj.companyUrn === 'string') {
      for (const inc of allIncluded) {
        if (!inc || typeof inc !== 'object') continue;
        const i = inc as Record<string, unknown>;
        if (i.entityUrn === obj.companyUrn || i['$id'] === obj.companyUrn) {
          exp.company_name = (i.name || i.companyName || '') as string;
          break;
        }
      }
    }

    const tp = obj.timePeriod || obj.dateRange;
    if (tp && typeof tp === 'object') {
      const t = tp as Record<string, unknown>;
      exp.start_date = formatDate(t.startDate) || undefined;
      exp.end_date = formatDate(t.endDate) || undefined;
      exp.is_current = !t.endDate;
      exp.duration_months = computeDurationMonths(t.startDate, t.endDate);
    }

    if (obj.employmentType && typeof obj.employmentType === 'string') exp.employment_type = obj.employmentType;
    if (obj.description && typeof obj.description === 'string') exp.description = obj.description;

    if (exp.title || exp.company_name) data.experiences.push(exp);
  }

  data.experiences.sort((a, b) => {
    if (a.is_current && !b.is_current) return -1;
    if (!a.is_current && b.is_current) return 1;
    return 0;
  });

  // Extract education
  for (const item of allIncluded) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const urn = (obj.entityUrn || obj['$type'] || '') as string;
    const isEdu = urn.includes('education') || urn.includes('Education') ||
                  (obj.schoolName && typeof obj.schoolName === 'string') ||
                  (obj.school && typeof obj.school === 'object');
    if (!isEdu) continue;
    if (!isForViewedProfile(obj)) continue;

    const edu: ScrapedEducation = {};
    if (obj.schoolName && typeof obj.schoolName === 'string') {
      edu.school_name = obj.schoolName;
    } else if (obj.school && typeof obj.school === 'object') {
      const s = obj.school as Record<string, unknown>;
      edu.school_name = (s.name || s.schoolName || '') as string;
    } else if (obj.schoolUrn && typeof obj.schoolUrn === 'string') {
      for (const inc of allIncluded) {
        if (!inc || typeof inc !== 'object') continue;
        const i = inc as Record<string, unknown>;
        if (i.entityUrn === obj.schoolUrn || i['$id'] === obj.schoolUrn) {
          edu.school_name = (i.name || i.schoolName || '') as string;
          break;
        }
      }
    }
    if (obj.degreeName && typeof obj.degreeName === 'string') edu.degree = obj.degreeName;
    else if (obj.degree && typeof obj.degree === 'string') edu.degree = obj.degree;
    if (obj.fieldOfStudy && typeof obj.fieldOfStudy === 'string') edu.field_of_study = obj.fieldOfStudy;

    const tp = obj.timePeriod || obj.dateRange;
    if (tp && typeof tp === 'object') {
      const t = tp as Record<string, unknown>;
      if (t.startDate && typeof t.startDate === 'object') edu.start_year = (t.startDate as Record<string, number>).year;
      if (t.endDate && typeof t.endDate === 'object') edu.end_year = (t.endDate as Record<string, number>).year;
    }
    if (edu.school_name) data.education.push(edu);
  }

  // Derive current title/company
  if (data.experiences.length > 0) {
    const cur = data.experiences.find(e => e.is_current) || data.experiences[0];
    data.currentTitle = cur.title || '';
    data.currentCompany = cur.company_name || '';
    data.employmentType = cur.employment_type || '';
  }
  if (!data.currentTitle && data.headline) {
    const at = data.headline.match(/^(.+?)\s+at\s+(.+)$/i);
    if (at) { data.currentTitle = at[1].trim(); data.currentCompany = at[2].trim(); }
    else data.currentTitle = data.headline;
  }
  if (!data.fullName) {
    const t = document.title || '';
    const c = t.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    const d = c.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    data.fullName = d ? d[1].trim() : c;
  }

  return data;
}

// ─── Main scrape function ──────────────────────────────────────────────────

async function scrapeProfile(): Promise<ScrapedData> {
  const url = window.location.href.split('?')[0];
  const vanityName = url.match(/\/in\/([^\/\?]+)/)?.[1] || '';

  console.log('[Vetted] ═══════════════════════════════════════════');
  console.log('[Vetted] Scrape:', vanityName, '| cached:', Object.keys(voyagerCache));

  const hasBefore = { profile: !!voyagerCache.profile, positions: !!voyagerCache.positions, educations: !!voyagerCache.educations };
  console.log('[Vetted] Cache before fetch:', hasBefore);

  if (!voyagerCache.profile || !voyagerCache.positions || !voyagerCache.educations) {
    if (vanityName) {
      await fetchProfileData(vanityName);
    } else {
      console.warn('[Vetted] No vanity name — cannot fetch Voyager API');
    }
  }

  const hasAfter = { profile: !!voyagerCache.profile, positions: !!voyagerCache.positions, educations: !!voyagerCache.educations };
  console.log('[Vetted] Cache after fetch:', hasAfter);

  const data = parseVoyagerData();

  console.log('[Vetted] RESULT:', JSON.stringify({
    fullName: data.fullName, location: data.location,
    headline: data.headline.slice(0, 60),
    currentTitle: data.currentTitle, currentCompany: data.currentCompany,
    exp: data.experiences.length, edu: data.education.length,
  }));
  console.log('[Vetted] ═══════════════════════════════════════════');

  return data;
}

// ─── Button injection ──────────────────────────────────────────────────────

function createButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'vetted-scrape-btn';
  btn.className = 'vetted-scrape-button';
  btn.textContent = 'Vetted';
  btn.type = 'button';

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    btn.textContent = 'Fetching...';
    btn.disabled = true;
    try {
      const data = await scrapeProfile();
      btn.textContent = 'Sending...';
      chrome.runtime.sendMessage({ action: 'scrapeComplete', data }, (resp) => {
        btn.disabled = false;
        if (chrome.runtime.lastError) {
          btn.textContent = 'Error';
          setTimeout(() => { btn.textContent = 'Vetted'; }, 3000);
          return;
        }
        btn.textContent = resp?.success ? 'Sent!' : 'Failed';
        setTimeout(() => { btn.textContent = 'Vetted'; }, 2500);
      });
    } catch (err) {
      console.error('[Vetted] Scrape error:', err);
      btn.disabled = false;
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = 'Vetted'; }, 3000);
    }
  });
  return btn;
}

function injectButton() {
  if (document.getElementById('vetted-scrape-btn')) return;
  if (!window.location.pathname.startsWith('/in/')) return;

  const btn = createButton();
  let inserted = false;

  const mainEl = document.querySelector('main');
  if (mainEl) {
    const virLinks = mainEl.querySelectorAll('a[href*="talent/profile"]');
    for (const link of Array.from(virLinks)) {
      const wrapper = link.closest('div[data-display-contents]') || link.parentElement;
      if (wrapper?.parentElement) {
        const div = document.createElement('div');
        div.setAttribute('data-display-contents', 'true');
        div.appendChild(btn);
        wrapper.parentElement.appendChild(div);
        inserted = true;
        break;
      }
    }
  }

  if (!inserted && mainEl) {
    const sections = mainEl.querySelectorAll('section');
    for (const section of Array.from(sections)) {
      const ck = section.getAttribute('componentkey') || '';
      if (ck.toLowerCase().includes('topcard')) {
        section.appendChild(btn);
        inserted = true;
        break;
      }
    }
  }

  if (!inserted) {
    btn.classList.add('vetted-scrape-button--fixed');
    document.body.appendChild(btn);
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────

// Install interceptor IMMEDIATELY at document_start
injectFetchInterceptor();
console.log('[Vetted] Loaded at', document.readyState);

function initButton() { setTimeout(injectButton, 2000); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initButton);
} else {
  initButton();
}

// SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    for (const key of Object.keys(voyagerCache)) delete voyagerCache[key];
    const newVanity = getViewedVanityName();
    window.postMessage({ type: 'VETTED_SET_VANITY', vanity: newVanity }, '*');
    document.getElementById('vetted-scrape-btn')?.remove();
    setTimeout(injectButton, 2000);
    console.log('[Vetted] SPA nav, now filtering for:', newVanity);
  }
}).observe(document, { subtree: true, childList: true });
