import { Link } from "react-router-dom";
import logo from "../assets/logo.png";
import "./Brand.css";

/** Site brand mark — the DOT Designs logo, links back to the cover. */
export default function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Dot Designs — home">
      <img
        className="brand__logo"
        src={logo}
        alt="Dot Designs — Architectural designer"
      />
    </Link>
  );
}
