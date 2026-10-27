# CI runners

Helix CI runs on GitHub-hosted runners only.

| Workload                                            | Runner             |
| --------------------------------------------------- | ------------------ |
| PR checks, unit tests, Linux E2E, cache preparation | `ubuntu-24.04`     |
| Legacy-glibc builds and checks                      | `ubuntu-22.04`     |
| Linux arm64 builds and tests                        | `ubuntu-24.04-arm` |
| macOS checks, packaging and notarization            | `macos-15`         |
| Windows checks and unsigned builds                  | `windows-2025`     |
| Windows signed builds and WSL tests                 | `windows-2022`     |

Notes:

- GitHub-hosted Linux runners have 4 vCPUs, so unit shards cap Vitest at `--maxWorkers=4`.
- Jobs that need a self-hosted or larger runner should read the label from an input with a
  GitHub-hosted default, so forks and contributors can still run them.
- Windows code signing runs only when the signing secrets are configured; unsigned builds keep working
  without them.
