"""Repeatable benchmark harness for TVT nesting experiments.

Each case is a JSON snapshot containing a prepared-kits payload. It does not
read live inventory. This prevents the moving-target loop we had in production.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics

import nest_sparrow as ns
from revolutionary.ensemble_v1 import revolutionary_solve, MIN_GAP_MM

ROOT = Path(__file__).resolve().parent
CASES = ROOT / 'cases'


def _load_case(case_id):
    path = CASES / f'{case_id}.json'
    if not path.exists():
        raise FileNotFoundError(f'Missing fixed case snapshot: {path}')
    payload = json.loads(path.read_text(encoding='utf-8'))
    return payload


def _prepare(payload):
    width = float(payload.get('widthMm') or 1220.0)
    height = float(payload.get('heightMm') or 580.0)
    prepared = []
    for kit in payload.get('kits') or []:
        p = ns._prep_kit(kit, width, height)
        p['date'] = str(kit.get('date') or '')
        prepared.append(p)
    return prepared


def _row(run):
    cert = run.get('productionCertificate') or {}
    return {
        'complete': int(run.get('completeFigures') or 0),
        'density': round(float(run.get('density') or 0.0), 2),
        'gapMm': round(float(run.get('minimumGapMm') or cert.get('minimumGapMmCertified') or 0.0), 4),
        'conflicts': int(cert.get('collisionCount') or 0),
        'border': int(cert.get('outsidePlateCount') or 0),
        'seconds': round(float(run.get('elapsedSeconds') or 0.0), 2),
        'stripWidthMm': round(float(run.get('stripWidthMm') or 0.0), 2),
        'strategy': run.get('selectionStrategy') or '',
        'ok': bool(run.get('ok')),
    }


def run_case(case_id, repeats=3, seconds=150.0, workers=4):
    payload = _load_case(case_id)
    prepared = _prepare(payload)
    rows = []
    for _ in range(repeats):
        result = revolutionary_solve(prepared, total_seconds=seconds, max_workers=workers)
        rows.append(_row(result))
    return rows


def summarize(case_id, rows):
    valid = [r for r in rows if r['ok'] and r['gapMm'] >= MIN_GAP_MM and r['conflicts'] == 0 and r['border'] == 0]
    if not valid:
        return {'case': case_id, 'validRuns': 0, 'runs': rows}
    best = max(valid, key=lambda r: (r['complete'], r['density'], -r['stripWidthMm'], -r['seconds']))
    return {
        'case': case_id,
        'validRuns': len(valid),
        'best': best,
        'medianComplete': statistics.median(r['complete'] for r in valid),
        'medianDensity': round(statistics.median(r['density'] for r in valid), 2),
        'medianSeconds': round(statistics.median(r['seconds'] for r in valid), 2),
        'runs': rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cases', nargs='+')
    ap.add_argument('--repeats', type=int, default=3)
    ap.add_argument('--seconds', type=float, default=150.0)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--out', default='benchmark-results.json')
    args = ap.parse_args()

    report = []
    for case_id in args.cases:
        report.append(summarize(case_id, run_case(case_id, args.repeats, args.seconds, args.workers)))
    out = Path(args.out)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
