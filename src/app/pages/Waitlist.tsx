import { useState, useEffect, useRef } from "react";
import { useSearchParams, Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";

const FORMSPREE_ENDPOINT = "https://formspree.io/f/mlgzrgnd";

const SERVICES = [
  { id: "5472", label: "Form 5472 + Pro Forma 1120 Filing" },
  { id: "past-filing", label: "Past Year Filing + CPA-Authored Reasonable Cause Letter" },
  { id: "llc-classification", label: "LLC Tax Classification Change" },
  { id: "irs-fax", label: "IRS Fax Transmission" },
  { id: "form-7004", label: "Form 7004 - Automatic 6-Month Extension" },
  { id: "fbar", label: "FBAR / FinCEN 114 Reporting" },
  { id: "wyoming-annual", label: "Annual Report - Wyoming" },
];

type Status = "idle" | "submitting" | "success" | "error";

export function Waitlist() {
  usePageMeta({
    title: "Join the Waitlist | FileTax.co",
    description:
      "Get notified when a new service launches on FileTax.co. Enter your name and email and select the services you are interested in.",
  });

  const [searchParams] = useSearchParams();
  const preselected = searchParams.get("service") ?? "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>(() =>
    SERVICES.some((s) => s.id === preselected) ? [preselected] : []
  );
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<{ name?: string; email?: string; services?: string }>({});
  const [submitError, setSubmitError] = useState<string>("");

  // Dropdown state
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync preselected service from URL
  useEffect(() => {
    if (preselected && SERVICES.some((s) => s.id === preselected)) {
      setSelected((prev) =>
        prev.includes(preselected) ? prev : [...prev, preselected]
      );
    }
  }, [preselected]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close dropdown on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function toggleService(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function validate() {
    const e: typeof errors = {};
    if (!name.trim()) e.name = "Please enter your name.";
    if (!email.trim()) e.email = "Please enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Please enter a valid email address.";
    if (selected.length === 0) e.services = "Please select at least one service.";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setSubmitError("");
    setStatus("submitting");

    try {
      // Map selected service ids back to readable labels for the email
      const selectedLabels = selected
        .map((id) => SERVICES.find((s) => s.id === id)?.label ?? id)
        .join(", ");

      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          services: selectedLabels,
          _subject: `New waitlist signup: ${name}`,
        }),
      });

      if (!response.ok) {
        throw new Error(`Submission failed (${response.status})`);
      }

      setStatus("success");
    } catch (err) {
      setStatus("error");
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    }
  }

  // Label shown in the dropdown trigger
  const triggerLabel =
    selected.length === 0
      ? "Select services..."
      : selected.length === 1
        ? SERVICES.find((s) => s.id === selected[0])?.label ?? "1 service selected"
        : `${selected.length} services selected`;

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "600px", margin: "0 auto" }}>
          <Link
            to="/"
            style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.375rem", marginBottom: "1.5rem" }}
          >
            &#8592; Back to Home
          </Link>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.25rem)", marginBottom: "0.625rem" }}>
            Stay in the loop
          </h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6 }}>
            Select the services you are interested in and we will reach out as soon as they are ready.
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "2.5rem 1rem 4rem" }}>
        <div style={{ maxWidth: "600px", margin: "0 auto" }}>

          {status === "success" ? (
            <div
              style={{
                background: "var(--tf-bg)",
                border: "1px solid #059669",
                borderRadius: "0.75rem",
                padding: "2.5rem 2rem",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>&#10003;</div>
              <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>You are on the list</h2>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, marginBottom: "1.5rem" }}>
                We will email you at <strong style={{ color: "var(--tf-text)" }}>{email}</strong> when the selected services are available.
              </p>
              <Link
                to="/"
                style={{
                  background: "#0284C7",
                  color: "white",
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  padding: "0.625rem 1.5rem",
                  borderRadius: "0.5rem",
                  textDecoration: "none",
                  display: "inline-block",
                  minHeight: "44px",
                  lineHeight: "1.8",
                }}
              >
                Back to Home
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              {/* Name */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label
                  htmlFor="wl-name"
                  style={{ display: "block", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.375rem" }}
                >
                  Your name
                </label>
                <input
                  id="wl-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.875rem",
                    borderRadius: "0.5rem",
                    border: `1px solid ${errors.name ? "#B31D1D" : "var(--tf-border)"}`,
                    background: "var(--tf-bg)",
                    color: "var(--tf-text)",
                    fontSize: "1rem",
                    outline: "none",
                    minHeight: "44px",
                  }}
                />
                {errors.name && (
                  <p style={{ color: "#B31D1D", fontSize: "0.8125rem", marginTop: "0.25rem" }}>{errors.name}</p>
                )}
              </div>

              {/* Email */}
              <div style={{ marginBottom: "1.75rem" }}>
                <label
                  htmlFor="wl-email"
                  style={{ display: "block", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.375rem" }}
                >
                  Email address
                </label>
                <input
                  id="wl-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.875rem",
                    borderRadius: "0.5rem",
                    border: `1px solid ${errors.email ? "#B31D1D" : "var(--tf-border)"}`,
                    background: "var(--tf-bg)",
                    color: "var(--tf-text)",
                    fontSize: "1rem",
                    outline: "none",
                    minHeight: "44px",
                  }}
                />
                {errors.email && (
                  <p style={{ color: "#B31D1D", fontSize: "0.8125rem", marginTop: "0.25rem" }}>{errors.email}</p>
                )}
              </div>

              {/* Services dropdown */}
              <fieldset style={{ border: "none", padding: 0, margin: "0 0 1.75rem" }}>
                <legend style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.375rem", display: "block" }}>
                  Services you are interested in
                </legend>

                <div ref={dropdownRef} style={{ position: "relative" }}>
                  {/* Trigger */}
                  <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    style={{
                      width: "100%",
                      padding: "0.625rem 0.875rem",
                      borderRadius: "0.5rem",
                      border: `1px solid ${errors.services ? "#B31D1D" : "var(--tf-border)"}`,
                      background: "var(--tf-bg)",
                      color: "var(--tf-text)",
                      fontSize: "1rem",
                      cursor: "pointer",
                      minHeight: "44px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      textAlign: "left",
                      outline: "none",
                    }}
                  >
                    <span
                      style={{
                        color: selected.length === 0 ? "var(--tf-muted)" : "var(--tf-text)",
                        fontWeight: selected.length === 0 ? 400 : 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {triggerLabel}
                    </span>
                    <span
                      style={{
                        marginLeft: "0.5rem",
                        fontSize: "0.625rem",
                        color: "var(--tf-muted)",
                        transition: "transform 140ms",
                        transform: open ? "rotate(180deg)" : "rotate(0)",
                        flexShrink: 0,
                      }}
                      aria-hidden="true"
                    >
                      ▼
                    </span>
                  </button>

                  {/* Dropdown panel */}
                  {open && (
                    <div
                      role="listbox"
                      aria-multiselectable="true"
                      style={{
                        position: "absolute",
                        top: "calc(100% + 0.25rem)",
                        left: 0,
                        right: 0,
                        zIndex: 50,
                        background: "var(--tf-bg)",
                        border: "1px solid var(--tf-border)",
                        borderRadius: "0.5rem",
                        padding: "0.5rem",
                        maxHeight: "340px",
                        overflowY: "auto",
                        boxShadow: "0 10px 25px rgba(0,0,0,0.18)",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                        {SERVICES.map((svc) => {
                          const checked = selected.includes(svc.id);
                          return (
                            <label
                              key={svc.id}
                              role="option"
                              aria-selected={checked}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.625rem",
                                padding: "0.5rem 0.625rem",
                                borderRadius: "0.375rem",
                                background: checked ? "rgba(2,132,199,0.08)" : "transparent",
                                cursor: "pointer",
                                fontSize: "0.9375rem",
                                fontWeight: checked ? 600 : 400,
                                color: "var(--tf-text)",
                                transition: "background 140ms",
                                minHeight: "36px",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleService(svc.id)}
                                style={{ width: "1rem", height: "1rem", accentColor: "#0284C7", flexShrink: 0 }}
                              />
                              {svc.label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {errors.services && (
                  <p style={{ color: "#B31D1D", fontSize: "0.8125rem", marginTop: "0.5rem" }}>{errors.services}</p>
                )}
              </fieldset>

              {/* Submission error */}
              {status === "error" && submitError && (
                <div
                  role="alert"
                  style={{
                    background: "rgba(179,29,29,0.06)",
                    border: "1px solid #B31D1D",
                    color: "#B31D1D",
                    borderRadius: "0.5rem",
                    padding: "0.75rem 1rem",
                    fontSize: "0.875rem",
                    marginBottom: "1rem",
                  }}
                >
                  {submitError} Please try again, or email us directly if the problem persists.
                </div>
              )}

              <button
                type="submit"
                disabled={status === "submitting"}
                style={{
                  background: "#0284C7",
                  color: "white",
                  fontWeight: 600,
                  fontSize: "1rem",
                  padding: "0.75rem 1.75rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  cursor: status === "submitting" ? "not-allowed" : "pointer",
                  opacity: status === "submitting" ? 0.7 : 1,
                  minHeight: "44px",
                  width: "100%",
                  transition: "opacity 140ms",
                }}
              >
                {status === "submitting" ? "Submitting..." : "Join the Waitlist"}
              </button>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
