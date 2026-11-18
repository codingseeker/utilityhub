import { useMemo, useState } from "react";
import { CATEGORY_META, TOOL_SUMMARIES } from "../tools.js";
import StatusBadge from "../components/StatusBadge.jsx";
import ToolIcon from "../components/ToolIcon.jsx";

const LENGTH = {
  m: { label: "Metres", factor: 1 },
  km: { label: "Kilometres", factor: 1000 },
  cm: { label: "Centimetres", factor: 0.01 },
  mm: { label: "Millimetres", factor: 0.001 },
  in: { label: "Inches", factor: 0.0254 },
  ft: { label: "Feet", factor: 0.3048 },
  yd: { label: "Yards", factor: 0.9144 },
  mi: { label: "Miles", factor: 1609.344 },
};

const MASS = {
  kg: { label: "Kilograms", factor: 1 },
  g: { label: "Grams", factor: 0.001 },
  mg: { label: "Milligrams", factor: 0.000001 },
  t: { label: "Metric tonnes", factor: 1000 },
  lb: { label: "Pounds", factor: 0.45359237 },
  oz: { label: "Ounces", factor: 0.028349523125 },
};

const DATA = {
  B: { label: "Bytes", factor: 1 },
  KB: { label: "Kilobytes (1024)", factor: 1024 },
  MB: { label: "Megabytes (1024²)", factor: 1024 ** 2 },
  GB: { label: "Gigabytes (1024³)", factor: 1024 ** 3 },
  TB: { label: "Terabytes (1024⁴)", factor: 1024 ** 4 },
};

const TEMPS = {
  c: { label: "Celsius" },
  f: { label: "Fahrenheit" },
  k: { label: "Kelvin" },
};

const SETS = {
  length: { label: "Length", units: LENGTH, from: "m", to: "ft" },
  mass: { label: "Mass", units: MASS, from: "kg", to: "lb" },
  data: { label: "Data", units: DATA, from: "MB", to: "GB" },
  temperature: { label: "Temperature", units: TEMPS, from: "c", to: "f" },
};

function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  if (value !== 0 && (Math.abs(value) >= 1e12 || Math.abs(value) < 1e-6)) {
    return value.toExponential(6);
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(value);
}

function convertTemperature(value, from, to) {
  let celsius = value;
  if (from === "f") celsius = ((value - 32) * 5) / 9;
  if (from === "k") celsius = value - 273.15;
  if (to === "f") return (celsius * 9) / 5 + 32;
  if (to === "k") return celsius + 273.15;
  return celsius;
}

function UnitConverter() {
  const [category, setCategory] = useState("length");
  const [value, setValue] = useState("1");
  const [from, setFrom] = useState(SETS.length.from);
  const [to, setTo] = useState(SETS.length.to);

  const set = SETS[category];
  const numeric = Number(value);

  const result = useMemo(() => {
    if (!Number.isFinite(numeric)) return null;
    if (category === "temperature") return convertTemperature(numeric, from, to);
    const units = set.units;
    return (numeric * units[from].factor) / units[to].factor;
  }, [category, numeric, from, to, set.units]);

  function switchCategory(next) {
    setCategory(next);
    setFrom(SETS[next].from);
    setTo(SETS[next].to);
    setValue("1");
  }

  function swap() {
    setFrom(to);
    setTo(from);
  }

  return (
    <div className="client-tool">
      <div className="client-tabs" role="tablist" aria-label="Conversion category">
        {Object.entries(SETS).map(([id, item]) => (
          <button type="button" key={id} role="tab" aria-selected={category === id} className={category === id ? "is-active" : ""} onClick={() => switchCategory(id)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="converter-grid">
        <label className="field">
          <span>Value</span>
          <input type="number" value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span>From</span>
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            {Object.entries(set.units).map(([id, unit]) => <option key={id} value={id}>{unit.label}</option>)}
          </select>
        </label>
        <button type="button" className="swap-button" onClick={swap} aria-label="Swap units">⇄</button>
        <label className="field">
          <span>To</span>
          <select value={to} onChange={(event) => setTo(event.target.value)}>
            {Object.entries(set.units).map(([id, unit]) => <option key={id} value={id}>{unit.label}</option>)}
          </select>
        </label>
      </div>

      <div className="result-board" aria-live="polite">
        <span className="eyebrow">Result</span>
        <strong className="display" aria-label={`${formatNumber(result)} ${to}`}>{formatNumber(result)}</strong>
        <span className="mono">{set.units[to]?.label || to}</span>
      </div>

      <p className="fine-print mono">
        {category === "temperature"
          ? "Temperature uses exact offset formulas."
          : `${formatNumber(numeric)} ${set.units[from]?.label || from} → ${set.units[to]?.label || to}`}
      </p>
    </div>
  );
}

const PERCENT_MODES = [
  { id: "percentOf", label: "% of a number", a: "Percent", b: "Number" },
  { id: "whatPercent", label: "What percent?", a: "Part", b: "Whole" },
  { id: "change", label: "% change", a: "From", b: "To" },
  { id: "increase", label: "Increase by %", a: "Number", b: "Percent" },
  { id: "decrease", label: "Decrease by %", a: "Number", b: "Percent" },
];

function PercentageCalculator() {
  const [mode, setMode] = useState("percentOf");
  const [a, setA] = useState("25");
  const [b, setB] = useState("200");

  const current = PERCENT_MODES.find((item) => item.id === mode);
  const x = Number(a);
  const y = Number(b);

  const { result, note } = useMemo(() => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { result: null, note: "Enter two numbers." };
    if (mode === "percentOf") return { result: (x / 100) * y, note: `${x}% of ${y}` };
    if (mode === "whatPercent") {
      if (y === 0) return { result: null, note: "The whole cannot be zero." };
      return { result: (x / y) * 100, note: `${x} is what percent of ${y}` };
    }
    if (mode === "change") {
      if (x === 0) return { result: null, note: "The starting value cannot be zero." };
      return { result: ((y - x) / x) * 100, note: `Change from ${x} to ${y}` };
    }
    if (mode === "increase") return { result: y * (1 + x / 100), note: `${x}% increase on ${y}` };
    return { result: y * (1 - x / 100), note: `${x}% decrease on ${y}` };
  }, [mode, x, y]);

  const suffix = mode === "percentOf" ? "" : mode === "whatPercent" || mode === "change" ? "%" : "total";

  return (
    <div className="client-tool">
      <div className="client-tabs" role="tablist" aria-label="Percentage mode">
        {PERCENT_MODES.map((item) => (
          <button type="button" key={item.id} role="tab" aria-selected={mode === item.id} className={mode === item.id ? "is-active" : ""} onClick={() => setMode(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="percent-grid">
        <label className="field">
          <span>{current.a}</span>
          <input type="number" value={a} onChange={(event) => setA(event.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span>{current.b}</span>
          <input type="number" value={b} onChange={(event) => setB(event.target.value)} inputMode="decimal" />
        </label>
      </div>

      <div className="result-board" aria-live="polite">
        <span className="eyebrow">Result</span>
        <strong className="display">{result === null ? "—" : `${formatNumber(result)}${suffix}`}</strong>
        <span className="mono">{note}</span>
      </div>
    </div>
  );
}

export default function ClientToolPage({ tool, navigate }) {
  return (
    <main className="page-shell tool-page client-page">
      <button type="button" className="back-link" onClick={() => navigate("/browse")}>
        <span aria-hidden="true">←</span> All tools
      </button>

      <header className="tool-heading">
        <span className="tool-hero-icon"><ToolIcon id={tool.id} size={36} /></span>
        <div className="tool-heading-copy">
          <div className="tool-heading-meta">
            <StatusBadge status="client" label="INSTANT" />
            <span className="mono">{CATEGORY_META[tool.category]?.name || "Utilities"}</span>
          </div>
          <h1 className="display">{tool.name}</h1>
          <p>{TOOL_SUMMARIES[tool.id] || tool.description} Runs entirely in this tab.</p>
        </div>
      </header>

      <div className="client-layout">
        {tool.id === "unit-converter" ? <UnitConverter /> : <PercentageCalculator />}
        <aside className="side-panel side-panel-accent client-aside">
          <p className="eyebrow">No upload</p>
          <h2>Instant and private.</h2>
          <p>This utility never touches the API, Cloud Storage, or your account quota. Calculations happen locally in JavaScript.</p>
          <p className="mono small">CLIENT RUNTIME · ZERO NETWORK</p>
        </aside>
      </div>
    </main>
  );
}
