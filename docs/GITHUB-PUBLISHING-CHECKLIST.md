# GitHub publishing checklist

Prepare the `wynterlabs-cardvault` repository privately, complete every check,
and obtain owner approval before changing it to **public** visibility.

- Review the sanitized archive, including the public documents and release
  candidate, before it enters the repository.
- Create a squashed first commit. Do not import private history.
- Enable branch protection and require review before protected branches change.
- Enable secret scanning and dependency alerts.
- Require the release checks before merging or creating a release.
- Configure private security reporting before any visibility change.

Do not publish until the owner has reviewed the sanitized archive, approved the
first commit, confirmed the security-reporting channel, and explicitly approved
changing repository visibility.

See the [project overview](../README.md) and [security policy](../SECURITY.md).
