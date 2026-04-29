// Content script — intercepts LinkedIn's Voyager API responses
//
// Architecture:
// 1. Inject a <script> into the page's MAIN world to monkey-patch fetch()
// 2. The patch saves the ORIGINAL fetch and only intercepts LinkedIn's own calls
// 3. Our direct API calls use the original unpatched fetch (via postMessage request)
// 4. Content script (ISOLATED world) listens for captured data and stores it
// 5. On button click, parse captured JSON into ScrapedData and send to background

// ─── Interfaces ────────────────────────────────────────────────────────────

// Names match background.ts and types.ts so global declaration merging works.
// (content.ts has no top-level import/export, so its interfaces become global.)
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
  description?: string;
  activities?: string;
  grade?: string;
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
  skills_tags?: string[];
  rawVoyager?: Record<string, unknown>;
}

// Local aliases so the rest of content.ts can keep its existing names.
type ScrapedExperience = RawExperience;
type ScrapedEducation = RawEducation;

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

  // DIAGNOSTIC: log every intercepted Voyager response for inspection
  const cls = url.includes('profilePositionGroups') || url.includes('profilePositions') ? 'positions'
            : url.includes('profileEducation') ? 'educations'
            : url.includes('profileSkill') ? 'skills'
            : url.includes('/profile') ? 'profile'
            : 'other';

  console.group(`[Vetted-Diag] ⚡ Intercepted (${cls}):`, url.slice(0, 120));
  console.log('Data:', data);
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    console.log('Top-level keys:', Object.keys(d));
    if (Array.isArray(d.elements)) console.log('elements.length:', d.elements.length);
    if (Array.isArray(d.included)) console.log('included.length:', d.included.length);
  }
  console.groupEnd();

  if (cls === 'positions') {
    voyagerCache.positions = data;
    console.log('[Vetted] ✓ Captured positions for', vanity);
  } else if (cls === 'educations') {
    voyagerCache.educations = data;
    console.log('[Vetted] ✓ Captured education for', vanity);
  } else if (cls === 'skills') {
    voyagerCache.skills = data;
    console.log('[Vetted] ✓ Captured skills for', vanity);
  } else if (cls === 'profile') {
    voyagerCache.profile = data;
    console.log('[Vetted] ✓ Captured profile for', vanity);
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

  // ── DIAGNOSTIC LOGGING (remove when debugging is done) ─────────────────
  const shortPath = path.split('?')[0].split('/').slice(-1)[0] || path.slice(0, 40);
  console.group(`[Vetted-Diag] Voyager call: ${shortPath}`);
  console.log('Full URL:', url);
  console.log('CSRF token length:', csrf.length);
  console.groupEnd();

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.setRequestHeader('csrf-token', csrf);
    xhr.setRequestHeader('x-restli-protocol-version', '2.0.0');
    xhr.setRequestHeader('accept', 'application/vnd.linkedin.normalized+json+2.1');
    xhr.withCredentials = true;
    xhr.timeout = 15000;

    xhr.onload = function () {
      // Collect rate-limit and tracking headers so we can see if LinkedIn is throttling us
      const interestingHeaders = [
        'content-type', 'x-li-uuid', 'x-li-proto-ver',
        'x-li-fabric', 'x-li-pop', 'x-li-route-key',
        'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
        'retry-after',
      ];
      const headers: Record<string, string> = {};
      for (const h of interestingHeaders) {
        const v = xhr.getResponseHeader(h);
        if (v) headers[h] = v;
      }

      console.group(`[Vetted-Diag] ← ${shortPath} status=${xhr.status}`);
      console.log('Status:', xhr.status, xhr.statusText);
      console.log('Response headers:', headers);
      console.log('Response body length:', (xhr.responseText || '').length, 'chars');

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          // Log the full parsed response so the user can see exactly what LinkedIn returned
          console.log('Parsed response (FULL):', data);
          console.log('Top-level keys:', Object.keys(data));
          if (Array.isArray((data as Record<string, unknown>).elements)) {
            const els = (data as Record<string, unknown>).elements as unknown[];
            console.log('elements.length:', els.length);
            if (els.length > 0) console.log('elements[0]:', els[0]);
          }
          if (Array.isArray((data as Record<string, unknown>).included)) {
            const inc = (data as Record<string, unknown>).included as unknown[];
            console.log('included.length:', inc.length);
            // Log a summary of included entity types
            const typeCounts: Record<string, number> = {};
            for (const item of inc) {
              if (!item || typeof item !== 'object') continue;
              const obj = item as Record<string, unknown>;
              const type = (obj['$type'] || obj.entityUrn || 'unknown') as string;
              const short = String(type).split('.').slice(-1)[0].split(':').slice(0, 4).join(':').slice(0, 50);
              typeCounts[short] = (typeCounts[short] || 0) + 1;
            }
            console.log('included entity types:', typeCounts);
          }
          console.groupEnd();
          resolve(data);
        } catch (e) {
          console.error('JSON parse error:', e);
          console.log('Raw body (first 500 chars):', (xhr.responseText || '').slice(0, 500));
          console.groupEnd();
          resolve(null);
        }
      } else {
        // Full error body so we can see LinkedIn's error message
        const fullBody = xhr.responseText || '';
        console.error('HTTP error — full body:', fullBody);
        if (xhr.status === 429) {
          console.error('⚠️ RATE LIMITED — retry-after:', xhr.getResponseHeader('retry-after'));
        }
        if (xhr.status === 401 || xhr.status === 403) {
          console.error('⚠️ AUTH ERROR — CSRF token may be stale or missing');
        }
        console.groupEnd();
        resolve(null);
      }
    };

    xhr.onerror = function () {
      console.error(`[Vetted-Diag] ← ${shortPath} NETWORK ERROR`);
      resolve(null);
    };

    xhr.ontimeout = function () {
      console.error(`[Vetted-Diag] ← ${shortPath} TIMEOUT after 15s`);
      resolve(null);
    };

    xhr.send();
  });
}

/**
 * Extract the real profile URN (e.g. "urn:li:fsd_profile:ACoAAAJEh44...") from
 * a profile API response. LinkedIn's positions/education endpoints require this
 * numeric member URN — the vanity name alone doesn't work.
 *
 * Tries two strategies in order:
 *   1. Find an entity where publicIdentifier === vanityName (strict match)
 *   2. Find any fsd_profile entity with firstName + lastName (main profile entity)
 */
function extractProfileUrn(profileResponse: unknown, vanityName: string): string | null {
  if (!profileResponse || typeof profileResponse !== 'object') return null;
  const root = profileResponse as Record<string, unknown>;

  const pools: unknown[][] = [];
  if (Array.isArray(root.included)) pools.push(root.included);
  if (Array.isArray(root.elements)) pools.push(root.elements);
  if (root.data && typeof root.data === 'object') {
    const d = root.data as Record<string, unknown>;
    if (Array.isArray(d.included)) pools.push(d.included);
    if (Array.isArray(d.elements)) pools.push(d.elements);
  }

  // Strategy 1: exact vanity match
  for (const pool of pools) {
    for (const item of pool) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      if (obj.publicIdentifier === vanityName && typeof obj.entityUrn === 'string') {
        console.log('[Vetted] Extracted profile URN (vanity match):', obj.entityUrn);
        return obj.entityUrn;
      }
    }
  }

  // Strategy 2: main profile entity (has firstName + lastName + fsd_profile URN)
  for (const pool of pools) {
    for (const item of pool) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.entityUrn === 'string' &&
          obj.entityUrn.startsWith('urn:li:fsd_profile:') &&
          obj.firstName && obj.lastName) {
        console.log('[Vetted] Extracted profile URN (firstName fallback):', obj.entityUrn);
        return obj.entityUrn;
      }
    }
  }

  return null;
}

/**
 * Log diagnostic info about a failed URN extraction so we can see the response shape.
 */
function logProfileResponseShape(profileResponse: unknown): void {
  if (!profileResponse || typeof profileResponse !== 'object') {
    console.warn('[Vetted] Profile response is null/non-object');
    return;
  }
  const root = profileResponse as Record<string, unknown>;
  console.warn('[Vetted] Profile response top-level keys:', Object.keys(root));

  const pools: { name: string; arr: unknown[] }[] = [];
  if (Array.isArray(root.included)) pools.push({ name: 'included', arr: root.included });
  if (Array.isArray(root.elements)) pools.push({ name: 'elements', arr: root.elements });
  if (root.data && typeof root.data === 'object') {
    const d = root.data as Record<string, unknown>;
    if (Array.isArray(d.included)) pools.push({ name: 'data.included', arr: d.included });
    if (Array.isArray(d.elements)) pools.push({ name: 'data.elements', arr: d.elements });
  }

  for (const { name, arr } of pools) {
    const sample = arr.slice(0, 3).map(item => {
      if (!item || typeof item !== 'object') return typeof item;
      const obj = item as Record<string, unknown>;
      return {
        entityUrn: obj.entityUrn || obj['$id'] || '(none)',
        publicIdentifier: obj.publicIdentifier || '(none)',
        hasFirstName: !!obj.firstName,
        keys: Object.keys(obj).slice(0, 10),
      };
    });
    console.warn(`[Vetted] ${name} (${arr.length} entries), first 3:`, sample);
  }
}

async function fetchProfileData(vanityName: string): Promise<void> {
  // STEP 1: Fetch the profile with FullProfileWithEntities decoration — this
  // expands positions (with titles), education, skills, etc. inline in the
  // included array. Then fall back to minimal top-card if that fails.
  console.log('[Vetted] Step 1: fetching profile (full) for vanity:', vanityName);
  const fullProfile = await fetchVoyagerAPI(
    `/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanityName)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-35`
  );
  if (fullProfile) {
    voyagerCache.profile = fullProfile;
    voyagerCache.fullProfile = fullProfile; // Mirror it for the parser to consult
  } else {
    // Fallback to the topcard decoration we've been using
    console.warn('[Vetted] FullProfileWithEntities failed — falling back to WebTopCardCore');
    const topCard = await fetchVoyagerAPI(
      `/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanityName)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-19`
    );
    if (topCard) voyagerCache.profile = topCard;
  }

  const profileUrn = extractProfileUrn(voyagerCache.profile, vanityName);

  // DIAGNOSTIC: scan the profile response for any entities that already carry titles
  const profileEntities = collectEntities(voyagerCache.profile);
  const withTitles = profileEntities.filter(e => typeof e.title === 'string');
  console.log(`[Vetted] Profile response: ${profileEntities.length} entities, ${withTitles.length} have title field`);
  if (withTitles.length > 0) {
    console.log('[Vetted] Sample entity with title:', {
      entityUrn: withTitles[0].entityUrn,
      $type: withTitles[0]['$type'],
      title: withTitles[0].title,
      companyName: withTitles[0].companyName,
      dateRange: withTitles[0].dateRange,
    });
  }

  if (!profileUrn) {
    console.warn('[Vetted] Could not extract profile URN — positions/education will likely fail');
    logProfileResponseShape(voyagerCache.profile);
    const [positions, education] = await Promise.all([
      fetchVoyagerAPI(`/identity/dash/profilePositionGroups?q=viewee&profileUrn=urn%3Ali%3Afsd_profile%3A${encodeURIComponent(vanityName)}`),
      fetchVoyagerAPI(`/identity/dash/profileEducations?q=viewee&profileUrn=urn%3Ali%3Afsd_profile%3A${encodeURIComponent(vanityName)}`),
    ]);
    if (positions) voyagerCache.positions = positions;
    if (education) voyagerCache.educations = education;
    return;
  }

  // STEP 2: Dedicated positions & education calls for completeness.
  // The full profile response should already include these, but the dedicated
  // endpoints often return richer detail (descriptions, per-role dateRange).
  const encodedUrn = encodeURIComponent(profileUrn);
  console.log('[Vetted] Step 2: fetching positions/education with URN:', profileUrn);

  const [positions, education] = await Promise.all([
    fetchVoyagerAPI(`/identity/dash/profilePositionGroups?q=viewee&profileUrn=${encodedUrn}`),
    fetchVoyagerAPI(`/identity/dash/profileEducations?q=viewee&profileUrn=${encodedUrn}`),
  ]);

  if (positions) voyagerCache.positions = positions;
  if (education) voyagerCache.educations = education;
}

// ─── Parse Voyager JSON into ScrapedData ───────────────────────────────────

/**
 * Collect all "included"/"elements" entities from a single response, plus the
 * root object itself if it looks like an entity (has entityUrn).
 */
function collectEntities(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (!data || typeof data !== 'object') return out;
  const d = data as Record<string, unknown>;

  const pools: unknown[] = [];
  if (Array.isArray(d.included)) pools.push(...d.included);
  if (Array.isArray(d.elements)) pools.push(...d.elements);
  if (d.data && typeof d.data === 'object') {
    const inner = d.data as Record<string, unknown>;
    if (Array.isArray(inner.included)) pools.push(...inner.included);
    if (Array.isArray(inner.elements)) pools.push(...inner.elements);
  }

  for (const item of pools) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      out.push(item as Record<string, unknown>);
    }
  }

  // Also include the root object if it has an entityUrn (some responses return
  // the entity directly at the top level)
  if (typeof d.entityUrn === 'string') out.push(d);

  return out;
}

/** Build a URN → entity lookup from a list of entities. */
function buildUrnIndex(entities: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const idx = new Map<string, Record<string, unknown>>();
  for (const e of entities) {
    const urn = (e.entityUrn || e['$id']) as string | undefined;
    if (urn && !idx.has(urn)) idx.set(urn, e);
  }
  return idx;
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

/** A dateRange/timePeriod end is "open" (meaning role is current) if there's
 *  no end object, or the end object has no year field. */
function isOpenEnded(end: unknown): boolean {
  if (!end || typeof end !== 'object') return true;
  const e = end as Record<string, unknown>;
  if (e.year === undefined || e.year === null) return true;
  return false;
}

function computeDurationMonths(start: unknown, end: unknown): number | undefined {
  if (!start || typeof start !== 'object') return undefined;
  const s = start as Record<string, number>;
  if (!s.year) return undefined;

  let eYear: number;
  let eMonth: number;
  if (!isOpenEnded(end)) {
    const e = end as Record<string, number>;
    eYear = e.year;
    eMonth = e.month || 12;
  } else {
    const now = new Date();
    eYear = now.getFullYear();
    eMonth = now.getMonth() + 1;
  }
  const months = (eYear - s.year) * 12 + (eMonth - (s.month || 1));
  return months >= 0 ? months : undefined;
}

/**
 * Resolve a company/school reference into a display name.
 * The reference can be: a string URN, a nested object, or a direct name string
 * stored alongside the URN in a field like "companyName".
 */
function resolveRefName(
  directName: unknown,
  urnRef: unknown,
  urnIndex: Map<string, Record<string, unknown>>,
): string | undefined {
  // 1. Direct string name (companyName, schoolName)
  if (typeof directName === 'string' && directName.trim()) return directName.trim();

  // 2. Nested object with name
  if (directName && typeof directName === 'object') {
    const o = directName as Record<string, unknown>;
    if (typeof o.name === 'string') return o.name;
  }

  // 3. URN reference — look up in index
  if (typeof urnRef === 'string' && urnRef.startsWith('urn:')) {
    const entity = urnIndex.get(urnRef);
    if (entity && typeof entity.name === 'string') return entity.name;
  }

  // 4. URN ref is itself an object (rare)
  if (urnRef && typeof urnRef === 'object') {
    const o = urnRef as Record<string, unknown>;
    if (typeof o.name === 'string') return o.name;
  }

  return undefined;
}

/** Extract a description string from various possible shapes (plain string,
 *  or { text: "...", attributes: [...] } object from the dash API). */
function extractDescription(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    const o = val as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
  }
  return undefined;
}

/**
 * Pick a displayable location name from an entity that might be a profile,
 * a Geo entity, or a Location entity.
 * Dash API can put the name in any of: locationName, geoLocationName,
 * defaultLocalizedName, localizedName, or a nested { localized: { "en_US": ... } }.
 */
function pickLocationName(obj: Record<string, unknown>): string {
  const candidates: unknown[] = [
    obj.locationName,
    obj.geoLocationName,
    obj.defaultLocalizedName,
    obj.localizedName,
    obj.location,
    obj.country,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      // Localized map like { "en_US": "San Francisco Bay Area" }
      const localized = o.localized;
      if (localized && typeof localized === 'object') {
        for (const v of Object.values(localized)) {
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
      }
      if (typeof o.full === 'string') return o.full;
      if (typeof o.city === 'string') return o.city;
      if (typeof o.name === 'string') return o.name;
      if (typeof o.defaultLocalizedName === 'string') return o.defaultLocalizedName;
      if (typeof o.localizedName === 'string') return o.localizedName;
    }
  }

  return '';
}

/**
 * Resolve the location for a profile entity. The location might be stored
 * directly on the profile or referenced via a URN to a Geo/Location entity
 * that lives elsewhere in the `included` array.
 */
function resolveLocation(
  profile: Record<string, unknown>,
  urnIndex: Map<string, Record<string, unknown>>,
): string {
  // 1. Direct fields on the profile itself
  const direct = pickLocationName(profile);
  if (direct) return direct;

  // 2. URN-referenced Geo / BasicLocation entities
  const urnFields = ['geo', '*geo', 'geoUrn', 'geoCountryUrn',
                     'basicLocation', '*basicLocation',
                     'location', '*location', 'locationUrn'];
  for (const field of urnFields) {
    const val = profile[field];
    if (typeof val === 'string' && val.startsWith('urn:')) {
      const entity = urnIndex.get(val);
      if (entity) {
        const name = pickLocationName(entity);
        if (name) return name;
      }
    }
  }

  return '';
}

/**
 * Detect a PositionGroup wrapper.
 * $type: "com.linkedin.voyager.dash.identity.profile.PositionGroup"
 * URN:   "urn:li:fsd_profilePositionGroup:(ACoAAA..., [id])"
 * Fields: companyName, companyUrn, dateRange — but NO title.
 * Real titles live in nested PositionInPositionGroup entities.
 */
function isPositionGroupEntity(obj: Record<string, unknown>): boolean {
  const t = String(obj['$type'] || '');
  if (t === 'com.linkedin.voyager.dash.identity.profile.PositionGroup') return true;
  const urn = String(obj.entityUrn || '');
  // Must be PositionGroup, NOT PositionInPositionGroup
  if (urn.includes('fsd_profilePositionGroup:') && !urn.includes('PositionInPositionGroup')) return true;
  return false;
}

/**
 * Detect a nested PositionInPositionGroup (one actual role within a group).
 * These carry the title field.
 */
function isPositionInGroupEntity(obj: Record<string, unknown>): boolean {
  const t = String(obj['$type'] || '');
  if (t.includes('PositionInPositionGroup')) return true;
  const urn = String(obj.entityUrn || '');
  if (urn.includes('fsd_profilePositionInPositionGroup:')) return true;
  // Also accept flat Position entities (some older profiles still return them)
  if (urn.includes('fsd_profilePosition:') && !urn.includes('PositionGroup')) return true;
  if (t === 'com.linkedin.voyager.dash.identity.profile.Position') return true;
  return false;
}

function isEducationEntity(obj: Record<string, unknown>): boolean {
  const urn = String(obj.entityUrn || obj['$type'] || '');
  if (urn.includes('fsd_profileEducation:') || urn.includes('fs_education:')) return true;
  if (urn.includes('fsdProfileEducation:')) return true;
  // Structural match: has schoolName or degreeName or fieldOfStudy
  if (typeof obj.schoolName === 'string' ||
      typeof obj.degreeName === 'string' ||
      typeof obj.fieldOfStudy === 'string') {
    return true;
  }
  return false;
}

/**
 * Extract the (profileId, groupOrPositionId) tuple from a URN of the form
 *   urn:li:fsd_profilePositionGroup:(ACoAAA..., 123)
 *   urn:li:fsd_profilePositionInPositionGroup:(ACoAAA..., 123)
 * Returns [profileId, secondId] or null if the URN doesn't match the tuple shape.
 */
function extractUrnTuple(urn: string): [string, string] | null {
  const m = urn.match(/\(([^,)]+)\s*,\s*([^)]+)\)/);
  if (!m) return null;
  return [m[1].trim(), m[2].trim()];
}

/**
 * Find nested Position entities that belong to a PositionGroup.
 *
 * LinkedIn's dash URN shapes (confirmed from live data):
 *   Group:    urn:li:fsd_profilePositionGroup:(profileId, groupId)
 *   Position: urn:li:fsd_profilePosition:(profileId, positionId)
 * The second tuple element is DIFFERENT (groupId vs positionId) so we cannot
 * match by tuple equality. The reliable matcher is:
 *   same profileId AND same companyName (both entities carry companyName)
 * With fallbacks for other linkage shapes.
 *
 * Strategies (first hit wins):
 *  1. Same profileId + same companyName (string match)
 *  2. Same profileId + same companyUrn (URN match)
 *  3. Nested has a field value equal to the group's entityUrn (direct ref)
 *  4. Nested has a "*positionGroup" / "positionGroupUrn" field pointing at us
 */
function findNestedPositionsForGroup(
  group: Record<string, unknown>,
  allNested: Record<string, unknown>[],
): Record<string, unknown>[] {
  const groupUrn = String(group.entityUrn || '');
  const groupTuple = extractUrnTuple(groupUrn);
  const groupProfileId = groupTuple ? groupTuple[0] : '';
  const groupCompanyName = typeof group.companyName === 'string' ? group.companyName.trim().toLowerCase() : '';
  const groupCompanyUrn = typeof group.companyUrn === 'string' ? group.companyUrn : '';

  const matches: Record<string, unknown>[] = [];

  for (const nested of allNested) {
    const nestedUrn = String(nested.entityUrn || '');
    const nestedTuple = extractUrnTuple(nestedUrn);
    const nestedProfileId = nestedTuple ? nestedTuple[0] : '';
    const sameProfile = groupProfileId && nestedProfileId === groupProfileId;

    let linked = false;

    // Strategy 1: same profile + same companyName (string)
    if (sameProfile && groupCompanyName) {
      const nc = typeof nested.companyName === 'string' ? nested.companyName.trim().toLowerCase() : '';
      if (nc && nc === groupCompanyName) linked = true;
    }

    // Strategy 2: same profile + same companyUrn
    if (!linked && sameProfile && groupCompanyUrn) {
      const nc = typeof nested.companyUrn === 'string' ? nested.companyUrn : '';
      if (nc && nc === groupCompanyUrn) linked = true;
    }

    // Strategy 3: direct URN reference from nested to group
    if (!linked) {
      for (const v of Object.values(nested)) {
        if (typeof v === 'string' && v === groupUrn) { linked = true; break; }
      }
    }

    // Strategy 4: nested has a positionGroup reference field
    if (!linked && groupTuple) {
      const ref = nested['*positionGroup'] || nested['positionGroup'] || nested['positionGroupUrn'];
      if (typeof ref === 'string' && (ref === groupUrn || ref.endsWith(`,${groupTuple[1]})`))) {
        linked = true;
      }
    }

    if (linked) matches.push(nested);
  }

  return matches;
}

/**
 * Build an experience record from a PositionGroup and optionally a nested
 * PositionInPositionGroup. When both are provided, nested fields take precedence
 * for title/description/employmentType and dateRange; group fields fill gaps.
 * When only a group is provided, title is left blank.
 */
function buildExperienceFromGroupAndPosition(
  group: Record<string, unknown> | null,
  nested: Record<string, unknown> | null,
  urnIndex: Map<string, Record<string, unknown>>,
): ScrapedExperience | null {
  const exp: ScrapedExperience = {};

  // Title: ONLY from nested (groups don't have title)
  if (nested && typeof nested.title === 'string') exp.title = nested.title;

  // Company: prefer group's companyName, then nested's, then URN lookup
  const companyDirectName =
    (group && typeof group.companyName === 'string' && group.companyName) ||
    (nested && typeof nested.companyName === 'string' && nested.companyName) ||
    undefined;
  const companyUrnRef =
    (group && (group.companyUrn || group.company)) ||
    (nested && (nested.companyUrn || nested.company)) ||
    undefined;
  const companyName =
    resolveRefName(companyDirectName, companyUrnRef, urnIndex) ||
    resolveRefName(undefined, group?.['*company'], urnIndex) ||
    resolveRefName(undefined, nested?.['*company'], urnIndex);
  if (companyName) exp.company_name = companyName;

  // Date range: prefer nested's dateRange (per-role), fall back to group's (aggregate)
  const tpSource = (nested && nested.dateRange) || (group && group.dateRange) ||
                   (nested && nested.timePeriod) || (group && group.timePeriod);
  if (tpSource && typeof tpSource === 'object') {
    const t = tpSource as Record<string, unknown>;
    const start = t.start || t.startDate;
    const end = t.end || t.endDate;
    const startStr = formatDate(start);
    const endStr = formatDate(end);
    if (startStr) exp.start_date = startStr;
    if (endStr) exp.end_date = endStr;
    exp.is_current = isOpenEnded(end);
    const dur = computeDurationMonths(start, end);
    if (dur !== undefined) exp.duration_months = dur;
  }

  // Employment type: nested preferred
  const empType = (nested && typeof nested.employmentType === 'string' && nested.employmentType) ||
                  (group && typeof group.employmentType === 'string' && group.employmentType);
  if (empType) exp.employment_type = empType;

  // Description: nested preferred
  const desc = extractDescription(nested?.description) || extractDescription(group?.description);
  if (desc) exp.description = desc;

  // Require at least company OR title to consider this a valid experience
  if (exp.title || exp.company_name) return exp;
  return null;
}

function extractEducationFromEntity(
  obj: Record<string, unknown>,
  urnIndex: Map<string, Record<string, unknown>>,
): ScrapedEducation | null {
  const edu: ScrapedEducation = {};

  const school = resolveRefName(obj.schoolName, obj.school, urnIndex) ||
                 resolveRefName(undefined, obj['*school'], urnIndex) ||
                 resolveRefName(undefined, obj.schoolUrn, urnIndex);
  if (school) edu.school_name = school;

  if (typeof obj.degreeName === 'string') edu.degree = obj.degreeName;
  else if (typeof obj.degree === 'string') edu.degree = obj.degree;

  if (typeof obj.fieldOfStudy === 'string') edu.field_of_study = obj.fieldOfStudy;

  // Free-text fields LinkedIn surfaces under each education entry. They're
  // optional — most profiles populate at least `activities` if any.
  // `description` and `grade` are common spots for honors, GPA, awards.
  const desc = extractDescription(obj.description);
  if (desc) edu.description = desc;

  const activities = extractDescription(obj.activities);
  if (activities) edu.activities = activities;

  if (typeof obj.grade === 'string' && obj.grade.trim()) {
    edu.grade = obj.grade.trim();
  }

  const tp = obj.dateRange || obj.timePeriod;
  if (tp && typeof tp === 'object') {
    const t = tp as Record<string, unknown>;
    const start = (t.start || t.startDate) as Record<string, number> | undefined;
    const end = (t.end || t.endDate) as Record<string, number> | undefined;
    if (start && start.year) edu.start_year = start.year;
    if (end && end.year) edu.end_year = end.year;
  }

  if (edu.school_name) return edu;
  return null;
}

function parseVoyagerData(): ScrapedData {
  const url = window.location.href.split('?')[0];

  const data: ScrapedData = {
    url, fullName: '', location: '', headline: '', summary: '',
    currentTitle: '', currentCompany: '', employmentType: '',
    experiences: [], education: [], skills_tags: [],
    rawVoyager: { ...voyagerCache },
  };

  // Build a global URN index from ALL cached responses so we can resolve
  // company/school URN references across sources.
  const allEntities: Record<string, unknown>[] = [];
  for (const val of Object.values(voyagerCache)) {
    allEntities.push(...collectEntities(val));
  }
  const urnIndex = buildUrnIndex(allEntities);

  console.log('[Vetted] Parser — total entities:', allEntities.length, '| URN index size:', urnIndex.size);

  // Entity type distribution (diagnostic)
  const typeCounts: Record<string, number> = {};
  for (const e of allEntities) {
    const urn = String(e.entityUrn || e['$type'] || 'unknown');
    const kind = urn.split(':').slice(2, 3).join('') || urn.slice(0, 30);
    typeCounts[kind] = (typeCounts[kind] || 0) + 1;
  }
  console.log('[Vetted] Parser — entity kinds:', typeCounts);

  // ── Profile info (from profile cache slot) ───────────────────────────────
  // CRITICAL: the FullProfileWithEntities decoration returns the viewed
  // profile's entities PLUS the logged-in viewer's profile entity (for
  // features like mutual connections). We MUST filter to only the viewed
  // profile's entity by matching publicIdentifier against the URL vanity,
  // otherwise we'll grab the viewer's name/headline/location by accident.
  const vanity = getViewedVanityName();
  const allProfileEntities = collectEntities(voyagerCache.profile);

  // Preferred: entities where publicIdentifier matches the URL vanity
  let viewedProfileEntities = allProfileEntities.filter(
    e => typeof e.publicIdentifier === 'string' &&
         e.publicIdentifier.toLowerCase() === vanity.toLowerCase()
  );

  // If no publicIdentifier match, narrow by the profileUrn we already extracted
  // for positions/education calls
  if (viewedProfileEntities.length === 0) {
    const extractedUrn = extractProfileUrn(voyagerCache.profile, vanity);
    if (extractedUrn) {
      viewedProfileEntities = allProfileEntities.filter(
        e => typeof e.entityUrn === 'string' && e.entityUrn === extractedUrn
      );
    }
  }

  // Final fallback: all profile entities (legacy behavior — may be wrong, but
  // better than nothing)
  if (viewedProfileEntities.length === 0) {
    console.warn('[Vetted] Could not identify viewed profile entity — falling back to all entities (name may be wrong)');
    viewedProfileEntities = allProfileEntities;
  } else {
    console.log(`[Vetted] Filtered profile entities: ${viewedProfileEntities.length}/${allProfileEntities.length} match viewed profile`);
  }

  for (const obj of viewedProfileEntities) {
    if (obj.firstName && obj.lastName) {
      if (!data.fullName) {
        data.fullName = `${obj.firstName} ${obj.lastName}`.trim();
      }
    }
    if (typeof obj.headline === 'string' && !data.headline) {
      data.headline = obj.headline;
    }
    if (!data.location) {
      data.location = resolveLocation(obj, urnIndex);
    }
    if (typeof obj.summary === 'string' && !data.summary) {
      data.summary = obj.summary;
    }
  }

  // Last-ditch location fallback: scan ALL cached entities for a Geo/Location entity
  if (!data.location) {
    for (const e of allEntities) {
      const t = String(e['$type'] || '');
      if (t.includes('Geo') || t.includes('Location')) {
        const name = pickLocationName(e);
        if (name) { data.location = name; break; }
      }
    }
  }

  // ── Experiences ──────────────────────────────────────────────────────────
  // LinkedIn's dash API splits experience into two entity types:
  //   1. PositionGroup — has companyName, companyUrn, dateRange — but NO title
  //   2. PositionInPositionGroup — nested inside a group, has the title field
  //
  // CRITICAL: titles (PositionInPositionGroup entities) may NOT be in the
  // positions endpoint's included array. They're typically in the profile
  // endpoint's included array when FullProfileWithEntities decoration is used.
  // We search BOTH cache slots (positions + profile) for nested position
  // entities to find titles regardless of where LinkedIn put them.
  const positionSlotEntities = collectEntities(voyagerCache.positions);
  const profileSlotEntities = collectEntities(voyagerCache.profile);
  const allPositionSources = [...positionSlotEntities, ...profileSlotEntities];

  // Groups can come from either response. Dedupe by entityUrn.
  const seenGroupUrns = new Set<string>();
  const groups: Record<string, unknown>[] = [];
  for (const e of allPositionSources) {
    if (!isPositionGroupEntity(e)) continue;
    const urn = String(e.entityUrn || '');
    if (urn && seenGroupUrns.has(urn)) continue;
    seenGroupUrns.add(urn);
    groups.push(e);
  }

  // Nested positions: scan both sources, dedupe by entityUrn
  const seenNestedUrns = new Set<string>();
  const nestedPositions: Record<string, unknown>[] = [];
  for (const e of allPositionSources) {
    if (!isPositionInGroupEntity(e)) continue;
    const urn = String(e.entityUrn || '');
    if (urn && seenNestedUrns.has(urn)) continue;
    if (urn) seenNestedUrns.add(urn);
    nestedPositions.push(e);
  }

  console.log(`[Vetted] Parser — position groups: ${groups.length} | nested positions: ${nestedPositions.length} (from ${positionSlotEntities.length} positions entities + ${profileSlotEntities.length} profile entities)`);

  // Compute the group→nested matches ONCE. Track which nested URNs got matched
  // so we can find orphans without double-counting.
  const matchedNestedUrns = new Set<string>();
  const groupMatches: Array<{ group: Record<string, unknown>; nested: Record<string, unknown>[] }> = [];
  for (const group of groups) {
    const nested = findNestedPositionsForGroup(group, nestedPositions);
    for (const n of nested) {
      const urn = String(n.entityUrn || '');
      if (urn) matchedNestedUrns.add(urn);
    }
    groupMatches.push({ group, nested });
  }

  // Emit experiences from groups:
  //   - If a group has nested positions: one experience per nested position
  //   - If a group has NO nested positions AND no other group claimed its
  //     company: emit a single group-only experience (blank title)
  for (const { group, nested } of groupMatches) {
    if (nested.length > 0) {
      for (const pos of nested) {
        const exp = buildExperienceFromGroupAndPosition(group, pos, urnIndex);
        if (exp) data.experiences.push(exp);
      }
    } else {
      const exp = buildExperienceFromGroupAndPosition(group, null, urnIndex);
      if (exp) data.experiences.push(exp);
    }
  }

  // Emit orphans: nested positions that weren't matched to any group. This
  // handles the edge case where LinkedIn returns a Position entity without
  // a PositionGroup sibling. Skips duplicates that were already emitted.
  for (const pos of nestedPositions) {
    const urn = String(pos.entityUrn || '');
    if (urn && matchedNestedUrns.has(urn)) continue;
    const exp = buildExperienceFromGroupAndPosition(null, pos, urnIndex);
    if (exp) data.experiences.push(exp);
  }

  console.log(`[Vetted] Parser — experiences extracted: ${data.experiences.length} (matched nested: ${matchedNestedUrns.size}/${nestedPositions.length})`);

  data.experiences.sort((a, b) => {
    if (a.is_current && !b.is_current) return -1;
    if (!a.is_current && b.is_current) return 1;
    return 0;
  });

  // ── Education (from educations cache slot) ───────────────────────────────
  const educationEntities = collectEntities(voyagerCache.educations);
  let eduFound = 0;
  for (const obj of educationEntities) {
    if (!isEducationEntity(obj)) continue;
    eduFound++;
    const edu = extractEducationFromEntity(obj, urnIndex);
    if (edu) data.education.push(edu);
  }
  console.log(`[Vetted] Parser — education entities identified: ${eduFound} | education extracted: ${data.education.length}`);

  // ── Derive current title/company ─────────────────────────────────────────
  // Prefer the most recent current experience. Fall back to headline ONLY when
  // no experiences exist at all — a blank title from experiences is still more
  // accurate than parsing the headline (which might say "CEO" for someone who
  // held that title at a past company, not their current one).
  if (data.experiences.length > 0) {
    const cur = data.experiences.find(e => e.is_current) || data.experiences[0];
    data.currentTitle = cur.title || '';
    data.currentCompany = cur.company_name || '';
    data.employmentType = cur.employment_type || '';
  } else if (data.headline) {
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

  // ── Skills extraction from Voyager skills response ──────────────────────
  // LinkedIn's profileSkill API returns entities with a `name` field.
  // We extract unique skill names into skills_tags[].
  if (voyagerCache.skills) {
    const skillEntities = collectEntities(voyagerCache.skills);
    const skillNames = new Set<string>();
    for (const entity of skillEntities) {
      // Voyager skill entities have { name: "Python", ... } or { skill: { name: "Python" } }
      const name = typeof entity.name === 'string' ? entity.name.trim()
        : typeof (entity as Record<string, unknown>).skill === 'object'
          ? ((entity as Record<string, unknown>).skill as Record<string, unknown>)?.name as string
          : null;
      if (name && name.length > 0 && name.length < 80) {
        skillNames.add(name);
      }
    }
    data.skills_tags = Array.from(skillNames);
    console.log(`[Vetted] Extracted ${data.skills_tags.length} skills:`, data.skills_tags.slice(0, 10));
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

  // DIAGNOSTIC: dump exactly what's in each cache slot for inspection
  console.group('[Vetted-Diag] 📦 Cache contents');
  console.log('profile:', voyagerCache.profile);
  console.log('positions:', voyagerCache.positions);
  console.log('educations:', voyagerCache.educations);
  console.log('skills:', voyagerCache.skills);
  console.groupEnd();

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

  /**
   * Set an error state on the button with a short label and a tooltip carrying
   * the full message. Clears after 4 seconds.
   */
  function setBtnError(label: string, detail: string) {
    btn.disabled = false;
    btn.textContent = label;
    btn.title = detail;
    console.error('[Vetted]', label, '—', detail);
    setTimeout(() => {
      btn.textContent = 'Vetted';
      btn.title = '';
    }, 4000);
  }

  /**
   * Translate a server message into a short button label.
   * API messages typically look like "API 401: ..." or "Network error: ..."
   * or "Scrape failed: missing name or URL...".
   */
  function labelFromMessage(msg: string): string {
    if (!msg) return 'Send failed';
    if (/unauth|401/i.test(msg)) return 'Auth error';
    if (/network/i.test(msg)) return 'No connection';
    if (/missing name|missing URL/i.test(msg)) return 'Missing data';
    if (/API 5\d\d/i.test(msg)) return 'Server error';
    if (/API 4\d\d/i.test(msg)) return 'Bad request';
    return 'Send failed';
  }

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    btn.textContent = 'Fetching...';
    btn.title = '';
    btn.disabled = true;

    let data;
    try {
      data = await scrapeProfile();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBtnError('Scrape failed', `Could not extract profile data: ${msg}`);
      return;
    }

    // Validate what we got before sending
    if (!data || !data.fullName) {
      setBtnError('No profile data', 'Scrape returned no name — reload the page and retry');
      return;
    }

    btn.textContent = 'Sending...';
    chrome.runtime.sendMessage({ action: 'scrapeComplete', data }, (resp) => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || 'Message channel closed';
        setBtnError('No connection', `Could not reach background: ${errMsg}`);
        return;
      }
      if (resp?.success) {
        btn.disabled = false;
        btn.textContent = 'Sent!';
        btn.title = '';
        setTimeout(() => { btn.textContent = 'Vetted'; }, 2500);
        return;
      }
      // API rejected
      const serverMsg = resp?.message || 'Unknown error';
      setBtnError(labelFromMessage(serverMsg), serverMsg);
    });
  });
  return btn;
}

/**
 * Try to inject the button. Returns 'topcard' if successfully placed in the profile
 * card, 'fixed' if it fell back to fixed position, or 'skip' if conditions aren't met.
 */
type InjectionResult = 'topcard' | 'fixed' | 'skip' | 'already-present';

function tryInjectButton(allowFixedFallback: boolean): InjectionResult {
  if (document.getElementById('vetted-scrape-btn')) return 'already-present';
  if (!window.location.pathname.startsWith('/in/')) return 'skip';

  const btn = createButton();
  const mainEl = document.querySelector('main');

  // Strategy 1: next to "View in Recruiter" link inside <main>
  if (mainEl) {
    const virLinks = mainEl.querySelectorAll('a[href*="talent/profile"]');
    for (const link of Array.from(virLinks)) {
      const wrapper = link.closest('div[data-display-contents]') || link.parentElement;
      if (wrapper?.parentElement) {
        const div = document.createElement('div');
        div.setAttribute('data-display-contents', 'true');
        div.appendChild(btn);
        wrapper.parentElement.appendChild(div);
        console.log('[Vetted] Button injected via strategy 1 (View in Recruiter)');
        return 'topcard';
      }
    }
  }

  // Strategy 2: topcard section by componentkey
  if (mainEl) {
    const sections = mainEl.querySelectorAll('section');
    for (const section of Array.from(sections)) {
      const ck = section.getAttribute('componentkey') || '';
      if (ck.toLowerCase().includes('topcard')) {
        section.appendChild(btn);
        console.log('[Vetted] Button injected via strategy 2 (topcard section)');
        return 'topcard';
      }
    }
  }

  // Strategy 3: any action button row in the profile card — look for Follow/Connect/Message
  if (mainEl) {
    const buttons = mainEl.querySelectorAll('button[aria-label], a[aria-label]');
    for (const el of Array.from(buttons)) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('follow') || label.includes('connect') || label.includes('invite') ||
          label.includes('message') || label.includes('more profile actions')) {
        const wrapper = el.closest('div[data-display-contents]') || el.parentElement;
        if (wrapper?.parentElement) {
          const div = document.createElement('div');
          div.setAttribute('data-display-contents', 'true');
          div.appendChild(btn);
          wrapper.parentElement.appendChild(div);
          console.log('[Vetted] Button injected via strategy 3 (action button row):', label);
          return 'topcard';
        }
      }
    }
  }

  // Strategy 4: find the section containing the profile h2 (name)
  const h2s = document.querySelectorAll('h2');
  for (const h2 of Array.from(h2s)) {
    const text = (h2 as HTMLElement).innerText?.trim() || '';
    if (text.length > 0 && text.length < 80 && !text.match(/^(experience|education|about|skills)$/i)) {
      const section = h2.closest('section');
      if (section) {
        section.appendChild(btn);
        console.log('[Vetted] Button injected via strategy 4 (h2 section)');
        return 'topcard';
      }
    }
  }

  // Fallback: fixed position at bottom-right of viewport
  if (allowFixedFallback) {
    btn.classList.add('vetted-scrape-button--fixed');
    document.body.appendChild(btn);
    console.log('[Vetted] Button injected via strategy 5 (fixed fallback)');
    return 'fixed';
  }

  return 'skip';
}

let injectionObserver: MutationObserver | null = null;

function injectButton() {
  if (!window.location.pathname.startsWith('/in/')) return;

  // First attempt — try topcard strategies, no fixed fallback yet
  const result = tryInjectButton(false);

  if (result === 'topcard' || result === 'already-present') {
    // Success or already there — stop any pending retry observer
    if (injectionObserver) {
      injectionObserver.disconnect();
      injectionObserver = null;
    }
    return;
  }

  if (result === 'skip') return;

  // Topcard strategies failed. Set up a MutationObserver to retry as the page
  // finishes loading. This catches late-rendering topcard.
  if (injectionObserver) injectionObserver.disconnect();

  let attempts = 0;
  const maxAttempts = 20;
  const startTime = Date.now();

  injectionObserver = new MutationObserver(() => {
    if (document.getElementById('vetted-scrape-btn')) {
      injectionObserver?.disconnect();
      injectionObserver = null;
      return;
    }
    attempts++;
    const retry = tryInjectButton(false);
    if (retry === 'topcard' || retry === 'already-present') {
      injectionObserver?.disconnect();
      injectionObserver = null;
      return;
    }

    // After 20 attempts OR 10 seconds, give up and use fixed-position fallback
    if (attempts >= maxAttempts || Date.now() - startTime > 10000) {
      injectionObserver?.disconnect();
      injectionObserver = null;
      if (!document.getElementById('vetted-scrape-btn')) {
        tryInjectButton(true); // allow fixed fallback this time
      }
    }
  });

  injectionObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Safety net: if the observer never fires, force fallback after 5s
  setTimeout(() => {
    if (!document.getElementById('vetted-scrape-btn')) {
      if (injectionObserver) {
        injectionObserver.disconnect();
        injectionObserver = null;
      }
      tryInjectButton(true);
    }
  }, 5000);
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
    // Clear persistent storage so the popup doesn't show stale data
    // from the previous profile when opened on the new one
    chrome.storage.local.remove(
      ['scrapedData', 'canonicalData', 'linkedinUrl', 'lastResult', 'lastScrapeTime'],
      () => {}
    );
    const newVanity = getViewedVanityName();
    window.postMessage({ type: 'VETTED_SET_VANITY', vanity: newVanity }, '*');
    document.getElementById('vetted-scrape-btn')?.remove();
    // Disconnect any pending injection retry from the previous page
    if (injectionObserver) {
      injectionObserver.disconnect();
      injectionObserver = null;
    }
    setTimeout(injectButton, 2000);
    console.log('[Vetted] SPA nav, cleared storage, now filtering for:', newVanity);
  }
}).observe(document, { subtree: true, childList: true });
