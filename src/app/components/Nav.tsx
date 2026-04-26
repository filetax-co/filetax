import { useState } from "react";
import { NavLink, Link } from "react-router";
import type { User } from "@supabase/supabase-js";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { Sun, Moon, Menu, X } from "lucide-react";

const navLinks = [
  { to: "/", label: "Home", exact: true },
  { to: "/pricing", label: "Pricing" },
  { to: "/services", label: "Services" },
  { to: "/past-filings", label: "Past Filings" },
  { to: "/resources", label: "Resources" },
  { to: "/faq", label: "FAQ" },
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
          style={{
            color: "#0284C7",
            fontWeight: 700,
            fontSize: "1.25rem",
            textDecoration: "none",
            fontFamily: "'Satoshi', sans-serif",
          }}
          aria-label="FileTax.co - Home"
        >
          FileTax.co
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

          {/* Auth area: avatar+name when logged in, Log in/Sign up when not */}
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
              display: "inline-block",
              whiteSpace: "nowrap",
              minHeight: "44px",
              lineHeight: "1.6",
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

            {/* Auth area (mobile) */}
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
                display: "block",
                textAlign: "center",
                marginTop: "0.75rem",
                minHeight: "44px",
                lineHeight: "1.6",
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
