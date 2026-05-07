# Sprint artifacts

This folder holds the **execution bundle** and human-readable sprint contracts derived from [`docs/remote-browser-design.md`](../remote-browser-design.md).

**Back to:** [Documentation hub](../README.md) · [User guide](../user-guide.md) · [Main README](../../README.md)

| File                                         | Purpose                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`sprint-bundle.json`](./sprint-bundle.json) | Machine-readable `spec`, `progress`, and `sprints[]` bundle (single source for tooling). |
| [`spec.md`](./spec.md)                       | Product objective, stories, constraints, test strategy, definition of done.              |
| [`progress.md`](./progress.md)               | Current sprint, completed vs pending work, risks, next step.                             |
| [`sprints/sprint-N/`](./sprints/)            | Per-sprint `tasks.md`, `contract.md`, `evaluation.md`.                                   |

Regenerate or amend `sprint-bundle.json` when scope changes, then refresh the markdown mirrors to match.
