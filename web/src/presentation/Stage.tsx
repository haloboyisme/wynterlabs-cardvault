import { rewardFor, RewardEffect } from "./rewards";
import { useEffect, useState, type CSSProperties } from "react";
import { backdrop, recapCards, type Presentation } from "./model";
import "./presentation.css";
export function Stage({ state, replay = false }: { state: Presentation; replay?: boolean }) {
  const [step, setStep] = useState(-1);
  const s = state.settings;
  const cards = recapCards(state);
  useEffect(() => {
    if (!replay || !cards.length) { setStep(-1); return; }
    let next = s.pack ? -2 : 0; setStep(next);
    const timer = window.setInterval(() => { next = next === -2 ? 0 : next + 1; setStep(next); if (next >= cards.length) clearInterval(timer); }, s.hold * 1000);
    return () => clearInterval(timer);
  }, [state.revision, replay, s.hold, s.pack, cards.length]);
  const card = replay && step >= 0 ? cards[step] : state.preview ?? state.cards.at(-1);
  const prize = rewardFor(s,card);
  const summary = replay && step >= cards.length;
  return <div className={`presentation-stage ${s.layout} ${s.glow ? "glow" : ""}`} style={{ background: backdrop(s), "--pull-accent": s.accent, "--reveal-time": `${s.duration}s`, "--pull-scale": s.scale } as CSSProperties} aria-label="Stream preview">
    {replay && step === -2 ? <div className="generic-pack"><span>YOUR NEXT DISCOVERY</span><strong>Open the pack</strong><span>CardVault</span></div> : summary ? <div className="pull-summary"><h2>{state.cards.reduce((n,c) => n + c.quantity, 0)} cards · Pack complete</h2><div className="pull-spread">{state.cards.map(c => <div key={c.id}>{c.image && <img src={c.image} alt="" referrerPolicy="no-referrer" />}<span>{c.quantity}× {c.name}</span></div>)}</div></div> : card ? <div key={`${state.revision}-${step}-${card.id}`} className={`pull-reveal reveal-${s.reveal}`}>
      <div className="pull-art">{card.image ? <img src={card.image} alt={card.name} referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = "none"; }} /> : null}<div className="pull-fallback">{card.name}</div><div className="pull-back">{s.card_back ? <img src={s.card_back} alt="Custom card back" /> : <>W<br/><small>CARDVAULT</small></>}</div></div>
      <div className="pull-details"><h2>{card.name}</h2>{s.details && <><p>{card.set}</p><p>{card.number} · {card.language.toUpperCase()} · {card.finish}</p><p>{card.rarity} · {card.quantity} {card.quantity === 1 ? "copy" : "copies"}</p></>}{s.prices && <strong>{card.price || "Price unavailable"}</strong>}</div>
      {prize && (replay || state.event?.kind === "confirm") && <RewardEffect tier={prize} eventKey={`${state.event?.id}-${step}`} particles={s.particles !== false} />}
    </div> : <p className="pull-empty">Confirmed pulls appear here</p>}
  </div>;
}
