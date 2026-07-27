import assert from "node:assert/strict";
import { parseCompensation, extractCompensationText } from "../engine/compensation.mjs";

// Em-dash ranges with a trailing currency code (the Remote case that stored
// only "$60,000" and dropped both the upper bound and the currency).
{
  const r = parseCompensation("The annual salary range for this full-time position is\n$60,000—$135,000 USD");
  assert.equal(r.low, 60000);
  assert.equal(r.high, 135000);
  assert.equal(r.currency, "USD");
  assert.equal(r.text, "$60,000 - $135,000 USD");
}

// Hyphen and en-dash separators, and the word "to".
for (const sep of ["-", "–", "—", " to "]) {
  const r = parseCompensation(`Base pay range: $150,000${sep}$234,000 CAD`);
  assert.equal(r.low, 150000, `separator ${sep}`);
  assert.equal(r.high, 234000, `separator ${sep}`);
}

// "k" shorthand.
{
  const r = parseCompensation("Salary: $126k CAD");
  assert.equal(r.low, 126000);
  assert.equal(r.currency, "CAD");
}

// Non-dollar currencies.
{
  const r = parseCompensation("Salary range: £60,000 - £80,000");
  assert.equal(r.currency, "GBP");
  assert.equal(r.high, 80000);
}

// Hourly pay is kept but labelled, and not confused with an annual figure.
{
  const r = parseCompensation("Compensation: $40.00 per hour");
  assert.equal(r.period, "hour");
  assert.equal(r.low, 40);
  assert.equal(r.text, "$40/hr");
}

// --- Fail-closed cases: these all previously produced garbage ---

// No labelled line at all: the old code fell back to the whole body and grabbed
// the first "$" it saw.
assert.equal(extractCompensationText("We ship to 30 countries and raised $19 million last year."), "");
assert.equal(extractCompensationText("Our platform processes $2 billion in volume annually."), "");
assert.equal(extractCompensationText("Save up to $500 per year with our product."), "");

// Labelled but implausible as pay.
assert.equal(extractCompensationText("Compensation is based on experience. $19"), "");
assert.equal(extractCompensationText("Salary: $2"), "");
assert.equal(extractCompensationText("Pay range: $500 per year"), "");

// Hourly outside plausible bounds.
assert.equal(extractCompensationText("Hourly rate: $2 per hour"), "");

// Empty and malformed input.
assert.equal(extractCompensationText(""), "");
assert.equal(extractCompensationText("No pay information here."), "");
assert.equal(parseCompensation("Salary: competitive"), null);

// An inverted range is not trusted.
assert.equal(extractCompensationText("Salary range: $200,000 - $100,000"), "");

console.log("compensation parsing tests: PASS");

// --- Regressions found backfilling the real corpus (2026-07-27) ---

// Label and amount separated by intervening lines.
{
  const r = parseCompensation(
    "Vantix provides market-competitive compensation.\n" +
    "For Canadian based candidates, the base pay ranges are listed below.\n" +
    "\n$194,000—$204,500 CAD",
  );
  assert.equal(r.low, 194000);
  assert.equal(r.high, 204500);
  assert.equal(r.currency, "CAD");
}

// A labelled line with no figure must not borrow a number from nearby text
// (a posting stating only "Highly competitive salary" yielded "$401,000").
assert.equal(extractCompensationText("Highly competitive salary\n401(k) matching and equity"), "");
assert.equal(extractCompensationText("Competitive salary and benefits\nWe serve 30,000 customers"), "");

// The upper bound of a range may omit the currency symbol.
{
  const r = parseCompensation("Salary range: $95,000 - 150,000");
  assert.equal(r.low, 95000);
  assert.equal(r.high, 150000);
}

console.log("compensation regression tests: PASS");

// --- Review findings, PR #6 (2026-07-27) ---
// Each of these previously produced a CONFIDENTLY WRONG value, which is the one
// outcome this module exists to prevent.

// Decimal tails broke range matching and silently kept only the lower bound.
{
  const r = parseCompensation("Salary: $129,780.00 - $256,120.00 CAD");
  assert.equal(r.low, 129780);
  assert.equal(r.high, 256120);
  assert.equal(r.text, "$129,780 - $256,120 CAD");
}

// "CA$" prefixes must be consumed as part of the amount, and name the currency.
{
  const r = parseCompensation("Salary: CA$255.5K - CA$365K");
  assert.equal(r.low, 255500);
  assert.equal(r.high, 365000);
  assert.equal(r.currency, "CAD");
}

// Non-dollar currencies must render with their own symbol, not "$".
assert.equal(extractCompensationText("Salary range: £60,000 - £80,000"), "£60,000 - £80,000 GBP");

// The lookahead must not adopt unrelated money from a benefits list.
assert.equal(
  extractCompensationText("Salary: competitive\nBenefits\nEquity grant valued at $150,000"),
  "",
);

// A bare-number range is trusted only alongside an explicit currency code.
{
  const r = parseCompensation("The base salary range is listed below\n128,100 - 214,000 CAD annually");
  assert.equal(r.low, 128100);
  assert.equal(r.high, 214000);
}
assert.equal(extractCompensationText("The range is listed below\n128,100 - 214,000 annually"), "");

// "Pay:" is a pay label.
assert.equal(extractCompensationText("Pay: $100,000 USD"), "$100,000 USD");

console.log("compensation review-finding tests: PASS");
