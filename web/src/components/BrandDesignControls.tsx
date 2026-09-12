import type { CSSProperties } from "react";
import type { BrandDesign } from "../lib/brand-design";

const choices = [
  ["surface", "Site background", ["navy", "charcoal", "light"]],
  ["typography", "Heading style", ["modern", "rounded", "editorial"]],
  ["corners", "Card corners", ["soft", "rounded", "square"]],
  ["finish", "Visual effects", ["glow", "outline", "plain"]],
  ["width", "Page width", ["comfortable", "wide", "full"]],
  ["navigation", "Section navigation", ["side", "top", "hidden"]],
] as const;
const visibility = [
  ["hero_art", "Home card artwork"], ["home_explore", "Home shortcuts"], ["home_updates", "Home updates"],
  ["home_community", "Home community activity"], ["home_roadmap", "Home roadmap"],
  ["dashboard_history", "Dashboard value history"], ["dashboard_recent", "Dashboard recent cards"],
  ["dashboard_decks", "Dashboard recent decks"], ["dashboard_sets", "Dashboard top sets"], ["dashboard_attention", "Dashboard attention panel"],
] as const;
export function BrandDesignControls({ design, onChange, disabled, siteName, productName, tagline, logo }: {
  design: BrandDesign; onChange: (next: BrandDesign) => void; disabled: boolean;
  siteName: string; productName: string; tagline: string; logo: string;
}) {
  function update<K extends keyof BrandDesign>(key: K, value: BrandDesign[K]) { onChange({ ...design, [key]: value }); }
  const style = { "--preview-accent": design.accent, "--preview-secondary": design.secondary,
    "--preview-bg": design.surface === "light" ? "#edf2f8" : design.surface === "charcoal" ? "#14171b" : "#0b1423",
    "--preview-ink": design.surface === "light" ? "#142137" : "#f5f8ff",
    borderRadius: design.corners === "square" ? 0 : design.corners === "rounded" ? 28 : 14,
    fontFamily: design.typography === "editorial" ? "Georgia,serif" : design.typography === "rounded" ? "ui-rounded,system-ui,sans-serif" : "inherit",
  } as CSSProperties;
  return <div className="brand-design-controls">
    <div className={`brand-design-preview preview-${design.finish}`} style={style} aria-label="Site design draft preview">
      <div className="brand-preview-wordmark"><img src={logo} alt="Draft logo" /><span>{siteName}<small>{productName}</small></span><span className="brand-preview-badge">Draft preview</span></div>
      {design.announcement && <p>{design.announcement}</p>}
      <small>{design.home_eyebrow}</small><h3>{tagline || productName}</h3><p>{design.home_description}</p>
      <div className="brand-preview-panels"><span>Scan your next card <b>→</b></span><span>Your collection <b>▤</b></span></div>
      <small>{design.footer_text}</small>
    </div>
    <fieldset disabled={disabled}><legend>Colors & character</legend><p>Site background is the default for System mode. Personal themes, text size, contrast, and reduced motion remain available in Account.</p>
      <div className="brand-design-grid">
        <label>Primary brand color<input type="color" value={design.accent} onChange={e => update("accent", e.target.value)} /></label>
        <label>Secondary brand color<input type="color" value={design.secondary} onChange={e => update("secondary", e.target.value)} /></label>
        {choices.map(([key, label, values]) => <label key={key}>{label}<select value={design[key]} onChange={e => update(key, e.target.value)}>{values.map(v => <option key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></label>)}
      </div>
    </fieldset>
    <fieldset disabled={disabled}><legend>Words & welcome</legend><div className="brand-design-grid">
      {([ ["home_eyebrow", "Home introduction label", 120], ["home_description", "Home welcome text", 400], ["dashboard_eyebrow", "Dashboard introduction label", 100], ["footer_text", "Footer message", 180], ["announcement", "Site announcement (optional)", 200] ] as const).map(([key,label,limit]) => <label key={key}>{label}<textarea rows={key === "home_description" ? 3 : 2} maxLength={limit} value={design[key]} onChange={e => update(key,e.target.value)} /></label>)}
    </div></fieldset>
    <fieldset disabled={disabled}><legend>Choose visible sections</legend><p>Hidden sections keep their data and can be shown again at any time.</p><div className="brand-visibility-grid">{visibility.map(([key,label]) => <label key={key}><input type="checkbox" checked={design[key]} onChange={e => update(key,e.target.checked)} />{label}</label>)}</div></fieldset>
    <p className="brand-save-note">Changes stay in this preview until you select Save. Shared branding is visible on Home and sign-in; account information remains private.</p>
  </div>;
}
