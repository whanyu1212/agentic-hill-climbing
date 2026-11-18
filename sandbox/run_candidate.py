"""Run a single fold inside the sandbox, never on the orchestrator host."""

import json
import sys
from contextlib import redirect_stdout


def main() -> None:
    request = json.load(sys.stdin)
    namespace = {"__name__": "candidate"}
    with redirect_stdout(sys.stderr):
        # The caller launches this process inside a fresh OS-level sandbox.
        exec(compile(request["source"], "candidate.py", "exec"), namespace)  # noqa: S102
        predictions = list(
            namespace["forecast"](request["history"], request["forecast_dates"])
        )
    json.dump([float(value) for value in predictions], sys.stdout, allow_nan=False)


if __name__ == "__main__":
    main()
