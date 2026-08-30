import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  createSimulatedAutoScannerController,
} from "../scanner/auto-scanner-controller";
import { readAutoScannerSettings } from "../scanner/auto-scanner-settings";
import { AutoScannerControllerPanel } from "./AutoScannerControllerPanel";
import { MultiScanSession } from "./MultiScanSession";

interface AutoScanWorkspaceProps {
  preferredSet: string;
  preferredSetGame: string;
  preferredGame: string;
  topControls: ReactNode;
}

export function AutoScanWorkspace({
  preferredSet,
  preferredSetGame,
  preferredGame,
  topControls,
}: AutoScanWorkspaceProps) {
  const [controller] = useState(() => createSimulatedAutoScannerController(readAutoScannerSettings));
  const [captureNotice, setCaptureNotice] = useState("");
  const disposalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (disposalTimer.current !== null) {
      clearTimeout(disposalTimer.current);
      disposalTimer.current = null;
    }
    return () => {
      disposalTimer.current = setTimeout(() => {
        disposalTimer.current = null;
        controller.dispose();
      }, 0);
    };
  }, [controller]);

  return <section className="auto-scan-workspace" aria-labelledby="automatic-card-session-title">
    <header>
      <p className="eyebrow">Private local test</p>
      <h1 id="automatic-card-session-title">Automatic card session</h1>
      <p>This simulation-only workspace models card movement without connecting to hardware. Advance one card only reports when the next card is ready: you still choose Capture now and confirm each printing before adding it.</p>
    </header>
    {captureNotice && <p className="auto-scan-capture-notice" role="status">{captureNotice}</p>}
    <div className="auto-scan-workspace-grid">
      <AutoScannerControllerPanel
        controller={controller}
        onReadyForCapture={() => setCaptureNotice("Next card is ready. Choose Capture now when the card is in view.")}
        onCaptureReadinessChange={(ready) => { if (!ready) setCaptureNotice(""); }}
      />
      <MultiScanSession
        preferredSet={preferredSet}
        preferredSetGame={preferredSetGame}
        preferredGame={preferredGame}
        topControls={topControls}
        stableFrameAutoCapture={false}
        onCaptureAccepted={() => setCaptureNotice("")}
      />
    </div>
  </section>;
}
