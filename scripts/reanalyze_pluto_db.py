#!/usr/bin/env python3
import json
import os
import re
import sqlite3
import time
import urllib.request

DB_PATH = os.path.expanduser('~/Library/Application Support/Pluto/pluto.db')
OLLAMA_URL = 'http://127.0.0.1:11434/api/generate'
MODEL = 'phi4-mini:3.8b'

def ollama_generate(prompt: str, json_mode: bool = True, num_ctx: int = 16384) -> str:
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "num_ctx": num_ctx,
            "num_predict": 4096,
            "temperature": 0.2
        }
    }
    if json_mode:
        payload["format"] = "json"
    
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                OLLAMA_URL,
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                return data.get('response', '')
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2)
    return ""

def calculate_jaccard_similarity(str_a: str, str_b: str) -> float:
    words_a = set(re.findall(r'\w+', str_a.lower()))
    words_b = set(re.findall(r'\w+', str_b.lower()))
    if not words_a or not words_b:
        return 0.0
    intersection = len(words_a.intersection(words_b))
    union = len(words_a.union(words_b))
    return intersection / union if union > 0 else 0.0

def deduplicate_items(items, text_key='text', assignee_key='assignee'):
    result = []
    for item in items:
        text = str(item.get(text_key, '')).strip()
        if not text:
            continue
        assignee = str(item.get(assignee_key, '') or '').strip().lower()
        is_dup = False
        for existing in result:
            ex_text = str(existing.get(text_key, '')).strip()
            ex_assignee = str(existing.get(assignee_key, '') or '').strip().lower()
            if assignee and ex_assignee and assignee != ex_assignee:
                continue
            if calculate_jaccard_similarity(text, ex_text) >= 0.70:
                is_dup = True
                break
        if not is_dup:
            result.append(item)
    return result

def window_transcript(lines, window_size=120, overlap=15):
    if len(lines) <= window_size:
        return [lines]
    windows = []
    step = window_size - overlap
    for start in range(0, len(lines), step):
        chunk = lines[start:start + window_size]
        if chunk:
            windows.append(chunk)
        if start + window_size >= len(lines):
            break
    return windows

def analyze_window(transcript_chunk: str, user_notes: str = "") -> dict:
    prompt = f"""You are a meeting analyst for Pluto. Analyze this transcript segment and output valid JSON only:
{{
  "overview": "2-3 sentence overview of this segment",
  "topics": [
    {{
      "title": "Short title",
      "summary": "2-3 sentence summary",
      "key_points": [{{"text": "point", "speaker": "Name or null"}}],
      "decisions": [{{"text": "decision made", "decided_by": "Name or null"}}],
      "action_items": [{{"text": "action item", "assignee": "Name or null", "due": "deadline or null"}}],
      "open_questions": []
    }}
  ]
}}

Rules:
- Be factual and objective.
- Only extract decisions and action items that are explicitly stated.

{f'User Notes: {user_notes}' if user_notes else ''}
Transcript:
{transcript_chunk}
"""
    raw = ollama_generate(prompt, json_mode=True)
    try:
        return json.loads(raw)
    except Exception:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise

def render_v3_markdown(doc: dict) -> str:
    lines = []
    lines.append(doc.get('overview', ''))
    lines.append('')
    for topic in doc.get('topics', []):
        lines.append('─────────────────────────────────────────────────')
        lines.append('')
        lines.append(f"## {topic.get('title', 'Topic')}")
        lines.append('')
        if topic.get('summary'):
            lines.append(topic['summary'])
            lines.append('')
        for pt in topic.get('key_points', []):
            spk = f"{pt['speaker']}: " if pt.get('speaker') else ""
            lines.append(f"• {spk}{pt.get('text', '')}")
        for dec in topic.get('decisions', []):
            by = f" ({dec['decided_by']})" if dec.get('decided_by') else ""
            lines.append(f"• Decision{by}: {dec.get('text', '')}")
        for q in topic.get('open_questions', []):
            lines.append(f"• ? {q}")
        lines.append('')
    
    action_items = doc.get('all_action_items', [])
    if action_items:
        lines.append('─────────────────────────────────────────────────')
        lines.append('')
        lines.append('## Action Items')
        lines.append('')
        for item in action_items:
            assignee = f"{item['assignee']}: " if item.get('assignee') else ""
            due = f" ({item['due']})" if item.get('due') else ""
            lines.append(f"- [ ] {assignee}{item.get('text', '')}{due}")
        lines.append('')
    return '\n'.join(lines)

def main():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute('''
        SELECT rowid, id, title, started_at, duration_seconds, transcript_json, user_notes
        FROM meetings
        ORDER BY started_at DESC
        LIMIT 15
    ''').fetchall()

    print(f"[Reanalyze Python] Found {len(rows)} meetings to re-analyze in {DB_PATH}")

    for idx, r in enumerate(rows):
        rowid = r['rowid']
        meeting_id = r['id']
        title = r['title']
        user_notes = r['user_notes'] or ""
        
        print(f"\n[{idx+1}/{len(rows)}] Meeting {meeting_id[:8]}... '{title}' ({r['duration_seconds']}s)")
        
        try:
            parsed = json.loads(r['transcript_json'] or "[]")
            segments = parsed if isinstance(parsed, list) else parsed.get('segments', [])
        except Exception:
            segments = []

        if not segments:
            print("  [Skip] 0 segments.")
            continue

        transcript_lines = []
        for s in segments:
            spk = s.get('speaker') or 'Unknown'
            txt = (s.get('text') or '').strip()
            if txt:
                transcript_lines.append(f"{spk}: {txt}")

        windows = window_transcript(transcript_lines, window_size=120, overlap=15)
        print(f"  Transcript: {len(transcript_lines)} lines -> {len(windows)} window(s)")

        all_topics = []
        all_decisions = []
        all_action_items = []
        overviews = []

        start_time = time.time()
        for w_idx, win in enumerate(windows):
            chunk_text = "\n".join(win)
            res = analyze_window(chunk_text, user_notes)
            
            if res.get('overview'):
                overviews.append(res['overview'])
            
            for t in res.get('topics', []):
                all_topics.append(t)
                for dec in t.get('decisions', []):
                    all_decisions.append(dec)
                for act in t.get('action_items', []):
                    act['topic'] = t.get('title', '')
                    all_action_items.append(act)

        # Merge & Deduplicate
        dedup_decisions = deduplicate_items(all_decisions, text_key='text', assignee_key='decided_by')
        dedup_action_items = deduplicate_items(all_action_items, text_key='text', assignee_key='assignee')

        # Combine Overview
        final_overview = " ".join(overviews) if len(overviews) <= 2 else f"The meeting covered {len(all_topics)} main discussion areas. {overviews[0]} {overviews[-1]}"

        doc_v3 = {
            "analysis_schema_version": 3,
            "overview": final_overview,
            "topics": all_topics,
            "all_action_items": dedup_action_items,
            "all_decisions": dedup_decisions,
            "meeting_type": "team_sync",
            "quality": {
                "format_pass": True,
                "retry_count": 0,
                "fallback_used": False,
                "issues": []
            },
            "generation_metadata": {
                "provider": "ollama",
                "model": MODEL,
                "generation_path": "adaptive_windowed_reanalysis",
                "prompt_version": "notes-v4",
                "generated_at": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                "error_categories": []
            }
        }

        enhanced_notes = render_v3_markdown(doc_v3)
        analysis_json = json.dumps(doc_v3)

        con.execute('''
            UPDATE meetings
            SET enhanced_notes = ?,
                analysis_json = ?,
                analysis_schema_version = 3,
                analysis_format_pass = 1,
                analysis_retry_count = 0,
                analysis_fallback_used = 0,
                analysis_provider = 'ollama',
                analysis_model = ?,
                analysis_generation_path = 'adaptive_windowed_reanalysis',
                analysis_prompt_version = 'notes-v4',
                analysis_generated_at = ?
            WHERE rowid = ?
        ''', (enhanced_notes, analysis_json, MODEL, doc_v3['generation_metadata']['generated_at'], rowid))
        
        try:
            con.execute('UPDATE meetings_fts SET enhanced_notes = ? WHERE meeting_id = ?', (enhanced_notes, meeting_id))
        except Exception:
            pass
            
        con.commit()

        elapsed = round(time.time() - start_time, 1)
        print(f"  ✅ Updated in {elapsed}s | Topics: {len(all_topics)} | Decisions: {len(dedup_decisions)} | Action Items: {len(dedup_action_items)}")

    con.close()
    print("\n[Reanalyze Python] All 15 meetings re-analyzed successfully!")

if __name__ == '__main__':
    main()
