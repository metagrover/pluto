### Accept noisy Swift output during Parakeet setup

- **Issue:** [#669](https://github.com/metagrover/pluto/issues/669)
- **PR:** [#728](https://github.com/metagrover/pluto/pull/728)
- **Changed:** Parakeet setup now reads the final non-empty path from Swift's build-directory output and canonicalizes it before installing either runtime binary.
- **Why:** Swift may print planning progress before the valid binary path, which previously stopped development startup after a successful build.
- **Replaced:** Validation of Swift's raw multiline output as though it were one path.
- **Notes:** The real Parakeet runtime and resource probe built, installed, passed strict code-signature verification, and the next preparation run correctly skipped rebuilding.
- **Safety:** Missing, relative, nonexistent, and canonical paths outside the package `.build` directory still fail closed; symlink escapes are rejected.
