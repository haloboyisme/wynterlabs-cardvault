import { apiRequest } from "../lib/api";
export type ScanMode = "single" | "multiple" | "diy";
export type FailureTag = "blur" | "glare" | "too_dark" | "sideways_or_layout" | "no_text" | "no_catalog_match" | "ambiguous_printing" | "wrong_match" | "timeout" | "service_error" | "unknown" | "finish_changed";
export type Outcome = "unresolved" | "recovered_by_retry" | "corrected_manually" | "skipped";
interface CardIdentity {printing_id:string;oracle_id?:string;name:string;set:{code:string;name:string;game:string};collector_number:string;language:string;finishes:string[]}
function snapshot(card:CardIdentity,finish:string|null,source:string) {
 return {printing_id:card.printing_id,name:card.name.slice(0,300),set_code:card.set.code.slice(0,64),set_name:card.set.name.slice(0,200),game:card.set.game.slice(0,32),collector_number:card.collector_number.slice(0,64),language:card.language.slice(0,16),finish,finish_source:source};
}
let account = "";
let epoch = 0;
export function setScanLogAccount(id: string) { if (id !== account) {account=id; epoch++;} }
export function qualityTags(warning: string): FailureTag[] {
  return /dark/i.test(warning) ? ["too_dark"] : /glare|bright/i.test(warning) ? ["glare"] : /focus|detail/i.test(warning) ? ["blur"] : [];
}
export function createScanTrace(mode: ScanMode) {
  const scanId = crypto.randomUUID();
  const ownerEpoch = epoch;
  const reasons = new Set<FailureTag>(), suspected = new Set<FailureTag>(), reported = new Set<FailureTag>();
  let manual = false;
  let suggested:ReturnType<typeof snapshot>|null=null, latest:ReturnType<typeof snapshot>|null=null, accepted:ReturnType<typeof snapshot>|null=null;
  let attempts = 1, revision = 0, outcome: Outcome = "unresolved", delivery = Promise.resolve();
  function write() {
    if (!reasons.size && !reported.size) return;
    const body = JSON.stringify({mode, revision:++revision, attempts, outcome, reasons:[...reasons], suspected:[...suspected], reported:[...reported], diagnostics:{suggested,latest_suggestion:latest,accepted}});
    delivery = delivery.then(async () => {
      for (let retry=0; retry<2; retry++) {
        if (ownerEpoch !== epoch) return;
        const controller = new AbortController();
        const timer = window.setTimeout(()=>controller.abort(),5000);
        try {
          await apiRequest(`/api/v1/scanner/failures/${scanId}`, {method:"PUT", body, signal:controller.signal});
          window.dispatchEvent(new Event("cardvault-scan-log-changed"));
          return;
        } catch {
          if (retry===1) window.dispatchEvent(new Event("cardvault-scan-log-error"));
        } finally {window.clearTimeout(timer);}
      }
    }).catch(()=>undefined);
  }
  return {
    id:scanId,
    get failed() {return Boolean(reasons.size || reported.size);},
    hint(tags:FailureTag[]) {tags.forEach(tag=>suspected.add(tag));},
    manual() {manual=true;},
    suggest(card:CardIdentity, selected:boolean) {
      latest=snapshot(card,selected?(card.finishes[0]??null):null,selected?"default":"not_selected");
      suggested ??= latest;
    },
    saved(card?:CardIdentity, finish?:string) {
      if(card && finish) {
        accepted=snapshot(card,finish,"user_confirmed");
        if(suggested && suggested.finish_source!=="not_selected" && suggested.printing_id!==accepted.printing_id) {reported.add("wrong_match");manual=true;}
        if(suggested && suggested.printing_id===accepted.printing_id && suggested.finish && suggested.finish!==finish) {reported.add("finish_changed");manual=true;}
      }
      outcome=manual?"corrected_manually":"recovered_by_retry";write();
    },
    retry() {attempts=Math.min(1000,attempts+1);},
    fail(tag:FailureTag, userReported=false) {(userReported?reported:reasons).add(tag);outcome="unresolved";write();},
    resolve(value:Outcome) {outcome=value;write();},
    flush() {return delivery;},
  };
}
export type ScanTrace = ReturnType<typeof createScanTrace>;
