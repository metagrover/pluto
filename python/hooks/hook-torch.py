from PyInstaller.utils.hooks import (
    PY_DYLIB_PATTERNS,
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
)

module_collection_mode = 'pyz+py'
warn_on_missing_hiddenimports = False

datas = collect_data_files(
    'torch',
    excludes=[
        '**/*.h',
        '**/*.hpp',
        '**/*.cuh',
        '**/*.lib',
        '**/*.cpp',
        '**/*.pyi',
        '**/*.cmake',
    ],
)

binaries = collect_dynamic_libs(
    'torch',
    search_patterns=PY_DYLIB_PATTERNS + ['*.so.*'],
)


def _include_torch_submodule(name: str) -> bool:
    blocked_prefixes = (
        'torch.distributed',
        'torch.utils.tensorboard',
        'torch.testing._internal',
    )
    return not any(
        name == prefix or name.startswith(f'{prefix}.')
        for prefix in blocked_prefixes
    )


hiddenimports = collect_submodules(
    'torch',
    filter=_include_torch_submodule,
    on_error='ignore',
)
