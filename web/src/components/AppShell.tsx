import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../app/auth";
import { useBranding } from "../app/branding";
import { MEMBER_TRADING_ENABLED } from "../app/features";
import { LogoMark } from "./LogoMark";

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const [headerHidden, setHeaderHidden] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    function clearHideTimer() {
      if (hideTimer.current !== null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    }

    function showAndScheduleHide() {
      clearHideTimer();
      setHeaderHidden(false);
      if (window.scrollY <= 64) return;
      hideTimer.current = window.setTimeout(() => setHeaderHidden(true), 18_000);
    }

    function handleMouseMove(event: MouseEvent) {
      if (event.clientY <= 28) showAndScheduleHide();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") showAndScheduleHide();
    }

    function handleTouchStart(event: TouchEvent) {
      if (event.touches[0]?.clientY <= 28) showAndScheduleHide();
    }

    function holdHeaderOpen() {
      clearHideTimer();
      setHeaderHidden(false);
    }

    const headerElement = headerRef.current;
    window.addEventListener("scroll", showAndScheduleHide, { passive: true });
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    headerElement?.addEventListener("mouseenter", holdHeaderOpen);
    headerElement?.addEventListener("mouseleave", showAndScheduleHide);
    return () => {
      clearHideTimer();
      window.removeEventListener("scroll", showAndScheduleHide);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("touchstart", handleTouchStart);
      headerElement?.removeEventListener("mouseenter", holdHeaderOpen);
      headerElement?.removeEventListener("mouseleave", showAndScheduleHide);
    };
  }, []);

  const forcedPasswordChange =
    auth.status === "authenticated" && Boolean(auth.user?.must_change_password);
  const forcedMfaSetup =
    auth.status === "authenticated" && Boolean(auth.user?.must_setup_mfa);
  const canAdminister =
    auth.user?.role === "owner" || auth.user?.role === "super_admin" || auth.user?.role === "admin";
  const workspaceRole = auth.user?.role === "super_admin"
    ? "Super admin workspace"
    : auth.user?.role
      ? `${auth.user.role.charAt(0).toUpperCase()}${auth.user.role.slice(1)} workspace`
      : "LAN protected";

  async function signOut() {
    await auth.logout();
    navigate("/");
  }

  return (
    <div className="site-frame">
      <a className="skip-link" href="#main">Skip to content</a>
      <header ref={headerRef} className={`site-header${headerHidden ? " is-idle-hidden" : ""}`}>
        <div className="header-topline">
          <Link className="brand" to="/" aria-label={`${branding.site_name} ${branding.product_name} home`}>
            <LogoMark branding={branding} />
            <span><strong>{branding.site_name}</strong><small>{branding.product_name.toUpperCase()}</small></span>
          </Link>
          <div className="header-account" aria-label="Current workspace">
            <span className="header-signal" aria-hidden="true" />
            <span>
              <strong className="header-account-name">
                {auth.status === "authenticated" ? auth.user?.display_name : "Private card workspace"}
              </strong>
              <small className="header-account-role">{workspaceRole}</small>
            </span>
          </div>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <NavLink to="/">Home</NavLink>
          {auth.status === "authenticated" ? (
            <>
              {!forcedPasswordChange && !forcedMfaSetup && (
                <>
                  <NavLink to="/dashboard">Dashboard</NavLink>
                  <NavLink to="/cards">Cards</NavLink>
                  <NavLink to="/collection">Collection</NavLink>
                  <NavLink to="/scan">Scan</NavLink>
                  <NavLink to="/decks">Decks</NavLink>
                  {MEMBER_TRADING_ENABLED && <NavLink to="/trades">Trades</NavLink>}
                  <NavLink to="/account">Account</NavLink>
                  {canAdminister && <NavLink to="/admin">Admin</NavLink>}
                </>
              )}
              {forcedMfaSetup && <NavLink to="/account">Account</NavLink>}
              <button className="nav-button" onClick={() => void signOut()}>Sign out</button>
            </>
          ) : (
            <NavLink className="nav-cta" to="/login">Sign in</NavLink>
          )}
        </nav>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <span>{branding.site_name} {branding.product_name}</span>
        <span>{branding.tagline}</span>
      </footer>
    </div>
  );
}
