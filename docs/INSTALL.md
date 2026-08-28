# Install WynterLabs CardVault

Use the standalone Docker workflow included with this release. Supply your own
domain or LAN host, storage location, secrets, and backup destination; do not
reuse values from another installation.

## Before you begin

- Use an Ubuntu 26.04 LTS amd64 host. The bootstrap installs Docker Engine,
  Docker Compose v2, and the HTTPS readiness client when needed.
- Minimum for a small personal collection: 2 vCPU, 4 GiB RAM, 512 MiB swap,
  and 60 GiB SSD storage.
- Recommended for faster scans, refreshes, and more retained images/backups:
  4 vCPU, 8 GiB RAM, and 100 GiB SSD storage.
- Choose the DNS name or LAN hostname that people will use to reach the app.
- Plan protected backups before storing a collection.
- Keep the source checkout and generated installation secrets private.

## Install

From the root of this release, prepare the host and install WynterLabs CardVault
with one command:

```sh
sudo ./deploy/standalone/bootstrap.sh --host cards.example.invalid
```

If Docker and Compose v2 are already installed and healthy, the bootstrap
leaves them unchanged. The installer creates the application secrets, starts
the services, and prints
the local setup URL and one-time bootstrap secret. Trust the certificate it
provides on devices that will use the application, then open the printed setup
URL.

Create the initial account using these example values only as a guide:

- Username: `owner`
- Email: `owner@example.invalid`
- Password: `<choose-a-strong-password>`

Store the generated secrets and backup materials securely. Before relying on
the installation, test a backup and recovery process that you control.

Return to the [project overview](../README.md).
