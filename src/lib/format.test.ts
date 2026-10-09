import { describe, expect, it } from "vitest";
import { entryDescription, pluralise } from "@/lib/format";

describe("pluralise", () => {
  it("uses the singular only for exactly one", () => {
    expect(pluralise(0, "entry", "entries")).toBe("entries");
    expect(pluralise(1, "entry", "entries")).toBe("entry");
    expect(pluralise(2, "entry", "entries")).toBe("entries");
  });
});

describe("entryDescription", () => {
  it("joins whichever of Project and note the entry has", () => {
    expect(entryDescription({ projectName: "Website", note: "Header" })).toBe("Website · Header");
    expect(entryDescription({ projectName: "Website", note: null })).toBe("Website");
    expect(entryDescription({ projectName: null, note: "Header" })).toBe("Header");
    expect(entryDescription({ projectName: null, note: "" })).toBe("");
  });
});
