import { describe, expect, it } from "vitest";
import { redact } from "../../src/core/redact.js";

describe("redact", () => {
  it("redacts AWS-style access key IDs", () => {
    const input = "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    expect(redact(input)).toBe("export AWS_ACCESS_KEY_ID=[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer abc123.def456-ghi789";
    expect(redact(input)).toBe("Authorization: [REDACTED]");
  });

  it("redacts sk-style secret keys", () => {
    const input = "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx";
    expect(redact(input)).toContain("[REDACTED]");
    expect(redact(input)).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });

  it("redacts GitHub personal access tokens", () => {
    const input = "token: ghp_abcdefghijklmnopqrstuvwxyz012345";
    expect(redact(input)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz012345");
  });

  it("redacts PEM private key blocks", () => {
    const input =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----";
    const result = redact(input);
    expect(result).toBe("[REDACTED]");
  });

  it("redacts password= key-value pairs", () => {
    const input = "curl -u admin --data password=hunter2secret http://internal";
    expect(redact(input)).not.toContain("hunter2secret");
  });

  it("redacts token= and apikey= key-value pairs", () => {
    expect(redact("token=abc123xyz")).not.toContain("abc123xyz");
    expect(redact("apikey=zzz999yyy")).not.toContain("zzz999yyy");
  });

  it("leaves ordinary text untouched", () => {
    const input = "Reading src/core/redact.ts to fix the regex.";
    expect(redact(input)).toBe(input);
  });
});
