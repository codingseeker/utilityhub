import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeFilename(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  // Keep the object key to a single filename segment.
  const filename = value.trim().split(/[\\/]/).pop() ?? "";
  return filename && filename !== "." && filename !== ".." ? filename : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Missing bearer token" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: "Supabase environment is not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return json({ error: "Invalid token" }, 401);

  try {
    let body: Record<string, unknown> = {};
    if (req.method !== "GET") {
      body = await req.json();
    }
    const url = new URL(req.url);
    const action = String(body.action ?? url.pathname.split("/").filter(Boolean).at(-1) ?? "").toLowerCase();

    if (action === "upload") {
      const filename = safeFilename(body.filename);
      if (!filename || typeof body.file !== "string") {
        return json({ error: "filename and base64 file are required" }, 400);
      }
      const encoded = body.file.replace(/^data:[^,]*;base64,/, "");
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      } catch {
        return json({ error: "file must be valid base64" }, 400);
      }

      const inputPath = `uploads/${crypto.randomUUID()}-${filename}`;
      const { error: uploadError } = await supabase.storage
        .from("utilityhub-files")
        .upload(inputPath, bytes, { contentType: "application/octet-stream", upsert: false });
      if (uploadError) return json({ error: uploadError.message }, 500);

      const { data: job, error: insertError } = await supabase.from("jobs").insert({
        user_id: user.id,
        status: "pending",
        filename,
        input_path: inputPath,
      }).select("id").single();
      if (insertError || !job) {
        await supabase.storage.from("utilityhub-files").remove([inputPath]);
        return json({ error: insertError?.message ?? "Could not create job" }, 500);
      }
      return json({ jobId: job.id });
    }

    if (action === "process") {
      const jobId = body.jobId ?? body.id ?? url.searchParams.get("jobId");
      if (typeof jobId !== "string" || !jobId) return json({ error: "jobId is required" }, 400);
      const { data: job, error: fetchError } = await supabase.from("jobs")
        .select("id, user_id, status, filename, input_path")
        .eq("id", jobId).eq("user_id", user.id).single();
      if (fetchError || !job) return json({ error: "Job not found" }, 404);

      const { error: processingError } = await supabase.from("jobs").update({ status: "processing" })
        .eq("id", jobId).eq("user_id", user.id);
      if (processingError) return json({ error: processingError.message }, 500);

      const { data: file, error: downloadError } = await supabase.storage
        .from("utilityhub-files").download(job.input_path);
      if (downloadError || !file) {
        await supabase.from("jobs").update({ status: "pending" }).eq("id", jobId).eq("user_id", user.id);
        return json({ error: downloadError?.message ?? "Could not download input file" }, 500);
      }

      const resultPath = `results/${crypto.randomUUID()}-${safeFilename(job.filename) ?? "file"}`;
      const { error: resultError } = await supabase.storage.from("utilityhub-files")
        .upload(resultPath, new Uint8Array(await file.arrayBuffer()), {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (resultError) {
        await supabase.from("jobs").update({ status: "pending" }).eq("id", jobId).eq("user_id", user.id);
        return json({ error: resultError.message }, 500);
      }

      const { data: updatedJob, error: doneError } = await supabase.from("jobs")
        .update({ status: "done", result_path: resultPath })
        .eq("id", jobId).eq("user_id", user.id)
        .select("id, status, filename, result_path").single();
      if (doneError || !updatedJob) return json({ error: doneError?.message ?? "Could not finish job" }, 500);
      return json({ job: updatedJob });
    }

    if (action === "status") {
      const jobId = body.jobId ?? body.id ?? url.searchParams.get("jobId");
      if (typeof jobId !== "string" || !jobId) return json({ error: "jobId is required" }, 400);
      const { data: job, error } = await supabase.from("jobs")
        .select("id, status, filename, input_path, result_path, created_at, updated_at")
        .eq("id", jobId).eq("user_id", user.id).single();
      if (error || !job) return json({ error: "Job not found" }, 404);
      return json({ job });
    }

    return json({ error: "Unknown action" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 400);
  }
});
