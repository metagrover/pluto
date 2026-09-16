# Provider comparison benchmark

The checked-in manifest at `benchmarks/provider-comparison/manifest.json` pins
synthetic fixtures by SHA-256. The opt-in runner sends the identical fixture
through Pluto's production notes, entity/profile/project extraction, Ask Pluto,
and suggested-question paths. Normal CI validates hashes and mocked adapter
contracts; it never calls a live provider.

Run one provider at a time:

```bash
PLUTO_BENCHMARK_PROVIDER=ollama \
OLLAMA_BENCHMARK_MODEL=gemma4:12b \
pnpm run benchmark:provider-comparison
```

```bash
PLUTO_BENCHMARK_PROVIDER=openai \
OPENAI_BENCHMARK_MODEL=gpt-4o-mini \
OPENAI_API_KEY=... \
pnpm run benchmark:provider-comparison
```

```bash
PLUTO_BENCHMARK_PROVIDER=openrouter \
OPENROUTER_BENCHMARK_MODEL=provider/model \
OPENROUTER_API_KEY=... \
pnpm run benchmark:provider-comparison
```

Before an OpenAI run, add a reviewed price entry for the requested model to the
dated price manifest. OpenRouter cost comes from returned usage metadata. Local
API cost is zero; hardware and power are explicitly excluded. Reports include
provider, requested/resolved model, fixture hash, prompt/schema version,
quality dimensions, latency, tokens, and API cost.

Automated scores are diagnostics, not a product recommendation. A reviewer must
inspect factual support, missed or misassigned commitments, corrections,
speaker context, profile/project updates, Q&A, and suggested questions before
Pluto publishes any “Local,” “Fast,” or “Best” label.
