import { describe, expect, it } from "vitest";

import { premiseFor, repeatCount, specAskRepeats, storeEntryRepeats } from "../bench/premise.ts";

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

describe("storeEntryRepeats", () => {
  it("counts duplicate integrities as repeat store placements", () => {
    const lockfile = {
      packages: {
        "a@1.0.0": { integrity: "sha512-one" },
        "b@1.0.0": { integrity: "sha512-one" },
        "c@1.0.0": { integrity: "sha512-two" },
      },
    };
    expect(storeEntryRepeats(lockfile)).toEqual({ distinct: 2, total: 3, repeats: 1 });
  });

  it("ignores packages without an integrity", () => {
    const lockfile = {
      packages: {
        "a@1.0.0": { integrity: "sha512-one" },
        "link@1.0.0": {},
      },
    };
    expect(storeEntryRepeats(lockfile)).toEqual({ distinct: 1, total: 1, repeats: 0 });
  });
});

describe("specAskRepeats", () => {
  it("counts a spec asked by two parents as one repeat", () => {
    const lockfile = {
      root: { dependencies: { shared: "^1.0.0" } },
      workspaces: {
        app: { dependencies: { shared: "^1.0.0", other: "^2.0.0" } },
      },
      packages: {
        "other@2.0.0": { dependencies: { shared: "^1.0.0" } },
      },
    };
    // root + workspace app + transitive from other: three asks of
    // (shared, ^1.0.0) and one of (other, ^2.0.0).
    expect(specAskRepeats(lockfile)).toEqual({ distinct: 2, total: 4, repeats: 2 });
  });

  it("treats different specifiers of one name as different asks", () => {
    const lockfile = {
      root: { dependencies: { shared: "^1.0.0" } },
      workspaces: { app: { dependencies: { shared: "^2.0.0" } } },
      packages: {},
    };
    expect(specAskRepeats(lockfile)).toEqual({ distinct: 2, total: 2, repeats: 0 });
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
