import sys
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
