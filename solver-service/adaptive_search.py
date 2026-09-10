"""Pure adaptive search policy for the experimental Polifan Sparrow motor.

This module decides where to spend rescue attempts.  It performs no solver,
network, Render, inventory, order or cut-batch operations.
"""

# Fixed, decorrelated seeds keep laboratory comparisons reproducible.
RESCUE_SEEDS = (811, 1879, 3253, 4937)
MIN_ATTEMPT_SECONDS = 14
MAX_ATTEMPT_SECONDS = 24
RESERVE_SECONDS = 8


def rescue_plan(current_complete, available_kits, remaining_seconds, max_complete=16):
    """Plan best-of-K attempts only at the next complete-figure frontier.

    The policy never spends rescue budget trying to improve density at the same
    complete count.  If 10 are certified, rescue targets 11; if 11 are
    certified, it targets 12, etc.  This matches the production objective that
    one extra complete BASE+TAPA kit outranks a denser plate with fewer kits.
    """
    current = max(0, int(current_complete or 0))
    available = max(0, int(available_kits or 0))
    remaining = max(0, int(remaining_seconds or 0))
    ceiling = min(int(max_complete), available)
    target = current + 1
    if current < 10 or target > ceiling:
        return []

    usable = remaining - RESERVE_SECONDS
    if usable < MIN_ATTEMPT_SECONDS:
        return []

    count = min(len(RESCUE_SEEDS), usable // MIN_ATTEMPT_SECONDS)
    if count <= 0:
        return []
    seconds = min(MAX_ATTEMPT_SECONDS, max(MIN_ATTEMPT_SECONDS, usable // count))

    return [
        {'target': target, 'seed': seed, 'seconds': seconds}
        for seed in RESCUE_SEEDS[:count]
    ]
