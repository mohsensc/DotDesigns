import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PRICE_BANDS, formatPrice } from "../lib/catalog";
import { CONTACT_EMAIL, looksLikeEmail, sendInquiry } from "../lib/inquiry";
import { useDocumentTitle } from "../lib/use-document-title";
import SiteChrome from "../components/SiteChrome.tsx";
import "./SpecialRequest.css";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  brief: "What you have in mind",
  bandId: "Budget range",
};

type FormState = {
  name: string;
  email: string;
  brief: string;
  space: string;
  dimensions: string;
  timeline: string;
  bandId: string;
  /** Honeypot. Real people never see this field. */
  website: string;
};

type SendState = "idle" | "sending" | "sent" | "failed";

const EMPTY: FormState = {
  name: "",
  email: "",
  brief: "",
  space: "",
  dimensions: "",
  timeline: "",
  bandId: "",
  website: "",
};

function buildMessage(f: FormState): string {
  const band = PRICE_BANDS.find(b => b.id === f.bandId);
  const lines: string[] = [];
  if (f.name.trim()) lines.push(`Name: ${f.name}`);
  if (f.email.trim()) lines.push(`Email: ${f.email}`);
  if (f.brief.trim()) lines.push("", "What I have in mind:", f.brief);
  if (f.space.trim()) lines.push(`Space / room: ${f.space}`);
  if (f.dimensions.trim()) lines.push(`Rough dimensions: ${f.dimensions}`);
  if (f.timeline.trim()) lines.push(`Timeline: ${f.timeline}`);
  if (band) lines.push("", `Budget range: ${band.label} — ${band.note}`);
  return lines.join("\n");
}

export default function SpecialRequest() {
  useDocumentTitle("Special Request");

  const [form, setForm] = useState<FormState>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [summaryFocusTick, setSummaryFocusTick] = useState(0);

  const summaryRef = useRef<HTMLDivElement | null>(null);
  const successHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) e.name = "Tell us your name.";
    if (!form.email.trim() || !looksLikeEmail(form.email)) e.email = "A working email, please.";
    if (!form.brief.trim()) e.brief = "A line or two on what you're picturing.";
    if (!form.bandId) e.bandId = "Pick the range closest to your budget.";
    return e;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;
  const message = buildMessage(form);
  const hasMessage = message.trim().length > 0;

  // Focus the error summary whenever a failed submit produces one — moves
  // both the visual focus and the screen reader's attention to it.
  useEffect(() => {
    if (touched && !isValid && summaryFocusTick > 0) {
      summaryRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryFocusTick]);

  useEffect(() => {
    if (sendState === "sent") {
      successHeadingRef.current?.focus();
    }
  }, [sendState]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    if (!isValid || sendState === "sending") {
      if (!isValid) setSummaryFocusTick(t => t + 1);
      return;
    }

    const band = PRICE_BANDS.find(b => b.id === form.bandId);
    setSendState("sending");
    setSendError(null);

    const result = await sendInquiry({
      kind: "request",
      name: form.name.trim(),
      email: form.email.trim(),
      message: form.brief.trim(),
      space: form.space.trim(),
      dimensions: form.dimensions.trim(),
      timeline: form.timeline.trim(),
      priceBand: band ? `${band.label} — ${band.note}` : undefined,
      website: form.website,
    });

    if (result.ok) {
      setSendState("sent");
    } else {
      setSendState("failed");
      setSendError(result.error);
    }
  }

  if (sendState === "sent") {
    return (
      <SiteChrome className="request">
        <Link to="/shop" className="request__back">
          &larr;&nbsp; Back to the shop
        </Link>
        <header className="request__header">
          <p className="request__eyebrow">Special Request</p>
          <h1 className="request__title" ref={successHeadingRef} tabIndex={-1}>
            Got it — thank you.
          </h1>
          <p className="request__lede">
            The studio has your request and will reply to {form.email} directly.
          </p>
        </header>
      </SiteChrome>
    );
  }

  return (
    <SiteChrome className="request">
      <Link to="/shop" className="request__back">
        &larr;&nbsp; Back to the shop
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
          {touched && !isValid && (
            <div className="request__summary" role="alert" tabIndex={-1} ref={summaryRef}>
              <p className="request__summary-title">A few things need fixing:</p>
              <ul className="request__summary-list">
                {(Object.keys(errors) as (keyof FormState)[]).map(key => (
                  <li key={key}>
                    <a href={`#rq-${key}`}>{FIELD_LABELS[key] ?? key}</a> — {errors[key]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="request__row">
            <div className="request__field">
              <label htmlFor="rq-name">Name</label>
              <input
                id="rq-name"
                type="text"
                required
                value={form.name}
                onChange={e => set("name", e.target.value)}
                aria-invalid={touched && !!errors.name}
                aria-describedby={touched && errors.name ? "rq-name-error" : undefined}
              />
              {touched && errors.name && (
                <p className="request__error" id="rq-name-error">{errors.name}</p>
              )}
            </div>

            <div className="request__field">
              <label htmlFor="rq-email">Email</label>
              <input
                id="rq-email"
                type="email"
                required
                value={form.email}
                onChange={e => set("email", e.target.value)}
                aria-invalid={touched && !!errors.email}
                aria-describedby={touched && errors.email ? "rq-email-error" : undefined}
              />
              {touched && errors.email && (
                <p className="request__error" id="rq-email-error">{errors.email}</p>
              )}
            </div>
          </div>

          <div className="request__field">
            <label htmlFor="rq-brief">What do you have in mind</label>
            <textarea
              id="rq-brief"
              rows={5}
              required
              value={form.brief}
              onChange={e => set("brief", e.target.value)}
              aria-invalid={touched && !!errors.brief}
              aria-describedby={touched && errors.brief ? "rq-brief-error" : undefined}
            />
            {touched && errors.brief && (
              <p className="request__error" id="rq-brief-error">{errors.brief}</p>
            )}
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

          <fieldset
            id="rq-bandId"
            className="request__field request__fieldset"
            // The error summary links here; a fieldset takes focus only with this.
            tabIndex={-1}
            aria-required="true"
            aria-invalid={touched && !!errors.bandId}
            aria-describedby={touched && errors.bandId ? "rq-bandId-error" : undefined}
          >
            <legend>Budget range</legend>
            <div className="request__bands">
              {PRICE_BANDS.map(band => (
                <label key={band.id} className="request__band">
                  <input
                    type="radio"
                    name="bandId"
                    required
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
            {touched && errors.bandId && (
              <p className="request__error" id="rq-bandId-error">{errors.bandId}</p>
            )}
          </fieldset>

          {/* Honeypot — hidden from real visitors, not display:none since some
              bots skip that. Anything filled in here means it's a bot. */}
          <div className="request__hp" aria-hidden="true">
            <label htmlFor="rq-website">Website</label>
            <input
              id="rq-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={form.website}
              onChange={e => set("website", e.target.value)}
            />
          </div>

          {sendState === "failed" && sendError && (
            <p className="request__error" role="alert">{sendError}</p>
          )}

          <button type="submit" className="request__submit" disabled={sendState === "sending"}>
            {sendState === "sending" ? "Sending…" : "Send the request"}
          </button>

          {sendState === "failed" && (
            <p className="request__fallback">
              Or copy the message below and email it to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> directly.
            </p>
          )}
        </form>

        {/* Always rendered: hiding it made the form jump 400px wider at the
            first keystroke. Empty, it just says what it's for. */}
        <aside className="request__preview">
          <p className="request__preview-label">Message preview</p>
          {hasMessage ? (
            <pre className="request__preview-body">{message}</pre>
          ) : (
            <p className="request__preview-empty">Fills in as you write.</p>
          )}
        </aside>
      </div>
    </SiteChrome>
  );
}
