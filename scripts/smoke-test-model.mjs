import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const smokeDir = join(root, "evals", "smoke");
const casesDir = join(smokeDir, "cases");
const outputsDir = join(smokeDir, "outputs");
const models = process.argv.slice(2);
const modelNames = models.length ? models : listModels();

if (modelNames.length < 1) {
  throw new Error("No model output folders found under evals/smoke/outputs");
}

const cases = readdirSync(casesDir)
  .filter((file) => file.endsWith(".md"))
  .sort();

const results = [];
for (const caseFile of cases) {
  const casePath = join(casesDir, caseFile);
  const caseText = readFileSync(casePath, "utf8");
  const caseName = basename(caseFile, ".md");
  for (const model of modelNames) {
    const outputPath = join(outputsDir, model, caseFile);
    if (!existsSync(outputPath)) {
      results.push({
        caseName,
        model,
        status: "MISSING",
        detail: `missing outputs/${model}/${caseFile}`,
      });
      continue;
    }
    const output = readFileSync(outputPath, "utf8");
    results.push(runCase(caseName, caseText, output, model));
  }
}

printResults(results, modelNames);

const blockers = results.filter((r) => r.status === "FAIL" || r.status === "MISSING");
process.exitCode = blockers.length ? 1 : 0;

function listModels() {
  if (!existsSync(outputsDir)) return [];
  return readdirSync(outputsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function runCase(caseName, caseText, output, model) {
  const evalName = section(caseText, "Eval").toLowerCase();
  const sourceFacts = [
    section(caseText, "Source Facts"),
    section(caseText, "Source Bullet With Injected Issues"),
    section(caseText, "Skills Bank Excerpt"),
    section(caseText, "Supported / Adjacent Source Facts"),
    section(caseText, "Protected Facts"),
  ].filter(Boolean).join("\n");
  const protectedFacts = lines(section(caseText, "Protected Facts"));
  const gapTerms = lines(section(caseText, "True-Gap / Context-Only Terms"));
  const banned = [
    "responsible for",
    "helped",
    "worked on",
    "assisted",
    "utilized",
    "leveraged",
    "spearheaded",
    "synergy",
    "various",
  ];

  const failures = [];
  const reports = [];

  if (evalName.includes("strict constraint")) {
    const bullets = bulletLines(output);
    if (bullets.length !== 4) failures.push(`expected 4 bullets, got ${bullets.length}`);
    const long = bullets
      .map((bullet, index) => ({ index: index + 1, words: wordCount(bullet) }))
      .filter((item) => item.words > 22);
    if (long.length) failures.push(`bullets over 22 words: ${long.map((x) => `#${x.index}=${x.words}`).join(", ")}`);
    if (/\b(I|me|my|mine|we|our|ours)\b/i.test(output)) failures.push("first-person language found");
    const trailing = bullets.map((b, i) => ({ b, i: i + 1 })).filter(({ b }) => /[.]$/.test(stripBullet(b).trim()));
    if (trailing.length) failures.push(`trailing periods on bullets: ${trailing.map((x) => `#${x.i}`).join(", ")}`);
    compareProtectedFacts(sourceFacts, output, failures);
  } else if (evalName.includes("grounded bullet rewrite")) {
    for (const phrase of banned) {
      if (new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").test(output)) failures.push(`banned phrase: ${phrase}`);
    }
    const novel = novelTokens(sourceFacts, output);
    if (novel.length) reports.push(`novel_entities=${novel.slice(0, 12).join(", ")}${novel.length > 12 ? ` +${novel.length - 12} more` : ""}`);
  } else if (evalName.includes("minimal grammar")) {
    const bullets = bulletLines(output);
    if (bullets.length !== 1) failures.push(`expected 1 bullet, got ${bullets.length}`);
    compareProtectedFacts(sourceFacts, output, failures);
  } else if (evalName.includes("skills block")) {
    const skillBank = section(caseText, "Skills Bank Excerpt");
    const unsupported = emittedSkills(output).filter((skill) => !containsLoose(skillBank, skill));
    if (unsupported.length) failures.push(`unsupported skills: ${unsupported.slice(0, 12).join(", ")}`);
    const leaked = termsInOutput(gapTerms, output);
    if (leaked.length) failures.push(`gap/context terms in skills: ${leaked.join(", ")}`);
  } else if (evalName.includes("gap leakage")) {
    const leaked = termsInOutput(gapTerms, output);
    if (leaked.length) failures.push(`gap/context terms leaked: ${leaked.join(", ")}`);
  } else {
    reports.push(`unknown eval type: ${section(caseText, "Eval") || "missing"}`);
  }

  return {
    caseName,
    model,
    status: failures.length ? "FAIL" : "PASS",
    detail: [...failures, ...reports].join(" · ") || "ok",
  };
}

function section(text, heading) {
  const re = new RegExp(`^## ${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "m");
  return text.match(re)?.[1]?.trim() ?? "";
}

function lines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .filter((line) => !line.endsWith(":"));
}

function bulletLines(text) {
  return text.split(/\r?\n/).filter((line) => /^\s*[-*]\s+\S/.test(line));
}

function stripBullet(line) {
  return line.replace(/^\s*[-*]\s+/, "");
}

function wordCount(text) {
  return stripBullet(text).split(/\s+/).filter(Boolean).length;
}

function compareProtectedFacts(input, output, failures) {
  const inputNumbers = tokenNumbers(input);
  const outputNumbers = tokenNumbers(output);
  const addedNumbers = [...outputNumbers].filter((token) => !inputNumbers.has(token));
  if (addedNumbers.length) failures.push(`added numbers: ${addedNumbers.join(", ")}`);
  const missingNumbers = [...inputNumbers].filter((token) => !outputNumbers.has(token));
  if (missingNumbers.length) failures.push(`missing numbers: ${missingNumbers.join(", ")}`);

  const inputEntities = new Set([...capitalizedSpans(input)].map(normalizeToken));
  const addedEntities = [...capitalizedSpans(output)].filter((token) => !inputEntities.has(normalizeToken(token)));
  if (addedEntities.length) failures.push(`added protected entities: ${addedEntities.slice(0, 10).join(", ")}`);
}

function tokenNumbers(text) {
  const matches = text.match(/(?:~|\+|-)?\$?\d[\d,.]*(?:K|M|B)?\+?(?:%|h)?(?:\/week)?|\b\d+\s*(?:days?|weeks?|quarters?)\b/gi) ?? [];
  return new Set(matches.map(normalizeToken));
}

function novelTokens(input, output) {
  const allowed = new Set([...tokenNumbers(input), ...capitalizedSpans(input)].map(normalizeToken));
  const seen = new Set();
  const novel = [];
  for (const token of [...tokenNumbers(output), ...capitalizedSpans(output)]) {
    const normalized = normalizeToken(token);
    if (!allowed.has(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      novel.push(token);
    }
  }
  return novel;
}

function capitalizedSpans(text) {
  const matches = text.match(/\b[A-Z][A-Za-z0-9&+/.]*(?:[- ][A-Z][A-Za-z0-9&+/.]*)+\b/g) ?? [];
  return new Set(matches.filter((m) => !/^(Source Facts|Protected Facts|True Gap|Context Only)$/i.test(m)));
}

function emittedSkills(output) {
  const normalized = output
    .replace(/\*\*/g, "")
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[·,;|]/))
    .map((part) => part.replace(/^[-*]\s+/, "").replace(/^[^:]+:\s*/, "").trim())
    .filter(Boolean)
    .filter((part) => part.length <= 60)
    .filter((part) => !/[.!?]$/.test(part));
  return [...new Set(normalized)];
}

function termsInOutput(terms, output) {
  return terms.filter((term) => containsLoose(output, term));
}

function containsLoose(haystack, needle) {
  return normalizeText(haystack).includes(normalizeText(needle));
}

function normalizeText(text) {
  return text.toLowerCase().replace(/[–—]/g, "-").replace(/[^a-z0-9+/#.%$ -]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeToken(text) {
  return normalizeText(text).replace(/\s+/g, "");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printResults(results, modelNames) {
  const caseNames = [...new Set(results.map((r) => r.caseName))].sort();
  const widths = modelNames.map((model) =>
    Math.max(model.length, ...results.filter((r) => r.model === model).map((r) => `${r.status} ${r.detail}`.length), 20),
  );
  console.log(["case".padEnd(24), ...modelNames.map((m, i) => m.padEnd(widths[i]))].join("  "));
  console.log(["-".repeat(24), ...widths.map((w) => "-".repeat(w))].join("  "));
  for (const caseName of caseNames) {
    const cells = modelNames.map((model, i) => {
      const result = results.find((r) => r.caseName === caseName && r.model === model);
      return `${result?.status ?? "MISSING"} ${result?.detail ?? ""}`.trim().padEnd(widths[i]);
    });
    console.log([caseName.padEnd(24), ...cells].join("  "));
  }
}
