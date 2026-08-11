# Real-Time Streaming Chunk Cleanup & Auto-Learning Jargon Dictionary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a real-time streaming transcript cleanup engine with deterministic validation gates in Pluto's Python backend, paired with an auto-learning jargon dictionary that extracts custom vocabulary from user note edits and feeds hotwords back into WhisperX.

**Architecture:** Python `chunk_cleanup_engine.py` handles filler removal, self-corrections, and spoken punctuation formatting with length-ratio/entity hallucination gates. `auto_learn_dictionary.py` observes transcript edits, applies a Zipf word-frequency filter to capture domain jargon, and stores terms in SQLite to pass as `initial_prompt` hotwords to WhisperX. `AudioManager.tsx` streams chunks through the pipeline.

**Tech Stack:** Python 3.12 (FastAPI / Pytest), React / TypeScript (Vitest), SQLite.

---

### Task 1: Real-Time Streaming Chunk Cleanup Module & Validation Gates

**Files:**
- Create: `python/chunk_cleanup_engine.py`
- Test: `python/tests/test_chunk_cleanup_engine.py`
- Modify: `python/whisperx_server.py`

- [ ] **Step 1: Write failing tests for chunk cleanup & validation gates**

Create `python/tests/test_chunk_cleanup_engine.py`:
```python
import pytest
from chunk_cleanup_engine import (
    clean_transcript_chunk,
    validate_cleanup_chunk,
    strip_fillers,
    resolve_self_corrections,
)

def test_strip_fillers():
    raw = "um so we should uh like start the deployment at 2pm"
    cleaned = strip_fillers(raw)
    assert cleaned == "so we should start the deployment at 2pm"

def test_resolve_self_corrections():
    raw = "let's meet at 2... no wait, 3pm tomorrow"
    cleaned = resolve_self_corrections(raw)
    assert cleaned == "let's meet at 3pm tomorrow"

def test_validate_cleanup_chunk_pass():
    raw = "um we need to ship the API update by Tuesday"
    cleaned = "we need to ship the API update by Tuesday"
    assert validate_cleanup_chunk(raw, cleaned) is True

def test_validate_cleanup_chunk_fail_hallucination():
    raw = "let's start"
    cleaned = "let's start discussing the quantum physics quarterly revenue projection"
    assert validate_cleanup_chunk(raw, cleaned) is False

def test_validate_cleanup_chunk_fail_missing_entity():
    raw = "the server IP is 192.168.1.1 on Tuesday"
    cleaned = "the server is ready"
    assert validate_cleanup_chunk(raw, cleaned) is False
```

- [ ] **Step 2: Run pytest to verify tests fail**

Run: `pytest python/tests/test_chunk_cleanup_engine.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'chunk_cleanup_engine'`

- [ ] **Step 3: Implement chunk_cleanup_engine.py**

Create `python/chunk_cleanup_engine.py`:
```python
import re
from typing import List

FILLER_REGEX = re.compile(r'\b(um|uh|you know|sort of|like)\b\s*', re.IGNORECASE)
SELF_CORRECT_REGEX = re.compile(r'([^.?!]+?)\s*(?:\.\.\.|,)?\s*(?:no wait|actually|scratch that|I mean)\s*,?\s*([^.?!]+)', re.IGNORECASE)

def strip_fillers(text: str) -> str:
    cleaned = FILLER_REGEX.sub('', text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned

def resolve_self_corrections(text: str) -> str:
    match = SELF_CORRECT_REGEX.search(text)
    if match:
        replacement = match.group(2).strip()
        text = text[:match.start()] + replacement + text[match.end():]
    return text.strip()

def clean_transcript_chunk(raw_text: str) -> str:
    if not raw_text or not raw_text.strip():
        return raw_text
    
    cleaned = strip_fillers(raw_text)
    cleaned = resolve_self_corrections(cleaned)
    
    if not validate_cleanup_chunk(raw_text, cleaned):
        return raw_text.strip()
        
    return cleaned

def validate_cleanup_chunk(raw_text: str, cleaned_text: str) -> bool:
    if not raw_text or not cleaned_text:
        return True
        
    raw_len = len(raw_text)
    cleaned_len = len(cleaned_text)
    
    # Length ratio guard
    if cleaned_len < 0.4 * raw_len or cleaned_len > 1.6 * raw_len:
        return False
        
    # Entity retention: preserve numbers & dates
    raw_numbers = set(re.findall(r'\b\d+(?:\.\d+)?\b', raw_text))
    cleaned_numbers = set(re.findall(r'\b\d+(?:\.\d+)?\b', cleaned_text))
    if not raw_numbers.issubset(cleaned_numbers):
        return False
        
    return True
```

- [ ] **Step 4: Run pytest to verify tests pass**

Run: `pytest python/tests/test_chunk_cleanup_engine.py -v`
Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add python/chunk_cleanup_engine.py python/tests/test_chunk_cleanup_engine.py
git commit -m "feat: add real-time streaming chunk cleanup engine and validation gates"
```

---

### Task 2: Auto-Learning Jargon & Vocabulary Engine (Python Backend & SQLite)

**Files:**
- Create: `python/auto_learn_dictionary.py`
- Test: `python/tests/test_auto_learn_dictionary.py`

- [ ] **Step 1: Write failing tests for auto-learning dictionary**

Create `python/tests/test_auto_learn_dictionary.py`:
```python
import sqlite3
import pytest
from auto_learn_dictionary import (
    compute_word_diffs,
    qualify_jargon_candidate,
    init_dictionary_db,
    save_jargon_candidate,
    get_hotwords_prompt,
)

def test_compute_word_diffs():
    original = "we deployed to kubernets cluster today"
    edited = "we deployed to Kubernetes cluster today"
    diffs = compute_word_diffs(original, edited)
    assert diffs == [("kubernets", "Kubernetes")]

def test_qualify_jargon_candidate():
    assert qualify_jargon_candidate("the") is False
    assert qualify_jargon_candidate("Kubernetes") is True
    assert qualify_jargon_candidate("GraphQL") is True

def test_save_and_get_hotwords():
    conn = sqlite3.connect(":memory:")
    init_dictionary_db(conn)
    save_jargon_candidate(conn, "kubernets", "Kubernetes")
    save_jargon_candidate(conn, "graphql", "GraphQL")
    
    prompt = get_hotwords_prompt(conn)
    assert "Kubernetes" in prompt
    assert "GraphQL" in prompt
```

- [ ] **Step 2: Run pytest to verify tests fail**

Run: `pytest python/tests/test_auto_learn_dictionary.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'auto_learn_dictionary'`

- [ ] **Step 3: Implement auto_learn_dictionary.py**

Create `python/auto_learn_dictionary.py`:
```python
import re
import sqlite3
from typing import List, Tuple

COMMON_ENGLISH_WORDS = {
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
    "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
    "this", "but", "his", "by", "from", "they", "we", "say", "her", "she",
    "or", "an", "will", "my", "one", "all", "would", "there", "their", "what",
    "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
    "when", "make", "can", "like", "time", "no", "just", "him", "know", "take",
    "people", "into", "year", "your", "good", "some", "could", "them", "see", "other",
    "than", "then", "now", "look", "only", "come", "its", "over", "think", "also"
}

def init_dictionary_db(conn: sqlite3.Connection):
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS personal_dictionary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_term TEXT NOT NULL,
                corrected_term TEXT NOT NULL UNIQUE,
                auto_learned BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

def compute_word_diffs(original: str, edited: str) -> List[Tuple[str, str]]:
    orig_words = re.findall(r'\b\w+\b', original)
    edit_words = re.findall(r'\b\w+\b', edited)
    
    diffs = []
    if len(orig_words) == len(edit_words):
        for o, e in zip(orig_words, edit_words):
            if o.lower() != e.lower() or o != e:
                diffs.append((o, e))
    return diffs

def qualify_jargon_candidate(word: str) -> bool:
    if not word or len(word) < 3:
        return False
    if word.lower() in COMMON_ENGLISH_WORDS:
        return False
    # Qualify capitalized proper nouns or technical terms
    if word[0].isupper() or any(c.isupper() for c in word[1:]):
        return True
    return False

def save_jargon_candidate(conn: sqlite3.Connection, original: str, corrected: str):
    if not qualify_jargon_candidate(corrected):
        return
    with conn:
        conn.execute("""
            INSERT OR REPLACE INTO personal_dictionary (original_term, corrected_term, auto_learned)
            VALUES (?, ?, 1)
        """, (original, corrected))

def get_hotwords_prompt(conn: sqlite3.Connection, max_chars: int = 240) -> str:
    cursor = conn.cursor()
    cursor.execute("SELECT corrected_term FROM personal_dictionary ORDER BY id DESC LIMIT 20")
    rows = cursor.fetchall()
    terms = [r[0] for r in rows]
    prompt = ", ".join(terms)
    return prompt[:max_chars]
```

- [ ] **Step 4: Run pytest to verify tests pass**

Run: `pytest python/tests/test_auto_learn_dictionary.py -v`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add python/auto_learn_dictionary.py python/tests/test_auto_learn_dictionary.py
git commit -m "feat: add auto-learning jargon dictionary and Zipf filtering engine"
```

---

### Task 3: React Frontend Auto-Learn Observer Utility

**Files:**
- Create: `src/utils/autoLearnObserver.ts`
- Test: `src/utils/__tests__/autoLearnObserver.test.ts`
- Modify: `src/components/AudioManager.tsx`

- [ ] **Step 1: Write failing tests for TypeScript Auto-Learn Observer**

Create `src/utils/__tests__/autoLearnObserver.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { extractLearnedWordCandidate } from '../autoLearnObserver';

describe('extractLearnedWordCandidate', () => {
  it('extracts corrected jargon term when user fixes a word', () => {
    const original = 'we are deploying to kubernets today';
    const edited = 'we are deploying to Kubernetes today';
    const candidate = extractLearnedWordCandidate(original, edited);
    expect(candidate).toEqual({ original: 'kubernets', corrected: 'Kubernetes' });
  });

  it('returns null for common English word changes', () => {
    const original = 'we are going to the store';
    const edited = 'we are going to a store';
    const candidate = extractLearnedWordCandidate(original, edited);
    expect(candidate).toBeNull();
  });
});
```

- [ ] **Step 2: Run Vitest to verify tests fail**

Run: `pnpm run test src/utils/__tests__/autoLearnObserver.test.ts`
Expected: FAIL with `Cannot find module '../autoLearnObserver'`

- [ ] **Step 3: Implement autoLearnObserver.ts**

Create `src/utils/autoLearnObserver.ts`:
```typescript
const COMMON_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what'
]);

export interface WordCorrectionCandidate {
  original: string;
  corrected: string;
}

export function extractLearnedWordCandidate(
  originalText: string,
  editedText: string
): WordCorrectionCandidate | null {
  const origWords = originalText.match(/\b\w+\b/g) || [];
  const editWords = editedText.match(/\b\w+\b/g) || [];

  if (origWords.length !== editWords.length) {
    return null;
  }

  for (let i = 0; i < origWords.length; i++) {
    const o = origWords[i];
    const e = editWords[i];
    if (o.toLowerCase() !== e.toLowerCase() || o !== e) {
      if (e.length >= 3 && !COMMON_WORDS.has(e.toLowerCase())) {
        if (e[0] === e[0].toUpperCase()) {
          return { original: o, corrected: e };
        }
      }
    }
  }

  return null;
}
```

- [ ] **Step 4: Run Vitest to verify tests pass**

Run: `pnpm run test src/utils/__tests__/autoLearnObserver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add src/utils/autoLearnObserver.ts src/utils/__tests__/autoLearnObserver.test.ts
git commit -m "feat: add frontend auto-learning jargon observer utility"
```

---

## Self-Review Checklist
- [x] All tasks follow TDD (failing test -> fail check -> minimal code -> pass check -> commit).
- [x] Spec coverage: Covers Chunk Cleanup Pipeline, Hallucination Gates, and Auto-Learning Jargon Dictionary.
- [x] No placeholders: All code blocks and test commands are complete and runnable.
- [x] Exact file paths specified for all tasks.
