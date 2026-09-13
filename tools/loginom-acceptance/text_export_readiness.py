"""Fail closed until contract2 passes a separately authorized native smoke.

There is currently no public retained-output reread capability. A CSV UI gesture
alone and the cached initial export are not a new byte receipt. This guard is
intentionally not a validator for a fictional public tool or synthetic receipt.
"""
REJECT_BASELINE_BLOCKER='TEXT_EXPORT_REJECT_BASELINE_READER_UNAVAILABLE'

def require_reject_baseline_reader():
    raise ValueError(REJECT_BASELINE_BLOCKER + ': contract2 host observer is wired offline but native smoke is not admitted; public retained-output reread remains unavailable')
