# Optional Google sign-in implementation plan

Goal: private-first, optional Google login and explicit account linking, configured in Admin after Docker owner setup.

Architecture: authorization-code flow with PKCE, browser-bound single-use state and nonce, verified Google RS256 ID tokens. Reuse local sessions, MFA, password recovery and owner permissions. Encrypt configuration using the existing escrow key with a separate purpose label. Never auto-link by email. New visitors use existing signup then explicitly link Google; this keeps a working password fallback.

- [x] API: disabled default, owner configuration/redaction, state expiration and binding, explicit linking, login through existing MFA; migration 0020.
- [x] UI: optional login button, Account link/unlink, Admin configuration form and callback instructions.
- [x] Documentation: installation points to optional Admin setup; private credentials never in repository.
- [x] Focused security tests, build, private migration/deploy, owner Google acceptance.

The owner confirmed successful linking and subsequent Google sign-in on
2026-09-03 and authorized publication to the V2.5 development branch.
Focused Google/email API verification: 17 passed. Google settings UI: 2 passed.
Production build and private rollout passed. This is not a new release tag.

Callback: `/api/v1/auth/google/callback`. Only `openid email` scopes. Provider errors redirect to a fixed local login/account page with a non-secret status code. No user-supplied return URLs. Disable configuration invalidates outstanding flows. No GitHub push until private acceptance.
