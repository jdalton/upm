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
// Formats: upm.lock and vlt-lock.json, plus npm package-lock.json v2/v3.
// YAML lockfiles (yarn, pnpm) are not covered; the CLI rejects them loudly.
//
// Print-only evidence, not a gate: run it before writing the benchmark,
// and put the numbers in the PR description.

import { fileURLToPath } from "node:url";

type Counts = { distinct: number; total: number; repeats: number };

type DepGroups = {
  dependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

/** One parsed lockfile: store placements and manifest asks. */
export type PremiseInputs = {
  /** Placement key → the tarball integrity placed there. */
  placements: Map<string, string>;
  /** One dependency edge as a (name, specifier) ask. */
  asks: Array<{ name: string; spec: string }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringMap = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

/**
 * Read the dependency groups of one parsed lockfile entry. Registry
 * packages don't install their own devDependencies, so those count
 * only where the developer wrote them: the root and workspace
 * manifest entries (`includeDev`).
 */
function* depAsks(entry: unknown, includeDev: boolean): Generator<{ name: string; spec: string }> {
  if (!isRecord(entry)) return;
  const groups: Record<string, unknown> = {
    dependencies: entry["dependencies"],
    optionalDependencies: entry["optionalDependencies"],
    peerDependencies: entry["peerDependencies"],
    devDependencies: includeDev ? entry["devDependencies"] : undefined,
  };
  for (const key of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "devDependencies",
  ]) {
    const specs = stringMap(groups[key]);
    if (!specs) continue;
    for (const [name, spec] of Object.entries(specs)) {
      if (typeof spec === "string") yield { name, spec };
    }
  }
}

/**
 * Parse one lockfile document. Understands the `packages`-map shape
 * (upm.lock, npm package-lock.json v2/v3) and the vlt-lock.json
 * `nodes`/`edges` shape; anything else throws, so a YAML lockfile
 * names its format instead of reporting zeros.
 */
export function premiseInputs(text: string): PremiseInputs {
  let root: Record<string, unknown>
  try {
    root = JSON.parse(text) as Record<string, unknown>
  } catch {
    // yarn.lock and pnpm-lock.yaml are YAML: a text lockfile reaching
    // here is a format this tool cannot count. Name the formats it
    // does count instead of letting JSON.parse speak for us.
    throw new Error(
      "unrecognized lockfile shape: expected upm.lock, vlt-lock.json or npm package-lock.json (v2/v3); YAML lockfiles are not supported",
    )
  };
  // Keyed by placement id (not integrity) so the COUNT of duplicate
  // integrities survives; repeatCount does the dedup later.
  const placements = new Map<string, string>();
  const asks: Array<{ name: string; spec: string }> = [];
  const nodes = stringMap(root["nodes"]);
  const edges = stringMap(root["edges"]);
  if (nodes && edges) {
    // vlt-lock.json: node value is `[ref, name, integrity, resolved?]`;
    // edge id is `"<ref> <name>"` and the value is
    // `"<type> <specifier> [target]"` — the manifest ask per edge is
    // the (name, specifier) pair.
    for (const [nodeId, node] of Object.entries(nodes)) {
      if (!Array.isArray(node)) continue;
      const integrity = node[2];
      if (typeof integrity === "string" && integrity !== "") {
        placements.set(nodeId, integrity);
      }
    }
    for (const [id, value] of Object.entries(edges)) {
      if (typeof value !== "string") continue;
      const name = id.includes(" ") ? id.slice(id.indexOf(" ") + 1) : id;
      const spec = value.split(" ")[1] ?? "";
      asks.push({ name, spec });
    }
    return { placements, asks };
  }
  const packages = stringMap(root["packages"]);
  if (!packages && !stringMap(root["root"])) {
    // yarn.lock and pnpm-lock.yaml are YAML; a text lockfile reaching
    // JSON.parse either threw above or is a shape this tool cannot
    // count. Say so instead of printing zeros that read as evidence.
    throw new Error(
      "unrecognized lockfile shape: expected upm.lock, vlt-lock.json or npm package-lock.json (v2/v3); YAML lockfiles are not supported",
    );
  }
  for (const [packageKey, entry] of Object.entries(packages ?? {})) {
    if (!isRecord(entry)) continue;
    const integrity = entry["integrity"];
    if (typeof integrity === "string" && integrity !== "") {
      placements.set(packageKey, integrity);
    }
    // npm package-lock v3 puts the ROOT manifest at the "" key; its
    // devDependencies are real asks.
    for (const ask of depAsks(entry, packageKey === "")) {
      asks.push(ask);
    }
  }
  for (const source of [root["root"], ...Object.values(stringMap(root["workspaces"]) ?? {})]) {
    for (const ask of depAsks(source, true)) asks.push(ask);
  }
  return { placements, asks };
}

const pct = (part: number, total: number): number => (total === 0 ? 0 : (part / total) * 100);

/** Count duplicate values in an iterable of strings. */
export function repeatCount(values: Iterable<string>): Counts {
  const seen = new Map<string, number>();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  let repeats = 0;
  for (const count of seen.values()) if (count > 1) repeats += count - 1;
  return { distinct: seen.size, total: repeats + seen.size, repeats };
}

/**
 * Aggregate repeated asks across one lockfile's dependency edges: an
 * ask repeated N times counts N-1 repeats, because one of them is the
 * read the install had to do anyway.
 */
export function specAskRepeats(inputs: PremiseInputs): Counts {
  return repeatCount(inputs.asks.map((ask) => `${ask.name} ${ask.spec}`));
}

/** Count store-entry repeats: distinct integrities vs placements. */
export function storeEntryRepeats(inputs: PremiseInputs): Counts {
  return repeatCount(inputs.placements.values());
}

/** Read one lockfile document and report both repeat patterns. */
export function premiseFor(text: string): { store: Counts; specs: Counts } {
  const inputs = premiseInputs(text);
  return {
    store: storeEntryRepeats(inputs),
    specs: specAskRepeats(inputs),
  };
}

function report(text: string, file: string): void {
  const { store, specs } = premiseFor(text);
  console.log(file);
  console.log(
    `  store entries: ${store.total} placements, ${store.distinct} distinct, ` +
      `${store.repeats} repeats (${pct(store.repeats, store.total).toFixed(1)}%)`,
  );
  console.log(
    `  spec asks:     ${specs.total} edges, ${specs.distinct} distinct, ` +
      `${specs.repeats} repeats (${pct(specs.repeats, specs.total).toFixed(1)}%)`,
  );
}

const files = process.argv.slice(2);
const entry = process.argv[1];
const isMain = entry !== undefined && fileURLToPath(import.meta.url) === entry;
if (isMain) {
  if (files.length === 0) {
    console.error("usage: node bench/premise.ts <lockfile> [more…]");
    process.exit(1);
  }
  const { readFileSync } = await import("node:fs");
  for (const file of files) {
    try {
      report(readFileSync(file, "utf8"), file);
    } catch (error) {
      console.error(`${file}: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  }
}
