import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getDefaultProfile,
  init,
  profileDir,
  setDefaultProfile,
  status,
  sync,
  validateName,
} from "./profile.ts";

function withFixture(fn: (baseDir: string, tmpDir: string) => void): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-profile-test-"));
  try {
    const baseDir = path.join(tmpDir, "agent");
    fs.mkdirSync(path.join(baseDir, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "skills"));
    fs.writeFileSync(path.join(baseDir, "auth.json"), '{"secret":true}\n');
    fs.writeFileSync(path.join(baseDir, "settings.json"), '{"theme":"base"}\n');
    fs.writeFileSync(path.join(baseDir, "modes.json"), '{"default":true}\n');
    fs.writeFileSync(path.join(baseDir, "models.json"), "{}\n");
    fn(baseDir, tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test("validates profile names", () => {
  for (const name of ["work", "personal_1", "dev-box"]) validateName(name);

  for (const name of ["", "-bad", "../bad", "has space", "a/b", "x".repeat(65)]) {
    assert.throws(() => validateName(name));
  }
});

test("init creates local files and symlinks shared base entries", () => {
  withFixture((baseDir) => {
    const profile = init("work", baseDir);

    assert.equal(profile.dir, profileDir("work", baseDir));
    assert.equal(fs.readFileSync(path.join(profile.dir, "auth.json"), "utf8"), "{}\n");
    assert.equal(
      fs.readFileSync(path.join(profile.dir, "settings.json"), "utf8"),
      fs.readFileSync(path.join(baseDir, "settings.json"), "utf8"),
    );
    assert.equal(fs.lstatSync(path.join(profile.dir, "models.json")).isSymbolicLink(), true);
    assert.equal(
      fs.readlinkSync(path.join(profile.dir, "models.json")),
      path.join(baseDir, "models.json"),
    );
    assert.equal(fs.lstatSync(path.join(profile.dir, "extensions")).isSymbolicLink(), true);
  });
});

test("sync adds new base links and removes stale managed links", () => {
  withFixture((baseDir) => {
    const profile = init("work", baseDir);

    fs.writeFileSync(path.join(baseDir, "tools.json"), "{}\n");
    sync(profile.dir);
    assert.equal(fs.lstatSync(path.join(profile.dir, "tools.json")).isSymbolicLink(), true);

    fs.rmSync(path.join(baseDir, "tools.json"));
    sync(profile.dir);
    assert.equal(fs.existsSync(path.join(profile.dir, "tools.json")), false);
  });
});

test("sync preserves real-file overrides", () => {
  withFixture((baseDir) => {
    const profile = init("work", baseDir);
    const modelsPath = path.join(profile.dir, "models.json");

    fs.rmSync(modelsPath);
    fs.writeFileSync(modelsPath, '{"profile":true}\n');
    sync(profile.dir);

    assert.equal(fs.lstatSync(modelsPath).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(modelsPath, "utf8"), '{"profile":true}\n');
    assert.deepEqual(status(profile.dir).overrides, ["models.json"]);
  });
});

test("default profile is configurable", () => {
  withFixture((baseDir) => {
    init("work", baseDir);
    assert.equal(getDefaultProfile(baseDir), undefined);

    setDefaultProfile("work", baseDir);
    assert.equal(getDefaultProfile(baseDir), "work");
    assert.throws(() => setDefaultProfile("missing", baseDir));
  });
});
