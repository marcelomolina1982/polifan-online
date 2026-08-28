"""One-shot read-only production-state benchmark for the isolated Render lab.

Runs after the synthetic startup smoke test has had time to finish, so Sparrow is not
competing with itself for CPU. This module is imported only by the isolated lab app.
"""
import threading
import time
import uuid

import real_state_benchmark


def _run_once():
    # The normal smoke test uses a 120 s budget. Leave a small buffer before the real run.
    time.sleep(140)
    job_id = f"startup-safe-{uuid.uuid4().hex[:10]}"
    real_state_benchmark.run_job(job_id, "safe")


threading.Thread(target=_run_once, daemon=True).start()
