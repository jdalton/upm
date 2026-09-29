#!/usr/bin/env node
// Premise check: count how often a repeated-work pattern occurs in real
// lockfiles BEFORE benchmarking an optimization for it. A component win on
// a pattern that never repeats is overhead with a nice percentage attached.
//
//   node bench/premise.ts <lockfile> [more.lockfiles…]
//
// Counts, per file:
// - store-entry repeats: packages keyed by the same tarball integrity, so
//   one install would read and verify that store entry once per placement.
// - spec-ask repeats: edges asking for the same (name, specifier), so one
//   install would read, parse and pick the same manifest more than once.
//
// Print-only evidence, not a gate: run it before writing the benchmark,
// and put the numbers in the PR description.

type Counts = { distinct: number; total: number; repeats: number }

type DepGroups = {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type Lockfile = {
  root?: DepGroups
  workspaces?: Record<string, DepGroups>
  packages?: Record<string, { integrity?: string } & DepGroups>
}

const pct = (part: number, total: number): number =>
  total === 0 ? 0 : (part / total) * 100

/** Count duplicate values in an iterable of strings. */
export function repeatCount(values: Iterable<string>): Counts {
  const seen = new Map<string, number>()
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1)
  let repeats = 0
  for (const count of seen.values()) if (count > 1) repeats += count - 1
  return { distinct: seen.size, total: repeats + seen.size, repeats }
}

/** Every (name, specifier) ask in the lockfile, one per dependency edge. */
function* edgeAsks(lockfile: Lockfile): Generator<{ name: string; spec: string }> {
  const sources: Array<DepGroups | undefined> = [
    lockfile.root,
    ...Object.values(lockfile.workspaces ?? {}),
  ]
  const groups: Array<keyof DepGroups> = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]
  for (const source of sources) {
    if (!source) continue
    for (const group of groups) {
      for (const [name, spec] of Object.entries(source[group] ?? {}))
        yield { name, spec }
    }
  }
  for (const entry of Object.values(lockfile.packages ?? {})) {
    for (const group of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
      for (const [name, spec] of Object.entries(entry[group] ?? {}))
        yield { name, spec }
    }
  }
}

/** Aggregate repeated asks across one lockfile's dependency edges. */
export function specAskRepeats(lockfile: Lockfile): Counts {
  return repeatCount(
    [...edgeAsks(lockfile)].map((edge) => `${edge.name} ${edge.spec}`),
  )
}

/** Count store-entry repeats: distinct integrities vs packages carrying them. */
export function storeEntryRepeats(lockfile: Lockfile): Counts {
  return repeatCount(
    Object.values(lockfile.packages ?? {})
      .map((entry) => entry.integrity)
      .filter((integrity): integrity is string => typeof integrity === "string"),
  )
}

/** Read one lockfile document and report both repeat patterns. */
export function premiseFor(text: string): { store: Counts; specs: Counts } {
  const lockfile = JSON.parse(text) as Lockfile
  return {
    store: storeEntryRepeats(lockfile),
    specs: specAskRepeats(lockfile),
  }
}

function report(text: string, file: string): void {
  const { store, specs } = premiseFor(text)
  console.log(file)
  console.log(
    `  store entries: ${store.total} placements, ${store.distinct} distinct, ` +
      `${store.repeats} repeats (${pct(store.repeats, store.total).toFixed(1)}%)`,
  )
  console.log(
    `  spec asks:     ${specs.total} edges, ${specs.distinct} distinct, ` +
      `${specs.repeats} repeats (${pct(specs.repeats, specs.total).toFixed(1)}%)`,
  )
}

const files = process.argv.slice(2)
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
if (isMain) {
  if (files.length === 0) {
    console.error("usage: node bench/premise.ts <lockfile> [more…]")
    process.exit(1)
  }
  for (const file of files)
    report(
      await import("node:fs").then((fs) => fs.readFileSync(file, "utf8")),
      file,
    )
}
