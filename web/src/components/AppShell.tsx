import {WorkspaceNavigation} from "./workspace/WorkspaceNavigation";
import {WorkspaceSearch} from "./workspace/WorkspaceSearch";
import {useWorkspaceLayout} from "../lib/use-workspace-layout";
import {applyWorkspaceLayout} from "../lib/workspace-layout";
import {WorkspaceBackground} from "./WorkspaceBackground";
import { ScanPrizeFeedback } from "../presentation/rewards";
import { WorkspaceEffects } from "./WorkspaceEffects";
import { brandDesign } from "../lib/brand-design";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";

import { useAuth } from "../app/auth";
import { useBranding } from "../app/branding";
import { MEMBER_TRADING_ENABLED } from "../app/features";
import { DEFAULT_BRANDING } from "../lib/branding";
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

  const {layout}=useWorkspaceLayout();
  const location=useLocation();
  const [collapsed,setCollapsed]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false);
  const menuButton=useRef<HTMLButtonElement>(null);
  const drawer=useRef<HTMLDivElement>(null);
  useEffect(()=>applyWorkspaceLayout(layout),[layout]);
  useEffect(()=>setMenuOpen(false),[location.pathname]);
  useEffect(()=>{
    if(!menuOpen)return;
    const first=drawer.current?.querySelector<HTMLElement>('a,button');first?.focus();
    function key(e:KeyboardEvent){if(e.key==='Escape'){setMenuOpen(false);menuButton.current?.focus();}if(e.key==='Tab'){
      const items=Array.from(drawer.current?.querySelectorAll<HTMLElement>('a,button')??[]);const first=items[0],last=items[items.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }}
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[menuOpen]);

  const forcedPasswordChange =
    auth.status === "authenticated" && Boolean(auth.user?.must_change_password);
  const forcedMfaSetup =
    auth.status === "authenticated" && Boolean(auth.user?.must_setup_mfa);
  const canAdminister =
    auth.user?.role === "owner" || auth.user?.role === "super_admin" || auth.user?.role === "admin";
  const siteName = branding.site_name?.trim() || DEFAULT_BRANDING.site_name;
  const productName = branding.product_name?.trim() || DEFAULT_BRANDING.product_name;
  const tagline = branding.tagline?.trim() || DEFAULT_BRANDING.tagline;
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
    <div className={`site-frame collector-shell ${auth.status === "authenticated" ? "is-member" : "is-guest"}${collapsed ? " sidebar-collapsed" : ""}`}>
      <WorkspaceBackground/><WorkspaceEffects /><ScanPrizeFeedback />
      <a className="skip-link" href="#main">Skip to content</a>
      <header ref={headerRef} className={`site-header workspace-header${headerHidden?" is-idle-hidden":""}`}>
        <div className="header-topline">
          {auth.status === "authenticated"&&<button type="button" className="workspace-collapse" aria-label={collapsed?"Expand sidebar":"Collapse sidebar"} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}>☰</button>}
          <Link className="brand" to="/" aria-label={`${siteName} ${productName} home`}>
            <LogoMark branding={branding} />
            <span><strong>{siteName}</strong><small>{productName.toUpperCase()}</small></span>
          </Link>
          {auth.status === "authenticated"&&!forcedPasswordChange&&!forcedMfaSetup&&<WorkspaceSearch/>}
          {auth.status === "authenticated"&&!forcedPasswordChange&&!forcedMfaSetup&&<Link className="workspace-scan-link" to="/scan">＋ Scan a card</Link>}
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
        {auth.status !== "authenticated"&&<nav aria-label="Primary navigation"><NavLink to="/">Home</NavLink><NavLink to="/login">Sign in</NavLink></nav>}
      </header>
      {auth.status === "authenticated"&&<>
        <aside className="workspace-sidebar"><WorkspaceNavigation admin={canAdminister} restricted={forcedPasswordChange||forcedMfaSetup} accountAllowed={!forcedPasswordChange} onSignOut={()=>void signOut()}/>{!forcedPasswordChange&&!forcedMfaSetup&&<Link className="workspace-customize-link" to="/account#account-look">✦ Make it yours</Link>}</aside>
        <nav className="workspace-mobile-nav" aria-label="Mobile shortcuts"><NavLink to="/" end>⌂<span>Home</span></NavLink>{!forcedPasswordChange&&!forcedMfaSetup&&<><NavLink to="/collection">▤<span>Collection</span></NavLink><NavLink to="/scan">◎<span>Scan</span></NavLink></>}<button ref={menuButton} type="button" onClick={()=>setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="workspace-mobile-menu">☰<span>More</span></button></nav>
        {menuOpen&&<div className="workspace-drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget){setMenuOpen(false);menuButton.current?.focus();}}}><div ref={drawer} id="workspace-mobile-menu" className="workspace-drawer" role="dialog" aria-modal="true" aria-label="All destinations"><button type="button" onClick={()=>{setMenuOpen(false);menuButton.current?.focus();}}>Close menu ×</button><WorkspaceNavigation admin={canAdminister} restricted={forcedPasswordChange||forcedMfaSetup} accountAllowed={!forcedPasswordChange} onSignOut={()=>void signOut()}/></div></div>}
      </>}
      {brandDesign(branding.design).announcement && <aside className="brand-announcement" aria-label="Site announcement">{brandDesign(branding.design).announcement}</aside>}
      <main id="main">{children}</main>
      <footer className="site-footer">
        <span>{siteName} {productName}</span>
        <span>{tagline}</span>
        <small>{brandDesign(branding.design).footer_text}</small>
      </footer>
    </div>
  );
}
