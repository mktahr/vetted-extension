// Background service worker for API calls

import { CanonicalProfile, RawProfile, IngestPayload, ScrapedData } from './types';

const API_ENDPOINT = 'https://vetted-self.vercel.app/api/ingest';
const INGEST_SECRET = '9f6e2b8d4c1a7e3f0a9d5b6c2e4f8a1d7c3b5e0f6a9d2c8e4b1a7d3f';

// Log that background script is loaded
console.log('[Vetted Extension] Background service worker loaded and ready');

function normalizeToCanonical(scrapedData: ScrapedData, linkedinUrl: string): CanonicalProfile {
  // Use fullName from scraped data (already extracted with fallback chain in content script)
  const fullName = (scrapedData.fullName || scrapedData.name || '').trim();
  
  return {
    linkedin_url: linkedinUrl,
    full_name: fullName,
    location_resolved: scrapedData.location || null,
    current_company: scrapedData.currentCompany || null,
    current_title: scrapedData.currentTitle || null,
    years_experience: scrapedData.experience?.years || null,
    years_at_current_company: scrapedData.experience?.yearsAtCurrent || null,
    undergrad_university: scrapedData.education?.undergraduate || null,
    secondary_university: scrapedData.education?.masters || null,
    phd_university: scrapedData.education?.phd || null,
    skills_tags: scrapedData.skills || null,
    focus_area_tags: null,
    excellence_tags: null,
    domain_tags: null,
    notes: null
  };
}

async function sendToAPI(payload: IngestPayload, retryCount: number = 0): Promise<{ success: boolean; message: string }> {
  console.log('[Vetted Extension] sendToAPI called:', {
    retryCount,
    endpoint: API_ENDPOINT,
    secretLength: INGEST_SECRET.length,
    payloadLinkedInUrl: payload.linkedin_url
  });
  
  // Log the FULL payload being sent (for debugging)
  console.log('[Vetted Extension] FULL payload being sent to API:', JSON.stringify(payload, null, 2));
  console.log('[Vetted Extension] Payload canonical_json fields:', {
    location_resolved: payload.canonical_json.location_resolved,
    current_company: payload.canonical_json.current_company,
    current_title: payload.canonical_json.current_title,
    years_experience: payload.canonical_json.years_experience,
    years_at_current_company: payload.canonical_json.years_at_current_company,
    undergrad_university: payload.canonical_json.undergrad_university,
    secondary_university: payload.canonical_json.secondary_university,
    phd_university: payload.canonical_json.phd_university
  });
  
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': INGEST_SECRET
      },
      body: JSON.stringify(payload)
    });

    console.log('[Vetted Extension] API response status:', response.status);

    // Log non-200 responses
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Vetted Extension] API Error ${response.status}:`, errorText);
      
      return {
        success: false,
        message: `API Error: ${response.status} - ${errorText}`
      };
    }

    const responseData = await response.json().catch(() => null);
    console.log('[Vetted Extension] API success response:', responseData);
    
    return {
      success: true,
      message: 'Profile successfully sent to database!'
    };
  } catch (error) {
    console.error('[Vetted Extension] sendToAPI error:', error);
    // Retry once on network failure
    if (retryCount === 0) {
      console.warn('[Vetted Extension] Network error, retrying once...', error);
      // Wait 1 second before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      return sendToAPI(payload, 1);
    }
    
    // Log final failure
    console.error('[Vetted Extension] Network error after retry:', error);
    return {
      success: false,
      message: `Network Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Vetted Extension] Background received message:', message.action);
  
  if (message.action === 'scrapeComplete') {
    const { data, linkedinUrl } = message;
    
    console.log('[Vetted Extension] Processing scrape complete:', {
      linkedinUrl,
      hasData: !!data,
      dataKeys: data ? Object.keys(data) : []
    });
    
    // Normalize data
    const canonical = normalizeToCanonical(data, linkedinUrl);
    
    // Log what was scraped vs what was normalized
    console.log('[Vetted Extension] Scraped data (raw):', {
      location: data.location,
      currentCompany: data.currentCompany,
      currentTitle: data.currentTitle,
      experience: data.experience,
      education: data.education
    });
    
    console.log('[Vetted Extension] Normalized canonical data:', canonical);
    console.log('[Vetted Extension] Canonical data breakdown:', {
      location_resolved: canonical.location_resolved,
      current_company: canonical.current_company,
      current_title: canonical.current_title,
      years_experience: canonical.years_experience,
      years_at_current_company: canonical.years_at_current_company,
      undergrad_university: canonical.undergrad_university,
      secondary_university: canonical.secondary_university,
      phd_university: canonical.phd_university,
      skills_tags: canonical.skills_tags?.length || 0
    });
    
    // REQUIRED FIELD VALIDATION: Do NOT send if required fields are missing
    const fullName = (canonical.full_name || '').trim();
    const linkedInUrl = (canonical.linkedin_url || '').trim();
    
    // Validate and update canonical object with validated values
    if (!fullName || fullName.length === 0 || !linkedInUrl || linkedInUrl.length === 0) {
      const errorMsg = 'Scrape failed: missing name or LinkedIn URL. Reload the page and try again.';
      console.error('[Vetted] Scrape failed: missing full_name or linkedin_url', { 
        scrapedData: data, 
        canonical,
        fullName: fullName,
        linkedInUrl: linkedInUrl,
        fullNameLength: fullName.length,
        linkedInUrlLength: linkedInUrl.length
      });
      
      // Show error badge
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
      
      // Store error result
      chrome.storage.local.set({
        lastResult: { success: false, message: errorMsg }
      });
      
      sendResponse({ success: false, message: errorMsg });
      return true;
    }
    
    // Update canonical with validated values (ensure they're never null/empty)
    canonical.full_name = fullName;
    canonical.linkedin_url = linkedInUrl;
    
    // Automatically send to database (zero user interaction)
    const payload: IngestPayload = {
      linkedin_url: linkedInUrl,
      raw_json: data,
      canonical_json: canonical
    };
    
    // Log FULL canonical_json to see what's being sent
    console.log('[Vetted Extension] FULL canonical_json being sent:', JSON.stringify(canonical, null, 2));
    console.log('[Vetted Extension] Sending to API:', {
      url: API_ENDPOINT,
      hasSecret: !!INGEST_SECRET,
      fullName: fullName,
      linkedInUrl: linkedInUrl,
      canonicalFullName: canonical.full_name,
      canonicalLocation: canonical.location_resolved,
      canonicalCompany: canonical.current_company,
      canonicalTitle: canonical.current_title,
      canonicalYearsExp: canonical.years_experience,
      canonicalYearsAtCurrent: canonical.years_at_current_company,
      canonicalUndergrad: canonical.undergrad_university,
      canonicalMasters: canonical.secondary_university,
      canonicalPhD: canonical.phd_university,
      payloadKeys: Object.keys(payload),
      canonicalKeys: Object.keys(canonical)
    });
    
    sendToAPI(payload).then(result => {
      console.log('[Vetted Extension] API response:', result);
      if (result.success) {
        // Show success badge
        chrome.action.setBadgeText({ text: '✓' });
        chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
        // Clear badge after 3 seconds
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '' });
        }, 3000);
      } else {
        // Show error badge
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
      }
      
      // Store data for popup viewing (user can review/edit)
      chrome.storage.local.set({
        scrapedData: data,
        linkedinUrl: linkedinUrl,
        canonicalData: canonical,
        lastResult: result,
        lastScrapeTime: Date.now()
      }, () => {
        console.log('[Vetted Extension] Data stored for popup viewing:', {
          name: canonical.full_name,
          company: canonical.current_company,
          title: canonical.current_title,
          education: {
            undergrad: canonical.undergrad_university,
            masters: canonical.secondary_university,
            phd: canonical.phd_university
          }
        });
        
        // Update badge to show data is ready for review
        if (result.success) {
          chrome.action.setBadgeText({ text: '✓' });
          chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
        } else {
          chrome.action.setBadgeText({ text: '!' });
          chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
        }
      });
      
      sendResponse(result);
    });
    
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'sendToDatabase') {
    // Manual send from popup (if user wants to re-send after editing)
    const payload: IngestPayload = {
      linkedin_url: message.linkedinUrl,
      raw_json: message.rawJson,
      canonical_json: message.canonicalJson
    };
    
    sendToAPI(payload).then(result => {
      sendResponse(result);
    });
    
    return true; // Keep channel open for async response
  }
});

