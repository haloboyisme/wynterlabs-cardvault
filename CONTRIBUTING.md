# Contributing to WynterLabs CardVault

Updated September 12, 2026 for V2.7.5.

## Before starting

Contributions require prior owner approval. Use the current `v2` branch as the
starting point and check the [remaining roadmap](docs/V3-ROADMAP.md) first.
Streamer presentation, dynamic themes, prize feedback and shared Brand Studio
are already included; see the [release notes](docs/v2.7.5-release.md).
Keep approved changes focused and explain the user-visible problem and result.

## Development and verification

The application uses a React/TypeScript frontend and a Python/FastAPI API with
PostgreSQL. Dependencies and supported runtime constraints are declared in
`web/package.json` and `api/pyproject.toml`. Reuse existing components and avoid
new paid services or dependencies without agreement.

After installing the declared development dependencies, useful checks include:

```sh
# From web/
npm run typecheck
npm run test -- --run
npm run build

# From api/
pytest
ruff check .
alembic heads
```

Run checks appropriate to the change. Distinguish focused tests from a full-suite
run, and describe failures or checks you could not perform. Schema changes need
an Alembic migration and upgrade notes. Installer changes need shell syntax checks
and a disposable installation/restore test; never run destructive smoke tests on
production. See [upgrade guidance](docs/UPGRADING.md).

For UI work, preserve simple/plain presentation, readable mobile layouts,
keyboard access, contrast and reduced-motion preferences. Themes and effects
must remain optional and bounded. Scanner changes need correction and duplicate
handling checks. Automated tests do not replace physical-card, long-camera-session
or real OBS audio-routing acceptance.

## Pull requests and documentation

Describe what changed, why, what was tested and any remaining limitations.
Update relevant guides and the changelog; remove completed roadmap items instead
of leaving them marked planned. Do not rewrite historical release records or
move existing release tags. Version changes and public releases remain owner controlled.

Do not commit credentials, databases, scan photos, private viewing links,
production logs or private deployment/hardware material. For security concerns,
follow [SECURITY.md](SECURITY.md), not a public issue or pull request.

Submit only original work compatible with the project license, including any
artwork, sounds or other media. By submitting a contribution that is accepted,
you acknowledge that it is distributed under the PolyForm Noncommercial License
1.0.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
