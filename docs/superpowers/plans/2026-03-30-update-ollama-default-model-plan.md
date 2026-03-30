# [phi4-mini-update] Update default Ollama model to phi4-mini:3.8b

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the default Ollama model to `phi4-mini:3.8b` across the codebase.

**Architecture:** Update constants, test mocks, and documentation.

**Tech Stack:** TypeScript, Vitest, documentation (Markdown).

---

### Task 1: Update Default Ollama Model in Provider

**Files:**
- Modify: `electron/llm/unifiedProvider.ts:27`

- [ ] **Step 1: Update the OLLAMA_DEFAULT_MODEL constant**

```typescript
// Replace:
// const OLLAMA_DEFAULT_MODEL = 'llama3.2';
const OLLAMA_DEFAULT_MODEL = 'phi4-mini:3.8b';
```

- [ ] **Step 2: Commit**

```bash
git add electron/llm/unifiedProvider.ts
git commit -m "feat: update default ollama model to phi4-mini:3.8b"
```

---

### Task 2: Update Unit Tests for UnifiedProvider

**Files:**
- Modify: `tests/unit/unifiedProvider.test.ts`

- [ ] **Step 1: Update test case names and assertions to use phi4-mini:3.8b**

```typescript
// Update tests that check for llama3.2 to use phi4-mini:3.8b
// lines 104, 109, 123, 168
```

- [ ] **Step 2: Run tests to verify**

Run: `npx vitest tests/unit/unifiedProvider.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/unifiedProvider.test.ts
git commit -m "test: align unifiedProvider tests with new phi4-mini default"
```

---

### Task 3: Update Documentation

**Files:**
- Modify: `TDD.md:98`

- [ ] **Step 1: Update the Ollama default model in the table**

```markdown
// | Ollama (default) | localhost:11434 | phi4-mini:3.8b |
```

- [ ] **Step 2: Commit**

```bash
git add TDD.md
git commit -m "docs: update ollama default model to phi4-mini in TDD.md"
```
