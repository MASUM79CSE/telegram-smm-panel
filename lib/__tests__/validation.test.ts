import { describe, it, expect } from "vitest";
import {
  passwordSchema,
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/lib/validation";

describe("lib/validation — passwordSchema", () => {
  it("accepts a strong password (upper, lower, digit, symbol, 10+ chars)", () => {
    expect(passwordSchema.safeParse("Str0ng!Pass").success).toBe(true);
  });

  it("rejects passwords shorter than 10 characters", () => {
    expect(passwordSchema.safeParse("Sh0rt!Pw").success).toBe(false);
  });

  it("rejects passwords over 128 characters", () => {
    const tooLong = "Aa1!" + "a".repeat(128);
    expect(passwordSchema.safeParse(tooLong).success).toBe(false);
  });

  it("rejects a password with no uppercase letter", () => {
    expect(passwordSchema.safeParse("weakpass1!").success).toBe(false);
  });

  it("rejects a password with no lowercase letter", () => {
    expect(passwordSchema.safeParse("WEAKPASS1!").success).toBe(false);
  });

  it("rejects a password with no digit", () => {
    expect(passwordSchema.safeParse("WeakPass!!").success).toBe(false);
  });

  it("rejects a password with no special character", () => {
    expect(passwordSchema.safeParse("WeakPass12").success).toBe(false);
  });
});

describe("lib/validation — registerSchema", () => {
  it("accepts a valid registration payload", () => {
    const result = registerSchema.safeParse({
      name: "Ada Lovelace",
      email: "Ada@Example.com",
      password: "Str0ng!Pass",
    });
    expect(result.success).toBe(true);
  });

  it("lowercases and trims the email", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "  Ada@EXAMPLE.com  ",
      password: "Str0ng!Pass",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("ada@example.com");
  });

  it("rejects a name shorter than 2 characters", () => {
    const result = registerSchema.safeParse({
      name: "A",
      email: "ada@example.com",
      password: "Str0ng!Pass",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "not-an-email",
      password: "Str0ng!Pass",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a weak password even with valid name/email", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "weak",
    });
    expect(result.success).toBe(false);
  });
});

describe("lib/validation — loginSchema", () => {
  it("accepts any non-empty password (login doesn't re-enforce strength policy)", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });
});

describe("lib/validation — forgotPasswordSchema / resetPasswordSchema", () => {
  it("forgotPasswordSchema requires a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });

  it("resetPasswordSchema requires a token and a strong password", () => {
    expect(
      resetPasswordSchema.safeParse({ token: "abc123", password: "Str0ng!Pass" }).success
    ).toBe(true);
    expect(resetPasswordSchema.safeParse({ token: "", password: "Str0ng!Pass" }).success).toBe(
      false
    );
    expect(resetPasswordSchema.safeParse({ token: "abc123", password: "weak" }).success).toBe(
      false
    );
  });
});
