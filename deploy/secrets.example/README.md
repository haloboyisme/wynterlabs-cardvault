# Runtime secret files

Create these files only on example-host under
`/opt/wynterlabs/secrets/cards-platform`:

- `db_password`: `openssl rand -hex 32`
- `bootstrap_secret`: `openssl rand -hex 32`
- `session_pepper`: `openssl rand -hex 64`
- `mfa_aesgcm_key`: create 32 random bytes at `/opt/wynterlabs/escrow/cards-platform/mfa_aesgcm_key`, mode `0600`. It is separately escrowed and must never be copied into the normal Cards secrets directory or backup archive.

Set the directory to mode 700 and every file to mode 600. Never copy live
values into this repository, logs, screenshots, or chat.
