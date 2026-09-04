<div align="center">

# 🃏 WynterLabs CardVault

### Scan it. Sort it. Own your collection.

**A private, self-hosted trading-card scanner and collection vault built for
collectors—not subscriptions.**

![Version](https://img.shields.io/badge/version-2.5.1-7c3aed?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-self--hosted-2496ed?style=for-the-badge&logo=docker&logoColor=white)
![AI assisted](https://img.shields.io/badge/development-AI--assisted-14b8a6?style=for-the-badge)
![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-f59e0b?style=for-the-badge)

</div>

> [!NOTE]
> WynterLabs CardVault is a fun, AI-assisted hobby project. I built it as a practical
> way to organize my cards and experiment with AI while avoiding another paid
> collection app—especially for scanning many cards. It is not a commercial
> service or a promise of permanent professional support.

## 🌈 Why this project exists

Collecting cards can already be expensive. Keeping track of them should not
require another monthly subscription just to scan, organize, price, and build
decks from cards you already own.

The goal is a simple but semi-advanced workspace that:

- runs on hardware you control;
- has no required paid app subscription;
- keeps collection and account data in your installation;
- makes single-card and multi-card scanning practical;
- remains understandable enough for hobbyists to operate; and
- costs relatively little to start and maintain beyond your hardware,
  electricity, storage, and internet connection.

AI helped with planning, coding, testing, documentation, and troubleshooting.
The project still requires human confirmation for scanned cards and human care
when installing, securing, backing up, or changing it.

## ✨ Version 2 at a glance

| Area | What is included |
|---|---|
| 🟣 **Catalogs** | Magic, Pokémon, Yu-Gi-Oh!, One Piece, Digimon, Star Wars: Unlimited, Union Arena, Disney Lorcana, and Riftbound browsing with game and set filtering |
| 🩵 **Scanner** | Manual single-card and faster card-by-card sessions with correction and exact-printing confirmation |
| 🟢 **Collection** | Quantities, conditions, finishes, values, game statistics, advanced sorting, bulk selection, import, and export |
| 🟠 **Decks** | Deck creation and management using cards from one supported game at a time |
| 🔵 **Dashboard** | Collection totals, pricing coverage, activity, and private hour-to-all-time value-history charts |
| 🟡 **Accounts** | Owner setup, invitations, roles, themes, sessions, recovery controls, and MFA |
| 🔴 **Safety** | Private-by-default deployment, generated secrets, HTTPS, isolated services, and backup tools |

Scanner recognition is an assistant, not an authority. Every scan should be
checked before saving because artwork, glare, angle, collector numbers, promos,
and reprints can produce an incorrect match.

## 🧪 Version 2 release

Version 2 expands the catalog foundation
to Magic: The Gathering, Pokémon, Yu-Gi-Oh!, One Piece, Digimon, Star Wars:
Unlimited, Union Arena, Disney Lorcana, and Riftbound. It also includes the
private Brand Studio and ongoing scanner improvements, including conditional
sideways-card recognition and labeled Digimon reference-artwork fallback when
an exact provider image is unavailable.

Keep backups and review scanned printings before saving. Recognition remains a
private assistant rather than an authority, even when CardVault preselects one
confident printing.

Authorized owner, Super Admin, and Admin accounts can also configure one
installation-wide catalog refresh schedule from the Admin catalog card. It can
run every 1-168 hours, daily, or weekly using a selected 24-hour time and IANA
time zone, for one supported game or all games. Manual refresh remains
available, and the panel reports the next run and latest result.

V2 account administration now includes a searchable and filterable managed
account directory, compact role/account/MFA-requirement badges, explicit
confirmation warnings, and success feedback after existing account actions.
This reuses the current authorization and session-revocation APIs; it does not
add an identity provider or weaken owner and Super Admin boundaries.

Scanner and collection completion adds explicit match feedback, reliable
one-result preselection, responsive single- and multi-card workspaces,
game-level collection totals, expanded sorting, and safe exact-printing
research links. TCGplayer and eBay open as independent third-party searches;
CardVault does not sell cards or process payments, shipping, messages, or
seller accounts.

## 🔐 Privacy and data boundaries

- Collections, accounts, imports, exports, and backups remain under the
  installer's control.
- Scanner photos are transient and are discarded instead of becoming a stored
  public photo library.
- Database and API services remain internal to the Docker network; the HTTPS
  proxy is the intended entry point.
- Installation secrets are generated locally and are never included in this
  repository.
- Card prices are estimates for reference—not appraisals or guaranteed sale
  values.

> [!IMPORTANT]
> Keep the server updated, protect the generated secrets, enable MFA for
> privileged accounts, and test backups before trusting the system with a large
> collection.

## 🧭 Version 2.5 and the road to Version 3

The roadmap is intentionally flexible because this is a fun project—not a
commitment to update the software forever.

### Completed V2 foundations

- Responsive and accessible single-card and multi-card scanning with correction,
  retry, session feedback, exact-printing confirmation, and one-result preselection.
- Multi-game collection filtering, advanced sorting, game/set statistics,
  pricing coverage, and private value-history presentation.
- Safe outbound exact-printing research links to TCGplayer and eBay without
  internal commerce or member-to-member transactions.
- Searchable account administration, optional member MFA, mandatory privileged
  MFA, trusted-browser handling, open member signup, invitation roles, and
  scheduled catalog refresh controls.
- Password-confirmed email changes, owner-reviewed deletion requests,
  hierarchy-safe MFA resets, and owner-only account deletion without requiring
  an outbound email service.
- A signed-in community feed for opted-in display names, recent card additions,
  catalog refreshes, and set releases. Sharing is off by default and never
  includes email, value, condition, notes, sessions, IP addresses, or scan photos.
- One-command Docker installation, generated secrets, backup/recovery tooling,
  and a documented owner-controlled release process.

### Included in V2.5

- Optional outbound mail configuration, signup email verification, and
  forgotten-password recovery using short-lived single-use reset links. The
  project will not email temporary passwords.
- Optional Google sign-in/linking using each installation's own credentials;
  username/password remains available. See [Google setup](docs/GOOGLE-SIGN-IN.md)
  and [email setup](docs/EMAIL-SETUP.md).

Version 2.5 closes the planned account, email, Google sign-in, collection,
scanner, backup, and self-hosted installation work. Future product changes are
grouped under Version 3: custom collectibles, continued scanner experiments,
optional DIY scanner hardware, and staged solo Magic/Pokémon tabletop practice.
See the [fine-grained V3 roadmap](docs/V3-ROADMAP.md). Roadmap items remain ideas,
not promised dates or guaranteed features.

## ⚖️ License and card-data notice

This project is source-available for noncommercial use under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use or resale
requires separate written permission from WynterLabs. This description is not
legal advice; read the complete license and [required notice](NOTICE).

Card names, images, rules text, set data, trademarks, and price references
belong to their respective owners and providers. Follow each provider's terms,
attribution requirements, and acceptable-use rules.

## 🚦 Start here

- [Install with the standalone Docker workflow](docs/INSTALL.md)
- [Read the security policy](SECURITY.md)
- [Read contribution expectations](CONTRIBUTING.md)
- [Review the GitHub publishing checklist](docs/GITHUB-PUBLISHING-CHECKLIST.md)
- [Review V2 release readiness](docs/v2-release-readiness.md)
- [Understand account and private community controls](docs/ACCOUNT-AND-COMMUNITY.md)

---

## 🐳 Installation

### Recommended host

- Ubuntu 26.04 LTS amd64
- Minimum personal setup: **2 vCPU, 4 GiB RAM, 512 MiB swap, 60 GiB SSD**
- Recommended for faster scans and larger backups: **4 vCPU, 8 GiB RAM,
  100 GiB SSD**
- A LAN IP address or DNS name that will stay assigned to the server

### One copy-and-paste command

Replace `YOUR_HOST_OR_IP` with the DNS name or LAN address people will use to
open WynterLabs CardVault:

```sh
sudo apt-get update && sudo apt-get install -y git && git clone --depth 1 --branch v2.5.1 https://github.com/haloboyisme/wynterlabs-cardvault.git && cd wynterlabs-cardvault && sudo ./deploy/standalone/bootstrap.sh --host YOUR_HOST_OR_IP
```

The bootstrap checks or installs Docker Engine and Docker Compose, generates
unique secrets, builds the four-service stack, applies database migrations,
waits for health checks, and displays the HTTPS setup address.

### Finish setup

1. Open the `/setup` address printed by the installer.
2. Read the one-time bootstrap code from the protected local path printed by
   the installer. The code is generated for that installation; there is no
   default setup password.
3. Create your own owner username, email, and strong password.
4. Trust the generated local CA certificate on devices that will open the app.
5. Create a backup and test recovery before importing a large collection.

For alternate ports, recovery, upgrades, and additional details, follow the
[complete Docker installation guide](docs/INSTALL.md).

---

<div align="center">

Made for fun, learning, and collectors who would rather spend money on cards.

</div>
