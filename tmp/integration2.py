import sqlite3
import json
import urllib.request
import os

DB_PATH = os.path.expanduser("~/Library/Application Support/pluto/pluto.db")

def get_context():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        SELECT m.id, m.title, snippet(f.meetings_fts, -1, '', '', '...', 64), m.enhanced_notes
        FROM meetings_fts f
        JOIN meetings m ON f.meeting_id = m.id
        WHERE meetings_fts MATCH 'Berlin'
        LIMIT 10
    """)
    rows = cur.fetchall()
    
    context_str = ""
    for idx, row in enumerate(rows):
        m_id, title, snippet, notes = row
        evidence_text = f"[FTS Match]: {snippet or 'No direct snippet'}\n"
        if notes:
            evidence_text += f"[Notes]: {notes[:800]}..."
        
        context_str += f"[Source {idx + 1}] Meeting ID: {m_id} | Title: {title}\nEvidence: {evidence_text}\nRelevant Topics: None\nDecisions: None\nAction Items: None\n\n---\n\n"
    
    conn.close()
    return context_str

def ask_ollama(prompt):
    url = "http://localhost:11434/api/generate"
    req = urllib.request.Request(url, data=json.dumps({"model": "phi4-mini:3.8b", "prompt": prompt, "stream": False}).encode('utf-8'), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as f:
        return json.loads(f.read().decode('utf-8')).get("response", "")

query = "What do you know about the Berlin trip?"
context_str = get_context()

prompt = f"""You are Pluto, an AI meeting intelligence assistant. Answer the user's question using ONLY the provided Context.

CRITICAL RULES:
1. Provide the direct answer immediately without any preamble. 
2. DO NOT hallucinate.

Question: {query}

Context:
{context_str}

For factual claims, append a citation:
<cite meeting="meeting_id" quote="short exact phrase">The claim text.</cite>"""

print("--- FINAL ANSWER ---")
print(ask_ollama(prompt))
