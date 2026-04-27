import urllib.request
import json

url = "http://localhost:11434/api/generate"
query = "do you know about Berlin meeting?"
prompt = f"""Analyze the following user query sent to an AI meeting assistant.
Classify the intent into one of these categories:
- "conversational": General chit-chat, greetings.
- "factual": Specific questions about facts, decisions, people.
- "temporal": Questions about when things happened or schedules.
- "comparative": Questions comparing entities/meetings.

Extract 3-5 relevant synonyms or related expanded keywords from the user's intent to help with search retrieval, if applicable.

Respond ONLY with a JSON object in the exact following format, with NO markdown formatting around it:
{{"intent": "conversational" | "factual" | "temporal" | "comparative", "expanded_keywords": ["keyword1", "keyword2"]}}

Query: "{query}"
"""
data = {
    "model": "phi4-mini:3.8b",
    "prompt": prompt,
    "stream": False
}
req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req) as f:
        resp = json.loads(f.read().decode('utf-8'))
        print(resp.get("response", ""))
except Exception as e:
    print(f"Error: {e}")
