import { Link } from "react-router-dom";
import { useDocumentTitle } from "../lib/use-document-title";
import SiteChrome from "../components/SiteChrome.tsx";
import "./NotFound.css";

export default function NotFound() {
  useDocumentTitle("Not found");

  return (
    <SiteChrome className="nf">
      <p className="nf__eyebrow">Error · Not found</p>
      <h1 className="nf__code">404</h1>
      <p className="nf__lede">
        This piece hasn&rsquo;t been <em>cast</em> yet.
      </p>
      <div className="nf__actions">
        <Link to="/" className="nf__btn nf__btn--primary">
          Back to the gallery
        </Link>
        <Link to="/shop" className="nf__btn nf__btn--quiet">
          See what's available
        </Link>
      </div>
    </SiteChrome>
  );
}
