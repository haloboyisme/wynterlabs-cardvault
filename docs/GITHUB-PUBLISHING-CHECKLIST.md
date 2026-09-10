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

- Version 2.6.0 includes remembered scan sets, difficult-card matching refinements,
  sales-based collection estimates, detailed pricing, and interactive value history.
- The `v2` branch is the repository landing branch and supported release line.
  Earlier release tags and the historical `v2.5` branch remain unchanged.
- See [V2.6.0 release notes](v2.6.0-release.md),
  [pricing sources and limits](PRICE-COMPARISON.md), and the
  [remaining roadmap](V3-ROADMAP.md).
- Automated checks cover application behavior. Real-card camera acceptance and
  prolonged phone/tablet testing remain open. No new clean-host installation or
  backup/restore drill was performed for this release.
- The private Hardware Lab prototype is excluded from this public release.
