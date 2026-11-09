#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Acme slide-design search  --  Engine v2 fusion layer.

Wraps the lifted UI/UX Pro Max BM25 engine (slide_search_core.py) and grounds
it in the 11-type canonical slide contract (slide-types.csv, 1:1 with the
master template and deck-spec.schema.json). Two modes:

  # Look up everything the composer needs for one of OUR canonical slide types
  python search.py --type analytics-dash-ai
  python search.py --type cover --json

  # Free-text search of the lifted knowledge DB, plus the best-fit canonical type
  python search.py "spend analytics dashboard"
  python search.py "customer onboarding" --json

The composer calls this per slide: it never invents a layout, it picks one of
the 11 types and pulls the grounded layout / copy / chart / animation guidance.
"""

import csv
import json
import argparse
from pathlib import Path

import slide_search_core as core

DS_DIR = Path(__file__).resolve().parent.parent
TYPES_CSV = DS_DIR / "slide-types.csv"

# Canonical slide types (the deck-spec.schema.json enum). Order = natural deck flow.
CANONICAL_TYPES = [
    "cover", "summary", "section-divider", "txt-character-ui", "txt-character-fun-ui",
    "application-screen", "application-multi-screen", "feature-highlight",
    "analytics-dash-ai", "people", "call-to-action",
]


def load_types():
    with open(TYPES_CSV, encoding="utf-8") as f:
        return {row["type"]: row for row in csv.DictReader(f)}


def suggest_type(query):
    """Cheap keyword vote to map free text to one of the 11 canonical types."""
    q = query.lower()
    votes = {
        "cover": ["cover", "title", "opening", "intro", "hero"],
        "summary": ["summary", "agenda", "overview", "contents"],
        "section-divider": ["section", "divider", "chapter", "break"],
        "txt-character-ui": ["benefit", "capability", "outcome", "value", "why"],
        "txt-character-fun-ui": ["marketplace", "supplier", "engagement", "two-sided", "fun"],
        "application-screen": ["feature", "workflow", "screen", "product", "app"],
        "application-multi-screen": ["breadth", "platform", "multi", "how it works", "steps"],
        "feature-highlight": ["features", "cards", "three", "capabilities", "pillars"],
        "analytics-dash-ai": ["analytics", "dashboard", "reporting", "spend", "data", "kpi", "insight"],
        "people": ["team", "people", "leadership", "who we are", "founders"],
        "call-to-action": ["cta", "call to action", "get started", "next steps", "contact", "close"],
    }
    scores = {t: sum(1 for kw in kws if kw in q) for t, kws in votes.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else None


def enrich_for_type(row):
    """Attach grounded knowledge-DB hits for a canonical type using the BM25 core."""
    role = row.get("narrative_role", "")
    layout_q = f"{row['data_title']} {role}"
    return {
        "type": row["type"],
        "data_title": row["data_title"],
        "narrative_role": role,
        "emotion": row.get("emotion"),
        "default_animation": row.get("default_animation"),
        "required_fields": row.get("required_fields"),
        "optional_fields": row.get("optional_fields"),
        "typical_asset_roles": row.get("typical_asset_roles"),
        "layout_notes": row.get("layout_notes"),
        "layout_hits": core.search(layout_q, "layout", 2).get("results", []),
        "copy_hits": core.search(role, "copy", 2).get("results", []),
        "chart_hits": core.search(role, "chart", 2).get("results", [])
                      if row["type"] == "analytics-dash-ai" else [],
    }


def main():
    ap = argparse.ArgumentParser(description="Acme slide-design search (Engine v2)")
    ap.add_argument("query", nargs="?", help="Free-text query")
    ap.add_argument("--type", choices=CANONICAL_TYPES, help="Look up a canonical slide type")
    ap.add_argument("--json", action="store_true", help="JSON output")
    ap.add_argument("-n", "--max-results", type=int, default=3)
    args = ap.parse_args()

    types = load_types()

    if args.type:
        out = enrich_for_type(types[args.type])
    elif args.query:
        best = suggest_type(args.query)
        out = {
            "query": args.query,
            "suggested_type": best,
            "type_detail": enrich_for_type(types[best]) if best else None,
            "knowledge": core.search_all(args.query, args.max_results),
        }
    else:
        ap.error("provide a query or --type")

    if args.json:
        print(json.dumps(out, indent=2))
    else:
        print(json.dumps(out, indent=2))  # single, machine-friendly view by default


if __name__ == "__main__":
    main()
