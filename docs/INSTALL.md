# Install WynterLabs CardVault

Use the standalone Docker workflow included with this release. Supply your own
domain or LAN host, storage location, secrets, and backup destination; do not
reuse values from another installation.

## Before you begin

Google sign-in is optional and disabled by default. After Docker installation
and owner setup, configure it in **Admin → Google sign-in** using your own Google
OAuth client. The installer reminds you of this step; no shared Google secret is
included. See [Google setup](GOOGLE-SIGN-IN.md) for the callback address, private
LAN hostname requirements, and account-linking instructions.

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

Clone the immutable V2.5 release and install WynterLabs CardVault with one command.
Replace `YOUR_HOST_OR_IP` with the LAN address or DNS name used by members:

```sh
sudo apt-get update && sudo apt-get install -y git && git clone --depth 1 --branch v2.5.0 https://github.com/haloboyisme/wynterlabs-cardvault.git && cd wynterlabs-cardvault && sudo ./deploy/standalone/bootstrap.sh --host YOUR_HOST_OR_IP
```

If the release is already downloaded, run the included bootstrap directly:

```sh
sudo ./deploy/standalone/bootstrap.sh --host cards.example.invalid
```

If Docker and Compose v2 are already installed and healthy, the bootstrap
leaves them unchanged. The installer creates the application secrets, starts
the services, and prints
the local setup URL and the file path of the one-time bootstrap secret. Read
that file locally on your server; the secret is not a default shared password.
Trust the certificate it
provides on devices that will use the application, then open the printed setup
URL.

Create the initial account using these example values only as a guide:

- Display name: `owner`
- Email: your own email address
- Password: `<choose-a-strong-password>`

Store the generated secrets and backup materials securely. Before relying on
the installation, run `sudo ./deploy/standalone/backup.sh`, then use the
isolated recovery workflow documented by `deploy/standalone/recover.sh` on
alternate ports. Never test a restore over the active installation.

Return to the [project overview](../README.md).
