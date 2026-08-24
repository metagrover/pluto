### Bound failed analysis retries and cancel timed-out generation

- **Issue:** [#647](https://github.com/metagrover/pluto/issues/647)
- **PR:** Not created; committed directly to master at the user's request.
- **Changed:** Analysis runs now carry durable attempt numbers and cancellable request IDs. A timed-out renderer operation aborts the active provider request and waits for it to stop before Pluto persists the terminal failure.
- **Why:** The previous timeout left Ollama generation running while the same meeting became automatically eligible again, creating an unbounded retry cycle behind the serialized local-model gate.
- **Replaced:** One-hour timeout experiments and automatic eligibility for every persisted failed state.
- **Notes:** Pluto makes at most two automatic analysis attempts. Manual retry remains available as one new bounded attempt, and lifecycle metadata stays content-free.
