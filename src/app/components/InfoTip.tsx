import { useLayoutEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

/**
 * The one info tooltip for the marketing site. Used by the pricing cards and
 * the eligibility check.
 *
 * WHY THIS IS JAVASCRIPT AND NOT THE OLD `.tf-tooltip` CSS
 *
 * The CSS version positioned the bubble with `left: 50%; transform:
 * translateX(-50%)` at a fixed 260px. That centres it on the trigger with no
 * knowledge of the viewport, so any trigger within ~130px of an edge pushed the
 * bubble off-screen, cut the text off, and on the pricing cards it added a
 * horizontal scrollbar to the whole page. The rightmost card in a grid hits
 * this every time, not occasionally.
 *
 * So the bubble is positioned FIXED and clamped to the viewport, and it flips
 * below the icon when there is not enough room above. This mirrors the product
 * app's InfoTooltip in Intake.tsx, which solved the same problem for the same
 * reason; the two are deliberately the same behaviour.
 *
 * Fixed positioning also escapes any `overflow: hidden` ancestor, which is what
 * clips a popover mid-sentence inside a rounded card.
 *
 * Opens on hover, on click, and on keyboard focus, so it is reachable without a
 * pointer. A fixed layer does not travel with the page, so it closes on scroll
 * and resize rather than being left stranded beside the wrong element.
 *
 * On the eligibility check these explanations sit inline after the question
 * rather than as a block underneath it. They are the difference between a
 * confident answer and a wrong one, but printing all of them at once turned a
 * two-question step into a wall of grey boxes, which is why they are behind an
 * icon at all.
 */
export function InfoTip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const measure = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(260, window.innerWidth - 16);
      // Clamp so a trigger near either edge keeps the whole bubble on screen.
      const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
      const below = r.top < 120;
      setBox({ left, top: below ? r.bottom + 6 : r.top - 6, width, below });
    };
    measure();
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
      <button
        type="button"
        ref={btnRef}
        aria-label={label ?? "More information"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--tf-muted)",
          padding: "2px",
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <Info size={16} />
      </button>
      {open && box && (
        <span
          role="tooltip"
          style={{
            position: "fixed",
            left: box.left,
            top: box.top,
            transform: box.below ? "none" : "translateY(-100%)",
            width: box.width,
            zIndex: 100,
            background: "var(--tf-nav)",
            color: "white",
            fontSize: "0.8125rem",
            fontWeight: 500,
            lineHeight: 1.5,
            padding: "0.75rem 1rem",
            borderRadius: "0.5rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            textAlign: "left",
            textTransform: "none",
            letterSpacing: "normal",
            whiteSpace: "normal",
            overflowWrap: "break-word",
            pointerEvents: "none",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
