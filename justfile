set shell := ["bash", "-cu"]

plan:
  codex --no-alt-screen -m gpt-5-mini "$(cat prompts/daily-plan.txt)"
