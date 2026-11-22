import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type InputFile,
  normalizeOperation,
  processOperation,
} from "./processor.ts";

const BUCKET = "utilityhub-files";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 20;
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

function safeFilename(value: string): string {
  const name = value.trim().split(/[\\/]/).pop() ?? "";
  const safe = name.replace(/[\u0000-\u001f]/g, "_");
  return safe && safe !== "." && safe !== ".." ? safe : "upload.bin";
}

function objectPath(group: string, jobId: string, filename: string): string {
  return `${group}/${jobId}/${crypto.randomUUID()}-${filename}`;
}

function readParameters(
  value: FormDataEntryValue | null,
): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("parameters must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

async function handleJobRequest(
  req: Request,
  supabase: SupabaseClient<any, "public", any>,
): Promise<Response> {
  const url = new URL(req.url);
  let action = url.searchParams.get("action") ??
    url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  let fields: FormData | Record<string, unknown>;

  if (
    req.method === "POST" &&
    req.headers.get("content-type")?.includes("multipart/form-data")
  ) {
    fields = await req.formData();
    action = "process";
  } else if (req.method === "POST") {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "Expected a JSON object." }, 400);
    }
    fields = parsed as Record<string, unknown>;
    action = String(fields.action ?? action).toLowerCase();
  } else {
    fields = {};
  }

  const get = (name: string): unknown =>
    fields instanceof FormData ? fields.get(name) : fields[name];
  const getAll = (name: string): FormDataEntryValue[] =>
    fields instanceof FormData ? fields.getAll(name) : [];

  if (action === "status") {
    const id = String(get("jobId") ?? url.searchParams.get("jobId") ?? "");
    if (!id) return json({ error: "jobId is required." }, 400);
    const { data: job, error } = await supabase.from("jobs")
      .select(
        "id, status, filename, operation, parameters, result_path, result, error_message, created_at, updated_at",
      )
      .eq("id", id).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!job) return json({ error: "Job not found." }, 404);
    return json({ job });
  }

  if (action === "download") {
    const id = String(get("jobId") ?? url.searchParams.get("jobId") ?? "");
    if (!id) return json({ error: "jobId is required." }, 400);
    const { data: job, error } = await supabase.from("jobs")
      .select("id, filename, result_path, result")
      .eq("id", id).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!job?.result_path) return json({ error: "Result not found." }, 404);
    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET).createSignedUrl(job.result_path, 300);
    if (signError || !signed) {
      return json({
        error: signError?.message ?? "Could not create download link.",
      }, 500);
    }
    return json({
      url: signed.signedUrl,
      fileName: job.result?.fileName ?? job.filename,
    });
  }

  if (action === "delete") {
    const id = String(get("jobId") ?? url.searchParams.get("jobId") ?? "");
    if (!id) return json({ error: "jobId is required." }, 400);
    const { data: job, error: lookupError } = await supabase.from("jobs")
      .select("id, input_paths, input_path, result_path")
      .eq("id", id).maybeSingle();
    if (lookupError) return json({ error: lookupError.message }, 500);
    if (!job) return json({ error: "Job not found." }, 404);
    const paths = [
      ...new Set(
        [...(job.input_paths ?? []), job.input_path, job.result_path].filter(
          Boolean,
        ),
      ),
    ];
    if (paths.length) {
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) return json({ error: error.message }, 500);
    }
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    return error
      ? json({ error: error.message }, 500)
      : json({ deleted: true });
  }

  if (action !== "process") {
    return json({
      error: "Use multipart form data with operation, parameters, and files.",
    }, 400);
  }
  if (!(fields instanceof FormData)) {
    return json(
      { error: "Multipart form data is required for processing." },
      400,
    );
  }

  const rawOperation = get("operation");
  if (typeof rawOperation !== "string" || !rawOperation) {
    return json({ error: "operation is required." }, 400);
  }
  let operation: string;
  try {
    operation = normalizeOperation(rawOperation);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Unsupported operation.",
    }, 400);
  }

  let parameters: Record<string, unknown>;
  try {
    parameters = readParameters(get("parameters") as FormDataEntryValue | null);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Invalid parameters.",
    }, 400);
  }

  const entries = [...getAll("files"), ...getAll("file")].filter((
    entry,
  ): entry is File => entry instanceof File && entry.size > 0);
  if (!entries.length) {
    return json({ error: "At least one non-empty file is required." }, 400);
  }
  if (entries.length > MAX_FILES) {
    return json({
      error: `A maximum of ${MAX_FILES} files can be processed at once.`,
    }, 413);
  }
  if (entries.some((file) => file.size > MAX_FILE_BYTES)) {
    return json({ error: "Each file must be 25 MB or smaller." }, 413);
  }
  const totalBytes = entries.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return json(
      { error: "The combined upload must be 40 MB or smaller." },
      413,
    );
  }

  const requiresMany = operation === "merge_pdf" ||
    operation === "images_to_pdf";
  if (!requiresMany && entries.length !== 1) {
    return json({ error: "This operation accepts one input file." }, 400);
  }
  if (operation === "merge_pdf" && entries.length < 2) {
    return json({ error: "PDF Merge needs at least two files." }, 400);
  }

  const files: InputFile[] = await Promise.all(entries.map(async (file) => ({
    name: safeFilename(file.name),
    type: file.type || "application/octet-stream",
    bytes: new Uint8Array(await file.arrayBuffer()),
  })));
  const filename = entries.length === 1
    ? files[0].name
    : `${entries.length}-files`;
  const { data: newJob, error: insertError } = await supabase.from("jobs")
    .insert({
      actor_id: "anonymous",
      user_id: null,
      status: "pending",
      filename,
      operation,
      parameters,
      input_paths: [],
    }).select("id").single();
  if (insertError || !newJob) {
    return json(
      { error: insertError?.message ?? "Could not create job." },
      500,
    );
  }

  const inputPaths: string[] = [];
  let resultPath: string | null = null;
  try {
    for (const file of files) {
      const path = objectPath("uploads", newJob.id, file.name);
      const { error } = await supabase.storage.from(BUCKET).upload(
        path,
        file.bytes,
        {
          contentType: file.type,
          upsert: false,
        },
      );
      if (error) {
        throw new Error(`Could not upload ${file.name}: ${error.message}`);
      }
      inputPaths.push(path);
    }

    const { error: processingUpdateError } = await supabase.from("jobs").update(
      {
        status: "processing",
        input_path: inputPaths[0],
        input_paths: inputPaths,
      },
    )
      .eq("id", newJob.id);
    if (processingUpdateError) throw new Error(processingUpdateError.message);
    const artifact = await processOperation(operation, files, parameters);
    resultPath = objectPath(
      "results",
      newJob.id,
      safeFilename(artifact.fileName),
    );
    const { error: resultUploadError } = await supabase.storage.from(BUCKET)
      .upload(resultPath, artifact.bytes, {
        contentType: artifact.contentType,
        upsert: false,
      });
    if (resultUploadError) {
      throw new Error(`Could not save result: ${resultUploadError.message}`);
    }

    const result = {
      fileName: artifact.fileName,
      sizeBytes: artifact.bytes.byteLength,
      contentType: artifact.contentType,
      summary: artifact.summary ?? {},
      previewRows: artifact.previewRows,
    };
    const { data: completed, error: doneError } = await supabase.from("jobs")
      .update({
        status: "done",
        result_path: resultPath,
        result,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", newJob.id)
      .select(
        "id, status, filename, operation, parameters, result_path, result, created_at, updated_at",
      )
      .single();
    if (doneError || !completed) {
      throw new Error(doneError?.message ?? "Could not update completed job.");
    }
    return json({ job: completed });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Processing failed.";
    await supabase.from("jobs").update({
      status: "failed",
      error_message: message,
      updated_at: new Date().toISOString(),
    })
      .eq("id", newJob.id);
    if (inputPaths.length) {
      await supabase.storage.from(BUCKET).remove(inputPaths);
    }
    if (resultPath) {
      await supabase.storage.from(BUCKET).remove([resultPath]);
    }
    return json({ error: message, jobId: newJob.id }, 422);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      { error: "Supabase server environment is not configured." },
      500,
    );
  }

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    return await handleJobRequest(req, supabase);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    return json({ error: message }, 400);
  }
});
