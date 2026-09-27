# CardVault documentation

Reviewed September 27, 2026. The maintained **v2** branch now identifies **2.7.8**. Existing release tags remain unchanged. Use the commit SHA to identify the exact branch build.

## Start here

| Task | Guide |
| --- | --- |
| Install a new server | [Installation](INSTALL.md) |
| Back up and upgrade | [Backup and version upgrades](UPGRADING.md) |
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

- [Version 2.7.8](v2.7.8-release.md)
- [Changes since the v2.7.7 tag](post-v2.7.7-updates.md)
- [Changelog](../CHANGELOG.md)
- [Remaining roadmap](V3-ROADMAP.md)
- Current migration head: `0025_scan_diagnostics`.
- V2.7.8 public package verification: 679 frontend tests across 89 files,
  TypeScript and production build passed. The private deployment separately
  passed 49 focused backend branding/layout tests. This is not a full API test
  run, a standalone upgrade drill, or a physical camera/feeder endurance test.
- Public automatic scanning remains simulation-only. Private feeder firmware,
  hardware services, credentials and deployment records are not distributed.

## Historical records

Numbered release notes, dated readiness reports, and `superpowers/` plans/specs
record the scope and evidence at the time they were written. Their old version
numbers and test counts are historical; use the guides above for current behavior.
Existing tags are not rewritten. The original [v2.7.7 notes](v2.7.7-release.md)
remain available alongside newer branch follow-ups.
