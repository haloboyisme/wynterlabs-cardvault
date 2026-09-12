# GitHub publishing checklist

Use this checklist for every `wynterlabs-cardvault` public release. The
repository is already public; release approval remains owner controlled.

- Review the sanitized archive, including the public documents and release
  candidate, before it enters the repository.
- Keep private deployment history, secrets, certificates, backup archives,
  owner identifiers, personal email addresses, and private network details out
  of public commits.
- Enable branch protection and require review before protected branches change.
- Enable secret scanning and dependency alerts.
- Require the release checks before merging or creating a release.
- Configure private security reporting before any visibility change.

Do not push or tag until the owner has reviewed the private live deployment,
the sanitized diff, installer evidence, backup/restore evidence, and the final
release checks.

See the [project overview](../README.md) and [security policy](../SECURITY.md).

## Current release status

- V2.7.5 includes streamer/OBS/video, prize feedback, dynamic personalization and
  shared branding. See [release notes](v2.7.5-release.md).
- `v2` remains the landing branch; older version tags remain unchanged.
- Private infrastructure, hardware experiments and credentials are excluded.
- Real-card/long-camera-session and OBS desktop audio acceptance remain open.
- No new clean-host install or backup/restore drill is claimed for this update.
- Final public-candidate automated results are recorded below after checks finish.

### V2.7.5 public-candidate checks — September 12, 2026

- 602 frontend tests passed across 74 files.
- 58 focused API tests passed (presentation, branding, custom cards and scanner OCR).
- TypeScript and production build passed; the existing large-chunk advisory remains.
- Changed-file Ruff passed; the pre-existing Role enum UP042 advisory was excluded
  for models.py rather than changing unrelated enum behavior in this release.
- Migration graph has one head, 0023_brand_design; installer shell syntax passed.
- Changed files were scanned for private host paths, addresses and credential markers.
