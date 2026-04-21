# [phi4-mini-update] Update default Ollama model to phi4-mini:3.8b & Cache Provider

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve LLM latency by caching the provider instance and update the default Ollama model to `phi4-mini:3.8b`.

**Architecture:** 
1.  Implement a singleton-style cache in `electron/llm/factory.ts` to reuse provider instances.
2.  Update default model constants in the provider, test mocks, and documentation.

**Tech Stack:** TypeScript, Vitest, documentation (Markdown).

---

### Task 1: Implement Provider Caching in LLM Factory

**Files:**
- Modify: `electron/llm/factory.ts`

- [ ] **Step 1: Add cache variables and hashing logic**

```typescript
// electron/llm/factory.ts
let cachedProvider: LLMProvider | null = null;
let lastSettingsHash: string | null = null;

function getSettingsHash(settings: LLMSettings): string {
  return JSON.stringify({
    provider: settings.llm_provider,
    ollama_model: settings.ollama_model,
    gemini_model: settings.gemini_model,
    openai_model: settings.openai_model,
    claude_model: settings.claude_model,
    // Add API keys if needed, but usually model/provider is enough for instance reuse
    gemini_key: !!settings.gemini_api_key,
    openai_key: !!settings.openai_api_key,
    claude_key: !!settings.claude_api_key
  });
}
```

- [ ] **Step 2: Update getProvider to reuse instance**

```typescript
export async function getProvider(settings: LLMSettings): Promise<LLMProvider> {
  const currentHash = getSettingsHash(settings);
  if (cachedProvider && lastSettingsHash === currentHash) {
    if (await cachedProvider.isAvailable()) {
      return cachedProvider;
    }
  }

  const providerType: ProviderType = settings.llm_provider || 'ollama';
  let providerToReturn: LLMProvider;

  // (Existing logic inside switch but return providerToReturn instead of direct return)
  // ... logic ...
  
  cachedProvider = providerToReturn;
  lastSettingsHash = currentHash;
  return providerToReturn;
}
```

- [ ] **Step 3: Commit**

```bash
git add electron/llm/factory.ts
git commit -m "perf: implement LLM provider caching to reduce ollama latency"
```

---

### Task 2: Update Default Ollama Model in Provider

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

### Task 3: Update Unit Tests for UnifiedProvider

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

### Task 4: Update Documentation

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
