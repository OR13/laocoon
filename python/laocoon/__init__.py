"""Compute-heavy projections for LAOCOON.

The seam between Bun and Python is schema-versioned JSON on disk, never an
in-process bridge: this package reads the event log and writes an artifact, and
knows nothing about the process that invoked it.
"""

__all__ = ["events", "reply_graph"]
