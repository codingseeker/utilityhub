# API processing notes

`POST /functions/v1/api` accepts `multipart/form-data` with an `operation` field,
an optional JSON `parameters` field, and one or more `files` fields. Processing is
synchronous: the response contains a completed job, and `GET ?action=status&jobId=…`
can retrieve it later. `POST` JSON actions support `download` and `delete`.

The function uses the server-side `SUPABASE_SERVICE_ROLE_KEY`; never expose that
key in the frontend. Anonymous jobs use `actor_id = 'anonymous'` and a null
`user_id`. Apply the migration in `supabase/migrations/` before deploying.

## Processing limits

- Files are limited to 25 MB each and 40 MB per request.
- `pdf_to_images` returns `PDF to Image is not supported in the cloud demo.` PDF
  rendering needs a native PDF renderer that is not included in this Deno
  function.
- `compress_pdf` removes metadata and enables PDF object streams. It does not
  recompress embedded images, so the output may not be smaller.
- ImageScript can decode TIFF, but some TIFF compression types (including CCITT)
  are unsupported by the library and return a processing error.
- Processing runs inline in one Edge Function request. Large or complex files
  can exceed the platform's request duration or memory budget.

PDF, image, CSV/JSON, text, and Office operations use the operation names
normalized in `processor.ts`. The Office tools remain local in the current UI,
but matching operation handlers are available to callers that submit those
files directly.
