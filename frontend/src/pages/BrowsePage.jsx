import { useMemo, useState } from "react";
import ToolIcon from "../components/ToolIcon.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { CATEGORY_META, TOOL_SUMMARIES } from "../tools.js";

export default function BrowsePage({ tools, navigate, initialCategory }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(initialCategory || "all");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tools.filter((tool) => {
      if (category !== "all" && tool.category !== category) return false;
      if (!needle) return true;
      return `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(needle);
    });
  }, [tools, category, query]);

  return (
    <main className="page-shell browse-page">
      <header className="page-head">
        <p className="eyebrow">The full bench</p>
        <h1 className="display">Browse tools.</h1>
        <p className="page-lede">
          Eighteen real tools. Cloud processors for files, instant utilities for
          quick maths. Filter by category or search by name.
        </p>
      </header>

      <div className="browse-controls">
        <label className="search-field">
          <span className="sr-only">Search tools</span>
          <span aria-hidden="true" className="search-mark">/</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search PDF, CSV, text, colour…"
          />
          {query ? (
            <button type="button" className="clear-search" onClick={() => setQuery("")} aria-label="Clear search">×</button>
          ) : null}
        </label>
        <div className="filter-chips" role="group" aria-label="Filter by category">
          <button type="button" className={category === "all" ? "chip is-active" : "chip"} onClick={() => setCategory("all")}>
            All <span className="mono">{tools.length}</span>
          </button>
          {Object.values(CATEGORY_META).map((item) => {
            const count = tools.filter((tool) => tool.category === item.id).length;
            return (
              <button
                type="button"
                key={item.id}
                className={category === item.id ? "chip is-active" : "chip"}
                onClick={() => setCategory(item.id)}
              >
                {item.name} <span className="mono">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <span className="display">0</span>
          <h2>No tools match that.</h2>
          <p>Clear the search or choose another category.</p>
        </div>
      ) : (
        <div className="browse-grid">
          {filtered.map((tool) => (
            <a
              key={tool.id}
              className={`browse-card${tool.runtime === "client" ? " browse-card-client" : ""}`}
              href={`/tools/${tool.id}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/tools/${tool.id}`);
              }}
            >
              <div className="browse-card-top">
                <span className="tool-icon"><ToolIcon id={tool.id} size={26} /></span>
                <StatusBadge status={tool.runtime} label={tool.runtime === "client" ? "INSTANT" : "CLOUD"} />
              </div>
              <h2>{tool.name}</h2>
              <p>{TOOL_SUMMARIES[tool.id] || tool.description}</p>
              <div className="browse-card-foot mono">
                <span>{CATEGORY_META[tool.category]?.name || tool.category}</span>
                <span>OPEN ↗</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
