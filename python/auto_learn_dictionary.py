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
