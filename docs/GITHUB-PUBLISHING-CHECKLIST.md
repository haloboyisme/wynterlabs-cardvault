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
