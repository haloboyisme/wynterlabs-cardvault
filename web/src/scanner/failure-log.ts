import { apiRequest } from "../lib/api";
export type ScanMode = "single" | "multiple" | "diy";
export type FailureTag = "blur" | "glare" | "too_dark" | "sideways_or_layout" | "no_text" | "no_catalog_match" | "ambiguous_printing" | "wrong_match" | "timeout" | "service_error" | "unknown";
export type Outcome = "unresolved" | "recovered_by_retry" | "corrected_manually" | "skipped";
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
  let attempts = 1, revision = 0, outcome: Outcome = "unresolved", delivery = Promise.resolve();
  function write() {
    if (!reasons.size && !reported.size) return;
    const body = JSON.stringify({mode, revision:++revision, attempts, outcome, reasons:[...reasons], suspected:[...suspected], reported:[...reported]});
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
    saved() {outcome=manual?"corrected_manually":"recovered_by_retry";write();},
    retry() {attempts=Math.min(1000,attempts+1);},
    fail(tag:FailureTag, userReported=false) {(userReported?reported:reasons).add(tag);outcome="unresolved";write();},
    resolve(value:Outcome) {outcome=value;write();},
    flush() {return delivery;},
  };
}
export type ScanTrace = ReturnType<typeof createScanTrace>;
