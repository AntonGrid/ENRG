import json
from pathlib import Path

import jsonschema


BASE_DIR = Path(__file__).resolve().parent.parent


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def test_attestation_deny_example_validates_against_schema():
    # Schema lives in Axis-core now
    schema_path = BASE_DIR.parent / "Axis-core" / "axis_core" / "schemas" / "attestation.schema.json"
    example_path = BASE_DIR / "attestation-example-deny.json"

    schema = load_json(schema_path)
    example = load_json(example_path)

    # This will raise jsonschema.ValidationError if invalid
    jsonschema.validate(instance=example, schema=schema)


from axis_core.onchain_bridge import build_attestation_params


def test_build_attestation_params_deny_case():
    example_path = BASE_DIR / "attestation-example-deny.json"
    example = load_json(example_path)

    params = build_attestation_params(example)

    # We only assert high-level invariants here.
    assert params.allowed is False
    assert isinstance(params.max_power_w, int)
    # max_power_w should be derived from max_power_kw * 1000
    decision = example["decision"]
    max_kw = decision.get("max_power_kw")
    if max_kw is not None:
        assert params.max_power_w == int(max_kw * 1000)
