<div align="center">

# 🃏 WynterLabs Cards

### A private, self-hosted card collection workspace built for collectors—not subscriptions.

![Version](https://img.shields.io/badge/version-1.0.0-7c3aed?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-self--hosted-2496ed?style=for-the-badge&logo=docker&logoColor=white)
![AI assisted](https://img.shields.io/badge/development-AI--assisted-14b8a6?style=for-the-badge)
![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-f59e0b?style=for-the-badge)

</div>

> [!NOTE]
> WynterLabs Cards is a fun, AI-assisted hobby project. I built it as a practical
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

## ✨ Version 1 at a glance

| Area | What is included |
|---|---|
| 🟣 **Catalogs** | Magic: The Gathering, Pokémon, and Yu-Gi-Oh! browsing with game and set filtering |
| 🩵 **Scanner** | Manual single-card and faster card-by-card sessions with correction and exact-printing confirmation |
| 🟢 **Collection** | Quantities, conditions, finishes, values, filters, bulk selection, import, and export |
| 🟠 **Decks** | Deck creation and management using cards from one supported game at a time |
| 🔵 **Dashboard** | Collection totals, pricing coverage, activity, and private value-history charts |
| 🟡 **Accounts** | Owner setup, invitations, roles, themes, sessions, recovery controls, and MFA |
| 🔴 **Safety** | Private-by-default deployment, generated secrets, HTTPS, isolated services, and backup tools |

Scanner recognition is an assistant, not an authority. Every scan should be
checked before saving because artwork, glare, angle, collector numbers, promos,
and reprints can produce an incorrect match.

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

## 🧭 Roadmap: possible Version 2 work

Version 1 is the completed self-hosted collector release. Any new product work
belongs to Version 2. The roadmap is intentionally flexible because this is a
fun project—not a commitment to update the software forever.

### Nearer experiments

- Continue improving scanner recognition, correction speed, mobile layout,
  accessibility, and session feedback.
- Add more trading-card games and provider adapters when trustworthy,
  legally appropriate data sources are available.
- Expand collection organization, statistics, price-history presentation, and
  optional community-style activity features.
- Add safe outbound links for researching or selling an exact printing through
  established marketplaces without processing payments inside WynterLabs.

### Longer-term ideas

- Optional DIY 3D-printed scanner hardware using an ESP or Arduino-compatible
  controller and a card-moving motor.
- A camera-assisted tabletop practice layout that can eventually use saved
  decks during solo play.
- Carefully designed member-to-member features only after moderation, privacy,
  legal, and safety questions are solved.
- Easier upgrades, more deployment targets, and optional advanced database
  choices if the hobby project grows enough to justify them.

Roadmap items are ideas, not promised dates or guaranteed features.

## ⚖️ License and card-data notice

This project is source-available for noncommercial use under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use or resale
requires separate written permission from WynterLabs. This description is not
legal advice; read the complete license and [required notice](NOTICE).

Card names, images, rules text, set data, trademarks, and price references
belong to their respective owners and providers. Follow each provider's terms,
attribution requirements, and acceptable-use rules.

## 🚦 Start here

- [Install with the standalone Docker workflow](https://github.com/haloboyisme/wynterlabs-cards/blob/main/docs/INSTALL.md)
- [Read the security policy](https://github.com/haloboyisme/wynterlabs-cards/blob/main/SECURITY.md)
- [Read contribution expectations](https://github.com/haloboyisme/wynterlabs-cards/blob/main/CONTRIBUTING.md)
- [Review the GitHub publishing checklist](https://github.com/haloboyisme/wynterlabs-cards/blob/main/docs/GITHUB-PUBLISHING-CHECKLIST.md)

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
open WynterLabs Cards:

```sh
sudo apt-get update && sudo apt-get install -y git && git clone --depth 1 --branch v1.0.0 https://github.com/haloboyisme/wynterlabs-cards.git && cd wynterlabs-cards && sudo ./deploy/standalone/bootstrap.sh --host YOUR_HOST_OR_IP
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
