"""Fail closed until the coordinator approves an actual reject-baseline reader.

There is currently no public retained-output reread capability. A CSV UI gesture
alone and the cached initial export are not a new byte receipt. This guard is
intentionally not a validator for a fictional public tool or synthetic receipt.
"""
REJECT_BASELINE_BLOCKER='TEXT_EXPORT_REJECT_BASELINE_READER_UNAVAILABLE'

def require_reject_baseline_reader():
    raise ValueError(REJECT_BASELINE_BLOCKER + ': independent same-session bytes between reject and replace cannot currently be obtained through the public acceptance toolset')
