# V2 Linked Sign-In and Scanner Controls Design

**Status:** Approved in chat on 2026-08-31. The current $6 increment implements only the scanner-control slice; linked sign-in remains the next independent V2 track.

## Goals

1. Keep username/password sign-in and later add optional Google and Apple sign-in.
2. Let a signed-in member explicitly link or unlink provider identities without unsafe email-only account merging.
3. Give multiple-card scanning one simple browser-local capture countdown control.
4. Reuse the existing simulation-only ESP32/Arduino controller and expose clearer bounded tuning and safety feedback.

## Linked sign-in boundary

- Google and Apple are optional provider adapters. Their buttons are hidden until the server has valid deployment secrets.
- A first provider sign-in creates a normal `member`; it never creates or promotes a privileged role.
- An existing provider subject signs into its linked account.
- Matching email addresses never silently link accounts. Linking requires an authenticated CardVault session plus recent password or MFA confirmation.
- Owner, Super Admin, and Admin accounts retain required CardVault MFA. Provider authentication does not bypass the five-hour trusted-browser policy.
- Store only provider issuer, stable subject, display metadata, and timestamps. Provider secrets remain deployment secrets and are never committed.
- Google uses server-verified OpenID Connect. Apple support stays independently deployable because it needs an Apple Services ID, associated App ID, verified web configuration, and redirect domain.

## $6 scanner-control increment

### Multiple-card scanner

- Add one control labeled **Capture countdown** with integer choices from 1 through 10 seconds.
- Default to the existing five-second behavior.
- Store the selection only in that browser under a versioned scanner key.
- Apply it to every stable-card automatic capture in the multiple-card session.
- Manual **Capture now**, the keyboard shortcut, recognition locking, session limits, privacy, and confirmation stay unchanged.
- A malformed stored value recovers to five seconds.

### DIY auto-scanner test

- Keep the controller simulation-only and privileged-account-only.
- Reuse the existing profile fields for board, pins, steps, speed, acceleration, countdown, settle delay, recognition timeout, retry limit, signal polarity, and direction.
- Add quick tuning for acceleration, recognition timeout, and retry limit beside the existing speed/countdown/settle controls.
- Add a **Run safety check** action that validates the active profile, reports warnings/errors, and never connects to or energizes hardware.
- Preserve connect, home, advance, disconnect, emergency stop, readiness signalling, bounded settings, and command history.

## Safety and privacy

- No new server endpoint, serial/WebUSB connection, firmware, or physical motor command is included.
- Photos retain the existing private scanner lifecycle.
- Browser-local settings contain no account secrets and can be reset to safe defaults.
- Every numeric setting is clamped or validated using the existing limits.

## Verification

- Unit-test storage recovery and countdown bounds.
- Component-test the multiple-card control and countdown propagation.
- Component-test added DIY tuning, the safety check, and unchanged emergency-stop behavior.
- Run the focused scanner tests once, then TypeScript and one production build.

## Deferred linked sign-in implementation stages

1. Provider-identity schema and secure account-linking API.
2. Google OIDC sign-in, signup, link, and unlink.
3. Apple sign-in, signup, link, and unlink after deployment credentials and redirect-domain configuration exist.
4. Account UI, login buttons, audits, recovery handling, documentation, and private deployment for each provider.
