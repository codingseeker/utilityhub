import { useAuth } from "../context/AuthContext.jsx";

const NAV = [
  { id: "home", label: "Home", path: "/" },
  { id: "browse", label: "Browse", path: "/browse" },
  { id: "recent", label: "Recent", path: "/recent" },
  { id: "settings", label: "Settings", path: "/settings" },
];

function NavLink({ item, route, navigate }) {
  const active = route.page === item.id;
  return (
    <a
      href={item.path}
      className={`nav-link${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        navigate(item.path);
      }}
    >
      {item.label}
    </a>
  );
}

export default function Header({ navigate, route, apiStatus, onSignIn }) {
  const { user, status } = useAuth();
  const signedIn = Boolean(user);

  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("/");
          }}
          aria-label="UtilityHub home"
        >
          <span className="brand-mark" aria-hidden="true">
            UH
          </span>
          <span className="brand-word">
            Utility<span>Hub</span>
          </span>
        </a>

        <nav className="topnav" aria-label="Main navigation">
          {NAV.map((item) => (
            <NavLink key={item.id} item={item} route={route} navigate={navigate} />
          ))}
        </nav>

        <div className="topbar-right">
          <span className={`cloud-pill status-${apiStatus}`} title="Runs on Google Cloud">
            <span className="cloud-dot" aria-hidden="true" />
            CLOUD
          </span>

          {status === "loading" ? (
            <span className="auth-chip auth-chip-loading">Checking…</span>
          ) : signedIn ? (
            <button type="button" className="user-chip" onClick={() => navigate("/settings")}>
              <span className="user-avatar" aria-hidden="true">
                {(user.displayName || user.email || "U").slice(0, 1).toUpperCase()}
              </span>
              <span className="user-name">{user.displayName || user.email}</span>
            </button>
          ) : (
            <button type="button" className="button button-small button-mustard" onClick={onSignIn}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {NAV.map((item) => (
          <NavLink key={item.id} item={item} route={route} navigate={navigate} />
        ))}
      </nav>
    </>
  );
}
