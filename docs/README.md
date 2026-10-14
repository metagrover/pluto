# Documentation

Start with the guide for the task you want to do:

| Task | Guide |
| --- | --- |
| Install Pluto and resolve setup problems | [Getting started](getting-started.md) |
| Run, troubleshoot, or verify a source build | [Development](dev.md) |
| Understand capture, transcription, and speaker evidence | [Architecture](architecture.md) |
| Understand saved speaker attribution | [Attribution contract](transcript-speaker-attribution.md) |
| Connect meeting notes to ChatGPT | [ChatGPT connection](chatgpt-connection.md) |
| Prepare and publish a release | [Releasing](releasing.md) |
| Maintain the product demo | [Demo](demo.md) |
| Run recording regression benchmarks | [Recording benchmark](recording-quality-benchmark.md) |
| Replay notes generation for development | [Notes replay](research/notes-replay-harness.md) |

[PRODUCT.md](../PRODUCT.md) describes product purpose and constraints.
[decisions.md](decisions.md) records durable choices; [ADRs](adr/README.md)
explain substantial architectural decisions. Check the current implementation
when a historical decision has been superseded.

Recent [plans](plans/) and [follow-ups](follow-ups/) retain open work and acceptance
limits. A plan is not proof that a feature shipped or that a hardware check passed.
[Release notes](releases/) and the [development journal](CHANGELOG.md) retain
delivery history.

Old specifications, competing implementation plans, and experiment reports have
been removed from the current tree. They remain in Git history, and retained
references link to the revision containing them. New work should update the
relevant current guide rather than append another competing product description.
