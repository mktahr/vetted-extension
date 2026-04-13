# LinkedIn Profile Data Population Fix

## 🎯 Quick Summary

**Problem:** Chrome extension scrapes data correctly and API returns success, but only 3 fields populate in the database instead of all 15+ fields.

**Root Cause:** Database function only extracts `linkedin_url`, `full_name`, and `current_title` from the payload.

**Solution:** Deploy two fixes to extract ALL fields from `canonical_json`.

---

## 📦 Files in this Directory

1. **`edge-function-fix.ts`** - Fixed Supabase Edge Function
   - Extracts `full_name` from `canonical_json` correctly

2. **`database-function-fix.sql`** - Complete database RPC function
   - Extracts ALL 15+ fields from `canonical_json`
   - Handles arrays, numeric conversions, and null values

3. **`DEPLOYMENT_INSTRUCTIONS.md`** - Step-by-step deployment guide
   - How to deploy the Edge Function
   - How to run the SQL fix
   - How to test and verify
   - Troubleshooting tips

---

## ⚡ Quick Start (5 minutes)

### Step 1: Deploy Database Function (2 min)
```
1. Open Supabase Dashboard
2. Go to SQL Editor
3. Copy contents of database-function-fix.sql
4. Paste and Run
```

### Step 2: Deploy Edge Function (2 min)
```
1. Open Supabase Dashboard
2. Go to Edge Functions → ingest
3. Copy contents of edge-function-fix.ts
4. Replace all code and Deploy
```

### Step 3: Test (1 min)
```
1. Go to any LinkedIn profile
2. Click "📥 Scrape Profile" button
3. Check database - ALL fields should now populate!
```

---

## ✅ What Gets Fixed

After deploying, these fields will populate correctly:

**Currently Working:**
- ✅ linkedin_url
- ✅ full_name

**Currently Broken → Fixed:**
- ✅ location_resolved
- ✅ current_company
- ✅ current_title
- ✅ years_experience
- ✅ years_at_current_company
- ✅ undergrad_university
- ✅ secondary_university
- ✅ phd_university
- ✅ skills_tags (array)
- ✅ focus_area_tags (array)
- ✅ excellence_tags (array)
- ✅ domain_tags (array)
- ✅ notes

**Already Working (unchanged):**
- ✅ raw_json in profile_snapshots
- ✅ canonical_json in profile_snapshots

---

## 🔍 What Changed

### Edge Function Change
```typescript
// BEFORE (broken):
p_full_name: body.full_name ?? null,  // ❌ undefined

// AFTER (fixed):
p_full_name: body.canonical_json?.full_name ?? null,  // ✅ "Lenny Rachitsky"
```

### Database Function Change
```sql
-- BEFORE (broken):
INSERT INTO profiles (linkedin_url, full_name, current_title)  -- Only 3 fields

-- AFTER (fixed):
INSERT INTO profiles (
  linkedin_url, full_name, location_resolved, current_company,
  current_title, years_experience, years_at_current_company,
  undergrad_university, secondary_university, phd_university,
  focus_area_tags, skills_tags, excellence_tags, domain_tags, notes
)  -- ALL 15 fields
```

---

## 📋 Deployment Checklist

- [ ] Read `DEPLOYMENT_INSTRUCTIONS.md`
- [ ] Deploy `database-function-fix.sql` to Supabase
- [ ] Deploy `edge-function-fix.ts` to Supabase
- [ ] Test scrape on a LinkedIn profile
- [ ] Verify all fields populate in database
- [ ] Verify both JSON blobs are stored in snapshots
- [ ] Re-scrape same profile to test update logic

---

## 🆘 Need Help?

See `DEPLOYMENT_INSTRUCTIONS.md` for:
- Detailed deployment steps
- Troubleshooting guide
- Validation checklist
- Rollback instructions

---

## 🚀 Future Enhancements

After this fix works, consider enhancing the scraper to extract:
- Degree types (Bachelor's, Master's, PhD, MBA)
- Fields of study (Computer Science, Business, etc.)
- More granular company information
- Certifications and languages

The database schema already has columns for degree/field info:
- `undergrad_degree`, `undergrad_field`
- `secondary_degree`, `secondary_field`
- `phd_degree`, `phd_field`

These just need the Chrome extension scraper to be enhanced.
