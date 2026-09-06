### Bounded recovery for verbose local meeting notes

- **Issue:** [#753](https://github.com/metagrover/pluto/issues/753)
- **Changed:** Compact local notes now plan against source-content volume, allow up to 2,048 output tokens per writer, and replace one overflowing part with two smaller source-aligned parts instead of repeating the same request.
- **Bounded:** The pipeline still permits at most six model calls. It completes all writer parts before optional model review so recovery cannot consume the capacity needed to cover later source parts; remaining reviews use the existing deterministic source checks.
- **Trust:** JSON schemas, exact source references, atomic publication, and fail-closed handling remain intact. An internal Ollama deadline is now reported as a provider timeout rather than a user cancellation.
- **Notes:** A private replay reproduced the original 1,024-token truncation and exercised the new split. A smaller replacement completed, while a later request hit the provider timeout, so this change improves capacity recovery without claiming that the affected meeting now completes reliably on the current local runtime.
