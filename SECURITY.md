# Security policy

Updated September 12, 2026 for V2.7.5.

## Reporting a vulnerability

This repository is public. GitHub private vulnerability reporting is currently
disabled, and no dedicated private reporting address is documented here.
Do not post exploit details, credentials or suspected vulnerabilities in public
issues, discussions or pull requests. Ask the maintainer to arrange a private
reporting channel without including sensitive details. Once a private channel
is confirmed, include the affected version, impact, a minimal reproduction and
any practical mitigation. No response-time guarantee is provided.

Never upload production databases, scan photos, private OBS links, keys, recovery
codes, session tokens or unredacted production logs to GitHub.

## Maintained release line

`v2` is the maintained release line; the current release is **V2.7.5**. Security
fixes target that line. Older releases, including `1.0.x`, do not have a separate
backport commitment. Review [releases](https://github.com/haloboyisme/wynterlabs-cardvault/releases)
and the [upgrade guide](docs/UPGRADING.md), preserving secrets and taking a verified
backup before upgrading.

## Deployment and account boundaries

Use the supported HTTPS entry point and keep API/database services internal.
Protect generated installation secrets, use MFA for privileged accounts, review
active sessions and test recovery. Public source code does not make a private
installation reachable from the internet. External access needs deliberate
network and authentication configuration.

Branding identity, logo and design can be read before sign-in so Home and login
show the configured brand. Do not put private information in those fields.
Branding changes still require an authorized administrator. Collections and
account data are not part of the branding response.

## Streamer links and media

An OBS link is a private, read-only bearer credential: anyone possessing it can
view that presentation, including enabled card details and prices. It grants no
account editing or device control. Links expire after seven days; Disable, Rotate
and Start new pack revoke prior links. Do not publish links or include them in
screenshots or issue reports. Disable an exposed link promptly.

Only confirmed collection saves enter a saved pack. Found-card previews may be
sent to OBS when capture is enabled. A custom card back is stored with the
presentation and shared with its authorized viewers; use non-sensitive artwork.
Exported recap videos are local files that can disclose the displayed cards and
values when shared. See the [streamer guide](docs/STREAMER-PREVIEW.md).

## Scope and limits

Application tests are not a security audit. Browser/OBS behavior, third-party
catalog providers and the host operating system have their own security and
update requirements. The private experimental hardware integration is excluded
from this public release.
