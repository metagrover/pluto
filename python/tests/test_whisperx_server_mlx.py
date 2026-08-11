import sys
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

import whisperx_server as server
from whisperx_server import MLX_MODEL_MAP, MLX_WHISPER_AVAILABLE, app

client = TestClient(app)


def test_health_reports_only_the_mlx_runtime():
    response = client.get('/health')
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'ok'
    assert data['engine'] in {'mlx_whisper', 'unavailable'}
    assert data['mlx_available'] == MLX_WHISPER_AVAILABLE
    assert 'whisperx_available' not in data
    assert data['device'] == 'mlx'
    assert data['compute_type'] == 'float16'
    assert data['supported_devices'] == ['mlx']
    assert data['supported_compute_types'] == ['float16']


def test_mlx_model_map():
    assert MLX_MODEL_MAP['small'] == 'mlx-community/whisper-small-mlx'
    assert MLX_MODEL_MAP['medium'] == 'mlx-community/whisper-medium-mlx'


def test_config_updates_only_user_selectable_model_and_language():
    response = client.post('/config', json={'model': 'small', 'language': 'en'})
    if not MLX_WHISPER_AVAILABLE:
        assert response.status_code == 503
        assert response.json()['detail'] == 'MLX Whisper is unavailable'
        return

    assert response.status_code == 200
    assert response.json()['config'] == {
        'device': 'mlx',
        'compute_type': 'float16',
        'model_name': 'small',
        'language': 'en',
    }


@pytest.mark.parametrize(
    'payload',
    [
        {'device': 'cpu'},
        {'device': 'cuda'},
        {'compute_type': 'int8'},
        {'compute_type': 'float32'},
    ],
)
def test_config_rejects_non_mlx_runtime_options(payload):
    response = client.post('/config', json=payload)
    assert response.status_code == 422


def test_missing_mlx_never_falls_back_to_cpu(monkeypatch):
    monkeypatch.setattr(server, 'MLX_WHISPER_AVAILABLE', False)
    with pytest.raises(server.HTTPException, match='MLX Whisper is unavailable') as exc:
        server.load_model_if_needed({'model': 'small'})
    assert exc.value.status_code == 503
    assert server.model_config['device'] == 'mlx'
    assert server.model_config['compute_type'] == 'float16'


def test_live_transcription_can_skip_word_timestamps(tmp_path, monkeypatch):
    audio_path = tmp_path / 'live.wav'
    audio_path.write_bytes(b'RIFF')
    calls = []

    def fake_transcribe(path, **kwargs):
        calls.append((path, kwargs))
        return {
            'segments': [{'start': 0, 'end': 1, 'text': 'hello'}],
            'language': 'en',
            'duration': 1,
        }

    monkeypatch.setattr(server, 'MLX_WHISPER_AVAILABLE', True)
    monkeypatch.setattr(server.mlx_whisper, 'transcribe', fake_transcribe)

    response = client.post(
        '/transcribe',
        json={
            'audio_path': str(audio_path),
            'model': 'base',
            'language': 'en',
            'word_timestamps': False,
        },
    )

    assert response.status_code == 200
    assert calls[0][1]['word_timestamps'] is False
    assert calls[0][1]['condition_on_previous_text'] is False
    assert 'words' not in response.json()['segments'][0]


def test_transcription_forwards_bounded_name_prompt_without_logging_content(
    tmp_path, monkeypatch, caplog
):
    audio_path = tmp_path / 'names.wav'
    audio_path.write_bytes(b'RIFF')
    calls = []
    synthetic_prompt = 'Person names: Nira Vale, Milo North.'

    def fake_transcribe(path, **kwargs):
        calls.append((path, kwargs))
        return {
            'segments': [{'start': 0, 'end': 1, 'text': 'synthetic speech'}],
            'language': 'en',
            'duration': 1,
        }

    monkeypatch.setattr(server, 'MLX_WHISPER_AVAILABLE', True)
    monkeypatch.setattr(server.mlx_whisper, 'transcribe', fake_transcribe)

    response = client.post(
        '/transcribe',
        json={
            'audio_path': str(audio_path),
            'model': 'base',
            'language': 'en',
            'initial_prompt': synthetic_prompt,
        },
    )

    assert response.status_code == 200
    assert calls[0][1]['initial_prompt'] == synthetic_prompt
    assert synthetic_prompt not in caplog.text


def test_transcription_omits_empty_name_prompt(tmp_path, monkeypatch):
    audio_path = tmp_path / 'empty-prompt.wav'
    audio_path.write_bytes(b'RIFF')
    calls = []

    def fake_transcribe(path, **kwargs):
        calls.append((path, kwargs))
        return {'segments': [], 'language': 'en', 'duration': 0}

    monkeypatch.setattr(server, 'MLX_WHISPER_AVAILABLE', True)
    monkeypatch.setattr(server.mlx_whisper, 'transcribe', fake_transcribe)

    response = client.post(
        '/transcribe',
        json={
            'audio_path': str(audio_path),
            'model': 'base',
            'language': 'en',
            'initial_prompt': '',
        },
    )

    assert response.status_code == 200
    assert 'initial_prompt' not in calls[0][1]


def test_transcription_rejects_oversized_name_prompt(tmp_path):
    audio_path = tmp_path / 'oversized-prompt.wav'
    audio_path.write_bytes(b'RIFF')

    response = client.post(
        '/transcribe',
        json={
            'audio_path': str(audio_path),
            'initial_prompt': 'A' * 241,
        },
    )

    assert response.status_code == 422


def test_transcription_failure_does_not_echo_name_prompt(
    tmp_path, monkeypatch, caplog, capsys
):
    audio_path = tmp_path / 'private-error.wav'
    audio_path.write_bytes(b'RIFF')
    synthetic_prompt = 'Person names: Nira Vale.'

    def fake_transcribe(_path, **_kwargs):
        raise RuntimeError(f'decode failed near {synthetic_prompt}')

    monkeypatch.setattr(server, 'MLX_WHISPER_AVAILABLE', True)
    monkeypatch.setattr(server.mlx_whisper, 'transcribe', fake_transcribe)

    response = client.post(
        '/transcribe',
        json={
            'audio_path': str(audio_path),
            'initial_prompt': synthetic_prompt,
        },
    )

    captured = capsys.readouterr()
    assert response.status_code == 500
    assert synthetic_prompt not in caplog.text
    assert synthetic_prompt not in captured.err
    assert synthetic_prompt not in response.text


def test_live_transcription_rejects_no_speech_and_bounds_segments(tmp_path, monkeypatch):
    audio_path = tmp_path / 'live.wav'
    with wave.open(str(audio_path), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16_000)
        audio.writeframes(b'\0\0' * 16_000)

    def fake_transcribe(_path, **_kwargs):
        return {
            'segments': [
                {
                    'start': 0,
                    'end': 1.2,
                    'text': 'bounded speech',
                    'no_speech_prob': 0.1,
                },
                {
                    'start': 0,
                    'end': 28,
                    'text': 'silence hallucination',
                    'no_speech_prob': 0.8,
                },
                {
                    'start': 2,
                    'end': 3,
                    'text': 'outside audio',
                    'no_speech_prob': 0.1,
                },
            ],
            'language': 'en',
            'duration': 30,
        }

    monkeypatch.setattr(server, 'MLX_WHISPER_AVAILABLE', True)
    monkeypatch.setattr(server.mlx_whisper, 'transcribe', fake_transcribe)

    response = client.post(
        '/transcribe',
        json={
            'audio_path': str(audio_path),
            'model': 'base',
            'language': 'en',
            'word_timestamps': False,
        },
    )

    assert response.status_code == 200
    assert response.json()['duration'] == 1.0
    assert response.json()['segments'] == [
        {'start': 0.0, 'end': 1.0, 'text': 'bounded speech'}
    ]


def test_final_transcription_drops_repeated_high_no_speech_segments(tmp_path, monkeypatch):
    audio_path = tmp_path / 'final.wav'
    with wave.open(str(audio_path), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16_000)
        audio.writeframes(b'\0\0' * 48_000)

    def fake_transcribe(_path, **_kwargs):
        return {
            'segments': [
                {'start': 0, 'end': 1, 'text': 'real speech', 'no_speech_prob': 0.1},
                {'start': 1, 'end': 2, 'text': 'repeated artifact', 'no_speech_prob': 0.8},
                {'start': 2, 'end': 3, 'text': 'repeated artifact', 'no_speech_prob': 0.8},
            ],
            'language': 'en',
            'duration': 30,
        }

    monkeypatch.setattr(server, 'MLX_WHISPER_AVAILABLE', True)
    monkeypatch.setattr(server.mlx_whisper, 'transcribe', fake_transcribe)

    response = client.post(
        '/transcribe',
        json={
            'audio_path': str(audio_path),
            'model': 'medium',
            'language': 'en',
            'word_timestamps': True,
        },
    )

    assert response.status_code == 200
    assert [segment['text'] for segment in response.json()['segments']] == [
        'real speech'
    ]
