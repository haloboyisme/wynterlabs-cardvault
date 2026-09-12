export const DEFAULT_DESIGN = {
  accent: "#5BE7E7", secondary: "#8BA9FF", surface: "navy", typography: "modern",
  corners: "soft", finish: "glow", width: "comfortable", navigation: "side",
  hero_art: true, home_explore: true, home_updates: true, home_community: true, home_roadmap: true,
  dashboard_history: true, dashboard_recent: true, dashboard_decks: true, dashboard_sets: true, dashboard_attention: true,
  home_eyebrow: "The WynterLabs collection experience",
  home_description: "Your collection. Beautifully in focus. Scan, discover, and organize your cards in a workspace made for collectors.",
  dashboard_eyebrow: "Your collection, in focus", footer_text: "Designed for collectors. Built by WynterLabs.", announcement: "",
};
export type BrandDesign = typeof DEFAULT_DESIGN;
export function brandDesign(value?: Partial<BrandDesign>): BrandDesign { return { ...DEFAULT_DESIGN, ...value }; }
export function applyBrandDesign(design: BrandDesign) {
  const root = document.documentElement;
  for (const key of ["surface", "typography", "corners", "finish", "width", "navigation"] as const) root.setAttribute(`data-brand-${key}`, design[key]);
  root.style.setProperty("--brand-accent", /^#[a-f0-9]{6}$/i.test(design.accent) ? design.accent : DEFAULT_DESIGN.accent);
  root.style.setProperty("--brand-secondary", /^#[a-f0-9]{6}$/i.test(design.secondary) ? design.secondary : DEFAULT_DESIGN.secondary);
  for (const key of ["hero_art", "home_explore", "home_updates", "home_community", "home_roadmap", "dashboard_history", "dashboard_recent", "dashboard_decks", "dashboard_sets", "dashboard_attention"] as const) root.setAttribute(`data-brand-${key.replaceAll("_", "-")}`, String(design[key]));
}
