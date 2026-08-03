import { useState } from "react";
import { NavLink, Link } from "react-router";
import type { User } from "@supabase/supabase-js";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { Sun, Moon, Menu, X } from "lucide-react";

const headerLogo = `${import.meta.env.BASE_URL}header.png`;

const navLinks = [
  { to: "/", label: "Home", exact: true },
  { to: "/pricing", label: "Pricing" },
  { to: "/services", label: "Services" },
  { to: "/past-filings", label: "Past Filings" },
  { to: "/resources", label: "Resources" },
  { to: "/faq", label: "FAQ" },
  // NO WAITLIST ENTRY. The marketing site was un-waitlisted on 3 Aug 2026 and
  // its own Nav.tsx never had one, so this repo's copy was showing a seventh
  // item that does not exist on filetax.co. It also reached the published
  // /guide screenshots, which are captured from THIS app, so the walkthrough
  // advertised a nav the live site does not have. The /waitlist ROUTE stays:
  // IRS fax and the Coming Soon list still link to it directly.
];

// --- helpers for the user chip ---------------------------------------------
function getDisplayName(user: User): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = typeof meta.full_name === "string" ? meta.full_name : "";
  const name = typeof meta.name === "string" ? meta.name : "";
  return fullName || name || (user.email ? user.email.split("@")[0] : "Account");
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function UserChip({ user, onClick }: { user: User; onClick?: () => void }) {
  const name = getDisplayName(user);
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : undefined;

  return (
    <Link
      to="/dashboard"
      onClick={onClick}
      aria-label={`Open profile for ${name}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        color: "white",
        textDecoration: "none",
        padding: "0.25rem 0.625rem 0.25rem 0.25rem",
        borderRadius: "9999px",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        minHeight: "44px",
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          width={32}
          height={32}
          style={{ width: 32, height: 32, borderRadius: "9999px", objectFit: "cover" }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: "9999px",
            background: "#0284C7",
            color: "white",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: "0.8125rem",
          }}
        >
          {getInitials(name)}
        </span>
      )}
      <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{name}</span>
    </Link>
  );
}
// ---------------------------------------------------------------------------

export function Nav() {
  const { theme, toggleTheme } = useTheme();
  const { user, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      style={{ background: "#0F172A" }}
      role="navigation"
      aria-label="Main navigation"
    >
      <div
        style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 1rem" }}
        className="flex items-center justify-between h-16"
      >
        {/* Logo */}
        <Link
          to="/"
          aria-label="Home"
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          <img
            src={headerLogo}
            alt="Logo"
            height={36}
            style={{ height: 36, width: "auto", display: "block" }}
          />
        </Link>

        {/* Desktop Nav Links */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.exact}
              style={({ isActive }) => ({
                color: isActive ? "#0284C7" : "white",
                fontWeight: 600,
                fontSize: "0.9375rem",
                textDecoration: "none",
                padding: "0.375rem 0.625rem",
                borderBottom: isActive ? "2px solid #0284C7" : "2px solid transparent",
                display: "inline-block",
              })}
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        {/* Right: theme toggle + auth + CTA */}
        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              background: "transparent",
              border: "none",
              color: "white",
              cursor: "pointer",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "44px",
              minHeight: "44px",
            }}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {!loading && (
            user ? (
              <UserChip user={user} />
            ) : (
              <>
                <Link
                  to="/portal?mode=login"
                  style={{
                    color: "white",
                    fontWeight: 600,
                    fontSize: "0.9375rem",
                    textDecoration: "none",
                    padding: "0.5rem 0.75rem",
                    minHeight: "44px",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  Log in
                </Link>
                <Link
                  to="/portal?mode=signup"
                  style={{
                    color: "white",
                    fontWeight: 600,
                    fontSize: "0.9375rem",
                    textDecoration: "none",
                    padding: "0.5rem 0.875rem",
                    border: "1px solid rgba(255,255,255,0.25)",
                    borderRadius: "0.5rem",
                    minHeight: "44px",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  Sign up
                </Link>
              </>
            )
          )}

          <Link
            to="/check"
            style={{
              background: "#0284C7",
              color: "white",
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
              padding: "0.5rem 1.125rem",
              borderRadius: "0.5rem",
              // inline-flex + centring, matching Log in and Sign up beside it.
              // This was inline-block with a lineHeight nudge. The box was the
              // right 44px, but inline-block cannot centre its content, so the
              // 4px of slack min-height added all fell BELOW the text and the
              // label sat 2px high next to its neighbours. Measured rather than
              // eyeballed: 10.4px above and 14.4px below, against 12.4/12.4.
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "nowrap",
              minHeight: "44px",
            }}
          >
            Check Eligibility
          </Link>
        </div>

        {/* Mobile: theme toggle + hamburger */}
        <div className="flex md:hidden items-center gap-2">
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              background: "transparent",
              border: "none",
              color: "white",
              cursor: "pointer",
              padding: "0.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "44px",
              minHeight: "44px",
            }}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            style={{
              background: "transparent",
              border: "none",
              color: "white",
              cursor: "pointer",
              padding: "0.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "44px",
              minHeight: "44px",
            }}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          style={{ background: "#0F172A", borderTop: "1px solid #1E293B" }}
          className="md:hidden"
        >
          <div style={{ padding: "0.75rem 1rem 1rem" }} className="flex flex-col">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.exact}
                onClick={() => setMobileOpen(false)}
                style={({ isActive }) => ({
                  color: isActive ? "#0284C7" : "white",
                  fontWeight: 600,
                  fontSize: "1rem",
                  textDecoration: "none",
                  padding: "0.75rem 0.5rem",
                  borderBottom: "1px solid #1E293B",
                  display: "block",
                })}
              >
                {link.label}
              </NavLink>
            ))}

            {!loading && (
              user ? (
                <div
                  style={{
                    padding: "0.75rem 0.5rem",
                    borderBottom: "1px solid #1E293B",
                  }}
                >
                  <UserChip user={user} onClick={() => setMobileOpen(false)} />
                </div>
              ) : (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <Link
                    to="/portal?mode=login"
                    onClick={() => setMobileOpen(false)}
                    style={{
                      flex: 1,
                      color: "white",
                      fontWeight: 600,
                      fontSize: "1rem",
                      textDecoration: "none",
                      padding: "0.75rem 1rem",
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: "0.5rem",
                      textAlign: "center",
                      minHeight: "44px",
                    }}
                  >
                    Log in
                  </Link>
                  <Link
                    to="/portal?mode=signup"
                    onClick={() => setMobileOpen(false)}
                    style={{
                      flex: 1,
                      color: "white",
                      fontWeight: 600,
                      fontSize: "1rem",
                      textDecoration: "none",
                      padding: "0.75rem 1rem",
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: "0.5rem",
                      textAlign: "center",
                      minHeight: "44px",
                    }}
                  >
                    Sign up
                  </Link>
                </div>
              )
            )}

            <Link
              to="/check"
              onClick={() => setMobileOpen(false)}
              style={{
                background: "#0284C7",
                color: "white",
                fontWeight: 600,
                fontSize: "1rem",
                textDecoration: "none",
                padding: "0.75rem 1rem",
                borderRadius: "0.5rem",
                // Same fix as the desktop button. Full width here, so flex with
                // centred content rather than block plus textAlign.
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: "0.75rem",
                minHeight: "44px",
              }}
            >
              Check Eligibility
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
