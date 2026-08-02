import { Link, useRouteError, isRouteErrorResponse } from "react-router";

// ---------------------------------------------------------------------
// Route-level error boundary.
//
// Without an `errorElement`, React Router renders its own developer screen:
// "Unexpected Application Error!", the raw message, a full stack trace, and a
// note addressed to "Hey developer". In development that is useful. In
// production it shows a stack trace to a stranger who came here about a
// $25,000 tax penalty, which reads as a broken site and tells them nothing
// about what to do.
//
// So: a plain apology and a way out in production, the real error in dev,
// where it is the whole point. The stack still reaches the console either way,
// so nothing is lost in debugging terms.
// ---------------------------------------------------------------------
export function RouteError() {
  const error = useRouteError();

  const is404 = isRouteErrorResponse(error) && error.status === 404;
  const detail =
    isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`
      : error instanceof Error
        ? error.message
        : String(error ?? "Unknown error");

  // The stack is worth having in the console even in production: it costs the
  // reader nothing and saves a support round trip.
  if (import.meta.env.DEV) console.error(error);

  return (
    <section style={{ background: "var(--tf-bg)", padding: "5rem 1rem 6rem" }}>
      <div style={{ maxWidth: "560px", margin: "0 auto", textAlign: "center" }}>
        <p
          style={{
            color: "var(--tf-muted)",
            fontSize: "0.75rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: "0.75rem",
          }}
        >
          {is404 ? "Page not found" : "Something went wrong"}
        </p>
        <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2.125rem)", marginBottom: "0.875rem", lineHeight: 1.2 }}>
          {is404 ? "That page does not exist." : "This page did not load properly."}
        </h1>
        <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "0.75rem" }}>
          {is404
            ? "The link may be out of date. Everything below still works."
            : "The fault is ours, not yours, and nothing you entered has been lost. Reloading usually clears it."}
        </p>
        <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6, marginBottom: "2rem" }}>
          If it keeps happening, email{" "}
          <a href="mailto:hello@filetax.co" style={{ color: "var(--tf-accent)", fontWeight: 600, textDecoration: "none" }}>
            hello@filetax.co
          </a>{" "}
          and we will sort it out. We respond within 1 business day.
        </p>

        <div className="flex flex-wrap gap-3 justify-center">
          {!is404 && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: "var(--tf-accent)", color: "white", fontWeight: 600, fontSize: "1rem",
                padding: "0.75rem 1.75rem", borderRadius: "0.5rem", border: "1px solid transparent",
                minHeight: "44px", cursor: "pointer",
              }}
            >
              Reload the page
            </button>
          )}
          <Link
            to="/"
            style={{
              background: is404 ? "var(--tf-accent)" : "transparent",
              color: is404 ? "white" : "var(--tf-text)",
              fontWeight: 600, fontSize: "1rem",
              padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: is404 ? "1px solid transparent" : "1px solid oklch(from var(--tf-text, #0F172A) l c h / 0.2)",
              minHeight: "44px",
            }}
          >
            Back to home
          </Link>
        </div>

        {/* Dev only. In production this is exactly the stack trace we are
            trying not to show a stranger. */}
        {import.meta.env.DEV && (
          <pre
            style={{
              marginTop: "2.5rem",
              textAlign: "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "var(--tf-surface)",
              border: "1px solid var(--tf-border)",
              borderRadius: "0.5rem",
              padding: "1rem",
              fontSize: "0.8125rem",
              color: "var(--tf-error, #B31D1D)",
              overflowX: "auto",
            }}
          >
            {detail}
            {error instanceof Error && error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        )}
      </div>
    </section>
  );
}
