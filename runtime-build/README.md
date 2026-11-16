# Python runtime pack build notes

This directory is maintainer-only; it is not published in the main npm package.
The runtime packs are ordinary npm packages and are installed on demand by the
plugin at `$DSH_HOME/cache/cg/python-runtime/`.

## Locked inputs

| Input | Pin |
|---|---|
| CPython | 3.13.17 |
| python-build-standalone (macOS/Linux) | release `20261021` |
| Windows embeddable | python.org `3.13.17` amd64 |
| numpy | 2.4.6 |
| pandas | 3.0.6 |
| python-dateutil | 2.9.0.post0 |
| six | 1.17.0 |
| tzdata | 2026.6 |
| pyarrow (parquet pack) | 25.0.1 |

The versions live only in `runtime/manifest.json`. The build scripts read them
from there; do not copy pins into a shell script.

## Local build

POSIX (run on the matching host):

```bash
bash runtime-build/build-linux.sh /tmp/cg-py-pack
bash runtime-build/build-macos.sh arm64 /tmp/cg-py-pack
bash runtime-build/build-macos.sh x64   /tmp/cg-py-pack
```

Windows (PowerShell 7):

```powershell
pwsh runtime-build/build-windows.ps1 -Out "$env:RUNNER_TEMP\cg-py-pack"
```

Each command produces both packs unless the last argument is `base` or `parquet`:

```text
/tmp/cg-py-pack/
  v587d-cg-py-base-linux-x64-1.0.0.tgz
  v587d-cg-py-parquet-linux-x64-1.0.0.tgz
```

`pack.mjs` owns the npm metadata. It reads the target's package name/version
from the manifest, writes `package.json` + `runtime-pack.json`, copies wheel
licenses into `licenses/`, rejects symlinks that escape the payload, and runs
`npm pack` through `npm-cli.js` (never the `npm` / `npm.cmd` shim).

## Verify before publishing

The pack must survive the same path the plugin uses, not just `tar -xzf`:

```bash
node scripts/python-runtime.mjs prepare --pack base \
  --tarball /tmp/cg-py-pack/v587d-cg-py-base-linux-x64-1.0.0.tgz \
  --dsh-home /tmp/cg-dsh
node scripts/python-runtime.mjs prepare --pack parquet \
  --tarball /tmp/cg-py-pack/v587d-cg-py-parquet-linux-x64-1.0.0.tgz \
  --dsh-home /tmp/cg-dsh
node scripts/python-runtime.mjs verify --pack parquet --dsh-home /tmp/cg-dsh
node runtime-build/verify-pack.mjs --dsh-home /tmp/cg-dsh --parquet
```

`verify --pack parquet` imports every pinned library. `verify-pack.mjs` goes
further: it resolves the installed packs through the real manager and runs
`python/worker.py run` against an `analysis.py` that does a groupby, a
timezone conversion, and a Parquet round-trip. CI runs both on every target.

Measured Linux x64 sanity check (2026-11-16, after pruning): base `53.6 MB`
`.tgz` / `162.7 MB` unpacked; parquet `49.9 MB` `.tgz` / `154.7 MB` unpacked.
Re-measure per release; the plugin UI quotes a conservative range.

## CI matrix

`.github/workflows/python-runtime-packs.yml` runs four native builders:

| Target | Runner |
|---|---|
| `linux-x64` | `ubuntu-22.04` (glibc 2.28+ contract) |
| `darwin-arm64` | `macos-15` |
| `darwin-x64` | `macos-15-intel` |
| `win32-x64` | `windows-latest` |

Each job installs `uv` at a pinned version, builds with `npm ci` +
`npm run build`, builds both packs, installs the tarballs through the manager,
runs `verify --pack parquet`, then `runtime-build/verify-pack.mjs`. A pack that
only unpacks is not considered built.

Pull requests touching the runtime paths run the same matrix. The publish job
runs only on a `python-runtime-v<version>` tag or a manual dispatch with
`publish=true`.

First full matrix run (PR #18, 2026-11-16): `darwin-arm64`, `darwin-x64`,
`linux-x64` and `win32-x64` all passed, including the install + worker +
Parquet round-trip step.

## Release order

1. Bump the exact versions in `runtime/manifest.json` (all eight targets).
2. Push a `python-runtime-v<version>` tag. CI builds all four platforms and
   refuses to publish unless the tag, manifest, and all eight tarballs agree.
3. The publish job uses npm Trusted Publishing (OIDC), the same model as the
   main package; the repository stores no npm token. Each of the eight package
   names needs this repository + `python-runtime-packs.yml` configured as its
   trusted publisher in npm package settings.
4. Verify `npm view @v587d/cg-py-base-<target>@<version> version` for each
   package, then publish the main plugin.
5. Keep old pack versions published; never delete a version that an older plugin
   may still pin.

**First release bootstrap:** npm only exposes Trusted Publisher settings for a
package that already exists. Publish `1.0.0` of all eight tarballs once from a
maintainer machine with `npm login` (`npm publish <tgz> --access public`), then
configure each package's trusted publisher in npm settings. After that, the tag
workflow is the only release path.

The publish job is idempotent: a package version already on the registry is
skipped, so re-running a failed matrix does not produce `E409`.

## Critical build gotchas

- **Delete `python/.gitignore`** before `npm pack`. python-build-standalone ships
  one containing `*`; npm then excludes the entire interpreter tree. `pack.mjs`
  removes every `.gitignore` / `.npmignore` under the staging tree for this
  reason.
- Remove `include/`, `share/`, `lib/pkgconfig`, stdlib `test/`, `idlelib/`,
  `tkinter/`, `ensurepip/`, `venv/`, `site-packages`, `bin/pip*`, `*.a`, `*.lib`
  and wheel tests before packing. Verify imports afterward.
- Do not ship a symlink that points outside `payload/`. `pack.mjs` fails the
  build instead of publishing an escaping link.
- Ensure the executable bit is set on POSIX before packing. The installer also
  repairs it, but the tarball should be correct.
- Windows uses the official embeddable; it has no `pip` / `ensurepip`. Wheels are
  installed with a uv-managed full CPython. numpy/pandas/pyarrow bundle the
  MSVC runtime DLLs they need in their `.libs` directories.
- `pnpm install --dir <project>` may ignore the project `.npmrc`; the installer
  passes `--config.node-linker=hoisted` explicitly. Test the packed tarball with
  a clean `$DSH_HOME` before publishing.
