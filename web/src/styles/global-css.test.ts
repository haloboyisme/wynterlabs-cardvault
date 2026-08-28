import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { APPEARANCE_ACCENTS, accentTokens } from "../lib/appearance";
import { contrastRatio } from "../lib/appearance-colors";

const css = readFileSync("src/styles/global.css", "utf8");
const workspaceCss = readFileSync("src/styles/workspace.css", "utf8");

const FOUNDATION_THEME_SURFACES = {
  midnight: "#08111D",
  frost: "#0C1520",
  light: "#F6F8FB",
} as const;
const FOUNDATION_THEME_PANELS = {
  midnight: "rgba(16,24,38,.82)",
  frost: "rgba(25,39,56,.88)",
  light: "rgba(255,255,255,.9)",
} as const;

function compositeOnSurface(foreground: string, surface: string): string {
  const match = foreground.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (!match) throw new TypeError(`Expected rgba color, received ${foreground}`);
  const alpha = Number(match[4]);
  const surfaceChannels = [surface.slice(1, 3), surface.slice(3, 5), surface.slice(5, 7)]
    .map((channel) => Number.parseInt(channel, 16));
  const channels = match.slice(1, 4).map(Number).map((channel, index) =>
    Math.round(channel * alpha + surfaceChannels[index] * (1 - alpha)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

it("keeps the authenticated primary navigation usable at narrow widths", () => {
  expect(css).toMatch(/\.primary-nav\s*\{[^}]*flex-wrap:\s*wrap/s);
  const narrow = css.match(/@media \(max-width: 640px\)[\s\S]*?\n\}/)?.[0] ?? "";
  expect(narrow).toMatch(/\.primary-nav\s*\{[^}]*width:\s*100%/s);
  expect(narrow).not.toMatch(/\.primary-nav[^}]*display:\s*none/);
  expect(narrow).not.toMatch(/\.nav-button[^}]*display:\s*none/);
});

it("provides keyboard focus, reduced motion, and legible interactive targets", () => {
  expect(css).toMatch(/button:focus-visible[\s\S]*select:focus-visible[\s\S]*outline:/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  expect(css).toMatch(/\.catalog-filters[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.catalog-pagination button[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.catalog-page-size select[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.catalog-results-footer[^}]*grid-template-columns:\s*1fr\s+auto\s+1fr/s);
  expect(css).toMatch(/\.catalog-results-footer \.catalog-pagination[^}]*grid-column:\s*2/s);
  expect(css).toMatch(/\.catalog-page-size[^}]*grid-column:\s*3/s);
  expect(css).toMatch(/\.catalog-page-size[^}]*justify-self:\s*end/s);
});

it("keeps catalog controls, cards, and details usable on phones", () => {
  expect(css).toMatch(/\.catalog-toolbar[^}]*display:\s*flex/s);
  expect(css).toMatch(/\.catalog-results[^}]*minmax\(210px,\s*1fr\)/s);
  const mobile = css.match(/@media \(max-width: 760px\)[\s\S]*$/)?.[0] ?? "";
  expect(mobile).toMatch(/\.catalog-filters[^}]*grid-template-columns:\s*1fr/s);
  expect(mobile).toMatch(/\.card-detail-layout[^}]*grid-template-columns:\s*1fr/s);
  expect(mobile).toMatch(/\.catalog-results[^}]*minmax\(145px,\s*1fr\)/s);
  expect(mobile).toMatch(/\.catalog-refine-toggle[^}]*display:\s*(?:inline-)?flex/s);
  expect(mobile).toMatch(/\.catalog-refine-group[^}]*display:\s*none/s);
  expect(mobile).toMatch(/\.catalog-refine-group\.is-open[^}]*display:\s*grid/s);
  expect(mobile).not.toMatch(/\.catalog-search-group[^}]*display:\s*none/s);
  expect(mobile).toMatch(/\.catalog-pagination[^}]*flex-wrap:\s*wrap/s);
  expect(mobile).toMatch(/\.catalog-results-footer[^}]*display:\s*flex/s);
  expect(mobile).toMatch(/\.catalog-results-footer[^}]*flex-wrap:\s*wrap/s);
  expect(mobile).toMatch(/\.catalog-page-size[^}]*margin-left:\s*auto/s);
});

it("styles legalities and non-blocking loading skeletons without motion dependence", () => {
  expect(css).toMatch(/\[data-legality="legal"\]/);
  expect(css).toMatch(/\[data-legality="not-legal"\]/);
  expect(css).toMatch(/\.catalog-skeleton-card/);
});

it("styles dashboard catalog states with explicit visual semantics", () => {
  expect(css).toMatch(/\.health-chip\.state-ready[^}]*background:/s);
  expect(css).toMatch(/\.health-chip\.state-stale[^}]*background:/s);
  expect(css).toMatch(/\.health-chip\.state-loading[^}]*background:/s);
  expect(css).toMatch(/\.health-chip\.state-preparing[^}]*background:/s);
  expect(css).toMatch(/\.health-chip\.state-unavailable[^}]*background:/s);
  expect(css).toMatch(/\.state-ready \.status-dot[^}]*background:/s);
  expect(css).toMatch(/\.state-stale \.status-dot[^}]*background:/s);
});

it("keeps private administration controls accessible and responsive", () => {
  expect(css).toMatch(/\.admin-grid\s*\{[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.admin-status-grid\s*\{[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.admin-actions\s*\{[^}]*display:\s*flex/s);
  expect(css).toMatch(/\.admin-card (?:input|select|button)[^}]*min-height:\s*44px/s);
  const mobile = css.match(/@media \(max-width: 760px\)[\s\S]*$/)?.[0] ?? "";
  expect(mobile).toMatch(/\.admin-grid[^}]*grid-template-columns:\s*1fr/s);
  expect(mobile).toMatch(/\.admin-status-grid[^}]*grid-template-columns:\s*1fr/s);
  expect(mobile).toMatch(/\.admin-actions[^}]*flex-wrap:\s*wrap/s);
});

it("uses words as well as color for administrator warnings", () => {
  expect(css).toMatch(/\.admin-warning/);
  expect(css).toMatch(/\.admin-destructive/);
});

it("keeps collection inventory and add controls accessible and responsive", () => {
  expect(css).toMatch(/\.collection-results\s*\{[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.collection-filters[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.collection-filters (?:input|select)[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.collection-actions[^}]*display:\s*flex/s);
  expect(css).toMatch(/\.collection-actions \.button[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.collection-page-size select[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.add-to-collection form[^}]*display:\s*grid/s);
  const mobile = css.match(/@media \(max-width: 760px\)[\s\S]*$/)?.[0] ?? "";
  expect(mobile).toMatch(/\.collection-filters[^}]*grid-template-columns:\s*1fr/s);
  expect(mobile).toMatch(/\.collection-results article[^}]*grid-template-columns:\s*1fr/s);
  expect(mobile).toMatch(/\.collection-results-footer[^}]*flex-wrap:\s*wrap/s);
});

it("keeps shared game filters and readable game metadata responsive", () => {
  expect(css).toMatch(/\.catalog-game-filter, \.collection-game-filter[^}]*min-width:\s*0/s);
  expect(css).toMatch(/\.catalog-game-badge, \.collection-game-meta[^}]*display:\s*inline-flex/s);
  expect(css).toMatch(/\.catalog-game-badge, \.collection-game-meta[^}]*border:/s);
  const mobile = css.match(/@media \(max-width: 760px\)[\s\S]*$/)?.[0] ?? "";
  expect(mobile).toMatch(/\.catalog-game-filter, \.collection-game-filter[^}]*width:\s*100%/s);
});

it("frames the live scanner and keeps captured cards usable on phones", () => {
  expect(css).toMatch(/\.scanner-camera-stage[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.scanner-camera-select[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.scanner-camera-select select[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.scanner-camera-select select[^}]*width:\s*min\(100%,\s*32rem\)/s);
  expect(css).toMatch(/\.scanner-viewfinder[^}]*position:\s*relative/s);
  expect(css).toMatch(/\.scanner-viewfinder video[^}]*height:\s*auto/s);
  expect(css).toMatch(/\.scanner-viewfinder video[^}]*transform-origin:\s*center/s);
  expect(css).toMatch(/\.scanner-viewfinder video[^}]*transition:\s*transform/s);
  expect(css).not.toMatch(/\.scanner-camera-stage video[^}]*aspect-ratio:\s*5\s*\/\s*7/s);
  expect(css).toMatch(/\.scanner-card-guide[^}]*aspect-ratio:\s*5\s*\/\s*7/s);
  expect(css).toMatch(/\.scanner-card-guide[^}]*position:\s*absolute/s);
  expect(css).toMatch(/\.scanner-card-guide[^}]*border:/s);
  expect(css).toMatch(/\.scanner-card-guide-corners/s);
  expect(css).toMatch(/\.scanner-camera-controls[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.scanner-camera-controls (?:input|select)[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.scanner-alignment-actions[^}]*display:\s*flex/s);
  expect(css).toMatch(/\.scanner-alignment-actions button[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.scanner-session-summary[^}]*display:\s*flex/s);
  expect(css).toMatch(/\.scanner-session-summary \.button[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.scanner-captured-stage img[^}]*object-fit:\s*contain/s);
  const mobile = css.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(mobile).toMatch(/\.scanner-camera-select[^}]*width:\s*100%/s);
  expect(mobile).toMatch(/\.scanner-camera-controls[^}]*grid-template-columns:\s*1fr/s);
  expect(mobile).toMatch(/\.scanner-session-summary[^}]*flex-direction:\s*column/s);
  expect(css).toMatch(/\.scanner-camera-stage button[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.scanner-captured-stage button[^}]*min-height:\s*44px/s);
});

it("uses the browser width for scanner workspaces and stacks them for tablets", () => {
  expect(css).toMatch(/\.scanner-page[^}]*width:\s*min\(1680px,\s*calc\(100% - 2rem\)\)/s);
  expect(css).toMatch(/\.single-scan-primary-workspace[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(18rem,\s*1fr\)/s);
  expect(css).toMatch(/\.single-scan-review-workspace[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(18rem,\s*1fr\)/s);
  expect(css).toMatch(/\.multi-scan-editor[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(18rem,\s*1fr\)/s);
  expect(css).toMatch(/\.single-scan-selected-preview[^}]*position:\s*sticky/s);
  expect(css).toMatch(/\.scan-confirmation[^}]*position:\s*sticky/s);
  const tablet = css.match(/@media \(max-width: 980px\)[\s\S]*$/)?.[0] ?? "";
  expect(tablet).toMatch(/\.single-scan-primary-workspace[^}]*grid-template-columns:\s*1fr/s);
  expect(tablet).toMatch(/\.single-scan-review-workspace[^}]*grid-template-columns:\s*1fr/s);
  expect(tablet).toMatch(/\.multi-scan-editor[^}]*grid-template-columns:\s*1fr/s);
  expect(tablet).toMatch(/\.scan-confirmation[^}]*position:\s*static/s);
});

it("keeps scanner title correction compact, accessible, and phone friendly", () => {
  expect(css).toMatch(/\.scanner-title-recovery[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.scanner-title-recovery (?:input|button)[^}]*min-height:\s*44px/s);
  const mobile = css.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(mobile).toMatch(/\.scanner-title-recovery[^}]*grid-template-columns:\s*1fr/s);
});

it("keeps multi-card sessions compact, scrollable, and touch friendly", () => {
  expect(css).toMatch(/\.scanner-mode-toggle[^}]*display:\s*flex/s);
  expect(css).toMatch(/\.scanner-mode-toggle label[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.scanner-set-preference[^}]*margin-left:\s*auto/s);
  expect(css).toMatch(/\.multi-scan-filmstrip[^}]*display:\s*flex/s);
  expect(css).toMatch(/\.multi-scan-filmstrip[^}]*overflow-x:\s*auto/s);
  expect(css).toMatch(/\.multi-scan-filmstrip[^}]*scroll-snap-type:\s*x\s+proximity/s);
  expect(css).toMatch(/\.multi-scan-filmstrip button[^}]*min-width:\s*8rem/s);
  expect(css).toMatch(/\.multi-scan-filmstrip button\.is-selected[^}]*border-color:/s);
  expect(css).toMatch(/\.multi-scan-editor[^}]*display:\s*grid/s);
  const mobile = css.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(mobile).toMatch(/\.scanner-mode-toggle[^}]*flex-direction:\s*column/s);
  expect(mobile).toMatch(/\.scanner-set-preference[^}]*width:\s*100%/s);
  expect(mobile).toMatch(/\.multi-scan-editor \.form-actions[^}]*flex-direction:\s*column/s);
});

it("defines the Phase 6 shared visual and accessibility system", () => {
  for (const token of [
    "--space-1", "--space-2", "--space-3", "--space-4",
    "--radius-sm", "--radius-md", "--radius-lg", "--focus",
    "--state-success", "--state-warning", "--state-danger",
  ]) {
    expect(css).toContain(token);
  }
  expect(css).toMatch(/:where\(button,[^}]*\)[^}]*min-height:\s*var\(--control-height\)/s);
  expect(css).toMatch(/:focus-visible[^}]*outline:/s);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  expect(css).toMatch(/\.table-scroll[^}]*overflow-x:\s*auto/s);
});

it("uses one responsive content frame across authenticated pages", () => {
  expect(css).toMatch(
    /:where\(\s*\.catalog-page,[\s\S]*?\.account-page\s*\)[^}]*width:\s*min\(var\(--content-width\),\s*calc\(100% - 2rem\)\)/,
  );
  expect(css).toMatch(/:where\(img, video, canvas\)[^}]*max-width:\s*100%/s);

  const phone = css.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(phone).toMatch(
    /:where\(\s*\.catalog-page,[\s\S]*?\.account-page\s*\)[^}]*width:\s*min\(var\(--content-width\),\s*calc\(100% - 1rem\)\)/,
  );
});

it("wraps authenticated actions and contains wide data locally", () => {
  expect(css).toMatch(
    /:where\(\s*\.collection-actions,[\s\S]*?\.catalog-pagination\s*\)[^}]*flex-wrap:\s*wrap/,
  );
  expect(css).toMatch(
    /\.collection-import-table-wrap[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto[^}]*overscroll-behavior-inline:\s*contain/s,
  );
});

it("gives notices structural emphasis in addition to their words and colors", () => {
  expect(css).toMatch(
    /:where\(\.form-error, \.form-success, \.catalog-warning, \.deck-warnings\)[^}]*border-left-width:\s*4px/s,
  );
});

it("keeps navigation touch targets and footer copy readable", () => {
  expect(css).toMatch(/\.site-header nav a[^}]*min-height:\s*var\(--control-height\)/s);
  expect(css).toMatch(/\.site-header nav a[^}]*display:\s*inline-flex/s);
  expect(css).toMatch(/\.site-footer[^}]*color:\s*var\(--muted\)/s);
  expect(css).toMatch(/\.collection-import-table-wrap:focus-visible[^}]*outline:/s);
});

it("keeps actual Home lead and both foundation gradient endpoints readable in every contrast mode", () => {
  const lightSurface = "#F6F8FB";
  const lightPanel = "#FFFFFF";
  const lightMuted = "#526276";
  const lightInk = "#172130";
  expect(contrastRatio(lightMuted, lightSurface)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(lightMuted, lightPanel)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(lightInk, lightSurface)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(lightInk, lightPanel)).toBeGreaterThanOrEqual(4.5);

  const heroLead = css.match(/\.hero-lede\s*\{[^}]*\}/)?.[0] ?? "";
  const foundationCopy = css.match(/\.foundation-callout p:last-child\s*\{[^}]*\}/)?.[0] ?? "";
  expect(heroLead).toMatch(/color:\s*var\(--muted\)/);
  expect(foundationCopy).toMatch(/color:\s*var\(--accent-soft-ink\)/);

  for (const theme of ["midnight", "frost", "light"] as const) {
    for (const custom of ["#000000", "#0000FF", "#FF0000"]) {
      const tokens = accentTokens("custom", custom, theme);
      const endpoints = [
        compositeOnSurface(tokens.soft, FOUNDATION_THEME_SURFACES[theme]),
        compositeOnSurface(FOUNDATION_THEME_PANELS[theme], FOUNDATION_THEME_SURFACES[theme]),
      ];
      for (const [index, endpoint] of endpoints.entries()) {
        expect(
          contrastRatio(tokens.softInk, endpoint),
          `${theme}/${custom}/endpoint-${index + 1} normal`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(tokens.softInk, endpoint),
          `${theme}/${custom}/endpoint-${index + 1} high contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  }

  const highContrastHero = css.match(/html\[data-contrast="high"\] \.hero-lede\s*\{[^}]*\}/)?.[0] ?? "";
  expect(highContrastHero).toMatch(/color:\s*var\(--ink\)/);
  const highContrastFoundation = css.match(/html\[data-contrast="high"\] \.foundation-callout p:last-child\s*\{[^}]*\}/)?.[0] ?? "";
  expect(highContrastFoundation).toMatch(/color:\s*var\(--accent-soft-ink\)/);
  expect(css).not.toMatch(
    /html\[data-contrast="high"\][^{]*:where\([^)]*\.foundation-callout p:last-child[^)]*\)/,
  );
});

it("defines complete semantic palettes for every resolved appearance theme", () => {
  for (const selector of [
    'html[data-theme="midnight"]',
    'html[data-theme="frost"]',
    'html[data-theme="light"]',
  ]) {
    const block = css.match(new RegExp(`${selector.replace(/[\[\]"]/g, "\\$&")}\\s*\\{[^}]*\\}`))?.[0] ?? "";
    for (const token of [
      "--ink", "--muted", "--panel", "--panel-strong", "--line", "--blue", "--cyan",
      "--deep", "--body-background", "--header-bg", "--control-bg", "--control-border",
    ]) expect(block).toContain(token);
  }
});

it("keeps Account themes simple while Advanced appearance remains accessible", () => {
  expect(css).toMatch(/\.account-appearance-card[^}]*background:\s*var\(--panel\)/s);
  expect(css).toMatch(/\.theme-options[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.theme-option[^}]*min-height:\s*var\(--control-height\)/s);
  expect(css).toMatch(/\.theme-option:has\(input:checked\)[^}]*border-color:/s);
  expect(css).toMatch(/\.appearance-advanced summary[^}]*min-height:\s*var\(--control-height\)/s);
  expect(css).toMatch(/\.appearance-advanced summary:focus-visible[^}]*outline:/s);
});

it("keeps the Advanced custom hex text input usable on desktop and phones", () => {
  expect(css).not.toMatch(/\.appearance-advanced-controls input\s*\{[^}]*width:\s*22px/s);
  expect(css).toMatch(
    /\.appearance-advanced-controls input:is\(\[type="checkbox"\],\s*\[type="radio"\]\)\s*\{[^}]*width:\s*22px/s,
  );

  const customHex = workspaceCss.match(/\.custom-accent-hex\s*\{[^}]*\}/)?.[0] ?? "";
  expect(customHex).toMatch(/width:\s*100%/);
  expect(customHex).toMatch(/min-width:\s*44px/);
  expect(customHex).toMatch(/max-width:\s*100%/);

  const phone = workspaceCss.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(phone).toMatch(/\.custom-accent-hex\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/s);
});

it("supports compact spacing and explicitly reduced motion without smaller targets", () => {
  expect(css).toMatch(/html\[data-density="compact"\][^}]*--space-4:/s);
  expect(css).toMatch(/html\[data-density="compact"\][^}]*--control-height:\s*44px/s);
  expect(css).toMatch(/html\[data-motion="reduced"\][\s\S]*transition:\s*none\s*!important/s);
  const phone = css.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(phone).toMatch(/\.theme-options[^}]*grid-template-columns:\s*1fr/s);
});

it("styles the customizable collection workspace and accessible detail bubble", () => {
  expect(css).toMatch(/\.collection-value[^}]*border:/s);
  expect(css).toMatch(/\.collection-value-coverage[^}]*color:\s*var\(--muted\)/s);
  expect(css).toMatch(/\.collection-results\[data-view="grid"\][^}]*grid-template-columns:\s*repeat\(auto-fill,/s);
  expect(css).toMatch(/\.collection-results\[data-view="list"\][^}]*grid-template-columns:\s*1fr/s);
  expect(css).toMatch(/\.collection-results\[data-size="small"\][^}]*--collection-card-width:\s*160px/s);
  expect(css).toMatch(/\.collection-results\[data-size="medium"\][^}]*--collection-card-width:\s*210px/s);
  expect(css).toMatch(/\.collection-results\[data-size="large"\][^}]*--collection-card-width:\s*270px/s);
  expect(css).toMatch(/\.collection-card[^}]*height:\s*100%/s);
  expect(css).toMatch(/\.collection-quantity[^}]*border-radius:\s*999px/s);
  expect(css).toMatch(/\.collection-detail-bubble[^}]*position:\s*relative/s);
  expect(css).toMatch(/\.collection-results\[data-animate="true"\] \.collection-detail-bubble[^}]*animation:/s);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.collection-detail-bubble[^}]*animation:\s*none/s);
  expect(css).toMatch(/\.collection-display-settings[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.collection-clear-filters[^}]*align-self:\s*end/s);
});

it("styles scanner progress, result filters, and reduced-motion save feedback", () => {
  expect(css).toMatch(/\.scanner-progress[^}]*grid-template-columns:\s*repeat\(4/s);
  expect(css).toMatch(/\.scanner-result-toolbar[^}]*grid-template-columns:/s);
  expect(css).toMatch(/\.scanner-save-feedback[^}]*animation:\s*scanner-feedback-in/s);
  expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.scanner-result-toolbar[^}]*grid-template-columns:\s*1fr/s);
  expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.scanner-save-feedback[^}]*animation:\s*none/s);
});

it("keeps compact workspace controls at the 44px accessibility minimum", () => {
  const compact = workspaceCss.match(/html\[data-density="compact"\][^}]*\}/)?.[0] ?? "";
  expect(compact).toMatch(/--control-height:\s*44px/);
});

it("uses the derived focus token in the dominant shared focus rule", () => {
  const dominantFocus = css.match(
    /button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible\s*\{[^}]*\}/,
  )?.[0] ?? "";
  expect(dominantFocus).toMatch(/outline:\s*3px solid var\(--focus\)/);
});

it("defines shared workspace presentation primitives with accessible responsive behavior", () => {
  for (const selector of [
    ".workspace-page-header",
    ".workspace-feedback",
    ".workspace-stat",
    ".workspace-disclosure",
    ".workspace-empty",
  ]) {
    expect(workspaceCss).toContain(selector);
  }

  expect(workspaceCss).toMatch(/\.workspace-page-header-actions[^}]*flex-wrap:\s*wrap/s);
  expect(workspaceCss).toMatch(/\.workspace-page-header-actions[^}]*:where\([^}]*\)[^}]*min-height:\s*var\(--control-height\)/s);
  expect(workspaceCss).toMatch(/\.workspace-disclosure summary[^}]*min-height:\s*var\(--control-height\)/s);
  expect(workspaceCss).toMatch(/\.workspace-disclosure summary:focus-visible[^}]*outline:/s);

  const phone = workspaceCss.match(/@media \(max-width: 760px\)[\s\S]*$/)?.[0] ?? "";
  expect(phone).toMatch(/\.workspace-page-header-actions[^}]*width:\s*100%/s);
  expect(phone).toMatch(/\.workspace-page-header-actions[^}]*justify-content:\s*flex-start/s);

  expect(workspaceCss).toMatch(
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.workspace-page-header[\s\S]*transition:\s*none\s*!important/s,
  );
});

it("makes each keyboard-focused accent swatch visibly distinct", () => {
  const focusRule = workspaceCss.match(/\.accent-swatch-option:has\(input:focus-visible\) \.accent-swatch-color\s*\{[^}]*\}/)?.[0] ?? "";
  expect(focusRule).toMatch(/box-shadow:\s*0 0 0 3px var\(--focus\)/);
});

it("keeps every named accent chooser target at least 44 by 44 pixels on phones", () => {
  const optionRule = workspaceCss.match(/\.accent-swatch-option\s*\{[^}]*\}/)?.[0] ?? "";
  expect(optionRule).toMatch(/min-width:\s*44px/);
  expect(optionRule).toMatch(/min-height:\s*44px/);
  expect(optionRule).toMatch(/grid-template-rows:\s*auto auto/);

  const phone = workspaceCss.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(phone).toMatch(/\.accent-swatch-grid[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(4\.5rem,\s*1fr\)\)/s);
});

it("routes every curated accent through the shared workspace variables", () => {
  for (const accent of APPEARANCE_ACCENTS) {
    const tokens = accentTokens(accent, null, "midnight");
    expect(tokens.accent).toMatch(/^#[0-9A-F]{6}$/i);
    expect(tokens.link).toMatch(/^#[0-9A-F]{6}$/i);
    expect(tokens.soft).toMatch(/^rgba\(/);
    expect(tokens.ink).toMatch(/^#[0-9A-F]{6}$/i);
  }
  expect(workspaceCss).toMatch(/html\[data-accent\][^}]*--focus:\s*var\(--accent-link\)/s);
  expect(workspaceCss).toMatch(/\.workspace-accent-button[^}]*background:\s*var\(--accent\)/s);
});

it("uses the computed soft ink wherever accent text sits on a soft accent surface", () => {
  expect(workspaceCss).toMatch(/:root[^}]*--accent-soft-ink:/s);
  for (const selector of [
    "\\.workspace-accent-surface",
    "\\.future-label",
    "\\.personalization-preview",
    "\\.collection-filter-chip",
    "\\.collection-finish-badge",
    "\\.collection-import-stages li\\[aria-current=\"step\"\\]",
    "\\.deck-format-chip",
  ]) {
    const block = workspaceCss.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`))?.[0] ?? "";
    expect(block, selector).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(block, selector).toMatch(/color:\s*var\(--accent-soft-ink\)/);
  }
  const previewSmall = workspaceCss.match(/\.personalization-preview small\s*\{[^}]*\}/)?.[0] ?? "";
  expect(previewSmall).toMatch(/color:\s*inherit/);

  const exactSoftBlocks = [...workspaceCss.matchAll(/([^{}]+)\{[^}]*background:\s*var\(--accent-soft\)[^}]*\}/g)];
  for (const [block, selector] of exactSoftBlocks) {
    expect(block, selector.trim()).toMatch(/color:\s*var\(--accent-soft-ink\)/);
  }
});

it("preserves the validated accent background when primary buttons hover", () => {
  const hover = workspaceCss.match(
    /\.site-header nav \.nav-cta:hover,[\s\S]*?\.button\.primary:hover\s*\{[^}]*\}/,
  )?.[0] ?? "";
  expect(hover).toMatch(/background:\s*var\(--accent\)/);
  expect(hover).not.toMatch(/background:\s*color-mix/);
  expect(hover).toMatch(/box-shadow:/);
});

it("integrates high contrast and text scaling with the workspace", () => {
  expect(workspaceCss).toMatch(/html\[data-contrast="high"\][^}]*--line:\s*var\(--ink\)/s);
  expect(workspaceCss).toMatch(/html\[data-text-scale="large"\][^}]*font-size:\s*112\.5%/s);
  expect(workspaceCss).toMatch(/html\[data-text-scale="extra-large"\][^}]*font-size:\s*125%/s);
});

it("preserves light-theme boundaries and strengthens every high-contrast control", () => {
  const light = workspaceCss.match(/html\[data-theme="light"\]\s*\{[^}]*\}/)?.[0] ?? "";
  const controlBackground = light.match(/--control-bg:\s*(#[0-9a-f]{3,6})/i)?.[1] ?? "";
  const controlBorder = light.match(/--control-border:\s*(#[0-9a-f]{3,6})/i)?.[1] ?? "";
  expect(contrastRatio(controlBorder, controlBackground)).toBeGreaterThanOrEqual(3);

  const standard = workspaceCss.match(/html\[data-contrast="standard"\]\s*\{[^}]*\}/)?.[0] ?? "";
  expect(standard).not.toContain("--line");
  const high = workspaceCss.match(/html\[data-contrast="high"\]\s*\{[^}]*\}/)?.[0] ?? "";
  expect(high).toContain("--control-border:");

  expect(css).toMatch(/:where\(input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), select, textarea\)[^}]*border-color:\s*var\(--control-border\)/s);
  expect(workspaceCss).toMatch(/\.collection-import-dropzone input[^}]*border:\s*1px solid var\(--control-border\)/s);
  expect(workspaceCss).toMatch(/\.deck-filter-bar :where\(input, select\)[^}]*border:\s*1px solid var\(--control-border\)/s);
});

it("keeps Admin routine and danger actions touch friendly and reflows its overview on phones", () => {
  expect(workspaceCss).toMatch(/\.workspace-routine-actions\s+:where\([^}]*\)[^}]*min-height:\s*var\(--control-height\)/s);
  expect(workspaceCss).toMatch(/\.workspace-danger-zone\s+:where\([^}]*\)[^}]*min-height:\s*var\(--control-height\)/s);
  expect(workspaceCss).toMatch(/\.workspace-routine-actions\s*\{[^}]*border-left:\s*3px solid/s);
  expect(workspaceCss).toMatch(/\.workspace-danger-zone\s*\{[^}]*border-left:\s*3px solid/s);
  expect(workspaceCss).toMatch(/\.admin-operational-overview[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
  const phone = workspaceCss.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(phone).toMatch(/\.admin-operational-overview[^}]*grid-template-columns:\s*1fr/s);
  expect(phone).toMatch(/\.workspace-routine-actions[^}]*flex-wrap:\s*wrap/s);
  expect(phone).toMatch(/\.workspace-danger-zone[^}]*flex-wrap:\s*wrap/s);
});

it("removes integrated workspace animation when reduced motion is selected", () => {
  expect(workspaceCss).toMatch(
    /html\[data-motion="reduced"\] \*[\s\S]*animation:\s*none\s*!important[\s\S]*transition:\s*none\s*!important/s,
  );
  expect(workspaceCss).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.admin-operational-overview[\s\S]*transition:\s*none\s*!important/s,
  );
});

it("keeps linked scanner preferences touch friendly and stacks them on phones", () => {
  expect(css).toMatch(/\.scanner-set-preference[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(13rem,\s*18rem\)\)/s);
  expect(css).toMatch(/\.scan-preference-field[^}]*display:\s*grid/s);
  expect(css).toMatch(/\.scan-preference-field[^}]*gap:/s);
  expect(css).toMatch(/\.scanner-set-preference select[^}]*min-height:\s*44px/s);
  const mobile = css.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(mobile).toMatch(/\.scanner-set-preference[^}]*grid-template-columns:\s*1fr/s);
  expect(mobile).toMatch(/\.scan-preference-field[^}]*width:\s*100%/s);
});

it("defines shared scanner workspace regions that stay reachable without page overflow", () => {
  for (const selector of [
    ".scanner-control-bar",
    ".scanner-primary-grid",
    ".scanner-session-strip",
    ".scanner-review-grid",
  ]) expect(css).toContain(selector);

  expect(css).toMatch(/\.scanner-page[^}]*overflow-x:\s*clip/s);
  expect(css).toMatch(/\.scanner-primary-grid[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(18rem,\s*1fr\)/s);
  expect(css).toMatch(/\.scanner-review-grid[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(18rem,\s*1fr\)/s);
  expect(css).toMatch(/\.scanner-session-strip[^}]*min-width:\s*0/s);
  expect(css).toMatch(/\.scanner-capture-action[^}]*min-height:\s*44px/s);

  const tablet = css.match(/@media \(max-width: 980px\)[\s\S]*$/)?.[0] ?? "";
  expect(tablet).toMatch(/\.scanner-primary-grid[^}]*grid-template-columns:\s*1fr/s);
  expect(tablet).toMatch(/\.scanner-review-grid[^}]*grid-template-columns:\s*1fr/s);
  expect(tablet).toMatch(/\.scanner-capture-action[^}]*position:\s*sticky/s);
  expect(tablet).toMatch(/\.scanner-confirm-actions[^}]*position:\s*sticky/s);
  expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.scanner-capture-countdown[^}]*animation:\s*none/s);
});
