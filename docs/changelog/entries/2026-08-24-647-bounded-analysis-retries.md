### Bound failed analysis retries and cancel timed-out generation

- **Issue:** [#647](https://github.com/metagrover/pluto/issues/647)
- **PR:** Not created; committed directly to master at the user's request.
- **Changed:** Analysis runs now carry durable attempt numbers and cancellable request IDs. A timed-out renderer operation aborts the active provider request and waits for it to stop before Pluto persists the terminal failure. Grounded structured-analysis topic titles now name generic meetings directly, including completed meetings that need title repair.
- **Why:** The previous timeout left Ollama generation running while the same meeting became automatically eligible again, creating an unbounded retry cycle behind the serialized local-model gate.
- **Replaced:** One-hour timeout experiments, automatic eligibility for every persisted failed state, and redundant title-only generation when structured analysis already produced a usable topic title.
- **Notes:** Pluto makes at most two automatic analysis attempts. Manual retry remains available as one new bounded attempt, lifecycle metadata stays content-free, user-edited titles remain authoritative, and title-only generation remains the fallback when analysis has no usable topic title.
