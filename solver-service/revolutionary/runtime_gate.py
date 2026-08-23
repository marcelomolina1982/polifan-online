from __future__ import annotations

import threading
from contextlib import contextmanager

_solver_lock = threading.Lock()

@contextmanager
def solver_lane():
    _solver_lock.acquire()
    try:
        yield
    finally:
        _solver_lock.release()
