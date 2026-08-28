import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");

function read(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

describe("WynterLabs CardVault branding", () => {
  it("uses the public product name across the visible app and setup flow", () => {
    for (const relativePath of [
      "web/index.html",
      "web/src/components/AppShell.tsx",
      "web/src/pages/HomePage.tsx",
      "api/app/mfa_service.py",
      "deploy/standalone/install.sh",
    ]) {
      expect(read(relativePath), relativePath).toContain("WynterLabs CardVault");
    }
  });

  it("keeps stable internal deployment identifiers for upgrade compatibility", () => {
    expect(read("deploy/standalone/install.sh")).toContain(
      "project_name=wynterlabs-cards-standalone",
    );
    expect(read("api/pyproject.toml")).toContain('name = "wynterlabs-cards-api"');
  });
});
