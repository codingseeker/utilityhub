import { useCallback, useEffect, useState } from "react";
import { fetchCatalog } from "./api.js";
import AuthModal from "./components/AuthModal.jsx";
import Footer from "./components/Footer.jsx";
import Header from "./components/Header.jsx";
import { FALLBACK_TOOLS, mergeCatalogOperations, toolById } from "./tools.js";
import BrowsePage from "./pages/BrowsePage.jsx";
import HomePage from "./pages/HomePage.jsx";
import RecentPage from "./pages/RecentPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ToolPage from "./pages/ToolPage.jsx";

function parseRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const query = new URLSearchParams(window.location.search);
  const toolMatch = /^\/tools\/([a-z0-9-]+)$/.exec(path);
  if (toolMatch) return { page: "tool", id: toolMatch[1], query, path };
  if (path === "/browse") return { page: "browse", query, path };
  if (path === "/recent") return { page: "recent", query, path };
  if (path === "/settings") return { page: "settings", query, path };
  if (path === "/") return { page: "home", query, path };
  return { page: "notfound", query, path };
}

function themePreference() {
  try {
    return localStorage.getItem("utilityhub.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);
  const [tools, setTools] = useState(FALLBACK_TOOLS);
  const [apiStatus, setApiStatus] = useState("checking");
  const [catalogError, setCatalogError] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [theme, setTheme] = useState(themePreference);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("utilityhub.theme", theme);
    } catch {
      // Storage is optional; the theme still applies for this session.
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.operations) && data.operations.length > 0) {
          setTools(mergeCatalogOperations(data.operations));
        }
        setApiStatus("online");
        setCatalogError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setApiStatus("offline");
        setCatalogError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [route.page, route.id]);

  const navigate = useCallback((path) => {
    if (window.location.pathname + window.location.search === path) return;
    window.history.pushState({}, "", path);
    setRoute(parseRoute());
  }, []);

  const tool = route.page === "tool" ? toolById(tools, route.id) : null;
  const noMatch = route.page === "notfound" || (route.page === "tool" && !tool);

  return (
    <div className="app-shell">
      <Header
        navigate={navigate}
        route={route}
        apiStatus={apiStatus}
        onSignIn={() => setAuthOpen(true)}
      />

      {route.page === "home" ? (
        <HomePage tools={tools} navigate={navigate} catalogError={catalogError} apiStatus={apiStatus} />
      ) : null}

      {route.page === "browse" ? (
        <BrowsePage tools={tools} navigate={navigate} initialCategory={route.query.get("category") || "all"} />
      ) : null}

      {route.page === "recent" ? (
        <RecentPage navigate={navigate} onSignIn={() => setAuthOpen(true)} />
      ) : null}

      {route.page === "settings" ? (
        <SettingsPage
          onSignIn={() => setAuthOpen(true)}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        />
      ) : null}

      {route.page === "tool" && tool ? (
        <ToolPage tool={tool} navigate={navigate} onSignIn={() => setAuthOpen(true)} />
      ) : null}

      {noMatch ? (
        <main className="page-shell narrow-page">
          <div className="gate-card">
            <span className="gate-mark display">404</span>
            <p className="eyebrow">Not found</p>
            <h1 className="display">That page is not on the bench.</h1>
            <p>The tool or page you asked for does not exist.</p>
            <button type="button" className="button button-mustard" onClick={() => navigate("/")}>
              Back to Home
            </button>
          </div>
        </main>
      ) : null}

      <Footer navigate={navigate} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
