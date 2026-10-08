import { expect, it } from "vitest";

// ADR-0002: third-party SDKs live only in integrations (and the test helpers that mock them).
const sources = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/integrations/**", "!/src/tests/support/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const sdkImport = /(?:from|import)\s*\(?\s*["'](?:@tauri-apps|@react-pdf)\//;

it("keeps Tauri and react-pdf imports inside integrations", () => {
  expect(Object.keys(sources)).toContain("/src/App.tsx");
  const offenders = Object.keys(sources).filter((path) => sdkImport.test(sources[path]));
  expect(offenders).toEqual([]);
});
