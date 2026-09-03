# Version 2.0.1 release readiness

This document records the release-candidate checks without storing private
addresses, usernames, email addresses, credentials, certificates, MFA keys, or
backup contents.

## Product boundary

- Scanner results remain suggestions and require member confirmation.
- Scanner photos remain transient and are not retained as a photo library.
- Marketplace buttons open exact-printing searches on independent third-party
  sites. CardVault does not process transactions, payment, shipping, seller
  contact, or marketplace accounts.
- The community feed is authenticated and opt-in. It exposes only display name,
  safe card identity/image data, catalog counts, and set release information.
  Prices, collection details, email, sessions, IP addresses, and scanner photos
  are excluded.
- Email changes use the current password and revoke all sessions. Non-owner
  deletion requests require owner review; owner deletion is unavailable in the
  web application. MFA reset follows the existing role hierarchy and revokes
  the target's sessions and trusted browsers.
- Google/Apple sign-in, outbound email recovery, physical scanner transport,
  custom collectibles, and gameplay remain optional future work rather than V2
  release requirements.

## Release gate

- [x] Scanner, collection, marketplace, and accessibility tests pass in the full suite.
- [x] Complete API suite: **346 passed**; complete web suite: **552 passed**.
- [x] Ruff, TypeScript checking, production web build, shell syntax, and diff checks pass.
- [x] Relative documentation links and public-file sanitization checks pass.
- [x] Clean standalone Docker bootstrap passes using generated test secrets.
- [x] Baseline private backup is verified; live services remain healthy.
- [x] Fresh post-acceptance private backup passes checksums and isolated restore.
- [x] Encrypted off-host copy is checksum verified and decrypt-tested.
- [x] Owner performs the private live MFA-reset and deletion-review actions.

## Account and community acceptance

- [x] Email change signs the member out; old email fails and new email signs in.
- [x] Member requests, cancels, and re-requests deletion; owner approves it.
- [x] Deleted member sessions and subsequent sign-in fail; its test card is removed.
- [x] Owner resets disposable member MFA; old session fails and enrollment is cleared.
- [x] Activity is hidden by default, appears on opt-in, and disappears on opt-out.

Live acceptance used one disposable member and one card. The real owner and
existing collections were not changed. Owner/Super Admin targeting restrictions
and trusted-browser revocation were reviewed in the server controls; live reset
acceptance specifically verified session revocation and cleared MFA enrollment.

## Evidence recorded on 2026-09-03

- Clean Ubuntu 26.04 amd64 container: 2 vCPU, 4 GiB RAM, 512 MiB swap,
  60 GiB disk. First ran the public one-command bootstrap, then installed the
  final `2.0.1` candidate with fresh volumes while reusing the Docker build cache.
- All four standalone services became healthy. HTTPS was checked with the
  generated CA; API and database ports were not published on the host.
- Setup created a generated-credential test owner, closed initial owner setup,
  allowed sign-in, and required owner MFA enrollment.
- Standalone backup `20260903T202846Z` restored on alternate ports at migration
  `0018_account_community`; restored owner sign-in passed.
- Private backup `20260903T202558Z` restored in a separate database container.
  Its encrypted off-host copy passed ciphertext and decrypted-content checksums.
  Temporary plaintext and disposable live-member credentials were removed.
- Private backup tooling now archives the deployed working tree rather than
  only HEAD. The isolated restore checker waits for the target database to
  accept a query, avoiding an initialization readiness race. These private
  operations scripts are not part of the standalone public distribution.
- The final release changes repair legacy fixtures, community-response mocks,
  lint issues, installer version checks, and documentation. No new production
  feature rollout or database migration was needed for release closure.

Non-blocking observations: two upstream test-client deprecation warnings and
the existing Vite large-chunk advisory. These are not test or build failures.
An empty-catalog minimum-spec install is verified; this is not a performance
guarantee for every game catalog or a benchmark of camera recognition.
## Installation and recovery

Install from the immutable `v2.0.1` tag using the command in
[`docs/INSTALL.md`](INSTALL.md). The setup process generates installation
secrets and has no default owner password. Test recovery only in an isolated
project on alternate ports; never overwrite the active installation to prove a
backup.
