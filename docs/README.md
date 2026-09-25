# CardVault documentation

Reviewed September 25, 2026. The release tag is **v2.7.7**; the maintained **v2**
branch includes later scanner, presentation and diagnostic updates. `VERSION`
continues to identify the release line. Use the commit SHA to identify a branch build.

## Start here

| Task | Guide |
| --- | --- |
| Install a new server | [Installation](INSTALL.md) |
| Back up and upgrade | [Upgrading and same-version limits](UPGRADING.md) |
| Scan cards and review failures | [Scanning and scan history](SCANNING.md) |
| Configure overlays, sound and recaps | [Streamer preview](STREAMER-PREVIEW.md) |
| Customize themes and backgrounds | [Personalization](PERSONALIZATION.md) |
| Add cards absent from catalogs | [Custom Card Import](CUSTOM-CARD-IMPORT.md) |
| Understand price estimates | [Price comparison](PRICE-COMPARISON.md) |
| Manage accounts | [Account and community](ACCOUNT-AND-COMMUNITY.md) |
| Configure optional sign-in and email | [Google sign-in](GOOGLE-SIGN-IN.md) · [Email](EMAIL-SETUP.md) |
| Report security concerns | [Security policy](../SECURITY.md) |
| Contribute or publish | [Contributing](../CONTRIBUTING.md) · [Publishing checklist](GITHUB-PUBLISHING-CHECKLIST.md) |

## Current status

- [Changes since the v2.7.7 tag](post-v2.7.7-updates.md)
- [Changelog](../CHANGELOG.md)
- [Remaining roadmap](V3-ROADMAP.md)
- Current migration head: `0025_scan_diagnostics`.
- Latest code verification: 663 frontend tests, 12 focused backend tests,
  TypeScript and production build passed. This is not a full API test run or a
  physical camera/feeder endurance test.
- Public automatic scanning remains simulation-only. Private feeder firmware,
  hardware services, credentials and deployment records are not distributed.

## Historical records

Numbered release notes, dated readiness reports, and `superpowers/` plans/specs
record the scope and evidence at the time they were written. Their old version
numbers and test counts are historical; use the guides above for current behavior.
Existing tags are not rewritten. The original [v2.7.7 notes](v2.7.7-release.md)
remain available alongside newer branch follow-ups.
