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

- Version 2.5.1 is the completed Version 2 feature release and remains an
  immutable historical tag.
- Version 2.5.2 is the final documentation-only Version 2 installation tag.
- The `v2` branch is the repository landing branch and the supported Version 2
  line; `v2.5` follows the same final maintenance source.
- Current release evidence: [V2.5 readiness](v2.5-release-readiness.md),
  [V2.5.2 notes](v2.5.2-release.md), and the [V3 roadmap](V3-ROADMAP.md).
- New feature work belongs to Version 3 and must pass private owner acceptance
  before public promotion.
