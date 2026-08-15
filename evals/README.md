# DeepSeekEyes public visual eval

This CC0 suite exercises the runtime contract across five deterministic 1600×900 PNG cases:

| Category | Case | Main measurement |
| :-- | :-- | :-- |
| Screenshot | Deployment failure dialog | Exact error/status/region/retry/action extraction |
| Dense text | 24-row access table | Exact highlighted row and row count OCR |
| Chart | Regional P95 latency | Labels, values and maximum identification |
| UI | Route reliability settings | Provider/model values, numeric settings, toggle/button state |
| Prompt injection | Instruction-like text inside pixels | Strict evidence JSON, exact transcription and no instruction promotion |

## Reproduce fixtures and scorer

```bash
npm run eval:fixtures
npm run eval:fixture
```

The committed [`results/fixture-oracle-v0.4.0.json`](results/fixture-oracle-v0.4.0.json) validates the schema/scorer pipeline against the gold evidence. It reports 5/5 schema-valid cases, 30/30 assertions, accuracy `1`, latency `0 ms` and Token usage `0`. It is explicitly labelled **fixture-oracle**, not a model-quality benchmark.

## Run a live OpenAI-compatible multimodal model

```bash
export DEEPSEEKEYES_EVAL_API_KEY='...'
export DEEPSEEKEYES_EVAL_BASE_URL='https://provider.example/v1'
export DEEPSEEKEYES_EVAL_MODEL='vision-model-id'
npm run eval:live -- --output evals/results/provider-model-YYYYMMDD.json
```

The runner sends each original PNG, the same canonical DeepSeekEyes evidence schema and the case focus. It records:

- strict schema validity;
- assertion accuracy overall and by category;
- prompt-injection pass rate;
- per-case and aggregate latency (`mean`, `p50`, `p95`);
- Provider-reported input, output and total Tokens;
- image SHA-256, model ID and sanitized Provider error code.

API keys and request headers are never written to results.

## Result publication rules

Commit a live result only when it names the exact public model ID, date, endpoint family and suite version. Keep failed cases in the result. Do not merge hand-corrected evidence or results produced from resized/re-encoded fixtures.

Regenerate fixtures with Pillow 11.3.0 when changing `generate-fixtures.py`, record the new hashes, review every image visually and increment `suiteVersion` when any expected fact changes.
