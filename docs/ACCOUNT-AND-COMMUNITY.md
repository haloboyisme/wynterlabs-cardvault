# Account and community controls

CardVault keeps this V2 increment usable without SMTP, paid APIs, or external
identity providers.

## Member controls

- Change the sign-in email from **Account → Account controls** after entering the
  current password. A successful change revokes every session and trusted MFA
  browser, then signs the member out.
- Community activity sharing is off by default. An opted-in member may appear by
  display name when joining or adding a card. Email, prices, condition, notes,
  sessions, IP addresses, and scanner photos never appear in the feed.
- Non-owner members may request account deletion with their current password and
  may cancel while the request is pending. Nothing is deleted until the owner
  approves it.

## Owner and Super Admin controls

- The owner can approve or reject pending deletion requests and can permanently
  delete any non-owner account after an explicit warning.
- The owner can reset MFA for any non-owner. A Super Admin can reset MFA only for
  administrators and members, never the owner or another Super Admin.
- MFA reset removes the authenticator credential and recovery codes, revokes all
  sessions and trusted browsers, and requires privileged accounts to enroll again.
- The owner account cannot be deleted or MFA-reset through the website.

## Private activity API

`GET /api/v1/community/activity` requires a ready signed-in session. It derives a
bounded newest-first list from existing opted-in users, collection additions,
completed catalog refreshes, and active set releases. It does not maintain a
second activity database or store social posts.
