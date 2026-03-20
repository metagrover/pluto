#!/usr/bin/env python3
"""Legacy QA helper for one meeting — do NOT use for production fixes.

Core attribution fixes live in:
  - assignSpeakersToCanonicalSegments (rmsActivityOverride)
  - applyCrossTurnAttributionRepairs (src/utils/speakerAttribution.ts)
  - AudioManager: repairs run after diarization / canonical hydration

Default: print markdown preview. --write-db mutates local pluto.db only.
Source: scripts/baselines/<meetingId>.manual.json
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import uuid

MEETING_ID = "8a6dfe36-7151-4763-9f43-2b87b682a386"
MANUAL_BASELINE = os.path.join(
    os.path.dirname(__file__),
    "baselines",
    f"{MEETING_ID}.manual.json",
)


def new_id() -> str:
    return str(uuid.uuid4())


def split_span(start: float, end: float, texts: list[str]) -> list[tuple[float, float]]:
    lens = [max(len(t.strip()), 1) for t in texts]
    s = sum(lens)
    out: list[tuple[float, float]] = []
    t0 = start
    dur = end - start
    for w in lens:
        frac = w / s
        t1 = t0 + dur * frac
        out.append((t0, t1))
        t0 = t1
    return out


def build_corrected(segs: list[dict]) -> list[dict]:
    by_idx = {i: s for i, s in enumerate(segs)}
    out: list[dict] = []

    # --- 0: open (2.157–32.459) split ---
    s0 = by_idx[0]
    t0s, t0e = s0["startTime"], s0["endTime"]
    a = (
        "Okay, hi Puneet. I set up this meeting to talk about the travel plans "
        "that we have for my trip to Berlin. I'm planning a three-week trip. "
        "So let's figure out what can I do during my time there."
    )
    b = "What date are you traveling, planning to travel?"
    c = "So I want to return by June 3rd."
    d = "July 3rd."
    spans = split_span(t0s, t0e, [a, b, c, d])
    for (st, en), txt, spk in zip(spans, [a, b, c, d], ["Me", "Them", "Me", "Them"]):
        out.append(
            {
                "id": new_id(),
                "startTime": st,
                "endTime": en,
                "start": st,
                "end": en,
                "text": txt,
                "speaker": spk,
            }
        )

    # --- 1: correction line = Me (was Them) ---
    s1 = by_idx[1]
    out.append(
        {
            "id": new_id(),
            "startTime": s1["startTime"],
            "endTime": s1["endTime"],
            "start": s1["startTime"],
            "end": s1["endTime"],
            "text": "Oh yeah, July 3rd correction July 3rd.",
            "speaker": "Me",
        }
    )

    # --- 2,3: calendar + fair amount (unchanged) ---
    for i in range(2, 4):
        s = by_idx[i]
        out.append({**s, "id": s["id"]})

    # --- 4: split Me question vs Them rest (fused in bad ASR) ---
    s4 = by_idx[4]
    t4s, t4e = s4["startTime"], s4["endTime"]
    p_me = "So how do you propose I spend my time there?"
    p_them = (
        "I don't know, eating, travelling, I don't have anything else "
        "right now in mind. We also need to shop."
    )
    spans5 = split_span(t4s, t4e, [p_me, p_them])
    out.append(
        {
            "id": new_id(),
            "startTime": spans5[0][0],
            "endTime": spans5[0][1],
            "start": spans5[0][0],
            "end": spans5[0][1],
            "text": p_me,
            "speaker": "Me",
        }
    )
    out.append(
        {
            "id": new_id(),
            "startTime": spans5[1][0],
            "endTime": spans5[1][1],
            "start": spans5[1][0],
            "end": spans5[1][1],
            "text": p_them,
            "speaker": "Them",
        }
    )

    # --- 5,6,7: outlet + jacket + buy here (unchanged) ---
    for i in range(5, 8):
        s = by_idx[i]
        out.append({**s, "id": s["id"]})

    # --- 8: quality / price / euros / okay ---
    s8 = by_idx[8]
    t8s, t8e = s8["startTime"], s8["endTime"]
    u1 = "And the quality of stuff that you will get here is significant."
    u2 = "And how much would it cost there?"
    u3 = "Like a good one, 150 to 200 euros."
    u4 = "Okay."
    spans8 = split_span(t8s, t8e, [u1, u2, u3, u4])
    spk8 = ["Them", "Me", "Them", "Me"]
    for (st, en), txt, spk in zip(spans8, [u1, u2, u3, u4], spk8):
        out.append(
            {
                "id": new_id(),
                "startTime": st,
                "endTime": en,
                "start": st,
                "end": en,
                "text": txt,
                "speaker": spk,
            }
        )

    # --- 9 Them unchanged ---
    out.append({**by_idx[9], "id": by_idx[9]["id"]})

    # --- 10 split North Face Them vs Me ---
    s10 = by_idx[10]
    t10s, t10e = s10["startTime"], s10["endTime"]
    v1 = "But basically like something like a jacket from North Face or Columbia. Okay."
    v2 = "Whenever I'll come there, I can figure that out."
    spans10 = split_span(t10s, t10e, [v1, v2])
    out.append(
        {
            "id": new_id(),
            "startTime": spans10[0][0],
            "endTime": spans10[0][1],
            "start": spans10[0][0],
            "end": spans10[0][1],
            "text": v1,
            "speaker": "Them",
        }
    )
    out.append(
        {
            "id": new_id(),
            "startTime": spans10[1][0],
            "endTime": spans10[1][1],
            "start": spans10[1][0],
            "end": spans10[1][1],
            "text": v2,
            "speaker": "Me",
        }
    )

    # --- 11 Them unchanged ---
    out.append({**by_idx[11], "id": by_idx[11]["id"]})

    # --- 12 Costco: Them sale + Me response ---
    s12 = by_idx[12]
    t12s, t12e = s12["startTime"], s12["endTime"]
    w1 = "There is a sale in Costco for Alida shoes for 50."
    w2 = (
        "Yeah, I saw that. But those Alida shoes are specifically designed for Costco. "
        "So if you want that, I can get it for you."
    )
    spans12 = split_span(t12s, t12e, [w1, w2])
    out.append(
        {
            "id": new_id(),
            "startTime": spans12[0][0],
            "endTime": spans12[0][1],
            "start": spans12[0][0],
            "end": spans12[0][1],
            "text": w1,
            "speaker": "Them",
        }
    )
    out.append(
        {
            "id": new_id(),
            "startTime": spans12[1][0],
            "endTime": spans12[1][1],
            "start": spans12[1][0],
            "end": spans12[1][1],
            "text": w2,
            "speaker": "Me",
        }
    )

    # --- 13 Them unchanged ---
    out.append({**by_idx[13], "id": by_idx[13]["id"]})

    # --- 14 long Me blob: split house / Me / bike Q / Them still good ---
    s14 = by_idx[14]
    t14s, t14e = s14["startTime"], s14["endTime"]
    x1 = (
        "they won't look that great to be honest but they look decent as a shoe "
        "but instead of spending a lot on that I'll spend 20 more dollars and get "
        "like sambals which look far better so do you think we can do two trips "
        "while I'm there one to Amsterdam and one somewhere else "
    ).strip()
    x2 = (
        "You have to think about it can't really put up in point right now "
        "because I don't know when we will get the house."
    )
    x3 = (
        "So we can figure it out while we are there, right? "
        "Plus, what is the condition of your bike?"
    )
    x4 = "It's still good."
    spans14 = split_span(t14s, t14e, [x1, x2, x3, x4])
    spk14 = ["Me", "Them", "Me", "Them"]
    for (st, en), txt, spk in zip(spans14, [x1, x2, x3, x4], spk14):
        out.append(
            {
                "id": new_id(),
                "startTime": st,
                "endTime": en,
                "start": st,
                "end": en,
                "text": txt,
                "speaker": spk,
            }
        )

    # --- 15 Them unchanged ---
    out.append({**by_idx[15], "id": by_idx[15]["id"]})

    # --- 16 biking flat: split Yes to Them ---
    s16 = by_idx[16]
    t16s, t16e = s16["startTime"], s16["endTime"]
    y1 = (
        "Okay, because I think I will need to continue more with my training there. "
        "So I'll bring my bike computer and maybe some light accessories so that I can bike properly there. "
        "But that's about it. Is Germany or Berlin mostly flat in terms of biking?"
    )
    y2 = "Yes."
    y3 = "That's good. And would I be able to bike on my own with maps?"
    spans16 = split_span(t16s, t16e, [y1, y2, y3])
    spk16 = ["Me", "Them", "Me"]
    for (st, en), txt, spk in zip(spans16, [y1, y2, y3], spk16):
        out.append(
            {
                "id": new_id(),
                "startTime": st,
                "endTime": en,
                "start": st,
                "end": en,
                "text": txt,
                "speaker": spk,
            }
        )

    # --- 17, 18 unchanged ---
    for i in range(17, 19):
        s = by_idx[i]
        out.append({**s, "id": s["id"]})

    return out


def manual_baseline_to_app_segments(data: dict) -> list[dict]:
    rows = data["segments"]
    base_ms = rows[0]["startMs"]
    out: list[dict] = []
    for s in rows:
        st = (s["startMs"] - base_ms) / 1000.0
        en = (s["endMs"] - base_ms) / 1000.0
        out.append(
            {
                "id": str(uuid.uuid4()),
                "startTime": st,
                "endTime": en,
                "start": st,
                "end": en,
                "text": s["text"],
                "speaker": s["speaker"],
            }
        )
    return out


def to_markdown(segs: list[dict]) -> str:
    lines = [f"# Human-corrected transcript preview ({len(segs)} segments)\n"]
    for i, s in enumerate(segs, 1):
        spk = s.get("speaker", "?")
        txt = (s.get("text") or "").strip()
        lines.append(f"**{i}. {spk}**\n\n{txt}\n")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--from-json",
        help="19-segment app-format transcript_json (array). Default: manual baseline.",
    )
    ap.add_argument(
        "--write-db",
        action="store_true",
        help="Write ~/Library/Application Support/pluto/pluto.db (else preview only).",
    )
    ap.add_argument(
        "--out-md",
        help="Also write markdown preview to this path.",
    )
    args = ap.parse_args()

    if args.from_json:
        with open(args.from_json, encoding="utf-8") as f:
            segs = json.load(f)
    else:
        with open(MANUAL_BASELINE, encoding="utf-8") as f:
            segs = manual_baseline_to_app_segments(json.load(f))

    if len(segs) != 19:
        raise SystemExit(f"expected 19 source segments, got {len(segs)}")

    fixed = build_corrected(segs)
    md = to_markdown(fixed)
    print(md)
    if args.out_md:
        with open(args.out_md, "w", encoding="utf-8") as f:
            f.write(md)

    if not args.write_db:
        print(
            f"\n---\nPreview only ({len(segs)} -> {len(fixed)} segments). "
            "Pass --write-db to persist.",
            flush=True,
        )
        return

    db = os.path.expanduser("~/Library/Application Support/pluto/pluto.db")
    con = sqlite3.connect(db)
    text = " ".join(
        (s.get("text") or "").strip()
        for s in fixed
        if isinstance(s, dict) and (s.get("text") or "").strip()
    )
    row = con.execute(
        "select title, coalesce(enhanced_notes,''), coalesce(user_notes,'') from meetings where id=?",
        (MEETING_ID,),
    ).fetchone()
    if not row:
        con.close()
        raise SystemExit(f"meeting {MEETING_ID} not found in {db}")
    title, enh, notes = row
    con.execute(
        "update meetings set transcript_json=? where id=?",
        (json.dumps(fixed, ensure_ascii=False), MEETING_ID),
    )
    con.execute(
        """insert or replace into meetings_fts (title, transcript_text, enhanced_notes, user_notes, meeting_id)
           values (?,?,?,?,?)""",
        (title or "", text, enh or "", notes or "", MEETING_ID),
    )
    con.commit()
    con.close()
    print("OK wrote DB", MEETING_ID, len(segs), "->", len(fixed))


if __name__ == "__main__":
    main()
