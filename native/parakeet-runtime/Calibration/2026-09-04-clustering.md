# Offline speaker clustering distance boundary

Pluto uses the pinned Community-1 segmentation, WeSpeaker embeddings and VBx pipeline. The source reference initializes AHC with **Euclidean distance 0.6** on unit-normalized embeddings. Its default VBx Fa/Fb are 0.07/0.8, matching the vendored FluidAudio configuration.

Reference source, inspected September 4, 2026:

- [Community-1 defaults](https://github.com/pyannote/pyannote-audio/blob/1fcd256e4c0d355a7c4e895be2ed65b6efbe3bdf/src/pyannote/audio/pipelines/speaker_diarization.py)
- [VBx AHC initialization](https://github.com/pyannote/pyannote-audio/blob/1fcd256e4c0d355a7c4e895be2ed65b6efbe3bdf/src/pyannote/audio/pipelines/clustering.py)

The vendored `OfflineDiarizerConfig.Clustering` documents its threshold as Euclidean distance. However, `AHCClustering` consumes cosine similarity and computes `sqrt(2 - 2 * threshold)` before cutting centroid linkage. Passing 0.6 therefore applies distance 0.8944, allowing substantially more merging than the reference radius.

Pluto explicitly adapts the reference distance at the library boundary:

```
cosine threshold = 1 - distance² / 2 = 0.82
```

This is a units correction against the reference implementation, not a threshold selected to achieve a requested speaker count. The vendored public API keeps its existing semantics. Speaker-count constraints remain unset; VBx, overlap exclusion and anonymous-label acceptance are unchanged.

## Behavioral regression

The native test runs the actual vendored AHC on unit vectors at distance 0.7. They must remain separate at the reference 0.6 radius. With the previous default they merge: the test failed before the adapter was added. A companion test verifies observations at distance 0.5 remain together, and no speaker count is forced.

Run: `swift test --package-path native/parakeet-runtime --filter FluidAudioSpeakerEvidenceTests`.

## Audio controls

The native pipeline was run at both the old cosine 0.6 and corrected cosine 0.82 settings, without a forced speaker count. Only this parameter changed. Each real voice control uses two distinct utterances from the public [OpenSLR LibriSpeech validation set](https://huggingface.co/datasets/openslr/librispeech_asr), downloaded by row ID from its dataset viewer. Audio is decoded with the verified arm64 FFmpeg to mono 16 kHz PCM. No personal meeting audio or embeddings are committed.

| Control | Known speakers | Old result | Corrected result |
| --- | ---: | ---: | ---: |
| Single speaker 2277, two utterances | 1 | 1 | 1 |
| Single speaker 2035, two utterances | 1 | 1 | 1 |
| Single speaker 7976, two utterances | 1 | 1 | 1 |
| Single speaker 8297, two utterances | 1 | 1 | 1 |
| Alternating 2277 / 2035 | 2 | 2 | 2 |
| Alternating 2277 / 8297 | 2 | 2 | 2 |
| Alternating 2035 / 7976 | 2 | 1 | 1 |
| Four voices, two turns each | 4 | 2 | 2 |
| Four voices with 1.5 s overlaps | 4 | 2 | 2 |
| Four voices with 1.5 s turns | 4 | 1 | 1 |
| Original Samantha / Daniel playback | 2 | 1 | 2 |
| Captured Samantha / Daniel playback | 2 | 1 | 2 |
| Single synthetic voice | 1 | 1 | 1 |

No control developed additional false splits. These are bounded regression controls, **not a diarization error rate benchmark**: speaker count alone is insufficient to establish correct assignment, and several multi-speaker controls still undercluster. Short turns and similar voices remain model limitations; uncertain labels must stay anonymous. A real meeting corpus is still needed to quantify general meeting accuracy.

### Reproduction inputs

LibriSpeech `clean/validation` rows 0, 1, 100, 101, 300, 301, 600, 601:

- 2277-149896-0000 and 2277-149896-0001
- 2035-147960-0005 and 2035-147960-0006
- 7976-110523-0017 and 7976-110523-0018
- 8297-275154-0017 and 8297-275154-0018

Single-speaker and pair controls retain the first 8 seconds of each utterance (or its full duration when shorter), with one second of silence before and between clips. Pair controls alternate speakers twice using each speaker's distinct utterances. The four-voice control retains up to 6 seconds per utterance; the short-turn control retains 1.5 seconds. The overlap control starts with one second of silence, adds no gaps, and overlaps each odd-indexed turn by 1.5 seconds using saturating 16-bit summation.

Local experimental scripts, turn outputs and logs are in `/tmp/pluto-cluster-calibration`; the synthetic diagnosis is in `/tmp/pluto-diarization-diagnosis`. These paths are scratch artifacts, not required for deterministic native unit tests.
