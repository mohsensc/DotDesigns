import { largestDimensionCm, toCm, type Size } from "../lib/catalog";
import "./ScaleFigure.css";

// Below this, a hand reads as the more legible comparison. At or above, a
// standing person does. Chosen by eye against the two reference photos, not
// derived from anything.
const HAND_CUTOFF_CM = 45;

// PNGs are tightly cropped to the ink, so the box IS the figure's real
// height — pixelWidth / pixelHeight from the actual files (170×400, 167×400),
// used as the true width:height ratio so the mask never letterboxes and lies
// about scale.
const HAND = { src: "/scale/hand.png", heightCm: 22, aspect: 170 / 400, label: "Hand, about 22 cm" };
const PERSON = { src: "/scale/person.png", heightCm: 170, aspect: 167 / 400, label: "Person, about 170 cm" };

// Budget the stage in pixels, not the same "arbitrary units == px" trick as
// before — that let a wide flat piece blow past 390px. Both axes are capped
// and the smaller resulting scale wins, so nothing clips in either direction.
const STAGE_HEIGHT_PX = 190;
const STAGE_WIDTH_PX = 280;

export type ScaleFigureProps = {
  /** The piece's real measurements. Pass undefined/null for no drawing. */
  size?: Size;
  /** The size as words, e.g. "H 84 × W 40 in" — shown as the piece's label. */
  formatted?: string | null;
};

/**
 * A piece, drawn to true proportion next to a hand or a person, so a buyer can
 * tell a bowl from a wall panel without doing unit math. Renders nothing when
 * the piece has no numeric size — an on-site commission genuinely has none.
 */
export default function ScaleFigure({ size, formatted }: ScaleFigureProps) {
  const largest = largestDimensionCm(size);
  if (largest == null || !size) return null;

  const reference = largest < HAND_CUTOFF_CM ? HAND : PERSON;

  const pieceHeightCm = toCm(size.height ?? size.length ?? size.depth ?? 0, size.unit);
  const pieceWidthCm = toCm(size.length ?? size.height ?? size.depth ?? 0, size.unit);
  const refWidthCm = reference.heightCm * reference.aspect;

  // Constrain by both axes: whichever is tighter — the tallest shape against
  // the height budget, or the two shapes side by side against the width
  // budget — sets the scale. A piece bigger than the reference in either
  // dimension shrinks the reference, never clips the piece.
  const heightScale = STAGE_HEIGHT_PX / Math.max(pieceHeightCm, reference.heightCm);
  const widthScale = STAGE_WIDTH_PX / (pieceWidthCm + refWidthCm);
  const scale = Math.min(heightScale, widthScale);

  const pieceH = pieceHeightCm * scale;
  const pieceW = pieceWidthCm * scale;
  const refH = reference.heightCm * scale;
  const refW = refH * reference.aspect;

  // formatted can be omitted by a caller that only has a Size — always leave
  // screen reader users with something concrete rather than nothing.
  const sizeWords = formatted || `${Math.round(largest)} cm at its largest`;
  const description = `${sizeWords}, roughly ${describeAgainst(largest, reference)}.`;

  return (
    <div className="scale-figure">
      <div className="scale-figure__stage" aria-hidden="true">
        <div className="scale-figure__group">
          {/* marginTop pads every shape up to the same STAGE_HEIGHT_PX, so
              the two shapes share a ground line regardless of how many
              lines their captions wrap to below. */}
          <div
            className="scale-figure__piece"
            style={{ width: pieceW, height: pieceH, marginTop: STAGE_HEIGHT_PX - pieceH }}
          />
          {formatted && <p className="scale-figure__caption">{formatted}</p>}
        </div>
        <div className="scale-figure__group">
          <div
            className={`scale-figure__silhouette scale-figure__silhouette--${reference === HAND ? "hand" : "person"}`}
            style={{ width: refW, height: refH, marginTop: STAGE_HEIGHT_PX - refH }}
          />
          <p className="scale-figure__caption">{reference.label}</p>
        </div>
      </div>
      <p className="scale-figure__sr-only">{description}</p>
    </div>
  );
}

/** "roughly half the height of a person" / "about twice the height of a hand" */
function describeAgainst(largestCm: number, reference: typeof HAND | typeof PERSON): string {
  const ratio = largestCm / reference.heightCm;
  const who = reference === HAND ? "a hand" : "a person";
  if (ratio > 0.85 && ratio < 1.15) return `the height of ${who}`;
  if (ratio <= 0.85) {
    const frac = ratio <= 0.2 ? "a fifth" : ratio <= 0.35 ? "a third" : ratio <= 0.6 ? "half" : "most";
    return `${frac} the height of ${who}`;
  }
  const times = Math.round(ratio);
  return times >= 2 ? `${times} times the height of ${who}` : `taller than ${who}`;
}
