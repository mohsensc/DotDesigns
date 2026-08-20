// ---------------------------------------------------------------------------
// Sending an enquiry.
//
// Both entry points post the same shape to /api/inquiry: the "ask about this
// piece" button on a piece page, and the Special Request form. The server turns
// it into an email.
//
// This replaces a mailto: link, which looked like it worked and often didn't —
// on webmail with no mail client registered, setting window.location.href to a
// mailto does nothing at all, and neither the buyer nor Hajar ever finds out.
// ---------------------------------------------------------------------------

export const CONTACT_EMAIL = "hello@dotdesigns.ca";

export type InquiryKind = "piece" | "request";

export type Inquiry = {
  kind: InquiryKind;
  name: string;
  email: string;
  message: string;
  /** Piece enquiries: which piece, so the email says so in its subject. */
  pieceTitle?: string;
  pieceSlug?: string;
  /** Special requests: the shape of the job. */
  space?: string;
  dimensions?: string;
  timeline?: string;
  priceBand?: string;
  /**
   * Honeypot. Real people never see this field, so anything in it is a bot and
   * the server drops the message. Named to look worth filling in.
   */
  website?: string;
};

export type InquiryResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Never throws — every caller renders the failure to the visitor rather than
 * swallowing it, so a lost enquiry is always visible as a lost enquiry.
 */
export async function sendInquiry(inquiry: Inquiry): Promise<InquiryResult> {
  try {
    const res = await fetch("/api/inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inquiry),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error || "That didn't send. Please try again." };
  } catch {
    return { ok: false, error: "Couldn't reach the studio. Check your connection and try again." };
  }
}

/** Client-side sanity check only; the server validates properly. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
