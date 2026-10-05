# Releasing Pluto

From a clean checkout of the GitHub default branch (`master`), synced with
`origin/master`, run:

```sh
pnpm release
```

Requires Node, pnpm, Git, and an authenticated GitHub CLI (`gh auth login`) with
repository Contents write and Actions read access. The command checks Actions
access before changing files or creating tags. The macOS installer is built on GitHub; the command can run from
any development machine. Merge and push product changes before releasing.

## Version policy

- Default (`auto`): `1.0.0-rc.3` → `1.0.0-rc.4`; once stable,
  `1.0.0` → `1.0.1`.
- `pnpm release stable`: promote the current RC base, e.g. `1.0.0-rc.4` → `1.0.0`.
- `pnpm release patch`, `minor`, or `major`: explicit SemVer bump for fixes,
  features, or breaking changes. These produce stable releases.
- `pnpm release rc`: increment an RC, or start the next patch RC from stable.

All new tags are `v<SemVer>`, e.g. `v1.0.0-rc.4`. The older `v1.0.0.rc.3`
format remains recognized. Automatic numbering does not infer whether a change
is breaking; choose `major` explicitly when it is.

## Notes and publication

`pnpm release --dry-run` fetches tags and previews the next version and notes
without changing files, creating a tag, or publishing. Notes include every
non-merge commit since the closest release tag on the branch, commit links,
an upgrade/install section, and a full comparison link. This includes direct
fix commits as well as changes merged through PRs.

For a curated product summary, supply a complete Markdown file:

```sh
pnpm release --dry-run --notes /path/to/release-notes.md
pnpm release --notes /path/to/release-notes.md
```

The command commits `package.json` and `docs/releases/v<version>.md`, creates
an annotated tag, and pushes the branch and tag together with `git push --atomic`.
It rejects dirty, detached, unsynced, duplicate-tag, and no-change releases.
Promoting an existing RC to stable is allowed without additional code changes.
No PR is needed for this metadata commit. If branch protection requires a PR,
prepare and merge the metadata through that policy before pushing its tag;
never bypass protection or force-push.

The existing Release workflow tests the code, builds native runtimes and the
Apple Silicon DMG, verifies the packaged runtimes and checksum, then creates
the GitHub Release with the committed notes, installer, and SHA256SUMS.txt.
Publication also requires a real packaged-runtime prepare against an empty
model cache and a separate cached restart with no additional downloads
(`pnpm run package:verify-setup`). This downloads about 1 GB into a disposable
directory; it never reads your profile or meeting data.
RCs are marked prerelease and never marked Latest. The command waits for the
workflow result and prints the release URL. The current pipeline uses ad-hoc
signing; it does not claim Developer ID signing or notarization.

## Recovery

- If commit checks fail, fix the problem and inspect the checkout before retrying.
- If push fails, the command prints the exact atomic push to retry. Keep the
  existing release commit and tag; do not create a second version or delete data.
- If GitHub fails after the tag is pushed, fix the build issue and use
  `gh run rerun <run-id> --failed` for transient failures. A source fix requires a
  new version because the published tag identifies an immutable source revision.
- If workflow discovery times out, use `gh run list --workflow release.yml`, then
  `gh run watch <run-id> --exit-status`. Do not bump just because discovery failed.
- Publishing can be retried: an existing draft resumes asset upload; an already
  published release is left intact.

Verify without publishing: `pnpm run test:release-workflow`. A workflow-only
change can additionally be exercised on a PR with the `release-test` label; that
builds and verifies an installer without publishing a release.

## Unnotarized installation

The README and generated release notes provide one copyable command after the
user drags Pluto into Applications:

```sh
xattr -dr com.apple.quarantine "/Applications/Pluto.app" && open "/Applications/Pluto.app"
```

This is an explicit, app-specific trust workaround, not notarization. Clear only
`com.apple.quarantine`; do not use `xattr -cr` or disable Gatekeeper globally.
Users may need to repeat it for a new quarantined download. Do not remove
quarantine automatically during download or claim that macOS has approved the app.
The repository is private, so anonymous raw-GitHub/curl installation is not a
working public distribution path. Do not make source or assets public implicitly.
