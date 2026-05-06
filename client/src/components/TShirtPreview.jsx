// Displays a submitted t-shirt design overlaid on a shirt silhouette.
// The design is clipped to the body area — sleeves stay clean.
//
// SVG coordinate space: viewBox="0 0 200 220"
// Shirt path landmarks:
//   Left collar  (76, 22) → neck curve → Right collar (124, 22)
//   Shoulders: (52, 6) left, (148, 6) right
//   Sleeve tips: (6, 44)–(6, 72) left,  (194, 44)–(194, 72) right
//   Sleeve-body join: (40, 62) left,  (160, 62) right
//   Body: trapezoid — (40,62) (160,62) (163,216) (37,216)

const SHIRT_PATH =
  'M 52 6 L 76 22 C 90 50,110 50,124 22 L 148 6 L 194 44 L 194 72 L 160 62 L 163 216 L 37 216 L 40 62 L 6 72 L 6 44 Z';

// Clip polygon — exactly the body trapezoid
const BODY_CLIP = '40,62 160,62 163,216 37,216';

// Image is placed to fill the body bounding box; clip handles the trapezoid edges
const IMG_X = 37;
const IMG_Y = 62;
const IMG_W = 126; // 163-37
const IMG_H = 154; // 216-62

export default function TShirtPreview({ id, imageData, name, status }) {
  const clipId = `body-${id}`;

  return (
    <div className={`tshirt-preview tshirt-preview-${status}`}>
      <svg
        viewBox="0 0 200 220"
        xmlns="http://www.w3.org/2000/svg"
        aria-label={`${name}'s t-shirt design`}
      >
        <defs>
          <clipPath id={clipId}>
            <polygon points={BODY_CLIP} />
          </clipPath>
        </defs>

        {/* Shirt fill */}
        <path d={SHIRT_PATH} fill="#f4f4f4" stroke="#c8c8c8" strokeWidth="1.5" strokeLinejoin="round" />

        {/* Design image clipped to body only */}
        {imageData ? (
          <image
            href={imageData}
            x={IMG_X}
            y={IMG_Y}
            width={IMG_W}
            height={IMG_H}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
        ) : (
          <text x="100" y="140" textAnchor="middle" fontSize="10" fill="#aaa">loading…</text>
        )}

        {/* Shirt outline drawn on top so edges are crisp over the image */}
        <path d={SHIRT_PATH} fill="none" stroke="#b0b0b0" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>

      <div className="tshirt-preview-name">{name}</div>
    </div>
  );
}
