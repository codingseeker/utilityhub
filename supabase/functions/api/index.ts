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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseKey) {
    return json(
      { error: "Supabase server environment is not configured" },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let body: Record<string, unknown> = {};
    if (req.method !== "GET") {
      body = await req.json();
    }
    const url = new URL(req.url);
    const action = String(
      body.action ?? url.pathname.split("/").filter(Boolean).at(-1) ?? "",
    ).toLowerCase();

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
        .upload(inputPath, bytes, {
          contentType: "application/octet-stream",
          upsert: false,
        });
      if (uploadError) return json({ error: uploadError.message }, 500);

      const { data: job, error: insertError } = await supabase.from("jobs")
        .insert({
          status: "pending",
          filename,
          input_path: inputPath,
        }).select("id").single();
      if (insertError || !job) {
        await supabase.storage.from("utilityhub-files").remove([inputPath]);
        return json(
          { error: insertError?.message ?? "Could not create job" },
          500,
        );
      }
      return json({ jobId: job.id });
    }

    if (action === "process") {
      const jobId = body.jobId ?? body.id ?? url.searchParams.get("jobId");
      if (typeof jobId !== "string" || !jobId) {
        return json({ error: "jobId is required" }, 400);
      }
      const { data: job, error: fetchError } = await supabase.from("jobs")
        .select("id, status, filename, input_path")
        .eq("id", jobId).single();
      if (fetchError || !job) return json({ error: "Job not found" }, 404);

      const { error: processingError } = await supabase.from("jobs").update({
        status: "processing",
      })
        .eq("id", jobId);
      if (processingError) return json({ error: processingError.message }, 500);

      const { data: file, error: downloadError } = await supabase.storage
        .from("utilityhub-files").download(job.input_path);
      if (downloadError || !file) {
        await supabase.from("jobs").update({ status: "pending" }).eq(
          "id",
          jobId,
        );
        return json({
          error: downloadError?.message ?? "Could not download input file",
        }, 500);
      }

      const resultPath = `results/${crypto.randomUUID()}-${
        safeFilename(job.filename) ?? "file"
      }`;
      const { error: resultError } = await supabase.storage.from(
        "utilityhub-files",
      )
        .upload(resultPath, new Uint8Array(await file.arrayBuffer()), {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (resultError) {
        await supabase.from("jobs").update({ status: "pending" }).eq(
          "id",
          jobId,
        );
        return json({ error: resultError.message }, 500);
      }

      const { data: updatedJob, error: doneError } = await supabase.from("jobs")
        .update({ status: "done", result_path: resultPath })
        .eq("id", jobId)
        .select("id, status, filename, result_path").single();
      if (doneError || !updatedJob) {
        return json(
          { error: doneError?.message ?? "Could not finish job" },
          500,
        );
      }
      return json({ job: updatedJob });
    }

    if (action === "status") {
      const jobId = body.jobId ?? body.id ?? url.searchParams.get("jobId");
      if (typeof jobId !== "string" || !jobId) {
        return json({ error: "jobId is required" }, 400);
      }
      const { data: job, error } = await supabase.from("jobs")
        .select(
          "id, status, filename, input_path, result_path, created_at, updated_at",
        )
        .eq("id", jobId).single();
      if (error || !job) return json({ error: "Job not found" }, 404);
      return json({ job });
    }

    if (action === "download") {
      const jobId = body.jobId ?? body.id ?? url.searchParams.get("jobId");
      if (typeof jobId !== "string" || !jobId) {
        return json({ error: "jobId is required" }, 400);
      }
      const { data: job, error } = await supabase.from("jobs")
        .select("id, filename, result_path")
        .eq("id", jobId).single();
      if (error || !job?.result_path) {
        return json({ error: "Result not found" }, 404);
      }
      const { data: signed, error: signError } = await supabase.storage
        .from("utilityhub-files").createSignedUrl(job.result_path, 60);
      if (signError || !signed) {
        return json({
          error: signError?.message ?? "Could not create download link",
        }, 500);
      }
      return json({ url: signed.signedUrl, fileName: job.filename });
    }

    if (action === "delete") {
      const jobId = body.jobId ?? body.id ?? url.searchParams.get("jobId");
      if (typeof jobId !== "string" || !jobId) {
        return json({ error: "jobId is required" }, 400);
      }
      const { data: job, error: fetchError } = await supabase.from("jobs")
        .select("id, input_path, result_path")
        .eq("id", jobId).single();
      if (fetchError || !job) return json({ error: "Job not found" }, 404);
      const paths = [job.input_path, job.result_path].filter(Boolean);
      if (paths.length) {
        const { error: storageError } = await supabase.storage.from(
          "utilityhub-files",
        ).remove(paths);
        if (storageError) return json({ error: storageError.message }, 500);
      }
      const { error: deleteError } = await supabase.from("jobs").delete().eq(
        "id",
        jobId,
      );
      if (deleteError) return json({ error: deleteError.message }, 500);
      return json({ deleted: true });
    }

    return json({ error: "Unknown action" }, 404);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Request failed",
    }, 400);
  }
});
