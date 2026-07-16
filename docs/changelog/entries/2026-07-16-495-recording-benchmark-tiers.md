### Separate fast recording benchmark checks from manual tiers

- **Issue:** [#495](https://github.com/metagrover/pluto/issues/495)
- **PR:** [#496](https://github.com/metagrover/pluto/pull/496)
- **Changed:** Recording-quality manifest cases now declare a `pr` or `manual` tier; the default command runs only fast PR cases, while `--tier manual` and `--tier all` make broader runs explicit in JSON and terminal output.
- **Why:** Long-running or hardware-sensitive evidence should be able to grow without slowing ordinary pull-request verification or disappearing outside the versioned benchmark contract.
- **Replaced:** One undifferentiated benchmark case list with no way to prove which cases belong in the fast gate.
- **Notes:** This slice adds no new audio or model fixtures; an empty selected tier fails clearly instead of reporting a misleading zero-case success.
