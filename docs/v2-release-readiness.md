# Version 2 release readiness

This document records the release-candidate checks without storing private
addresses, usernames, email addresses, credentials, certificates, MFA keys, or
backup contents.

## Product boundary

- Scanner results remain suggestions and require member confirmation.
- Scanner photos remain transient and are not retained as a photo library.
- Marketplace buttons open exact-printing searches on independent third-party
  sites. CardVault does not process transactions, payment, shipping, seller
  contact, or marketplace accounts.
- Google/Apple sign-in, outbound email recovery, community feeds, physical
  scanner transport, custom collectibles, and gameplay remain optional future
  work rather than V2 release requirements.

## Release gate

- [ ] Focused scanner, collection, marketplace, and accessibility tests pass.
- [ ] Complete web and API test suites pass.
- [ ] Type checking and production web build pass.
- [ ] Documentation links and tracked-file sanitization checks pass.
- [ ] Standalone Docker bootstrap tests pass using generated test secrets.
- [ ] Private live predeployment backup passes checksums and isolated restore.
- [ ] Live Compose services and HTTPS readiness checks pass.
- [ ] Private live postdeployment backup passes checksums and isolated restore.
- [ ] Encrypted off-host copy is checksum verified and decrypt-tested.
- [ ] Owner reviews the private live deployment before public push and tag.

## Installation and recovery

Install from the immutable `v2.0.0` tag using the command in
[`docs/INSTALL.md`](INSTALL.md). The setup process generates installation
secrets and has no default owner password. Test recovery only in an isolated
project on alternate ports; never overwrite the active installation to prove a
backup.
