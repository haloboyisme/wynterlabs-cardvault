# V2 Account and Community Completion Design

**Status:** Approved in chat on 2026-09-02

## Goal

Complete the remaining email-free account controls and add a private-by-default Home activity experience by reusing CardVault's existing identity, MFA, collection, catalog, administration, and Home components.

## Scope

- Members can change their sign-in email after confirming their current password. The normalized email must remain unique. A successful change revokes every session and trusted-MFA browser, then signs the member out so the new email is used on the next login.
- Non-owner accounts can request deletion after confirming their current password and an explicit warning. They can cancel a pending request.
- Only the owner can approve or reject deletion requests or directly delete a non-owner account. Every destructive control requires a typed confirmation and a fresh server-side target lookup. Owner deletion is not exposed in the web interface.
- The owner and Super Admin can reset MFA only within their existing role hierarchy. The owner cannot be reset through the web interface. Resetting MFA deletes the target's credential and recovery codes, revokes all sessions and trusted browsers, and marks privileged targets as requiring MFA setup again.
- Each account has a server-stored `share_activity` preference. It defaults to false.
- Signed-in Home activity can show opted-in members' recently added cards and new-member joins plus installation-wide catalog refreshes. It never includes email addresses, collection totals, prices, conditions, notes, sessions, IP addresses, or scanner photos.
- Turning activity sharing off removes that member's derived entries from subsequent feed responses. No separate permanent activity-event copy is created.
- Release documentation is updated after one combined final verification. Private deployment remains first; GitHub publication requires the owner's separate live approval.

## Architecture

### Data

Migration `0018_account_community_controls` adds `users.share_activity`, an `account_deletion_requests` decision record, and the required security-audit event values. Deletion requests use a revision and one current row per user so approval cannot operate on stale state.

### Account API

The existing account router owns self-service email, preferences, and deletion-request endpoints. Current-password verification reuses `verify_password`; identity locking, session revocation, and trusted-browser revocation reuse existing helpers.

### Administrative API

The existing Admin router owns deletion decisions, direct non-owner deletion, and MFA reset. Authorization is checked again inside the transaction after locking both actor and target. Super Admin cannot affect an owner or another Super Admin. Only owner can delete accounts or decide deletion requests.

### Community API

A small authenticated `/api/v1/community/activity` endpoint derives bounded feed entries from opted-in users, their collection items, and completed catalog imports. It returns presentation-safe entries sorted newest first and does not create a second activity database.

### Web interface

Account receives three compact security/privacy cards: change email, deletion request, and community visibility. Admin reuses its managed-account table for MFA reset and direct deletion, with a separate pending-deletion section. Home keeps its existing unsigned experience and adds the activity feed only for authenticated members.

## Safety and error handling

- Email changes, deletion requests, direct deletion, and MFA resets fail closed on stale or inactive identities.
- Duplicate emails return a generic conflict without exposing another account.
- Destructive operations require exact confirmation text and cannot target the owner.
- Deleting a user relies on current database cascade rules and is never run as part of deployment or testing against live data.
- Feed queries are bounded and indexed; a failed activity request leaves the rest of Home usable with retry feedback.
- `share_activity=false` is the migration and application default.

## Verification

- API tests cover uniqueness, password confirmation, session/MFA-trust revocation, role boundaries, stale deletion decisions, cascading deletion, privacy filtering, and bounded feed output.
- Web tests cover warnings, confirmation text, success/error feedback, privacy toggling, Admin role boundaries, authenticated activity, retry behavior, and unsigned Home privacy.
- One final combined verification runs the focused API and web files, migration smoke, type checking, production build, document links, and tracked-file secret scan once.

## Excluded

- SMTP, email verification, and forgotten-password delivery.
- Google or Apple sign-in.
- Public profiles, comments, likes, follows, messaging, or member contact information.
- Publishing or tagging GitHub before owner review of the private deployment.
