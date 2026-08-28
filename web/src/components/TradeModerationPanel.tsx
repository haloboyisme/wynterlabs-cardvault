import { useCallback, useEffect, useRef, useState } from "react";

import {
  getModerationReports,
  moderateListing,
  moderateReport,
  setMemberAccountStatus,
  setMemberTradingStatus,
  type TradeReport,
  voidTradeStrike,
} from "../lib/trading";

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function TradeModerationPanel() {
  const [reports, setReports] = useState<TradeReport[]>([]);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    try {
      const rows = await getModerationReports(controller.signal);
      if (current !== generation.current || controller.signal.aborted) return;
      setReports(rows);
      setError("");
    } catch (reason) {
      if (current === generation.current && !isAbort(reason)) {
        setError(reason instanceof Error ? reason.message : "Trade reports could not be loaded.");
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      request.current?.abort();
    };
  }, [load]);

  async function act(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await action();
      setFeedback(message);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The moderation action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card trade-moderation" aria-labelledby="trade-moderation-heading">
      <p className="eyebrow">Owner and administrators</p>
      <h2 id="trade-moderation-heading">Trade moderation</h2>
      <p>Review incident reports, remove listings, suspend trading, or deactivate an ordinary member account. No personal contact information is exposed.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {feedback && <p className="form-success" role="status">{feedback}</p>}
      {!reports.length && !error && <p>No trade reports are waiting.</p>}
      <ul className="moderation-list">
        {reports.map((report) => (
          <li key={report.id}>
            <div>
              <strong>{report.incident_reference}</strong>
              <span>{report.reported_display_name}</span>
              <span>Reported by {report.reporter_display_name ?? "Member"}</span>
              <span>{report.reason} &middot; {report.status}</span>
              <span>{report.reported_active_strikes ?? 0} of 3 active strikes</span>
              {report.details && <p>{report.details}</p>}
            </div>
            <div className="admin-actions">
              {report.status === "open" && (
                <>
                  <button type="button" disabled={busy} onClick={() => void act(
                    () => moderateReport(report.id, {
                      action: "uphold", expected_revision: report.revision, note: null,
                    }),
                    "Report upheld and strike recorded.",
                  )}>Uphold report</button>
                  <button type="button" disabled={busy} onClick={() => void act(
                    () => moderateReport(report.id, {
                      action: "dismiss", expected_revision: report.revision, note: null,
                    }),
                    "Report dismissed.",
                  )}>Dismiss report</button>
                </>
              )}
              {report.listing_id && report.listing_revision && (
                <button className="admin-destructive" type="button" disabled={busy} onClick={() => {
                  if (confirm("Remove this trade listing?")) {
                    void act(
                      () => moderateListing(report.listing_id!, {
                        status: "removed", expected_revision: report.listing_revision!, note: "Removed from report queue",
                      }),
                      "Trade listing removed.",
                    );
                  }
                }}>Remove listing</button>
              )}
              {report.strike_id && report.strike_revision && report.strike_status === "active" && (
                <button type="button" disabled={busy} onClick={() => {
                  if (confirm("Void this strike after reviewing the member's appeal?")) {
                    void act(
                      () => voidTradeStrike(report.strike_id!, {
                        expected_revision: report.strike_revision!,
                        note: "Appeal evidence accepted",
                      }),
                      "Strike voided after appeal review.",
                    );
                  }
                }}>Void strike after appeal</button>
              )}
              {report.reported_trading_status === "active" && report.reported_trading_revision && (
                <button className="admin-destructive" type="button" disabled={busy} onClick={() => {
                  if (confirm("Suspend trading for this member? Their account, collection, and decks remain available.")) {
                    void act(
                      () => setMemberTradingStatus(report.reported_user_id, {
                        status: "suspended",
                        expected_revision: report.reported_trading_revision!,
                        note: "Manual moderation suspension",
                      }),
                      "Member trading suspended.",
                    );
                  }
                }}>Suspend trading</button>
              )}
              <button className="admin-destructive" type="button" disabled={busy} onClick={() => {
                if (confirm("Deactivate this ordinary member account and revoke its sessions?")) {
                  void act(
                    () => setMemberAccountStatus(report.reported_user_id, {
                      is_active: false, note: "Moderation deactivation",
                    }),
                    "Member account deactivated.",
                  );
                }
              }}>Deactivate account</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
