/**
 * Redaction engine self-check. Run with `npx tsx scripts/redact-check.ts`.
 * Exits non-zero on the first failure.
 */
import {
  credentialMatches,
  detectSensitive,
  PlaceholderRestorer,
  redactText,
  restoreText,
} from "../lib/privacy/redact";

let passed = 0;
let total = 0;

function check(name: string, condition: boolean, detail?: string): void {
  total += 1;
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* 1. email + stability */
{
  const text = "Mail ada@example.com then ada@example.com again.";
  const result = redactText(text);
  check("email masked", result.text.includes("[EMAIL_1]"), result.text);
  check("same email reuses placeholder", result.text.match(/\[EMAIL_1\]/g)?.length === 2);
  check("no raw email left", !result.text.includes("ada@example.com"));
}

/* 2. Luhn */
{
  const good = "Card 4242 4242 4242 4242 on file";
  const bad = "Number 1234 5678 9012 3456 is not a card";
  check("valid card detected", redactText(good).entries.some((e) => e.kind === "card"));
  check("invalid card ignored", !redactText(bad).entries.some((e) => e.kind === "card"));
}

/* 3. IBAN */
{
  const text = "IBAN GB82 WEST 1234 5698 7654 32 please";
  check("valid IBAN detected", redactText(text).entries.some((e) => e.kind === "iban"), JSON.stringify(redactText(text).entries));
}

/* 4. private key */
{
  const text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
  const entries = redactText(text).entries;
  check("PEM key detected", entries.some((e) => e.kind === "private-key"));
  check("PEM key is a credential", entries.some((e) => e.kind === "private-key" && e.credential));
}

/* 5. credentialMatches only returns credentials */
{
  const text = "ping 10.0.0.1 or email a@b.co and password=hunter2secret";
  const creds = credentialMatches(text);
  check("credential filter", creds.length > 0 && creds.every((m) => m.credential), JSON.stringify(creds));
  check("non-credential ip not in credential list", !creds.some((m) => m.kind === "ip"));
}

/* 6. JWT */
{
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  check("JWT detected", redactText(`token ${jwt}`).entries.some((e) => e.kind === "jwt"));
}

/* 7. round trip */
{
  const text =
    "Contact ada@example.com, IP 10.0.0.1, card 4242 4242 4242 4242, key sk-abcdefghijklmnopqrstuvwx.";
  const { text: masked, entries } = redactText(text);
  check("mixed redaction changed text", masked !== text);
  check("round trip restores", restoreText(masked, entries) === text, masked);
}

/* 8. streaming split */
{
  const text = "your secret is sk-abcdefghijklmnopqrstuvwx ok";
  const { text: masked, entries } = redactText(text);
  const restorer = new PlaceholderRestorer(entries);
  const chunks = [masked.slice(0, 20), masked.slice(20, 24), masked.slice(24)];
  let out = "";
  let sawPartial = false;
  for (const chunk of chunks) {
    const piece = restorer.push(chunk);
    if (/\[[A-Z_]*$/.test(piece) || /\[SECRET_$/.test(piece)) sawPartial = true;
    out += piece;
  }
  out += restorer.flush();
  check("no partial placeholder emitted", !sawPartial, out);
  check("stream round trip restores", out === text, out);
}

/* 8b. streaming edge cases (a delta that starts with "[") */
{
  const text = "echo this back: ada@example.com";
  const { text: masked, entries } = redactText(text);
  // The provider can split the stream so a chunk is exactly the placeholder; the
  // delimiter must never be re-scanned from index 0 forever (regression: it hung).
  check("the stream carries the placeholder, not the address", masked.includes("[EMAIL_1]") && !masked.includes("ada@example.com"), masked);
  const restorer = new PlaceholderRestorer(entries);
  const chunks = ["echo", " ", "this", " ", "back:", " ", "[EMAIL_1]"];
  let out = "";
  for (const chunk of chunks) out += restorer.push(chunk);
  out += restorer.flush();
  check("placeholder arriving whole in one chunk is restored", out === text, out);
  check("no placeholder leaks to the client", !out.includes("[EMAIL_1]"), out);
}

{
  // A chunk that opens with "[" but is ordinary text must still stream through.
  const entries = [{ placeholder: "[EMAIL_1]", value: "ada@example.com", kind: "email" as const, credential: false }];
  const restorer = new PlaceholderRestorer(entries);
  const chunks = ["[draft] hello ", "[EMAIL_1]", " done"];
  let out = "";
  for (const chunk of chunks) out += restorer.push(chunk);
  out += restorer.flush();
  check("leading bracket text passes through", out === "[draft] hello ada@example.com done", out);
}

/* 9. custom terms + patterns */
{
  const byTerm = redactText("Project Nightingale ships Tuesday.", { customTerms: ["Nightingale"] });
  check("custom term masked", byTerm.text.includes("[CUSTOM_1]"));
  const byPattern = redactText("id AB-12345 done", { customPatterns: ["AB-\\d{5}"] });
  check("custom pattern masked", byPattern.text.includes("[CUSTOM_1]"));
  const bad = redactText("plain text", { customPatterns: ["("] });
  check("invalid pattern skipped", bad.text === "plain text");
}

/* 10. clean text untouched */
{
  const text = "Just an ordinary sentence with no secrets at all.";
  const result = redactText(text);
  check("clean text unchanged", result.text === text && result.entries.length === 0);
  check("detectSensitive clean", detectSensitive(text).length === 0);
}

console.log(`\n${passed === total ? "PASS" : "FAIL"} ${passed}/${total}`);
if (passed !== total) process.exit(1);
