import { type ReactNode, useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../app/auth";
import type { User } from "../lib/types";

interface ProtectedRouteProps {
  children: ReactNode;
  roles?: User["role"][];
  allowPasswordChange?: boolean;
}

export function ProtectedRoute({
  children,
  roles,
  allowPasswordChange = false,
}: ProtectedRouteProps) {
  const auth = useAuth();
  const location = useLocation();
  const admittedPasswordChange = useRef(false);

  useEffect(() => {
    if (
      auth.status === "authenticated"
      && auth.user?.must_change_password
      && allowPasswordChange
    ) {
      admittedPasswordChange.current = true;
    }
  }, [allowPasswordChange, auth.status, auth.user?.must_change_password]);

  if (auth.status === "loading") {
    return <section className="state-panel" aria-live="polite">Checking your session...</section>;
  }
  if (auth.status === "unavailable") {
    return (
      <section className="state-panel error-panel">
        <p className="eyebrow">Connection interrupted</p>
        <h1>The cards service is taking a breath.</h1>
        <p>Check that dblite is online, then refresh this page.</p>
      </section>
    );
  }
  if (auth.status !== "authenticated") {
    if (allowPasswordChange && admittedPasswordChange.current) {
      return children;
    }
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (auth.user.must_change_password && !allowPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }
  if (!auth.user.must_change_password && allowPasswordChange) {
    return <Navigate to="/dashboard" replace />;
  }
  if (roles && !roles.includes(auth.user.role)) {
    return (
      <section className="state-panel">
        <p className="eyebrow">Restricted area</p>
        <h1>Not authorized</h1>
        <p>Owner or administrator access is required for this page.</p>
      </section>
    );
  }
  return children;
}
