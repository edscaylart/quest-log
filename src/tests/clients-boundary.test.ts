import { expect, it } from "vitest";

// #42: every Client list loads through useClients.
const sources = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/integrations/**", "!/src/hooks/clients/**", "!/src/tests/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

it("loads Clients only through useClients", () => {
  expect(Object.keys(sources)).toContain("/src/App.tsx");
  const offenders = Object.keys(sources).filter((path) => /\blistClients\b/.test(sources[path]));
  expect(offenders).toEqual([]);
});
