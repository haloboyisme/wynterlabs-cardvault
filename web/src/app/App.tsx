import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "../components/AppShell";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { AcceptInvitationPage } from "../pages/AcceptInvitationPage";
import { AdminPage } from "../pages/AdminPage";
import { AccountPage } from "../pages/AccountPage";
import { CardDetailPage } from "../pages/CardDetailPage";
import { CardsPage } from "../pages/CardsPage";
import { ChangePasswordPage } from "../pages/ChangePasswordPage";
import { CollectionImportPage } from "../pages/CollectionImportPage";
import { CollectionPage } from "../pages/CollectionPage";
import { CollectionPricingPage } from "../pages/CollectionPricingPage";
import { DashboardPage } from "../pages/DashboardPage";
import { DeckDetailPage } from "../pages/DeckDetailPage";
import { DecksPage } from "../pages/DecksPage";
import { HomePage } from "../pages/HomePage";
import { LoginPage } from "../pages/LoginPage";
import { MfaChallengePage } from "../pages/MfaChallengePage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ScannerPage } from "../pages/ScannerPage";
import { SetupPage } from "../pages/SetupPage";
import { TradingPage } from "../pages/TradingPage";
import { AuthProvider } from "./auth";
import { BrandProvider } from "./branding";
import { MEMBER_TRADING_ENABLED } from "./features";

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <BrandProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/mfa-challenge" element={<MfaChallengePage />} />
            <Route path="/signup" element={<AcceptInvitationPage />} />
            <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
            <Route
              path="/change-password"
              element={<ProtectedRoute allowPasswordChange><ChangePasswordPage /></ProtectedRoute>}
            />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
            <Route path="/cards" element={<ProtectedRoute><CardsPage /></ProtectedRoute>} />
            <Route path="/cards/:printingId" element={<ProtectedRoute><CardDetailPage /></ProtectedRoute>} />
            <Route path="/collection" element={<ProtectedRoute><CollectionPage /></ProtectedRoute>} />
            <Route
              path="/collection/pricing"
              element={<ProtectedRoute><CollectionPricingPage /></ProtectedRoute>}
            />
            <Route
              path="/collection/import"
              element={<ProtectedRoute><CollectionImportPage /></ProtectedRoute>}
            />
            <Route path="/scan" element={<ProtectedRoute><ScannerPage /></ProtectedRoute>} />
            {MEMBER_TRADING_ENABLED && (
              <Route path="/trades" element={<ProtectedRoute><TradingPage /></ProtectedRoute>} />
            )}
            <Route path="/decks" element={<ProtectedRoute><DecksPage /></ProtectedRoute>} />
            <Route path="/decks/:deckId" element={<ProtectedRoute><DeckDetailPage /></ProtectedRoute>} />
            <Route
              path="/admin"
              element={(
                <ProtectedRoute roles={["owner", "super_admin", "admin"]}>
                  <AdminPage />
                </ProtectedRoute>
              )}
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AppShell>
        </BrandProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
