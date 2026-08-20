import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PRICE_BANDS, formatPrice } from "../lib/catalog";
import "./SpecialRequest.css";

type FormState = {
  name: string;
  email: string;
  brief: string;
  space: string;
  dimensions: string;
  timeline: string;
  bandId: string;
};

const EMPTY: FormState = {
  name: "",
  email: "",
  brief: "",
  space: "",
  dimensions: "",
  timeline: "",
  bandId: "",
};

function buildMessage(f: FormState): string {
  const band = PRICE_BANDS.find(b => b.id === f.bandId);
  return [
    `Name: ${f.name || "—"}`,
    `Email: ${f.email || "—"}`,
    "",
    "What they have in mind:",
    f.brief || "—",
    "",
    `Space / room: ${f.space || "—"}`,
    `Rough dimensions: ${f.dimensions || "—"}`,
    `Timeline: ${f.timeline || "—"}`,
    `Budget range: ${band ? `${band.label} — ${band.note}` : "—"}`,
  ].join("\n");
}

export default function SpecialRequest() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [touched, setTouched] = useState(false);

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) e.name = "Tell us your name.";
    if (!form.email.trim() || !form.email.includes("@")) e.email = "A working email, please.";
    if (!form.brief.trim()) e.brief = "A line or two on what you're picturing.";
    if (!form.bandId) e.bandId = "Pick the range closest to your budget.";
    return e;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;
  const message = buildMessage(form);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    if (!isValid) return;
    const subject = `Special request — ${form.name}`;
    window.location.href = `mailto:hello@dotdesigns.ca?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  }

  return (
    <main className="request">
      <Link to="/shop" className="request__back">
        &larr; Back to the shop
      </Link>

      <header className="request__header">
        <p className="request__eyebrow">Special Request</p>
        <h1 className="request__title">Tell us what you're picturing.</h1>
        <p className="request__lede">
          Most commissions start here. Work runs from around {formatPrice(PRICE_BANDS[0].min)} for
          small pottery up to {formatPrice(PRICE_BANDS[PRICE_BANDS.length - 1].min)}+ for an
          on-site wall installation — the range below is the same one the studio quotes from.
        </p>
      </header>

      <div className="request__layout">
        <form className="request__form" onSubmit={handleSubmit} noValidate>
          <div className="request__field">
            <label htmlFor="rq-name">Name</label>
            <input id="rq-name" type="text" value={form.name} onChange={e => set("name", e.target.value)} />
            {touched && errors.name && <p className="request__error">{errors.name}</p>}
          </div>

          <div className="request__field">
            <label htmlFor="rq-email">Email</label>
            <input id="rq-email" type="email" value={form.email} onChange={e => set("email", e.target.value)} />
            {touched && errors.email && <p className="request__error">{errors.email}</p>}
          </div>

          <div className="request__field">
            <label htmlFor="rq-brief">What do you have in mind</label>
            <textarea id="rq-brief" rows={5} value={form.brief} onChange={e => set("brief", e.target.value)} />
            {touched && errors.brief && <p className="request__error">{errors.brief}</p>}
          </div>

          <div className="request__row">
            <div className="request__field">
              <label htmlFor="rq-space">Space / room</label>
              <input
                id="rq-space"
                type="text"
                value={form.space}
                onChange={e => set("space", e.target.value)}
                placeholder="Entryway, dining room…"
              />
            </div>
            <div className="request__field">
              <label htmlFor="rq-dimensions">Rough dimensions</label>
              <input
                id="rq-dimensions"
                type="text"
                value={form.dimensions}
                onChange={e => set("dimensions", e.target.value)}
                placeholder="8 ft wide, roughly"
              />
            </div>
          </div>

          <div className="request__field">
            <label htmlFor="rq-timeline">Timeline</label>
            <input
              id="rq-timeline"
              type="text"
              value={form.timeline}
              onChange={e => set("timeline", e.target.value)}
              placeholder="No rush / by spring / etc."
            />
          </div>

          <fieldset className="request__field request__fieldset">
            <legend>Budget range</legend>
            <div className="request__bands">
              {PRICE_BANDS.map(band => (
                <label key={band.id} className="request__band">
                  <input
                    type="radio"
                    name="bandId"
                    value={band.id}
                    checked={form.bandId === band.id}
                    onChange={() => set("bandId", band.id)}
                  />
                  <span className="request__band-marker" aria-hidden="true" />
                  <span className="request__band-text">
                    <span className="request__band-label">{band.label}</span>
                    <span className="request__band-note">{band.note}</span>
                  </span>
                </label>
              ))}
            </div>
            {touched && errors.bandId && <p className="request__error">{errors.bandId}</p>}
          </fieldset>

          <button type="submit" className="request__submit">
            Send the request
          </button>
        </form>

        <aside className="request__preview">
          <p className="request__preview-label">Message preview</p>
          <pre className="request__preview-body">{message}</pre>
          <p className="request__preview-hint">
            If your mail client doesn't open, copy this and send it to{" "}
            <a href="mailto:hello@dotdesigns.ca">hello@dotdesigns.ca</a>.
          </p>
        </aside>
      </div>
    </main>
  );
}
