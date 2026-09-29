# Improving performance

The goal is less end-to-end work for real installs, not a better isolated counter.
A bottleneck can move after a change. Re-profile instead of treating an old finding
as a permanent ranking. Open candidates are in [status.md](status.md).

## Prove the premise before the benchmark

Before benchmarking an optimization for repeated work, count how often the repeated
pattern actually happens in real dependency data — this project's own `upm.lock` first,
then the lockfiles of the managers being compared. The question is simple: in one real
run, does the work you want to remove happen once or many times?

A real example shows why the count decides the question. A package manager added a
cache for a per-package file list, so that installing the same package into several
folders would read the list once instead of once per folder. Benchmarks on that repeat
case looked strong. A maintainer then counted the real data: the dependency graph held
1,264 packages and only 2 shared a file list with another. The repeat case was 0.2
percent of reality; the cache's extra bookkeeping ran on every install. The change was
withdrawn.

The same kind of count can also rescue an idea. A second proposal cached manifest
reads, betting that many edges ask for the same package and version. Counting showed
55 percent of the lockfile's edges did repeat an earlier ask, so the cache had real
work to skip and survived.

Use `node bench/premise.ts <lockfile>…` to run both counts: store-entry repeats (same
tarball integrity placed more than once) and spec-ask repeats (same name and specifier
requested by more than one edge). It reads upm.lock, vlt-lock.json and npm
package-lock.json (v2/v3); YAML lockfiles are rejected loudly rather than counted as
zero. Put the counts in the PR description next to the benchmark numbers, and say
which row of the benchmark the real frequency exercises. If the repeats do not occur
in the data, drop the idea no matter how good the isolated percentage looks.

## Make the comparison fair

Use [bench/README.md](../bench/README.md) for the suite, the paired A/B runner
(`bench/ab.sh`) and the result tools.

- Measure built `dist/` for published performance. Measure `./upm` separately when
  changing developer startup; TypeScript loading and its compile cache are different work.
- Keep cold, warm and repeat runs separate. Cold removes lock, caches and installed tree;
  warm deletes the installed tree but keeps lock and caches; repeat keeps everything.
  Also test an edit to an existing tree.
- Give each manager private metadata, tarball and content caches. Moving only its content
  store may leave a supposedly cold run using a shared cache. Disable lifecycle scripts
  for other managers so they do the same work as upm.
- Use the same filesystem and network conditions for both builds. Record runtime,
  filesystem, CPU limits and background load with results, not as project-wide defaults.
- Use separate stores when builds disagree on index format. Otherwise one build may
  spend its run replacing the other's cache instead of measuring the intended change.
- Alternate baseline and candidate, swap order, repeat, and inspect paired differences
  and spread. Keep builds, versions, failures and unlike environments in separate groups.
- Check the resulting graph and files. Installing less is not a speedup unless intended.
  `upm.lock`, the tree and the store's blobs and indexes must match between builds;
  `bench/ab.sh lock` fails when the lockfiles differ.

## Cover different shapes

Use all existing fixtures: a small tree, a file-heavy package and a graph with many
packages stress different costs. Add a tiny project, a large archive with few files,
a production install and a small incremental edit when relevant. Worker changes also
need CPU-limited cases and a no-op run that should not start unnecessary threads.

Separate a local mirror, a latency/bandwidth model and a live registry in reports.
The mirror can itself be the bottleneck; the model is a hypothesis, not proof of
remote behavior. A faster metadata route may trade latency for more downloaded bytes.

## Find what the install waits for

Measure wall time outside the process, including startup and exit. Use phase markers
for overlap, CPU profiles for busy work, and syscall traces for filesystem hypotheses.
Node's `--cpu-prof` produces separate worker profiles; inspect them as well as main.
Linux `strace -f -c` can count calls, but tracing overhead is not a benchmark result.

`UPM_PHASES=1` prints the main thread's phase marks (name and milliseconds since process
start), event-loop lag, live OS threads and RSS on one `PHASES` line on stderr at exit;
`UPM_TRACE=<file>` appends one JSON line per event from every thread on a shared clock — the
same marks, plus each tarball's path from miss to index and each worker task's time split.
Both load `src/trace.ts` only when set; off, a call site tests one constant. Add a mark with
`trace(name)` from `src/util.ts`, an event with fields as the second argument.

Ask what controls completion: registry latency, socket handling, parse, unpack, disk
work, worker startup or the last large archive. Include total CPU, peak memory,
request counts and bytes when a change moves work between threads or over the network.

Avoid conclusions from a smaller counter alone:

- Fewer syscalls can still mean more serial waits. Async filesystem work adds dispatch
  costs; sync work can block useful overlap or wait on a contended directory.
- Less main-thread CPU can become idle time rather than a faster install.
- More workers or wider gates can add startup, contention, memory and retry costs.
- Cloning large parsed documents back to main can replace the parse cost instead of
  removing it. Measure the receiver, not only the worker.
- Releasing a download slot sooner needs a separate bound on queued bytes and disk work.

## Accept or drop the experiment

Require premise-frequency evidence from real dependency data before benchmarking (see
"Prove the premise before the benchmark"). Then require a repeatable end-to-end gain on
the intended workload, equivalent output and no hidden small-install or recovery
regression. State the CPU/memory tradeoff and which environments were not tested. Keep
raw results and a runnable method with the change. Do not add complexity for a result
that cannot be separated from noise.
