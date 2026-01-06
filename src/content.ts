// Content script for scraping LinkedIn profile data

interface ScrapedData {
  name?: string;
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

function extractText(selector: string): string | null {
  const element = document.querySelector(selector);
  return element?.textContent?.trim() || null;
}

function extractAllText(selector: string): string[] {
  const elements = document.querySelectorAll(selector);
  return Array.from(elements).map(el => el.textContent?.trim()).filter(Boolean) as string[];
}

function extractYearsFromText(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d+)\+?\s*years?/i);
  return match ? parseInt(match[1], 10) : null;
}

// Parse date range and calculate years (e.g., "Jan 2020 - Present" or "Jan 2020 - Dec 2023")
function calculateYearsFromDateRange(dateRange: string | null): number | null {
  if (!dateRange) return null;
  
  // Remove extra whitespace and normalize
  const normalized = dateRange.trim().replace(/\s+/g, ' ');
  
  // Match patterns like "Jan 2020 - Present", "Jan 2020 - Dec 2023", "2020 - 2023"
  const patterns = [
    /(\w+)\s+(\d{4})\s*-\s*(?:Present|Now|Current)/i,
    /(\w+)\s+(\d{4})\s*-\s*(\w+)\s+(\d{4})/i,
    /(\d{4})\s*-\s*(?:Present|Now|Current)/i,
    /(\d{4})\s*-\s*(\d{4})/i
  ];
  
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      let startDate: Date | null = null;
      let endDate: Date = new Date(); // Default to now for "Present"
      
      if (match[1] && match[2]) {
        // Has month and year
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthIndex = monthNames.findIndex(m => match[1].toLowerCase().startsWith(m));
        if (monthIndex !== -1) {
          startDate = new Date(parseInt(match[2]), monthIndex, 1);
        }
      } else if (match[1] && /^\d{4}$/.test(match[1])) {
        // Just year
        startDate = new Date(parseInt(match[1]), 0, 1);
      }
      
      if (match[3] && match[4] && !/present|now|current/i.test(match[3])) {
        // Has end date
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthIndex = monthNames.findIndex(m => match[3].toLowerCase().startsWith(m));
        if (monthIndex !== -1) {
          endDate = new Date(parseInt(match[4]), monthIndex, 1);
        }
      } else if (match[2] && /^\d{4}$/.test(match[2]) && !/present|now|current/i.test(normalized)) {
        // Just end year
        endDate = new Date(parseInt(match[2]), 11, 31);
      }
      
      if (startDate) {
        const years = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
        return Math.round(years * 10) / 10; // Round to 1 decimal place
      }
    }
  }
  
  return null;
}

// Check if a role is an internship
function isInternship(title: string | null | undefined): boolean {
  if (!title) return false;
  const titleLower = title.toLowerCase();
  return titleLower.includes('intern') || 
         titleLower.includes('internship') ||
         titleLower.includes('co-op') ||
         titleLower.includes('coop');
}

function scrapeProfile(): ScrapedData {
  const data: ScrapedData = {};

  // Name extraction with exact fallback chain as specified
  let fullName: string = '';
  
  // First try: h1 innerText
  const h1Element = document.querySelector('h1');
  if (h1Element?.innerText) {
    fullName = h1Element.innerText;
  }
  
  // If empty: meta og:title
  if (!fullName || fullName.trim().length === 0) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    if (ogTitle) {
      fullName = ogTitle.split(' - ')[0];
    }
  }
  
  // If still empty: document.title
  if (!fullName || fullName.trim().length === 0) {
    const title = document.title;
    if (title) {
      // Split on " | " then " - " and take first part
      const parts = title.split(' | ')[0].split(' - ')[0];
      fullName = parts;
    }
  }
  
  // Clean up: trim and replace newlines with spaces
  if (fullName) {
    fullName = fullName.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
  }
  
  // Final safety check: if still empty, use URL fallback
  if (!fullName || fullName.trim().length === 0) {
    const urlMatch = window.location.href.match(/\/in\/([^\/\?]+)/);
    if (urlMatch && urlMatch[1]) {
      // Convert URL slug to readable name (e.g., "john-doe" -> "John Doe")
      fullName = urlMatch[1]
        .split('-')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
  }
  
  // Store as fullName (and also as name for backward compatibility)
  data.fullName = fullName || '';
  data.name = fullName || '';
  
  console.log('[Vetted Extension] Name extraction result:', {
    extractedName: fullName,
    hasName: !!fullName && fullName.length > 0,
    url: window.location.href
  });

  // Extract location with multiple selectors (LinkedIn changes HTML frequently)
  const locationSelectors = [
    '.text-body-small.inline.t-black--light.break-words',
    '.pv-text-details__left-panel .text-body-small',
    '[data-test-id="location"]',
    '.pv-text-details__left-panel span.text-body-small',
    'span.text-body-small.inline',
    '.top-card-layout__entity-info span',
    '.ph5.pb5 span.text-body-small',
    'main section span.text-body-small'
  ];
  
  for (const selector of locationSelectors) {
    const location = extractText(selector);
    if (location && location.length > 0 && !location.includes('•') && location.length < 100) {
      data.location = location;
      break;
    }
  }
  
  // Also try to find location near the name
  if (!data.location) {
    const nameElement = document.querySelector('h1');
    if (nameElement) {
      const parent = nameElement.parentElement;
      if (parent) {
        const locationElements = parent.querySelectorAll('span, div');
        for (const el of Array.from(locationElements)) {
          const text = el.textContent?.trim();
          if (text && text.length > 0 && text.length < 100 && 
              !text.includes('•') && 
              !text.includes('@') &&
              (text.includes(',') || text.split(' ').length <= 4)) {
            data.location = text;
            break;
          }
        }
      }
    }
  }

  // Extract current title and company from experience section
  const experienceSection = document.querySelector('#experience')?.closest('section') ||
                            document.querySelector('[data-section="experience"]');
  
  if (experienceSection) {
    const firstExperience = experienceSection.querySelector('li:first-child') ||
                           experienceSection.querySelector('[data-chameleon-result-urn]') ||
                           experienceSection.querySelector('ul > li');
    
    if (firstExperience) {
      // Use innerText to avoid hidden duplicates, and try multiple selectors
      const titleSelectors = [
        'h3',
        '.t-14.t-bold',
        '[data-field="title"]',
        '.t-16.t-black.t-bold',
        'span.t-16.t-black.t-bold'
      ];
      
      let title: string | undefined = undefined;
      for (const selector of titleSelectors) {
        const element = firstExperience.querySelector(selector);
        if (element) {
          // Use innerText to avoid duplicates from hidden elements
          const text = (element as HTMLElement).innerText?.trim() || element.textContent?.trim();
          if (text && text.length > 0 && text.length < 200) {
            // Remove duplicates (if text appears twice, take first occurrence)
            const words = text.split(/\s+/);
            const uniqueWords: string[] = [];
            const seen = new Set<string>();
            for (const word of words) {
              const key = word.toLowerCase();
              if (!seen.has(key)) {
                seen.add(key);
                uniqueWords.push(word);
              }
            }
            title = uniqueWords.join(' ');
            if (title.length > 0) break;
          }
        }
      }
      
      data.currentTitle = title;
      
      data.currentCompany = firstExperience.querySelector('.t-14.t-normal span')?.textContent?.trim() ||
                           firstExperience.querySelector('.pv-entity__secondary-title')?.textContent?.trim() ||
                           firstExperience.querySelector('[data-field="company"]')?.textContent?.trim() ||
                           firstExperience.querySelector('span.t-14.t-normal')?.textContent?.trim() ||
                           undefined;
      
      // Extract years at current company from date range
      const dateRangeSelectors = [
        '.t-14.t-normal.t-black--light',
        '.pv-entity__bullet-item-v2',
        '[data-field="dateRange"]',
        '.pv-entity__date-range span',
        '.t-14.t-normal span',
        'span.t-14.t-normal.t-black--light'
      ];
      
      let dateRange: string | null = null;
      for (const selector of dateRangeSelectors) {
        const element = firstExperience.querySelector(selector);
        if (element?.textContent) {
          dateRange = element.textContent.trim();
          if (dateRange && (dateRange.includes('-') || dateRange.includes('Present') || dateRange.includes('Now'))) {
            break;
          }
        }
      }
      
      // If no date range found in specific selectors, try the whole experience item
      if (!dateRange || !dateRange.includes('-')) {
        const fullText = firstExperience.textContent || '';
        const dateMatch = fullText.match(/(\w+\s+\d{4}|\d{4})\s*-\s*(\w+\s+\d{4}|\d{4}|Present|Now|Current)/i);
        if (dateMatch) {
          dateRange = dateMatch[0];
        }
      }
      
      if (dateRange) {
        // First try to find explicit "X years" text
        const yearsMatch = dateRange.match(/(\d+)\+?\s*years?/i);
        if (yearsMatch) {
          data.experience = data.experience || {};
          data.experience.yearsAtCurrent = parseInt(yearsMatch[1], 10);
        } else {
          // Calculate from date range
          const years = calculateYearsFromDateRange(dateRange);
          if (years !== null) {
            data.experience = data.experience || {};
            data.experience.yearsAtCurrent = Math.round(years);
          }
        }
      }
    }
  }

  // Extract education with improved selectors
  const educationSection = document.querySelector('#education')?.closest('section') ||
                          document.querySelector('[data-section="education"]') ||
                          document.querySelector('section[aria-labelledby*="education"]') ||
                          document.querySelector('section[aria-label*="Education"]');
  
  console.log('[Vetted Extension] Education section found:', !!educationSection);
  
  if (educationSection) {
    // Try multiple selector strategies
    let educationItems: NodeListOf<Element> | Element[] = educationSection.querySelectorAll('li');
    if (educationItems.length === 0) {
      educationItems = educationSection.querySelectorAll('[data-chameleon-result-urn]');
    }
    if (educationItems.length === 0) {
      educationItems = educationSection.querySelectorAll('.pvs-list__paged-list-item');
    }
    if (educationItems.length === 0) {
      educationItems = educationSection.querySelectorAll('.pvs-entity');
    }
    
    const education: { undergraduate?: string; masters?: string; phd?: string } = {};
    const schools: Array<{ name: string; degree?: string }> = [];
    
    console.log('[Vetted Extension] Education items found:', educationItems.length);
    
    Array.from(educationItems).forEach((item, index) => {
      const schoolSelectors = [
        'h3',
        '.pv-entity__school-name',
        '[data-field="school"]',
        '.t-16.t-black.t-bold',
        'span.t-16.t-black.t-bold',
        '.pvs-entity__summary-info h3',
        '.pvs-entity__summary-info-v2 h3',
        'a[data-field="school_name"]',
        'span[data-field="school_name"]'
      ];
      
      let schoolName: string | null = null;
      for (const selector of schoolSelectors) {
        const element = item.querySelector(selector);
        if (element) {
          // Use innerText to avoid hidden duplicates
          const text = (element as HTMLElement).innerText?.trim() || element.textContent?.trim();
          if (text && text.length > 0 && text.length < 200) {
            schoolName = text;
            break;
          }
        }
      }
      
      // If no school name found, try getting text from the whole item
      if (!schoolName) {
        const itemText = (item as HTMLElement).innerText || item.textContent || '';
        // Look for patterns like "School Name" or "University Name"
        const lines = itemText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
        if (lines.length > 0 && lines[0].length < 200) {
          schoolName = lines[0];
        }
      }
      
      const degreeSelectors = [
        '.pv-entity__degree-name',
        '.t-14.t-normal span',
        '[data-field="degree"]',
        '.t-14.t-black.t-normal span',
        'span.t-14.t-black.t-normal',
        '.pvs-entity__summary-info .t-14',
        '.pvs-entity__summary-info-v2 .t-14',
        'a[data-field="degree_name"]',
        'span[data-field="degree_name"]'
      ];
      
      let degree: string | null = null;
      for (const selector of degreeSelectors) {
        const element = item.querySelector(selector);
        if (element) {
          const text = (element as HTMLElement).innerText?.trim() || element.textContent?.trim();
          if (text && text.length > 0 && text.length < 200) {
            degree = text;
            break;
          }
        }
      }
      
      if (schoolName) {
        schools.push({ name: schoolName, degree: degree || undefined });
        console.log(`[Vetted Extension] Education item ${index + 1}:`, { schoolName, degree });
      }
    });
    
    // Process schools and categorize by degree level
    schools.forEach((school) => {
      const degreeText = (school.degree || '').toLowerCase();
      
      if (degreeText.includes('phd') || degreeText.includes('doctor') || degreeText.includes('ph.d')) {
        if (!education.phd) education.phd = school.name;
      } else if (degreeText.includes('master') || degreeText.includes('mba') || 
                 degreeText.includes('ms') || degreeText.includes('ma') ||
                 degreeText.includes('m.s') || degreeText.includes('m.a')) {
        if (!education.masters) education.masters = school.name;
      } else if (degreeText.includes('bachelor') || degreeText.includes('bs') || 
                 degreeText.includes('ba') || degreeText.includes('b.s') || 
                 degreeText.includes('b.a') || degreeText.includes('undergrad')) {
        if (!education.undergraduate) education.undergraduate = school.name;
      }
    });
    
    // If only one school and no degree level specified, default to undergraduate
    if (schools.length === 1 && !schools[0].degree) {
      if (!education.undergraduate && !education.masters && !education.phd) {
        education.undergraduate = schools[0].name;
      }
    } else if (schools.length > 0 && Object.keys(education).length === 0) {
      // If we have schools but couldn't categorize, default first to undergrad
      education.undergraduate = schools[0].name;
    }
    
    if (Object.keys(education).length > 0) {
      data.education = education;
      console.log('[Vetted Extension] Final education data:', education);
    } else if (schools.length > 0) {
      // Fallback: if we found schools but couldn't categorize, use first as undergrad
      data.education = { undergraduate: schools[0].name };
      console.log('[Vetted Extension] Using fallback education (first school as undergrad):', data.education);
    } else {
      console.log('[Vetted Extension] No education data found');
    }
  } else {
    console.log('[Vetted Extension] Education section not found on page');
  }

  // Extract skills
  const skillsSection = document.querySelector('#skills')?.closest('section') ||
                       document.querySelector('[data-section="skills"]');
  
  if (skillsSection) {
    const skills = extractAllText('.pv-skill-category-entity__name') ||
                  extractAllText('.pv-skill-entity__skill-name') ||
                  extractAllText('[data-test-id="skill"]');
    
    if (skills.length > 0) {
      data.skills = skills;
    }
  }

  // Calculate total years of experience from all roles (excluding internships)
  if (experienceSection) {
    const allExperiences = Array.from(experienceSection.querySelectorAll('li') || 
                                     experienceSection.querySelectorAll('[data-chameleon-result-urn]') ||
                                     experienceSection.querySelectorAll('.pvs-list__paged-list-item'));
    
    let totalYears = 0;
    const dateRanges: Array<{ start: Date; end: Date }> = [];
    
    allExperiences.forEach((expItem) => {
      // Get title to check if it's an internship
      const titleSelectors = [
        'h3',
        '.t-14.t-bold',
        '[data-field="title"]',
        'span.t-14.t-bold',
        '.t-16.t-black.t-bold'
      ];
      
      let title: string | null = null;
      for (const selector of titleSelectors) {
        const element = expItem.querySelector(selector);
        if (element?.textContent) {
          title = element.textContent.trim();
          if (title) break;
        }
      }
      
      // Skip internships
      if (isInternship(title)) {
        return;
      }
      
      // Extract date range
      const dateRangeSelectors = [
        '.t-14.t-normal.t-black--light',
        '.pv-entity__bullet-item-v2',
        '[data-field="dateRange"]',
        '.pv-entity__date-range span',
        '.t-14.t-normal span',
        'span.t-14.t-normal.t-black--light'
      ];
      
      let dateRange: string | null = null;
      for (const selector of dateRangeSelectors) {
        const element = expItem.querySelector(selector);
        if (element?.textContent) {
          dateRange = element.textContent.trim();
          if (dateRange && (dateRange.includes('-') || dateRange.includes('Present') || dateRange.includes('Now'))) {
            break;
          }
        }
      }
      
      // If no date range found, try full text
      if (!dateRange || !dateRange.includes('-')) {
        const fullText = expItem.textContent || '';
        const dateMatch = fullText.match(/(\w+\s+\d{4}|\d{4})\s*-\s*(\w+\s+\d{4}|\d{4}|Present|Now|Current)/i);
        if (dateMatch) {
          dateRange = dateMatch[0];
        }
      }
      
      if (dateRange) {
        const years = calculateYearsFromDateRange(dateRange);
        if (years !== null && years > 0) {
          totalYears += years;
        }
      }
    });
    
    // Round to nearest whole number
    if (totalYears > 0) {
      data.experience = data.experience || {};
      data.experience.years = Math.round(totalYears);
    }
  }
  
  // Also try to extract from summary if available (as fallback)
  if (!data.experience?.years) {
    const summary = extractText('.pv-about__summary-text') ||
                   extractText('.inline-show-more-text') ||
                   extractText('[data-test-id="summary"]');
    
    if (summary) {
      const yearsExp = extractYearsFromText(summary);
      if (yearsExp) {
        data.experience = data.experience || {};
        data.experience.years = yearsExp;
      }
    }
  }

  // Store raw HTML structure for additional parsing
  data.rawHtml = {
    name: document.querySelector('h1')?.outerHTML || null,
    location: document.querySelector('.text-body-small')?.outerHTML || null,
    experience: experienceSection?.outerHTML || null,
    education: educationSection?.outerHTML || null,
    skills: skillsSection?.outerHTML || null
  };

  // Log what we scraped for debugging
  console.log('[Vetted Extension] Scraped profile data:', {
    name: data.name,
    location: data.location,
    currentTitle: data.currentTitle,
    currentCompany: data.currentCompany,
    education: data.education,
    skills: data.skills?.length || 0,
    experience: data.experience
  });

  return data;
}

// Inject button into LinkedIn page
function injectScrapeButton() {
  // Check if button already exists
  if (document.getElementById('vetted-scrape-btn')) {
    return;
  }

  const button = document.createElement('button');
  button.id = 'vetted-scrape-btn';
  button.textContent = '📥 Download Profile';
  button.className = 'vetted-scrape-button';
  
  button.addEventListener('click', (e) => {
    // Prevent event from bubbling to LinkedIn's native buttons
    e.stopPropagation();
    e.preventDefault();
    
    // Show loading state
    button.textContent = '⏳ Downloading...';
    button.disabled = true;
    
    console.log('[Vetted Extension] Button clicked, starting scrape...');
    const scrapedData = scrapeProfile();
    const linkedinUrl = window.location.href;
    
    console.log('[Vetted Extension] Scraped data:', scrapedData);
    console.log('[Vetted Extension] LinkedIn URL:', linkedinUrl);
    
    // Send message to background script
    chrome.runtime.sendMessage({
      action: 'scrapeComplete',
      data: scrapedData,
      linkedinUrl: linkedinUrl
    }, (response) => {
      console.log('[Vetted Extension] Response from background:', response);
      
      // Reset button immediately (don't wait for API)
      button.textContent = '📥 Download Profile';
      button.disabled = false;
      
      if (chrome.runtime.lastError) {
        console.error('[Vetted Extension] Error sending message:', chrome.runtime.lastError);
        button.textContent = '❌ Error';
        setTimeout(() => {
          button.textContent = '📥 Download Profile';
        }, 2000);
      } else if (response && response.success) {
        // Show success briefly
        button.textContent = '✓ Downloaded';
        setTimeout(() => {
          button.textContent = '📥 Download Profile';
        }, 2000);
      }
    });
  });

  // Create container to prevent conflicts
  const container = document.createElement('div');
  container.id = 'vetted-scrape-container';
  container.appendChild(button);
  
  // Try multiple injection points for better compatibility
  // Try to find the profile intro section (newer LinkedIn layout)
  const profileIntro = document.querySelector('.pv-text-details__left-panel') ||
                       document.querySelector('[data-test-id="profile-intro"]') ||
                       document.querySelector('.ph5.pb5') ||
                       document.querySelector('main section');
  
  if (profileIntro) {
    // Try to insert after the name/title section
    const nameSection = profileIntro.querySelector('h1')?.closest('div') ||
                       profileIntro.querySelector('.text-heading-xlarge')?.parentElement;
    
    if (nameSection && nameSection.nextSibling) {
      nameSection.parentElement?.insertBefore(container, nameSection.nextSibling);
    } else if (nameSection) {
      nameSection.parentElement?.appendChild(container);
    } else {
      // Insert at the beginning of the profile intro
      profileIntro.insertBefore(container, profileIntro.firstChild);
    }
  } else {
    // Fallback: try to find main content area
    const mainContent = document.querySelector('main') || document.querySelector('#main');
    if (mainContent) {
      mainContent.insertBefore(container, mainContent.firstChild);
    } else {
      // Last resort: add to top of body
      document.body.insertBefore(container, document.body.firstChild);
    }
  }
}

// Wait for page to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectScrapeButton);
} else {
  injectScrapeButton();
}

// Also listen for navigation changes (LinkedIn uses SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    setTimeout(injectScrapeButton, 1000);
  }
}).observe(document, { subtree: true, childList: true });

