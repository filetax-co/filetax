import { useState, useEffect } from "react";
import { Link } from "react-router";

interface DeadlinePair {
  primary: Date;
  extension: Date;
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
  const year = now.getFullYear();
  const { primary, extension } = getIRSDeadlines(year);

  if (now > extension) {
    return (
      <div className="clock-pastdue">
        <p style={{ fontWeight: 700, marginBottom: "0.5rem" }}>
          The filing deadline for {year} has passed.
        </p>
        <p style={{ fontSize: "0.9375rem", marginBottom: "1rem" }}>
          Late filing penalties may apply. File now to limit exposure. Adding a
          Reasonable Cause Letter gives you the best chance at penalty
          abatement.
        </p>
        <div className="clock-actions">
          <Link
            to="/past-filings"
            style={{
              background: "white",
              color: "#B31D1D",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Fix a Missed Year
          </Link>
          <Link
            to="/check"
            style={{
              background: "rgba(255,255,255,0.15)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.3)",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Start My Filing
          </Link>
        </div>
      </div>
    );
  }

  let target = primary;
  let label = "Next IRS Filing Deadline (Form 5472):";
  let sublabel = "";

  if (now > primary) {
    target = extension;
    label = "April 15 deadline has passed.";
    sublabel = "If you filed Form 7004, your extended deadline is October 15:";
  }

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
    </div>
  );
}