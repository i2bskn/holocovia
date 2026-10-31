import {
  HORIZONTAL_VIEW_BOX,
  SYMBOL_BRIDGE,
  SYMBOL_BRIDGE_WIDTH,
  SYMBOL_POST_WIDTH,
  SYMBOL_POSTS,
  SYMBOL_VIEW_BOX,
  WORDMARK_PATHS,
  WORDMARK_TRANSFORM,
} from "../../src/brand";

// The symbol, colored by .brand-symbol (the brand color, or white on dark backgrounds).
function Symbol() {
  return (
    <g
      className="brand-symbol"
      fill="none"
      stroke="currentColor"
      strokeWidth={SYMBOL_POST_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={SYMBOL_POSTS} />
      <path d={SYMBOL_BRIDGE} strokeWidth={SYMBOL_BRIDGE_WIDTH} />
    </g>
  );
}

// The logo for the header: the horizontal logo, or the symbol alone on narrow screens (CSS chooses).
// Decorative: the link around it is named "libreno".
export function BrandLogo() {
  return (
    <>
      <svg className="brand-horizontal" viewBox={HORIZONTAL_VIEW_BOX} aria-hidden="true" focusable="false">
        <Symbol />
        <g className="brand-wordmark" transform={WORDMARK_TRANSFORM} fill="currentColor">
          {WORDMARK_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
      <svg className="brand-symbol-only" viewBox={SYMBOL_VIEW_BOX} aria-hidden="true" focusable="false">
        <Symbol />
      </svg>
    </>
  );
}
