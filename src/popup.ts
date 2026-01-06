// Popup script for editing and submitting profile data

import { CanonicalProfile, RawProfile, IngestPayload } from './types';

interface FormData {
  linkedinUrl: string;
  fullName: string;
  location: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: string;
  yearsAtCurrent: string;
  undergradUniversity: string;
  secondaryUniversity: string;
  phdUniversity: string;
  skillsTags: string;
  focusAreaTags: string;
  excellenceTags: string;
  domainTags: string;
  notes: string;
}

function parseTags(tagString: string): string[] | null {
  if (!tagString || !tagString.trim()) return null;
  return tagString.split(',').map(tag => tag.trim()).filter(Boolean);
}

function parseNumber(value: string): number | null {
  if (!value || !value.trim()) return null;
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
}

function parseString(value: string): string | null {
  if (!value || !value.trim()) return null;
  return value.trim();
}

function getFormData(): FormData {
  return {
    linkedinUrl: (document.getElementById('linkedinUrl') as HTMLInputElement)?.value || '',
    fullName: (document.getElementById('fullName') as HTMLInputElement)?.value || '',
    location: (document.getElementById('location') as HTMLInputElement)?.value || '',
    currentTitle: (document.getElementById('currentTitle') as HTMLInputElement)?.value || '',
    currentCompany: (document.getElementById('currentCompany') as HTMLInputElement)?.value || '',
    yearsExperience: (document.getElementById('yearsExperience') as HTMLInputElement)?.value || '',
    yearsAtCurrent: (document.getElementById('yearsAtCurrent') as HTMLInputElement)?.value || '',
    undergradUniversity: (document.getElementById('undergradUniversity') as HTMLInputElement)?.value || '',
    secondaryUniversity: (document.getElementById('secondaryUniversity') as HTMLInputElement)?.value || '',
    phdUniversity: (document.getElementById('phdUniversity') as HTMLInputElement)?.value || '',
    skillsTags: (document.getElementById('skillsTags') as HTMLTextAreaElement)?.value || '',
    focusAreaTags: (document.getElementById('focusAreaTags') as HTMLTextAreaElement)?.value || '',
    excellenceTags: (document.getElementById('excellenceTags') as HTMLTextAreaElement)?.value || '',
    domainTags: (document.getElementById('domainTags') as HTMLTextAreaElement)?.value || '',
    notes: (document.getElementById('notes') as HTMLTextAreaElement)?.value || ''
  };
}

function formDataToCanonical(formData: FormData, originalRaw: RawProfile): CanonicalProfile {
  return {
    linkedin_url: formData.linkedinUrl,
    full_name: parseString(formData.fullName),
    location_resolved: parseString(formData.location),
    current_company: parseString(formData.currentCompany),
    current_title: parseString(formData.currentTitle),
    years_experience: parseNumber(formData.yearsExperience),
    years_at_current_company: parseNumber(formData.yearsAtCurrent),
    undergrad_university: parseString(formData.undergradUniversity),
    secondary_university: parseString(formData.secondaryUniversity),
    phd_university: parseString(formData.phdUniversity),
    skills_tags: parseTags(formData.skillsTags),
    focus_area_tags: parseTags(formData.focusAreaTags),
    excellence_tags: parseTags(formData.excellenceTags),
    domain_tags: parseTags(formData.domainTags),
    notes: parseString(formData.notes)
  };
}

function populateForm(canonical: CanonicalProfile, raw: RawProfile) {
  (document.getElementById('linkedinUrl') as HTMLInputElement).value = canonical.linkedin_url;
  (document.getElementById('fullName') as HTMLInputElement).value = canonical.full_name || '';
  (document.getElementById('location') as HTMLInputElement).value = canonical.location_resolved || '';
  (document.getElementById('currentTitle') as HTMLInputElement).value = canonical.current_title || '';
  (document.getElementById('currentCompany') as HTMLInputElement).value = canonical.current_company || '';
  (document.getElementById('yearsExperience') as HTMLInputElement).value = canonical.years_experience?.toString() || '';
  (document.getElementById('yearsAtCurrent') as HTMLInputElement).value = canonical.years_at_current_company?.toString() || '';
  (document.getElementById('undergradUniversity') as HTMLInputElement).value = canonical.undergrad_university || '';
  (document.getElementById('secondaryUniversity') as HTMLInputElement).value = canonical.secondary_university || '';
  (document.getElementById('phdUniversity') as HTMLInputElement).value = canonical.phd_university || '';
  (document.getElementById('skillsTags') as HTMLTextAreaElement).value = canonical.skills_tags?.join(', ') || '';
  (document.getElementById('focusAreaTags') as HTMLTextAreaElement).value = canonical.focus_area_tags?.join(', ') || '';
  (document.getElementById('excellenceTags') as HTMLTextAreaElement).value = canonical.excellence_tags?.join(', ') || '';
  (document.getElementById('domainTags') as HTMLTextAreaElement).value = canonical.domain_tags?.join(', ') || '';
  (document.getElementById('notes') as HTMLTextAreaElement).value = canonical.notes || '';
}

function showMessage(text: string, isError: boolean = false) {
  const messageEl = document.getElementById('message');
  if (!messageEl) return;
  
  messageEl.textContent = text;
  messageEl.className = `message ${isError ? 'error' : 'success'}`;
  messageEl.classList.remove('hidden');
  
  setTimeout(() => {
    messageEl.classList.add('hidden');
  }, 5000);
}

// Load data when popup opens
document.addEventListener('DOMContentLoaded', () => {
  const loadingEl = document.getElementById('loading');
  const editorEl = document.getElementById('editor');
  const emptyEl = document.getElementById('empty');
  
  chrome.storage.local.get(['scrapedData', 'linkedinUrl', 'canonicalData', 'lastResult', 'lastScrapeTime'], (result) => {
    if (loadingEl) loadingEl.classList.add('hidden');
    
    // Show last result if available
    if (result.lastResult) {
      if (result.lastResult.success) {
        showMessage('Profile successfully sent to database!', false);
      } else {
        showMessage(result.lastResult.message || 'Error sending profile', true);
      }
    }
    
    // Check if we have recent scraped data (within last 5 minutes)
    const hasRecentData = result.lastScrapeTime && (Date.now() - result.lastScrapeTime < 5 * 60 * 1000);
    
    if (result.scrapedData && result.canonicalData && result.linkedinUrl) {
      if (editorEl) editorEl.classList.remove('hidden');
      populateForm(result.canonicalData, result.scrapedData);
      
      // Log what we're showing
      console.log('[Vetted Extension] Popup showing scraped data:', {
        name: result.canonicalData.full_name,
        company: result.canonicalData.current_company,
        title: result.canonicalData.current_title,
        hasEducation: !!(result.canonicalData.undergrad_university || result.canonicalData.secondary_university || result.canonicalData.phd_university),
        skillsCount: result.canonicalData.skills_tags?.length || 0
      });
    } else {
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        emptyEl.innerHTML = '<p>No profile data found. Navigate to a LinkedIn profile page and click the "📥 Download Profile" button to scrape and send the profile data.</p>';
      }
    }
  });
  
  // Clear badge when popup opens
  chrome.action.setBadgeText({ text: '' });
  
  // Handle form submission
  const form = document.getElementById('profileForm') as HTMLFormElement;
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
      }
      
      // Get current stored data
      chrome.storage.local.get(['scrapedData', 'linkedinUrl'], (result) => {
        const formData = getFormData();
        const canonical = formDataToCanonical(formData, result.scrapedData || {});
        
        const payload: IngestPayload = {
          linkedin_url: canonical.linkedin_url,
          raw_json: result.scrapedData || {},
          canonical_json: canonical
        };
        
        // Send to background script
        chrome.runtime.sendMessage({
          action: 'sendToDatabase',
          linkedinUrl: canonical.linkedin_url,
          rawJson: payload.raw_json,
          canonicalJson: payload.canonical_json
        }, (response) => {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send to Database';
          }
          
          if (chrome.runtime.lastError) {
            showMessage(`Error: ${chrome.runtime.lastError.message}`, true);
          } else if (response && response.success) {
            showMessage(response.message, false);
            // Clear storage after successful send
            chrome.storage.local.remove(['scrapedData', 'linkedinUrl', 'canonicalData']);
            // Clear badge
            chrome.action.setBadgeText({ text: '' });
            // Close popup after 2 seconds
            setTimeout(() => {
              window.close();
            }, 2000);
          } else {
            showMessage(response?.message || 'Unknown error occurred', true);
          }
        });
      });
    });
  }
  
  // Handle cancel button
  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      window.close();
    });
  }
});

