import { useState, useEffect } from "react";
import { Link } from "react-router";

interface DeadlinePair {
  primary: Date;
  extension: Date;
}

interface NextDeadline {
  target: Date;
  /** Calendar year the deadline falls in. The tax year it covers is this minus one. */
  year: number;
  phase: "primary" | "extension";
  /**
   * True once the previous tax year's October extension has passed, which is
   * exactly the primary-deadline window: 16 October through 15 April. In the
   * extension window (16 April to 15 October) the prior year is not yet late.
   */
  priorYearLate: boolean;
}

/**
 * The next deadline that has not yet passed, looking into next year when the
 * current year's October extension is behind us. Computing only the current
 * calendar year left the clock dead from 16 October to 31 December.
 */
export function getNextDeadline(now: Date): NextDeadline {
  const startYear = now.getFullYear();
  for (let year = startYear; year <= startYear + 1; year++) {
    const { primary, extension } = getIRSDeadlines(year);
    if (now <= primary) return { target: primary, year, phase: "primary", priorYearLate: true };
    if (now <= extension) return { target: extension, year, phase: "extension", priorYearLate: false };
  }
  // Unreachable: next year's April deadline is always ahead of any date this year.
  const { primary } = getIRSDeadlines(startYear + 1);
  return { target: primary, year: startYear + 1, phase: "primary", priorYearLate: true };
}

function getIRSDeadlines(year: number): DeadlinePair {
  // April 15 23:59:59 ET (EDT = UTC-4) = April 16 03:59:59 UTC
  let primary = new Date(Date.UTC(year, 3, 16, 3, 59, 59));
  // October 15 23:59:59 ET (EDT = UTC-4) = October 16 03:59:59 UTC
  let extension = new Date(Date.UTC(year, 9, 16, 3, 59, 59));

  const adjust = (d: Date) => {
    const day = d.getUTCDay();
    if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
    if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
    return d;
  };

  return { primary: adjust(primary), extension: adjust(extension) };
}

export function IRSClock() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const { target, year, phase, priorYearLate } = getNextDeadline(now);

  const label =
    phase === "extension"
      ? "April 15 deadline has passed."
      : "Next IRS Filing Deadline (Form 5472):";
  const sublabel =
    phase === "extension"
      ? `If you filed Form 7004, your extended deadline is October 15, ${year}:`
      : `For the ${year - 1} tax year, due April 15, ${year}:`;

  const diff = target.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / 1000 / 60) % 60);

  return (
    <div className="clock-active">
      <p className="clock-label">{label}</p>
      {sublabel && <p className="clock-sublabel">{sublabel}</p>}
      <div className="clock-units">
        <div className="clock-unit">
          <span className="clock-num">{days}</span>
          <span className="clock-tag">days</span>
        </div>
        <div className="clock-unit">
          <span className="clock-num">{hours}</span>
          <span className="clock-tag">hrs</span>
        </div>
        <div className="clock-unit">
          <span className="clock-num">{mins}</span>
          <span className="clock-tag">min</span>
        </div>
      </div>
      {priorYearLate && (
        <p className="clock-late-note">
          The {year - 2} tax year deadline has passed. If you missed it, you can
          still file voluntarily.{" "}
          <Link to="/past-filings">Fix a missed year</Link>
        </p>
      )}
    </div>
  );
}