const SECRET_PATTERNS: readonly RegExp[] = [
  // PEM private key blocks
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  // AWS-style access key IDs
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Bearer tokens
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // OpenAI-style secret keys
  /\bsk-[A-Za-z0-9]{16,}\b/g,
  // GitHub personal access tokens
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  // password=/token=/apikey= style key-value pairs
  /\b(password|token|apikey|api_key|secret)\s*[=:]\s*["']?[^\s"'&]+["']?/gi,
];

export function redact(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
