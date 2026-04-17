import { useState } from "react";
import { NavLink, Link } from "react-router";
import { useTheme } from "../context/ThemeContext";
import { Sun, Moon, Menu, X } from "lucide-react";

const navLinks = [
  { to: "/", label: "Home", exact: true },
  { to: "/pricing", label: "Pricing" },
  { to: "/services", label: "Services" },
  { to: "/past-filings", label: "Past Filings" },
  { to: "/resources", label: "Resources" },
  { to: "/faq", label: "FAQ" },
];

export function Nav() {
  const { theme, toggleTheme } = useTheme();
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

        {/* Right: Dark mode toggle + CTA */}
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
            Start My Filing
          </Link>
        </div>

        {/* Mobile: toggle + hamburger */}
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
              Start My Filing
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}