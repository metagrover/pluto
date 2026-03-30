# design: update ollama default model to phi4-mini:3.8b

**goal:** update the default ollama model from `llama3.2` to `phi4-mini:3.8b` across the codebase (logic, tests, and documentation).

**context:** the user wants to switch the primary local model to `phi4-mini:3.8b` for better performance/efficiency in meeting intelligence tasks.

**proposed changes:**
1.  **`electron/llm/unifiedProvider.ts`**:
    *   change `OLLAMA_DEFAULT_MODEL` constant from `'llama3.2'` to `'phi4-mini:3.8b'`.
2.  **`tests/unit/unifiedProvider.test.ts`**:
    *   update test case names and assertions to use `phi4-mini:3.8b`.
    *   update mock model lists to include the new default.
3.  **`TDD.md`**:
    *   update the llm provider table to reflect the new default model.

**success criteria:**
- `OLLAMA_DEFAULT_MODEL` is `'phi4-mini:3.8b'`.
- `tests/unit/unifiedProvider.test.ts` passes all tests.
- `TDD.md` correctly documents the default model.
