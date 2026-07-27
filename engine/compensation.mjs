// Deterministic compensation parsing for scraped job postings.
//
// Fails closed by design: a posting that does not state pay on a labelled line
// records nothing rather than a guess. The previous behaviour scanned the whole
// job body for the first "$..." it could find, which produced values like "$2",
// "$19" and "$500 per year" from unrelated JD prose and made the field unusable
// for triage. Callers should treat "" as "not available", never as "unpaid".

const LABEL = /salary|compensation|base pay|pay range|hiring range|pay scale|annual(?:ized)? pay|per hour|hourly rate|\bpay\s*:|\/\s*(?:hr|hour)\b/i;

// "$" is ambiguous (a Vancouver posting quoting "$140,000" means CAD, a US one
// means USD), so it never implies a currency on its own — only an explicit code
// or an unambiguous symbol does. An unknown currency is reported as "" rather
// than guessed.
const SYMBOL = { "£": "GBP", "€": "EUR" };
const CODE = /\b(?:CA|US|A)?\$?\s*\b(CAD|USD|GBP|EUR|AUD)\b/i;
// "CA$" / "US$" / "A$" prefixes name the currency without using a code word.
const PREFIXED_SYMBOL = /\b(CA|US|A)\$/i;
const PREFIX_CURRENCY = { CA: "CAD", US: "USD", A: "AUD" };
const OUTPUT_SYMBOL = { GBP: "£", EUR: "€" };

// $130,000 | $130k | £60,000.50 | $129,780.00
// Digits must allow a decimal tail: stopping at "129,780" inside
// "$129,780.00 - $256,120.00" broke range matching and silently persisted the
// lower bound alone — a confidently wrong value, worse than reporting nothing.
const DIGITS = String.raw`\d[\d,]*(?:\.\d+)?`;
// The currency symbol is REQUIRED on the leading amount: allowing bare numbers
// let unrelated figures on a labelled line parse as pay (a JD stating only
// "Highly competitive salary" yielded "$401,000" from adjacent text).
// A "CA$"/"US$"/"A$" prefix must be consumed as part of the amount, or a range
// like "CA$255.5K - CA$365K" fails on its upper bound and degrades to a single.
const CURRENCY_PREFIX = String.raw`(?:\b(?:CA|US|A)\s*)?`;
const AMOUNT = String.raw`${CURRENCY_PREFIX}[$£€]\s*(${DIGITS})\s*([kK])?`;
// The upper bound of a range may omit the symbol ("$95,000 - 150,000").
const AMOUNT_BARE = String.raw`${CURRENCY_PREFIX}(?:[$£€]\s*)?(${DIGITS})\s*([kK])?`;
// A range of two bare numbers is only trusted when an explicit currency code
// sits alongside it ("128,100 - 214,000 CAD"), which is specific enough to be
// pay rather than arbitrary prose.
const RANGE_BARE = new RegExp(`(${DIGITS})\\s*([kK])?\\s*(?:[-–—]|\\bto\\b)\\s*(${DIGITS})\\s*([kK])?`);
// Accepts hyphen, en dash, em dash, or the word "to" as a range separator.
const RANGE = new RegExp(`${AMOUNT}\\s*(?:[-–—]|\\bto\\b)\\s*${AMOUNT_BARE}`);
const SINGLE = new RegExp(AMOUNT);

const HOURLY = /per\s*hour|hourly|\/\s*(?:hr|hour)\b|an\s*hour/i;

// Plausibility bounds. Anything outside these is a parse artefact, not pay.
const ANNUAL_MIN = 20000;
const ANNUAL_MAX = 2000000;
const HOURLY_MIN = 15;
const HOURLY_MAX = 500;

function toNumber(digits, kSuffix) {
  const n = Number(String(digits).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return kSuffix ? n * 1000 : n;
}

function detectCurrency(line) {
  const code = line.match(CODE);
  if (code) return code[1].toUpperCase();
  const prefixed = line.match(PREFIXED_SYMBOL);
  if (prefixed) return PREFIX_CURRENCY[prefixed[1].toUpperCase()] ?? "";
  for (const [symbol, currency] of Object.entries(SYMBOL)) {
    if (line.includes(symbol)) return currency;
  }
  return "";
}

// A continuation line is trusted only when it is essentially just the money:
// strip the amounts, currency and separators, and little should remain. Without
// this, a three-line lookahead past "Salary: competitive" happily adopted
// "Equity grant valued at $150,000" from a benefits list.
function isAmountLine(line) {
  const residue = String(line)
    .replace(/[$£€]/g, "")
    .replace(/\b(?:CAD|USD|GBP|EUR|AUD)\b/gi, "")
    .replace(/\b(?:CA|US|A)\$?/gi, "")
    .replace(/[\d,.]+\s*[kK]?/g, "")
    .replace(/(?:[-–—]|\bto\b)/g, "")
    .replace(/\b(?:per|a|an)\s*(?:year|annum|hour|hr)\b/gi, "")
    .replace(/[^\w]/g, "")
    .trim();
  return residue.length <= 12;
}

function inRange(value, period) {
  if (value === null) return false;
  return period === "hour"
    ? value >= HOURLY_MIN && value <= HOURLY_MAX
    : value >= ANNUAL_MIN && value <= ANNUAL_MAX;
}

/**
 * Parse compensation from job body text.
 *
 * Only labelled lines are considered — there is deliberately no whole-document
 * fallback. Returns null when nothing can be parsed confidently.
 *
 * @returns {{text: string, low: number, high: number, currency: string, period: "year"|"hour"}|null}
 */
export function parseCompensation(text = "") {
  const lines = String(text).split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!LABEL.test(line)) continue;

    // The amount often sits below the label rather than on it ("For Canadian
    // based candidates, the base pay ranges ... are listed below." / blank /
    // "$194,000—$204,500 CAD"). Look ahead, but only across lines that are
    // themselves essentially just an amount — see isAmountLine.
    const candidates = [line];
    for (let ahead = 1; ahead <= 3; ahead += 1) {
      const next = lines[i + ahead];
      if (next === undefined) break;
      if (!next.trim()) continue;
      if (!isAmountLine(next)) break;
      candidates.push(`${line} ${next}`);
    }
    for (const candidate of candidates) {
      const period = HOURLY.test(candidate) ? "hour" : "year";
      const currency = detectCurrency(candidate);

      const range = candidate.match(RANGE);
      if (range) {
        const low = toNumber(range[1], range[2]);
        const high = toNumber(range[3], range[4]);
        if (inRange(low, period) && inRange(high, period) && high >= low) {
          return { text: formatCompensation(low, high, currency, period), low, high, currency, period };
        }
        continue;
      }

      // Bare-number range, permitted only with an explicit currency code.
      if (currency) {
        const bare = candidate.match(RANGE_BARE);
        if (bare) {
          const low = toNumber(bare[1], bare[2]);
          const high = toNumber(bare[3], bare[4]);
          if (inRange(low, period) && inRange(high, period) && high >= low) {
            return { text: formatCompensation(low, high, currency, period), low, high, currency, period };
          }
        }
      }

      const single = candidate.match(SINGLE);
      if (single) {
        const value = toNumber(single[1], single[2]);
        if (inRange(value, period)) {
          return { text: formatCompensation(value, value, currency, period), low: value, high: value, currency, period };
        }
      }
    }
  }

  return null;
}

export function formatCompensation(low, high, currency, period) {
  const unit = period === "hour" ? "/hr" : "";
  const symbol = OUTPUT_SYMBOL[currency] ?? "$";
  const money = (n) => `${symbol}${period === "hour" ? n : n.toLocaleString("en-US")}`;
  const amount = low === high ? `${money(low)}${unit}` : `${money(low)} - ${money(high)}${unit}`;
  return currency ? `${amount} ${currency}` : amount;
}

/** Convenience wrapper: the display string, or "" when nothing is confident. */
export function extractCompensationText(text = "") {
  return parseCompensation(text)?.text ?? "";
}
