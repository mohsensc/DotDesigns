import { Link } from "react-router-dom";
import Brand from "../components/Brand.tsx";
import "./NotFound.css";

export default function NotFound() {
  return (
    <main className="nf">
      <div className="nf__field" />
      <div className="nf__frame" />

      <header className="nf__nav">
        <Brand />
      </header>

      <section className="nf__content">
        <p className="eyebrow eyebrow--gold">Error · Not Found</p>
        <h1 className="nf__code">404</h1>
        <p className="nf__lede">
          This piece hasn&rsquo;t been <em>cast</em> yet.
        </p>
        <Link to="/" className="enter">
          <span className="enter__label">Return to the Cover</span>
          <span className="enter__rule" />
          <span className="enter__arrow">&rarr;</span>
        </Link>
      </section>

      <footer className="nf__footer">
        <span className="eyebrow">N&ordm; 04 — MMXXVI · London</span>
      </footer>
    </main>
  );
}
