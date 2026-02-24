# Custom torch hook to avoid importing torch in an isolated subprocess.
# The default hook uses collect_submodules(), which imports torch and can
# trigger OpenMP shared-memory errors on some macOS setups.

import importlib.util
import pkgutil

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    is_module_satisfies,
    PY_DYLIB_PATTERNS,
)


def _collect_torch_submodules() -> list[str]:
    spec = importlib.util.find_spec("torch")
    if not spec or not spec.submodule_search_locations:
        return []

    modules: list[str] = []
    for _, name, _ in pkgutil.walk_packages(
        spec.submodule_search_locations, "torch."
    ):
        modules.append(name)
    return modules


if is_module_satisfies("PyInstaller >= 6.0"):
    module_collection_mode = "pyz+py"
    warn_on_missing_hiddenimports = False

    datas = collect_data_files(
        "torch",
        excludes=[
            "**/*.h",
            "**/*.hpp",
            "**/*.cuh",
            "**/*.lib",
            "**/*.cpp",
            "**/*.pyi",
            "**/*.cmake",
        ],
    )
    hiddenimports = _collect_torch_submodules()
    binaries = collect_dynamic_libs(
        "torch",
        # Ensure we pick up fully-versioned .so files as well
        search_patterns=PY_DYLIB_PATTERNS + ["*.so.*"],
    )
else:
    from PyInstaller.utils.hooks import get_package_paths

    datas = [(get_package_paths("torch")[1], "torch")]
