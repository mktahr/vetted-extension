# Deployment Instructions - Fix LinkedIn Profile Data Population

## Problem
Profile data from LinkedIn scraper is not populating in the database because the database function only inserts 3 fields instead of all 15+ fields.

## Solution Overview
1. Fix the Supabase Edge Function to extract `full_name` correctly
2. Replace the database RPC function with a complete version that extracts ALL fields

---

## Step 1: Update Supabase Edge Function

### Option A: Via Supabase CLI (Recommended)
```bash
# Navigate to your Supabase project
cd /path/to/your/supabase/project

# Copy the fixed edge function
cp /Users/matt/Desktop/DEV/vetted-extension/FIXES/edge-function-fix.ts supabase/functions/ingest/index.ts

# Deploy the function
supabase functions deploy ingest
```

### Option B: Via Supabase Dashboard
1. Go to your Supabase Dashboard
2. Click **Edge Functions** in the left sidebar
3. Find the `ingest` function
4. Click **Edit**
5. Replace the entire content with the code from `edge-function-fix.ts`
6. Click **Deploy**

**Key Change:**
```typescript
// OLD (broken):
p_full_name: body.full_name ?? null,

// NEW (fixed):
p_full_name: body.canonical_json?.full_name ?? null,
```

---

## Step 2: Update Database RPC Function

### Via Supabase SQL Editor
1. Go to your Supabase Dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the entire contents of `database-function-fix.sql`
5. Paste into the SQL Editor
6. Click **Run** (or press `Cmd+Enter`)
7. You should see a success message and the function details at the bottom

**What this does:**
- Creates/replaces the `upsert_profile_from_snapshot` function
- Extracts ALL 15+ fields from `canonical_json`:
  - ✅ linkedin_url
  - ✅ full_name
  - ✅ location_resolved
  - ✅ current_company
  - ✅ current_title
  - ✅ years_experience
  - ✅ years_at_current_company
  - ✅ undergrad_university
  - ✅ secondary_university
  - ✅ phd_university
  - ✅ focus_area_tags (array)
  - ✅ skills_tags (array)
  - ✅ excellence_tags (array)
  - ✅ domain_tags (array)
  - ✅ notes
- Preserves both `raw_json` and `canonical_json` in snapshots
- Updates `updated_at` timestamp on conflicts
- Uses smart merging (doesn't overwrite existing data with nulls)

---

## Step 3: Verify the Fix

### Test with a LinkedIn Profile
1. Open Chrome and go to any LinkedIn profile
   - Example: https://www.linkedin.com/in/lennyrachitsky/
2. Click the **"📥 Scrape Profile"** button
3. Open Chrome DevTools (F12) → Console
4. You should see:
   ```
   [Vetted Extension] API response status: 200
   [Vetted Extension] API success response: {profile_id: 'xxx-xxx-xxx'}
   ```

### Check the Database
1. Go to Supabase Dashboard → **Table Editor**
2. Click on the **profiles** table
3. Find the most recent entry (sort by `created_at` descending)
4. **Verify ALL fields are populated:**
   - ✅ full_name: "Lenny Rachitsky"
   - ✅ location_resolved: "United States"
   - ✅ current_company: "Lenny's Newsletter · Full-time"
   - ✅ current_title: (may be null if not available)
   - ✅ years_experience: 33
   - ✅ years_at_current_company: 7
   - ✅ undergrad_university: "UC San Diego"
   - ✅ secondary_university: (null if none)
   - ✅ phd_university: (null if none)

### Check the Snapshots
1. Click on the **profile_snapshots** table
2. Find the matching entry (same `profile_id`)
3. **Verify JSON storage:**
   - ✅ raw_json: Contains complete scraped data
   - ✅ canonical_json: Contains normalized profile data

---

## Step 4: Clean Up (Optional)

### Remove Duplicate Function (if it exists)
If you have two versions of `upsert_profile_from_snapshot`, the `CREATE OR REPLACE` should have overwritten it. To verify:

```sql
-- Check how many versions exist
SELECT
  proname,
  pg_get_function_arguments(oid) as args
FROM pg_proc
WHERE proname = 'upsert_profile_from_snapshot';
```

If you see multiple entries with different signatures, drop the old one:
```sql
-- Replace with the actual old signature
DROP FUNCTION IF EXISTS upsert_profile_from_snapshot(text, jsonb, jsonb);
```

---

## Troubleshooting

### Issue: Function doesn't update after running SQL
**Solution:**
- Refresh the Supabase Dashboard page
- Check the **Database** → **Functions** page to see the function details
- Try running the query again

### Issue: Still seeing only 3 fields populated
**Possible causes:**
1. Edge Function wasn't deployed (check Edge Functions deployment log)
2. Database function didn't update (verify in SQL Editor)
3. Browser cache (hard refresh: Cmd+Shift+R)

**Debug steps:**
```sql
-- Check the function definition
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'upsert_profile_from_snapshot';
```

### Issue: Error when running SQL
**Common errors:**
- `relation "profiles" does not exist` → Check table name capitalization
- `column "xyz" does not exist` → Verify your schema matches the function
- `function already exists` → Use `CREATE OR REPLACE` instead of `CREATE`

---

## Validation Checklist

After deployment, verify:
- [ ] Edge Function deployed successfully
- [ ] Database function shows in Functions list
- [ ] Test scrape returns 200 success
- [ ] Profile appears in `profiles` table
- [ ] ALL fields are populated (not just linkedin_url and full_name)
- [ ] Snapshot appears in `profile_snapshots` table
- [ ] Both `raw_json` and `canonical_json` are populated in snapshot
- [ ] Re-scraping same profile updates existing record (no duplicate)
- [ ] `updated_at` timestamp changes on re-scrape

---

## Rollback (if needed)

If something goes wrong, you can rollback to the old version:

### Rollback Edge Function
Deploy the previous version from your Supabase Edge Functions deployment history.

### Rollback Database Function
```sql
-- Minimal version (old broken one)
CREATE OR REPLACE FUNCTION public.upsert_profile_from_snapshot(
  p_linkedin_url text,
  p_full_name text,
  p_raw_json jsonb,
  p_canonical_json jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  INSERT INTO public.profiles (linkedin_url, full_name, current_title)
  VALUES (p_linkedin_url, COALESCE(p_canonical_json->>'full_name', p_full_name), p_canonical_json->>'current_title')
  ON CONFLICT (linkedin_url) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    current_title = COALESCE(EXCLUDED.current_title, profiles.current_title)
  RETURNING id INTO v_profile_id;

  INSERT INTO public.profile_snapshots (profile_id, raw_json, canonical_json)
  VALUES (v_profile_id, p_raw_json, p_canonical_json);

  RETURN v_profile_id;
END;
$$;
```

---

## Next Steps (Future Enhancements)

After confirming this fix works, consider:
1. **Enhance scraping** - Extract degree types and fields of study from LinkedIn education sections
2. **Add validation** - Email format validation, URL validation, etc.
3. **Improve duplicate detection** - Match profiles by name similarity even if URLs differ
4. **Add data quality scores** - Track completeness percentage per profile

---

## Support

If you encounter issues:
1. Check the browser console for extension errors
2. Check Supabase Edge Function logs (Dashboard → Edge Functions → ingest → Logs)
3. Check Supabase database logs (Dashboard → Logs)
4. Verify the SQL function definition matches the expected version
