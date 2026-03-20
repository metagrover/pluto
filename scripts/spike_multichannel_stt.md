# Spike: cloud multichannel STT (Deepgram + AssemblyAI)

Use when you want vendor-grade transcription on **true dual-channel** audio (e.g. Pluto `me_*.wav` + `them_*.wav` muxed to stereo). This does **not** fix single mixed mono; for that, keep using per-channel local Whisper + the in-app channel-boundary split.

## 1. Build a stereo WAV (example)

```bash
# macOS: interleave two mono files into stereo (ffmpeg)
ffmpeg -i me.wav -i them.wav -filter_complex "[0:a][1:a]amerge=inputs=2[a]" -map "[a]" -ac 2 dual_stereo.wav
```

## 2. Deepgram (pre-recorded, multichannel)

Docs: `https://developers.deepgram.com/docs/multichannel`

```bash
export DEEPGRAM_API_KEY="..."
curl -s -X POST "https://api.deepgram.com/v1/listen?model=nova-2&multichannel=true&diarize=true" \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: audio/wav" \
  --data-binary @dual_stereo.wav | jq .
```

Inspect `channels[]` / per-channel alternatives in the JSON response for your model version.

## 3. AssemblyAI (multichannel)

Docs: `https://www.assemblyai.com/docs/pre-recorded-audio/multichannel`

```bash
export ASSEMBLYAI_API_KEY="..."
# Upload then transcribe with multichannel — follow current API (upload URL + transcript create with multichannel flag).
```

Use their REST flow: upload file → create transcript with `audio_channels` / multichannel options per latest docs.

## Trade-offs

| Topic | Note |
|--------|------|
| Privacy | Audio leaves device; align with product policy. |
| Cost | Per-minute × channels; compare to local GPU/CPU Whisper. |
| Latency | Batch post-meeting is easiest; streaming adds integration work. |
| Accuracy | Strong when **channels are isolated**; weak if both speakers are mixed into one channel. |

## In-app debug metrics

- `PLUTO_TRANSCRIPT_DEBUG=1` — verbose attribution logs.
- `PLUTO_TRANSCRIPT_PIPELINE_LOG=1` — one summary object: canonical splits, hydration mode (`full` / `me_only`), diarization boundary splits, merged counts.
