const paths = {
  "merge-pdf": (
    <>
      <path d="M7 4.5h7l4 4v6.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8.5a2 2 0 0 1 2-2Z" />
      <path d="M14 4.5v4h4" />
      <path d="M9 19.5h8a2 2 0 0 0 2-2V11" />
    </>
  ),
  "split-pdf": (
    <>
      <path d="M5 4.5h6l3 3v5.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2Z" />
      <path d="M11 4.5v3h3" />
      <path d="M7 18h10a2 2 0 0 0 2-2v-4" />
      <path d="m15 14 4-2 4 2" />
    </>
  ),
  "compress-pdf": (
    <>
      <path d="M5 4.5h9l4 4v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2Z" />
      <path d="M14 4.5v4h4" />
      <path d="m8 12 3 3 3-3" />
      <path d="M11 15v4" />
    </>
  ),
  "rotate-pdf": (
    <>
      <path d="M6 5.5h8l4 4v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
      <path d="M14 5.5v4h4" />
      <path d="M9 14.5a3 3 0 1 0 3 3" />
      <path d="M9 14.5h3v3" />
    </>
  ),
  "images-to-pdf": (
    <>
      <rect x="3" y="5" width="9" height="8" rx="1.5" />
      <circle cx="6" cy="8" r="1" />
      <path d="m4 12 2.5-2.5L9 12" />
      <path d="M15 8h4l2 2v9a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-6" />
      <path d="M19 8v2h2" />
    </>
  ),
  "pdf-to-images": (
    <>
      <path d="M6 3.5h8l4 4v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" />
      <path d="M14 3.5v4h4" />
      <rect x="8" y="12" width="8" height="7" rx="1.5" />
      <circle cx="10.5" cy="14.5" r="0.8" />
      <path d="m8.5 18 2-2 1.5 1.5 1.5-1.5 1 1" />
    </>
  ),
  "image-convert": (
    <>
      <rect x="3" y="4" width="8" height="8" rx="1" />
      <path d="m4 10 2-2 2 2" />
      <path d="M14 5h5l2 2v11a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      <path d="M16 13h4" />
      <path d="m18 11 2 2-2 2" />
    </>
  ),
  "image-compress": (
    <>
      <rect x="3" y="4" width="12" height="10" rx="1" />
      <path d="m5 12 3-3 3 3" />
      <path d="M17 4v4h4" />
      <path d="M21 10v8a2 2 0 0 1-2 2H9" />
      <path d="m14 17 4 3 4-3" />
    </>
  ),
  "color-picker": (
    <>
      <path d="m14 4 6 6" />
      <path d="m17 7-9.5 9.5a2.1 2.1 0 0 0-.6 1.2L6.5 21l3.3-.4a2.1 2.1 0 0 0 1.2-.6L20.5 10.5" />
      <path d="m11.5 9.5 3 3" />
      <circle cx="7" cy="7" r="2" />
    </>
  ),
  "csv-to-json": (
    <>
      <path d="M5 3.5h8l4 4v13H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M13 3.5v4h4" />
      <path d="M7 12h6M7 15h6M7 18h4" />
    </>
  ),
  "json-to-csv": (
    <>
      <path d="M5 3.5h8l4 4v13H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M13 3.5v4h4" />
      <path d="M6.5 12h7.5M6.5 15h7.5M6.5 18h7.5" />
      <path d="M10 12v7" />
    </>
  ),
  "json-format": (
    <>
      <path d="M9 4.5H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h2" />
      <path d="M15 4.5h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-2" />
      <path d="M11 9h2M11 12h2M11 15h2" />
    </>
  ),
  "table-preview": (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3 9h18M9 9v10M15 9v10" />
      <path d="M6 12h1M12 12h1M18 12h1M6 15h1M12 15h1M18 15h1" />
    </>
  ),
  "text-case": (
    <>
      <path d="M4 18 8.5 6 13 18" />
      <path d="M5.7 14h5.6" />
      <path d="M15 10h5v8h-5z" />
      <path d="M15 14h5" />
    </>
  ),
  "text-counter": (
    <>
      <path d="M5 3.5h9l4 4v13H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M14 3.5v4h4" />
      <path d="M7 11h6M7 14h6M7 17h4" />
    </>
  ),
  "text-cleaner": (
    <>
      <path d="m4 20 4-1 10-10-3-3L5 16l-1 4Z" />
      <path d="m13 8 3 3" />
      <path d="M16 4h4M18 2v4" />
    </>
  ),
  "unit-converter": (
    <>
      <path d="M4 8h16M4 16h16" />
      <path d="M7 5v6M12 5v6M17 5v6M7 13v6M12 13v6M17 13v6" />
    </>
  ),
  "percentage-calculator": (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
      <path d="m8 9 2-2M8 7l2 2M14 17l2-2M14 15l2 2" />
      <path d="M8 16h0M16 8h0" />
    </>
  ),
};

export default function ToolIcon({ id, size = 24, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths[id] || paths["merge-pdf"]}
    </svg>
  );
}
