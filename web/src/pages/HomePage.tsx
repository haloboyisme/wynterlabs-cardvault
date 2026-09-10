import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../app/auth";
import { useBranding } from "../app/branding";
import { CardImage } from "../components/CardImage";
import { getCommunityActivity, type CommunityActivity } from "../lib/community";

const quickActions = [
  {
    code: "01",
    title: "Browse cards",
    copy: "Search exact printings, sets, languages, and collector numbers.",
    to: "/cards",
  },
  {
    code: "02",
    title: "Scan cards",
    copy: "Use careful single-card mode or move quickly through a multi-card session.",
    to: "/scan",
  },
  {
    code: "03",
    title: "Open collection",
    copy: "See quantities, set coverage, filters, prices, and total collection value.",
    to: "/collection",
  },
  {
    code: "04",
    title: "Build a deck",
    copy: "Select owned cards and turn them into a deck without re-entering details.",
    to: "/decks",
  },
];

const updates = [
  ["Available", "Difficult-card matching refinements", "Either half of a split card can match. Ambiguous printings require a choice, stalled searches can be retried, and Scan includes foil/promo guidance."],
  ["V2.6", "Remembered scanning set", "Return to Scan with your last game and preferred set restored for this account and browser. Each game remembers its own set; Auto clears it."],
  ["Available", "Custom Card Import", "Add missing cards privately, with optional images, set details and values. Use them in collections, decks, imports and exports."],
  ["Available", "Sales-based collection value", "Compare asking and market prices per card and see a collection-wide sales-based estimate with priced-copy coverage."],
  ["Available", "Interactive value history", "Explore dashboard values with numeric axes, a timeline slider, exact snapshots and a data table."],
];

const roadmap = [
  ["V2.8", "Real feeder testing", "Experimental private prototype; not included in this public release. Connect the actual feeder, calibrate the card path, and verify stop, disconnect and scan timing."],
  ["Testing", "Real-card scanner acceptance", "Split-card matching, ambiguity handling and search recovery are improved. Check your difficult Room, foil and promo cards and long phone/tablet sessions; further tuning follows observed failures."],
  ["V3", "Solo tabletop and saved decks", "Planned: Magic and Pokémon camera layouts, saved-deck selection, play zones, counters and turn notes. Start with private solo practice."],
  ["V3.2", "Streamer previews and OBS", "Planned: instant, fade or flip reveals; configurable card details, sounds, mute and optional effects. Add a private pop-out URL for OBS with transparent, green, blue or solid backgrounds."],
  ["V3.2", "Pack recap and saved video", "Planned: finish a pack, replay confirmed pulls and corrections, choose highlights or every card, and save the recap video or record it in OBS."],
  ["V3.5", "Wireless feeders and Bluetooth", "Deferred: account-owned Wi-Fi and Bluetooth connections, one controlling session, reconnect and revoke controls. Validate phone and computer compatibility first."],
  ["Later", "Gameplay tracking and shared displays", "Explore deliberate scans or a second camera, friend/tournament displays, TV/YouTube layouts and companion tablets after solo play works."],
  ["Later", "Community and hardware compatibility", "Explore multiplayer and community features beyond the existing activity feed. Make supported Raspberry Pi, computer and custom-hardware setup easier using the existing Docker foundation."],
];

export function HomePage() {
  const auth = useAuth();
  const { branding } = useBranding();
  const signedIn = auth.status === "authenticated";
  const [activity, setActivity] = useState<CommunityActivity[]>([]);
  const [activityState, setActivityState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    if (!signedIn) { setActivityState("ready"); return; }
    const controller = new AbortController();
    void getCommunityActivity(controller.signal).then((result) => {
      setActivity(result.items); setActivityState("ready");
    }).catch(() => { if (!controller.signal.aborted) setActivityState("unavailable"); });
    return () => controller.abort();
  }, [signedIn]);

  return (
    <>
      <section className="hero home-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> {branding.site_name} {branding.product_name} · Private by design</p>
          <h1>{branding.tagline}</h1>
          <p className="hero-lede">
            A private card workspace built for real collections: fast enough
            for a new stack, detailed enough for every exact printing, and
            personal enough to feel like your own.
          </p>
          <div className="hero-actions">
            {signedIn ? (
              <>
                <Link className="button primary" to="/dashboard">Open dashboard</Link>
                <Link className="button ghost" to="/scan">Scan a card</Link>
              </>
            ) : (
              <>
                <Link className="button primary" to="/login">Sign in</Link>
                <a className="button ghost" href="#whats-new">See what is new</a>
              </>
            )}
          </div>
          <dl className="hero-stats">
            <div><dt>Access</dt><dd>Private LAN</dd></div>
            <div><dt>Photos</dt><dd>Stay on device</dd></div>
            <div><dt>Workspace</dt><dd>Your theme</dd></div>
          </dl>
        </div>
        <div className="hero-visual" aria-label="Abstract trading card collection">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <article className="display-card card-back">
            <span className="mini-mark">W</span>
            <div className="card-grid" />
          </article>
          <article className="display-card card-front">
            <div className="card-art"><span>&</span></div>
            <div className="card-meta"><strong>First Light</strong><small>Foundation - 001</small></div>
          </article>
          <div className="scan-line" />
        </div>
      </section>

      <section className="home-quick-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Start anywhere</p>
            <h2>Less hunting. More collecting.</h2>
          </div>
          <p>Every major tool is one clear step away, with feedback that keeps you oriented.</p>
        </div>
        <nav className="home-quick-grid" aria-label={`Explore ${branding.site_name} ${branding.product_name}`}>
          {quickActions.map((item) => (
            <Link className="home-quick-card" to={item.to} key={item.title}>
              <span className="home-quick-code">{item.code}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
              <span className="home-card-link">Open <span aria-hidden="true">→</span></span>
            </Link>
          ))}
        </nav>
      </section>

      <section className="home-update-section" id="whats-new">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Release notes</p>
          <h2>V2.6 is ready.</h2>
          </div>
          <p>Recent improvements are kept short and useful so members can see what changed at a glance.</p>
        </div>
        <div className="home-update-grid">
          {updates.map(([label, title, copy]) => (
            <article className="home-update-card" key={title}>
              <span>{label}</span><h3>{title}</h3><p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      {signedIn && <section className="home-activity-section" aria-labelledby="community-activity-heading">
        <div className="section-heading"><div><p className="eyebrow">Private community</p><h2 id="community-activity-heading">What collectors are doing.</h2></div><p>Only members who opt in appear here. Collection values and private details stay hidden.</p></div>
        {activityState === "loading" && <p role="status">Loading community activity&hellip;</p>}
        {activityState === "unavailable" && <p role="status">Community activity is temporarily unavailable.</p>}
        {activityState === "ready" && activity.length === 0 && <div className="home-activity-empty"><strong>No shared activity yet.</strong><p>Members can opt in from Account controls.</p></div>}
        <div className="home-activity-grid">
          {activity.map((item, index) => <article className={`home-activity-card activity-${item.kind}`} key={`${item.kind}-${item.occurred_at}-${index}`}>
            {item.kind === "card_added" && item.card_name ? <>
              <CardImage name={item.card_name} imageUris={item.image_uris} className="home-activity-image" />
              <span className="home-activity-kind">Recently added</span><h3>{item.card_name}</h3><p>{item.display_name} added {item.set_name} · {item.collector_number}</p>
              {item.printing_id && <Link to={`/cards/${item.printing_id}`}>View exact printing</Link>}
            </> : item.kind === "new_member" ? <><span className="home-activity-avatar">{item.display_name?.slice(0, 1).toUpperCase()}</span><span className="home-activity-kind">New member</span><h3>{item.display_name}</h3><p>Joined the private CardVault community.</p></> : item.kind === "set_updated" ? <><span className="home-activity-kind">Set release</span><h3>{item.set_name}</h3><p>{item.game?.toUpperCase()} · {item.set_code} · {item.released_at}</p></> : <><span className="home-activity-kind">Catalog update</span><h3>{item.game?.toUpperCase()} cards refreshed</h3><p>{item.printing_count?.toLocaleString()} printings across {item.set_count?.toLocaleString()} sets.</p></>}
            <time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleDateString()}</time>
          </article>)}
        </div>
      </section>}

      <section className="home-roadmap-section" id="roadmap">
        <div className="home-roadmap-heading">
          <p className="eyebrow">Roadmap</p>
          <h2>What’s next for CardVault.</h2>
          <p>Remaining work only · updated September 10, 2026. Version targets are plans, not release dates. New features are tested privately before public release.</p>
        </div>
        <ol className="home-roadmap-list">
          {roadmap.map(([status, title, copy]) => (
            <li key={`${status}-${title}`}>
              <span className={`roadmap-state roadmap-${status.toLowerCase()}`}>{status}</span>
              <div><h3>{title}</h3><p>{copy}</p></div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
