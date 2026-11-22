import ToolIcon from "../components/ToolIcon.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { CATEGORY_META, TOOL_SUMMARIES, runtimeBadge } from "../tools.js";

const FEATURED = ["merge-pdf", "compress-pdf", "image-convert", "csv-to-json", "text-counter", "docx-to-txt", "unit-converter"];

export default function HomePage({ tools, navigate, catalogError, apiStatus }) {
  const featured = FEATURED.map((id) => tools.find((tool) => tool.id === id)).filter(Boolean);
  const categories = Object.values(CATEGORY_META);

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-kicker">
            <StatusBadge status={apiStatus} label={apiStatus === "online" ? "Cloud API online" : apiStatus === "offline" ? "Cloud API offline" : "Checking cloud"} dot />
            <span className="mono">GCP · CLOUD RUN · GCS · BROWSER</span>
          </div>
          <h1 className="display hero-title">
            EVERY TOOL.
            <span className="hero-line-2">CLOUD + LOCAL.</span>
          </h1>
          <p className="hero-lede">
            A blunt, fast utility bench for real files. PDFs, images, CSV,
            JSON, and text run on Cloud Run workers. Word and PowerPoint tools
            run entirely in this tab — their bytes never touch the network.
          </p>
          <div className="hero-actions">
            <button type="button" className="button button-mustard button-large" onClick={() => navigate("/tools/merge-pdf")}>
              Start with a PDF →
            </button>
            <button type="button" className="button button-ghost button-large" onClick={() => navigate("/browse")}>
              Browse all {tools.length} tools
            </button>
          </div>
          <ul className="hero-points mono">
            <li>Signed uploads</li>
            <li>24h result retention</li>
            <li>Local Office tools</li>
          </ul>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="paper-card paper-back">
            <span className="mono">scan-04.tiff</span>
            <span className="paper-stamp small">PNG</span>
          </div>
          <div className="paper-card paper-middle">
            <span className="mono">report.pdf</span>
            <div className="paper-rule" />
            <div className="paper-rule short" />
          </div>
          <div className="paper-card paper-front">
            <div className="paper-top">
              <span className="paper-dot" />
              <span className="mono">job_8f2c</span>
              <StatusBadge status="done" label="DONE" />
            </div>
            <div className="paper-rule" />
            <div className="paper-rule" />
            <div className="paper-rule short" />
            <div className="paper-block">
              <span className="mono">VERIFIED OUTPUT</span>
              <strong>merged.pdf</strong>
            </div>
          </div>
          <span className="floating-tag tag-one mono">PUT → GCS</span>
          <span className="floating-tag tag-two mono">worker: done</span>
          <span className="hero-cross cross-one" />
          <span className="hero-cross cross-two" />
        </div>
      </section>

      {catalogError ? (
        <p className="catalog-note">
          The live catalog could not be reached. Built-in tool definitions are showing; cloud jobs need the API.
        </p>
      ) : null}

      <section className="category-strip" aria-label="Tool categories">
        {categories.map((category, index) => (
          <button
            type="button"
            key={category.id}
            className={`category-tile tone-${index % 3}`}
            onClick={() => navigate(`/browse?category=${category.id}`)}
          >
            <span className="mono">0{index + 1}</span>
            <strong>{category.name}</strong>
            <span>{category.tagline}</span>
          </button>
        ))}
      </section>

      <section className="tools-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Featured bench</p>
            <h2 className="display">Pick a sharp tool.</h2>
          </div>
          <p>
            Instant utilities and Office tools run in your browser. Cloud tools
            use a signed upload, a queued job, and a short-lived download link.
          </p>
        </div>

        <div className="tool-grid">
          {featured.map((tool, index) => (
            <a
              className={`tool-card${tool.runtime === "client" ? " tool-card-client" : ""}${tool.runtime === "local" ? " tool-card-local" : ""}`}
              href={`/tools/${tool.id}`}
              key={tool.id}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/tools/${tool.id}`);
              }}
            >
              <div className="tool-card-top">
                <span className="tool-icon"><ToolIcon id={tool.id} /></span>
                <span className="tool-index mono">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <StatusBadge {...runtimeBadge(tool)} />
              <h3>{tool.name}</h3>
              <p>{TOOL_SUMMARIES[tool.id] || tool.description}</p>
              <span className="tool-link mono">OPEN TOOL <span aria-hidden="true">↗</span></span>
            </a>
          ))}
        </div>
      </section>

      <section className="process-section">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">The pipeline</p>
            <h2 className="display">Upload. Queue. Verify. Download.</h2>
          </div>
        </div>
        <ol className="process-list">
          <li>
            <span className="process-number display">01</span>
            <h3>Direct signed upload</h3>
            <p>The browser PUTs bytes straight to Cloud Storage. The API only signs the URL.</p>
          </li>
          <li>
            <span className="process-number display">02</span>
            <h3>Worker takes the lease</h3>
            <p>A Cloud Run worker claims the Firestore job, processes it, and heartbeats.</p>
          </li>
          <li>
            <span className="process-number display">03</span>
            <h3>Output is verified</h3>
            <p>Page counts, signatures, image dimensions, and JSON are checked before completion.</p>
          </li>
          <li>
            <span className="process-number display">04</span>
            <h3>Five-minute link</h3>
            <p>Downloads use a signed GET URL. Results auto-expire after 24 hours.</p>
          </li>
        </ol>
      </section>

      <section className="trust-strip">
        <div>
          <strong className="display">GCP native</strong>
          <span>Cloud Run, Firestore, GCS, Secret Manager, Cloud Logging.</span>
        </div>
        <div>
          <strong className="display">No fake jobs</strong>
          <span>Every cloud result is produced by a real processor and checked.</span>
        </div>
        <div>
          <strong className="display">Owner-scoped</strong>
          <span>Supabase access tokens and user checks on every job and download.</span>
        </div>
      </section>
    </main>
  );
}
