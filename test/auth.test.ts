import { describe, it, expect, afterEach } from "vitest";
import { isAuthEnabled, verifyPassword } from "@/security/auth";

describe("isAuthEnabled", () => {
  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
  });

  it("is disabled when ADMIN_PASSWORD is not set", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(isAuthEnabled()).toBe(false);
  });

  it("is enabled when ADMIN_PASSWORD is set", () => {
    process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
    expect(isAuthEnabled()).toBe(true);
  });
});

describe("verifyPassword", () => {
  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
  });

  it("accepts anything when auth is disabled", async () => {
    delete process.env.ADMIN_PASSWORD;
    expect(await verifyPassword("literally anything")).toBe(true);
  });

  it("accepts the correct password", async () => {
    process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
    expect(await verifyPassword("correct-horse-battery-staple")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
    expect(await verifyPassword("wrong")).toBe(false);
  });

  it("rejects a password that differs only in length", async () => {
    process.env.ADMIN_PASSWORD = "short";
    expect(await verifyPassword("short-but-longer")).toBe(false);
  });
});
