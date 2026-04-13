// Fixed Supabase Edge Function for /functions/v1/ingest
// Deploy this to: Supabase Dashboard → Edge Functions → ingest

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Use POST", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const body = await req.json().catch(() => null);
  if (!body?.linkedin_url) {
    return new Response("Missing linkedin_url", { status: 400 });
  }

  // FIX: Extract full_name from canonical_json instead of top-level body
  const { data, error } = await supabase.rpc("upsert_profile_from_snapshot", {
    p_linkedin_url: body.linkedin_url,
    p_full_name: body.canonical_json?.full_name ?? null,  // ✅ Fixed: was body.full_name
    p_raw_json: body.raw_json ?? null,
    p_canonical_json: body.canonical_json ?? null,
  });

  if (error) return new Response(error.message, { status: 400 });

  return new Response(JSON.stringify({ profile_id: data }), {
    headers: { "content-type": "application/json" },
  });
});
