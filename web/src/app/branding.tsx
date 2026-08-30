import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "./auth";
import { DEFAULT_BRANDING, getBranding, type Branding } from "../lib/branding";

interface BrandingContextValue {
  branding: Branding;
  applyBranding: (branding: Branding) => void;
  refreshBranding: () => Promise<Branding>;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const requestGeneration = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++requestGeneration.current;
    };
  }, []);

  const refreshBranding = useCallback(async () => {
    const generation = ++requestGeneration.current;
    const current = await getBranding();
    if (mounted.current && generation === requestGeneration.current) setBranding(current);
    return current;
  }, []);

  const applyBranding = useCallback((current: Branding) => {
    ++requestGeneration.current;
    if (mounted.current) setBranding(current);
  }, []);

  useEffect(() => {
    document.title = `${branding.site_name} ${branding.product_name}`;
  }, [branding]);

  useEffect(() => {
    if (status !== "authenticated") {
      ++requestGeneration.current;
      setBranding(DEFAULT_BRANDING);
      return;
    }
    const controller = new AbortController();
    const generation = ++requestGeneration.current;
    void getBranding(controller.signal)
      .then((current) => {
        if (!controller.signal.aborted && mounted.current && generation === requestGeneration.current) setBranding(current);
      })
      .catch(() => {
        if (!controller.signal.aborted && mounted.current && generation === requestGeneration.current) setBranding(DEFAULT_BRANDING);
      });
    return () => {
      ++requestGeneration.current;
      controller.abort();
    };
  }, [status]);

  const value = useMemo(() => ({ branding, applyBranding, refreshBranding }), [applyBranding, branding, refreshBranding]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const value = useContext(BrandingContext);
  if (!value) throw new Error("useBranding must be used inside BrandProvider");
  return value;
}
