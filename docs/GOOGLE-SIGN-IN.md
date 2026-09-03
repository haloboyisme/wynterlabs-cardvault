# Optional Google sign-in

Google is **disabled by default**. No paid Google service, Gmail scope, billing activation, or public CardVault server is required for basic sign-in. Every self-hosted installation uses its own Google OAuth web client; no shared credentials are shipped.

## After Docker installation

1. Finish the normal owner setup, escrow the recovery key, and enroll required owner MFA.
2. Use a working HTTPS hostname. For LAN-only installations, local DNS can point your owned hostname at your private server. Trust the server CA on each client device. Google cannot use a raw private IP as the web redirect URI. Do not add port forwarding just for Google login.
3. Create a project in Google Cloud → Google Auth Platform. Complete Branding and Audience. Personal Google accounts use External. Keep Testing while validating; add each test Google account under Audience → Test users.
4. Create an OAuth client of type Web application. Under Authorized redirect URIs, register exactly `https://YOUR-HOST/api/v1/auth/google/callback`. JavaScript origins are not required for this server-side flow.
5. In CardVault **Admin → Google sign-in setup**, enter the HTTPS origin, client ID and client secret, enable, and confirm with your current CardVault password. Only an owner or super administrator can configure this. A saved secret is never returned by the API. Leaving it blank preserves it; changing the client ID requires a new secret.
6. While signed in with your existing account, open **Account → Linked sign-in methods**, enter your CardVault password, and choose **Link Google account**. Google must return you to that same browser session.
7. Sign out and choose **Sign in with Google**. CardVault MFA still applies. Password sign-in stays available.

The installer prints the Admin setup link when installation completes. You can skip this option entirely or enable/disable it later without reinstalling Docker. The Admin form is the setup mechanism; the installer does not ask for provider secrets in shell arguments.

## New users and recovery

An unlinked Google identity is never automatically attached by email. New users follow Create account, retain a password, complete email verification if enabled, then link Google in Account. Existing users sign in with their password and explicitly link. This release does not create passwordless accounts directly from Google.

Unlink requires the current password. It does not delete the CardVault account or collection. Disabling Google in Admin leaves password login and normal recovery in place. It invalidates outstanding Google authorization attempts. Existing CardVault sessions are not terminated merely by disabling the provider.

## Security and operations

- Only `openid email` is requested. No Gmail/Drive access or refresh token is stored.
- Google subject ID, not email, identifies the linked account. No role escalation through Google.
- Single-use state, browser binding, PKCE, nonce, Google RSA signature/audience/issuer/expiry checks protect callbacks. Login does not bypass inactive accounts, verification gates, password-change gates, or MFA setup.
- Client secret and PKCE verifier are encrypted with a purpose-separated key derived from the escrowed MFA key. Back up that key separately from the encrypted database. Downloaded provider JSON must stay outside source control.
- OAuth callback query strings are removed from the API access-log scope; do not enable reverse-proxy query logging on this route.
- Google token exchange and key retrieval have bounded network timeouts. An outage returns a generic retry message and password login remains usable.
- Troubleshooting: `redirect_uri_mismatch` means the exact hostname/path differs; access denied may mean the account is absent from Google Test users; a failed link may mean the original session expired or a different identity was already linked.

Reference: [Google OpenID Connect server flow](https://developers.google.com/identity/openid-connect/openid-connect).
