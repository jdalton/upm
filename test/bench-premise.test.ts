import { describe, expect, it } from "vitest";

import {
  premiseFor,
  premiseInputs,
  repeatCount,
  specAskRepeats,
  storeEntryRepeats,
} from "../bench/premise.ts";

describe("repeatCount", () => {
  it("counts no repeats when every value is distinct", () => {
    expect(repeatCount(["a", "b", "c"])).toEqual({ distinct: 3, total: 3, repeats: 0 });
  });

  it("counts one repeat per extra occurrence", () => {
    expect(repeatCount(["a", "a", "a", "b"])).toEqual({ distinct: 2, total: 4, repeats: 2 });
  });

  it("is empty on an empty input", () => {
    expect(repeatCount([])).toEqual({ distinct: 0, total: 0, repeats: 0 });
  });
});

describe("premiseInputs", () => {
  it("counts npm package-lock v3 root devDependencies from the empty key", () => {
    const inputs = premiseInputs(
      JSON.stringify({
        packages: {
          "": { dependencies: { prod: "^1.0.0" }, devDependencies: { types: "^2.0.0" } },
          "node_modules/prod": { integrity: "sha512-p" },
          "node_modules/types": { integrity: "sha512-t" },
        },
      }),
    );
    // prod from root deps, types from root devDeps: both real asks.
    expect(inputs.asks).toEqual([
      { name: "prod", spec: "^1.0.0" },
      { name: "types", spec: "^2.0.0" },
    ]);
    expect(inputs.placements.size).toBe(2);
  });

  it("does not count a dependency package's own devDependencies", () => {
    const inputs = premiseInputs(
      JSON.stringify({
        packages: {
          "node_modules/a": {
            integrity: "sha512-a",
            devDependencies: { buildtool: "^9.0.0" },
          },
        },
      }),
    );
    expect(inputs.asks).toEqual([]);
  });

  it("understands the vlt-lock.json node/edge shape", () => {
    const inputs = premiseInputs(
      JSON.stringify({
        nodes: {
          "~npm~a@1.0.0": ["npm", "a", "sha512-x", "https://r/a.tgz"],
          "~npm~b@1.0.0": ["npm", "b", "sha512-x", "https://r/b.tgz"],
        },
        edges: {
          "file~_d @eslint/js": "dev catalog: ~npm~@eslint+js@9.39.5",
          "file~app react": "prod ^16.8 ~npm~react@16.8.0",
        },
      }),
    );
    expect(inputs.placements.size).toBe(2);
    expect(inputs.asks).toEqual([
      { name: "@eslint/js", spec: "catalog:" },
      { name: "react", spec: "^16.8" },
    ]);
  });

  it("throws on a YAML lockfile instead of reporting zeros", () => {
    expect(() => premiseInputs("# yarn lockfile v1\n\nfoo@^1:\n")).toThrow(
      /unrecognized lockfile shape/,
    );
  });
});

describe("specAskRepeats", () => {
  it("counts a spec asked by two parents as one repeat", () => {
    const inputs = premiseInputs(
      JSON.stringify({
        root: { dependencies: { shared: "^1.0.0" } },
        workspaces: {
          app: { dependencies: { shared: "^1.0.0", other: "^2.0.0" } },
        },
        packages: {
          "other@2.0.0": { dependencies: { shared: "^1.0.0" } },
        },
      }),
    );
    // shared asked by root, app and other's edge; other asked by app.
    expect(specAskRepeats(inputs)).toEqual({ distinct: 2, total: 4, repeats: 2 });
  });

  it("counts an ask repeated across root and lockfile edges", () => {
    const inputs = premiseInputs(
      JSON.stringify({
        packages: {
          "": { devDependencies: { shared: "^1.0.0" } },
          "node_modules/a": { dependencies: { shared: "^1.0.0" } },
        },
      }),
    );
    expect(specAskRepeats(inputs)).toEqual({ distinct: 1, total: 2, repeats: 1 });
  });

  it("treats different specifiers of one name as different asks", () => {
    const inputs = premiseInputs(
      JSON.stringify({
        root: { dependencies: { shared: "^1.0.0" } },
        workspaces: { app: { dependencies: { shared: "^2.0.0" } } },
        packages: {},
      }),
    );
    expect(specAskRepeats(inputs)).toEqual({ distinct: 2, total: 2, repeats: 0 });
  });
});

describe("storeEntryRepeats", () => {
  it("counts duplicate integrities as repeat store placements", () => {
    const inputs = premiseInputs(
      JSON.stringify({
        packages: {
          "a@1.0.0": { integrity: "sha512-one" },
          "b@1.0.0": { integrity: "sha512-one" },
          "c@1.0.0": { integrity: "sha512-two" },
        },
      }),
    );
    expect(storeEntryRepeats(inputs)).toEqual({ distinct: 2, total: 3, repeats: 1 });
  });

  it("counts duplicate integrities across npm placements", () => {
    const inputs = premiseInputs(
      JSON.stringify({
        packages: {
          "node_modules/a": { integrity: "sha512-x" },
          "node_modules/b": { integrity: "sha512-x" },
        },
      }),
    );
    expect(storeEntryRepeats(inputs)).toEqual({ distinct: 1, total: 2, repeats: 1 });
  });

  it("ignores packages without an integrity", () => {
    const inputs = premiseInputs(
      JSON.stringify({
        packages: {
          "a@1.0.0": { integrity: "sha512-one" },
          "link@1.0.0": {},
        },
      }),
    );
    expect(storeEntryRepeats(inputs)).toEqual({ distinct: 1, total: 1, repeats: 0 });
  });
});

describe("premiseFor", () => {
  it("reports both patterns from one document", () => {
    const premise = premiseFor(
      JSON.stringify({
        root: { dependencies: { a: "^1.0.0" } },
        workspaces: { app: { dependencies: { a: "^1.0.0" } } },
        packages: {
          "a@1.0.0": { integrity: "sha512-x" },
          "b@1.0.0": { integrity: "sha512-x" },
        },
      }),
    );
    expect(premise.store).toEqual({ distinct: 1, total: 2, repeats: 1 });
    expect(premise.specs).toEqual({ distinct: 1, total: 2, repeats: 1 });
  });
});
