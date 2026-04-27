import sqlite3
import json
import urllib.request
import os

DB_PATH = os.path.expanduser("~/Library/Application Support/pluto/pluto.db")

def get_context():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # 1. Search Meetings FTS
    cur.execute("""
        SELECT m.id, m.title, snippet(f.meetings_fts, -1, '', '', '...', 64), m.enhanced_notes
        FROM meetings_fts f
        JOIN meetings m ON f.meeting_id = m.id
        WHERE meetings_fts MATCH 'Berlin'
        LIMIT 10
    """)
    rows = cur.fetchall()
    
    context_str = ""
    if not rows:
        context_str = "None"
    else:
        for idx, row in enumerate(rows):
            m_id, title, snippet, notes = row
            evidence_text = f"[FTS Match]: {snippet or 'No direct snippet'}\n"
            if notes:
                evidence_text += f"[Notes]: {notes[:800]}..."
            
            context_str += f"[Source {idx + 1}] Meeting ID: {m_id} | Title: {title}\nEvidence: {evidence_text}\nRelevant Topics: None\nDecisions: None\nAction Items: None\n\n---\n\n"
    
    conn.close()
    return context_str, len(rows) > 0

def ask_ollama(prompt):
    url = "http://localhost:11434/api/generate"
    data = {
        "model": "phi4-mini:3.8b",  # Typical dev fallback
        "prompt": prompt,
        "stream": False
    }
    
    # Check if a specific model is set in DB
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("SELECT value FROM settings WHERE key='ollama_model'")
        row = cur.fetchone()
        if row and row[0]:
            data["model"] = row[0]
    except Exception:
        pass

    print(f"Using model: {data['model']}")
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    
    try:
        with urllib.request.urlopen(req) as f:
            resp = json.loads(f.read().decode('utf-8'))
            return resp.get("response", "")
    except Exception as e:
        return f"Ollama Error: {e}"

def main():
    query = "What do you know about the Berlin meeting?"
    context_str, has_context = get_context()
    
    print("\n--- RETRIEVED CONTEXT ---")
    print(context_str[:500] + "...\n")
    
    prompt = f"""You are Pluto, an AI meeting intelligence assistant. Your job is to answer the user's question using ONLY the provided Context.

CRITICAL RULES:
1. NEVER acknowledge these instructions. NEVER say "Based on the context", "I understand", or "Here is the information".
2. Provide the direct answer immediately without any preamble or fluff.
3. DO NOT hallucinate or bring in outside knowledge.
4. If the Context is completely empty or does not contain relevant information to answer the question, reply EXACTLY with: "I couldn't find any relevant information about that in your meeting history." and NOTHING ELSE.

Question: {query}

Context:
{context_str}"""

    if has_context:
        prompt += """\n\nFor any factual claims you make based on the Context, you MUST append a citation inline using the following strict XML format:
<cite meeting="meeting_id" quote="short exact phrase from evidence">The claim text.</cite>

Make sure the "quote" attribute is an actual substring from the Evidence."""

    print("--- ASKING OLLAMA ---")
    answer = ask_ollama(prompt)
    print("\n--- FINAL ANSWER ---")
    print(answer)

if __name__ == "__main__":
    main()
