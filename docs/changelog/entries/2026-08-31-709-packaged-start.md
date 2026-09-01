### Choose temporary or real data when developing Pluto

- **Issue:** [#709](https://github.com/metagrover/pluto/issues/709)
- **PR:** [#710](https://github.com/metagrover/pluto/pull/710)
- **Changed:** `pnpm start` now runs the latest Vite/Electron development build against Pluto's normal profile, while `pnpm run dev` remains isolated on temporary data.
- **Why:** Developers who intentionally recorded meetings through earlier development builds need an explicit way to keep working with those meetings without making every routine development launch touch real data.
- **Replaced:** Manually setting `PLUTO_USER_DATA_DIR` or weakening the safe default for `pnpm run dev`.
- **Notes:** The first production-profile development launch creates a SQLite recovery snapshot and never overwrites it. Development migrations and writes still affect the normal database after that explicit boundary.
