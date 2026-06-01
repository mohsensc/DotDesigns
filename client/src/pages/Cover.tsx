import { Link } from "react-router-dom";
import Brand from "../components/Brand.tsx";
import "./Cover.css";
import hero from "../assets/hero.png";

export default function Cover() {
  return (
    <main className="cover">
      {/* warm stone gradient field */}
      <div className="cover__field" />

      {/* hero image on the right, fading into the field on its left edge */}
      <div className="cover__image" style={{ backgroundImage: `url(${hero})` }} />
      <div className="cover__image-fade" />

      {/* thin gold inset frame */}
      <div className="cover__frame" />

      {/* top navigation */}
      <header className="cover__nav">
        <Brand />
        <nav className="cover__links">
          <Link to="/works" className="eyebrow eyebrow--link">
            Works
          </Link>
          <Link to="/about" className="eyebrow eyebrow--link">
            About
          </Link>
          <Link to="/contact" className="eyebrow eyebrow--link">
            Contact
          </Link>
        </nav>
      </header>

      {/* centered content column */}
      <section className="cover__content">
        <p className="eyebrow eyebrow--gold">Sculptural · Modern Abstract</p>
        <h1 className="headline">
          Texture,
          <br />
          movement <span className="amp">&amp;</span>
          <br />
          <em>abstract form.</em>
        </h1>
        <p className="lede">
          A studio practice in sculptural relief and modern abstraction by Dot.
        </p>
        <Link to="/collection" className="enter">
          <span className="enter__label">View the Collection</span>
          <span className="enter__rule" />
          <span className="enter__arrow">&rarr;</span>
        </Link>
      </section>

      {/* footer marker */}
      <footer className="cover__footer">
        <span className="eyebrow">N&ordm; 04 — MMXXVI · London</span>
      </footer>
    </main>
  );
}
