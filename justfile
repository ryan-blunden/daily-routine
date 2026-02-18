set shell := ["bash", "-cu"]

plan:
    python3 scripts/plan.py

serve:
    open http://localhost:8000
    python3 -m http.server
