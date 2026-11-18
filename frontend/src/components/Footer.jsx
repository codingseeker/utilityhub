export default function Footer({ navigate }) {
  return (
    <footer className="footer">
      <div className="footer-brand">
        <strong>UTILITYHUB</strong>
        <span>Real processing. Google Cloud native.</span>
      </div>
      <div className="footer-links">
        <a href="/browse" onClick={(event) => { event.preventDefault(); navigate("/browse"); }}>
          All tools
        </a>
        <a href="/settings" onClick={(event) => { event.preventDefault(); navigate("/settings"); }}>
          Account
        </a>
        <span className="footer-mono">v2.0 · GCP</span>
      </div>
    </footer>
  );
}
