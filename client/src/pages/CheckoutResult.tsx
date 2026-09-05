import { Link } from "react-router-dom";
import { useDocumentTitle } from "../lib/use-document-title";
import { CONTACT_EMAIL } from "../lib/inquiry";
import SiteChrome from "../components/SiteChrome.tsx";
import "./CheckoutResult.css";

// Where Stripe sends people back to. Two states, one layout.
//
// Deliberately makes no network call. Stripe only redirects to success_url after
// the payment actually succeeded, and the webhook is what moves stock — so
// re-confirming here would add a spinner and a failure mode to a page whose only
// job is to say "that worked". The receipt is Stripe's to send.

type Props = { outcome: "success" | "cancelled" };

export default function CheckoutResult({ outcome }: Props) {
  const ok = outcome === "success";
  useDocumentTitle(ok ? "Thank you" : "Checkout cancelled");

  return (
    <SiteChrome className="checkout">
      <section className="checkout__panel">
        <p className="checkout__eyebrow">{ok ? "Order received" : "Nothing charged"}</p>
        <h1 className="checkout__title">{ok ? "Thank you." : "No payment was taken."}</h1>

        {ok ? (
          <>
            <p className="checkout__lede">
              Your receipt is on its way by email. Hajar packs and ships each piece herself, so
              she'll be in touch shortly to arrange delivery and give you a timeline.
            </p>
            <p className="checkout__note">
              Anything you need in the meantime, reply to that email or write to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="checkout__link">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </>
        ) : (
          <>
            <p className="checkout__lede">
              You left the checkout, so nothing was charged and the piece is still available.
              You can pick up where you left off whenever you like.
            </p>
            <p className="checkout__note">
              If something went wrong at the payment step, tell us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="checkout__link">
                {CONTACT_EMAIL}
              </a>{" "}
              and we'll sort it out by hand.
            </p>
          </>
        )}

        <div className="checkout__actions">
          <Link to="/shop" className="checkout__btn checkout__btn--primary">
            {ok ? "Back to the shop" : "Return to the shop"}
          </Link>
          <Link to="/" className="checkout__btn checkout__btn--quiet">
            The gallery
          </Link>
        </div>
      </section>
    </SiteChrome>
  );
}
