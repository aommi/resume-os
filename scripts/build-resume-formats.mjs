import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, loadProfile, fullName, variantTitles, resolveBrowserPath, resolveBase, workDir } from "../engine/config.mjs";
import { buildStyles, renderPage } from "../engine/templates/resume-template.mjs";

const config = loadConfig();
const profile = loadProfile(config);
const options = parseArgs(process.argv.slice(2));
const formatConfig = loadFormatConfig();
const baseFormatsDir = join(workDir(config), "resume-formats");
const outDir = options.outDir || (options.variant ? join(baseFormatsDir, options.variant) : baseFormatsDir);
const VARIANT_TITLES = variantTitles(config);
const resumeTitle = resolveResumeTitle();
const outputBaseName = `${fullName(profile)} - ${resumeTitle}`;
const emitNarrow = options.emitNarrow ?? formatConfig.emitNarrow ?? true;
mkdirSync(outDir, { recursive: true });

const sourcePath = resolveBase(options.source, config);
const resume = parseResumeMarkdown(readFileSync(sourcePath, "utf8"));
validateResume(resume, sourcePath);

function resolveResumeTitle() {
  if (options.resumeTitle) return options.resumeTitle;
  if (Object.prototype.hasOwnProperty.call(VARIANT_TITLES, options.variant)) {
    return VARIANT_TITLES[options.variant];
  }
  throw new Error(
    `Unknown --variant "${options.variant}"; pass an explicit --resume-title or add the variant to VARIANT_TITLES.`,
  );
}

function validateResume(parsed, sourcePath) {
  const missing = [];
  if (!parsed.name) missing.push("name (# heading)");
  if (!parsed.contact.length) missing.push("contact");
  if (!parsed.headline) missing.push("headline");
  if (!parsed.experience.length) missing.push("EXPERIENCE");
  if (!parsed.projects.length) missing.push("SELECTED PROJECTS");
  if (!parsed.skills.length) missing.push("SKILLS");
  if (!parsed.education.length) missing.push("EDUCATION");
  if (missing.length) {
    throw new Error(
      `${sourcePath}: missing ${missing.join(", ")} section${missing.length > 1 ? "s" : ""}`,
    );
  }
}

function requiredTerms() {
  return (options.requireTerms ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

function parseArgs(args) {
  const parsed = {
    source: "resume.md",
    variant: "",
    export: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--export") {
      parsed.export = true;
    } else if (arg === "--source") {
      parsed.source = args[index + 1] ?? parsed.source;
      index += 1;
    } else if (arg.startsWith("--source=")) {
      parsed.source = arg.slice("--source=".length);
    } else if (arg === "--variant") {
      parsed.variant = args[index + 1] ?? parsed.variant;
      index += 1;
    } else if (arg.startsWith("--variant=")) {
      parsed.variant = arg.slice("--variant=".length);
    } else if (arg === "--out-dir") {
      parsed.outDir = args[index + 1] ?? parsed.outDir;
      index += 1;
    } else if (arg.startsWith("--out-dir=")) {
      parsed.outDir = arg.slice("--out-dir=".length);
    } else if (arg === "--resume-title") {
      parsed.resumeTitle = args[index + 1] ?? parsed.resumeTitle;
      index += 1;
    } else if (arg.startsWith("--resume-title=")) {
      parsed.resumeTitle = arg.slice("--resume-title=".length);
    } else if (arg === "--deliver") {
      parsed.deliver = args[index + 1] ?? parsed.deliver;
      index += 1;
    } else if (arg.startsWith("--deliver=")) {
      parsed.deliver = arg.slice("--deliver=".length);
    } else if (arg === "--require-terms") {
      parsed.requireTerms = args[index + 1] ?? parsed.requireTerms;
      index += 1;
    } else if (arg.startsWith("--require-terms=")) {
      parsed.requireTerms = arg.slice("--require-terms=".length);
    } else if (arg === "--with-narrow") {
      parsed.emitNarrow = true;
    } else if (arg === "--no-narrow") {
      parsed.emitNarrow = false;
    } else if (arg === "--skills-first") {
      parsed.skillsFirst = true;
    }
  }

  return parsed;
}

function loadFormatConfig() {
  const configPath = "resume-format.config.json";
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${configPath}: ${error.message}`);
  }
}

function parseResumeMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const name = stripPrefix(lines.find((line) => line.startsWith("# ")), "# ");
  const headlineLine = lines.find((line) => line.startsWith("**") && line.endsWith("**"));
  const headline = headlineLine ? headlineLine.slice(2, -2) : "";

  const headlineIndex = lines.findIndex((line) => line === headlineLine);
  const contactLines = lines
    .slice(1, headlineIndex)
    .map((line) => line.trim())
    .filter(Boolean);
  const contact = contactLines
    .map((item) => item.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);

  const sections = sectionMap(lines);
  return {
    name,
    contact,
    headline,
    experience: parseExperience(sliceSection(lines, sections, "EXPERIENCE")),
    projects: parseProjects(sliceSection(lines, sections, "SELECTED PROJECTS")),
    skills: parseSkills(sliceSection(lines, sections, "SKILLS")),
    education: parseEducation(sliceSection(lines, sections, "EDUCATION")),
  };
}

function sectionMap(lines) {
  const sections = new Map();
  lines.forEach((line, index) => {
    const match = line.match(/^##\s+(.+)$/);
    if (match) sections.set(match[1].trim(), index);
  });
  return sections;
}

function sliceSection(lines, sections, sectionName) {
  const start = sections.get(sectionName);
  if (start === undefined) return [];
  const sectionStarts = [...sections.values()].sort((a, b) => a - b);
  const end = sectionStarts.find((index) => index > start) ?? lines.length;
  return lines.slice(start + 1, end);
}

function parseExperience(lines) {
  const jobs = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^###\s+(.+)$/);
    if (!heading) continue;

    const [role, company] = splitOnce(heading[1], " — ");
    const metaLine = stripItalics(lines[index + 1] ?? "");
    const [location, dates] = splitOnce(metaLine, " · ");
    const bullets = [];
    index += 2;

    while (index < lines.length && !lines[index].startsWith("### ")) {
      const bullet = lines[index].match(/^-\s+(.+)$/);
      if (bullet) bullets.push(cleanInline(bullet[1]));
      index += 1;
    }
    index -= 1;

    jobs.push({
      role: cleanInline(role),
      company: cleanInline(company),
      location: cleanInline(location),
      dates: cleanInline(dates),
      bullets,
    });
  }
  return jobs;
}

function parseProjects(lines) {
  const projects = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^###\s+(.+)$/);
    if (!heading) continue;

    const contentLines = [];
    index += 1;

    while (index < lines.length && !lines[index].startsWith("### ")) {
      const line = lines[index].trim();
      if (line) contentLines.push(line);
      index += 1;
    }
    index -= 1;

    const linksIndex = contentLines.findIndex((line) => /github\.com|https?:\/\//.test(line));
    const links = linksIndex === -1 ? "" : contentLines[linksIndex];
    const bodyLines = linksIndex === -1 ? contentLines : contentLines.slice(0, linksIndex);
    const bullets = bodyLines
      .filter((line) => line.startsWith("- "))
      .map((line) => cleanInline(line.slice(2)));
    const description = bodyLines.filter((line) => !line.startsWith("- ")).join(" ");

    projects.push({
      name: cleanInline(heading[1]),
      description: cleanInline(description),
      bullets,
      links: cleanInline(links),
    });
  }

  return projects;
}

function parseSkills(lines) {
  const skills = lines
    .map((line) => line.match(/^\*\*(.+?):\*\*\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      label: cleanInline(match[1]),
      items: cleanInline(match[2]),
    }));
  return skills;
}

function parseEducation(lines) {
  const education = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^###\s+(.+)$/);
    if (!heading) continue;

    const [degree, school] = splitOnce(heading[1], " — ");
    const metaLine = stripItalics(lines[index + 1] ?? "");
    const [location, dates] = splitOnce(metaLine, " · ");
    const detailLines = [];
    index += 2;

    while (index < lines.length && !lines[index].startsWith("### ")) {
      const line = lines[index].trim();
      if (line) detailLines.push(line);
      index += 1;
    }
    index -= 1;

    education.push({
      degree: cleanInline(degree),
      school: cleanInline(school),
      location: cleanInline(location),
      dates: cleanInline(dates),
      detail: cleanInline(detailLines.join(" ")),
    });
  }
  return education;
}

function splitOnce(value, separator) {
  const index = value.indexOf(separator);
  if (index === -1) return [value, ""];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function stripPrefix(value = "", prefix) {
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : "";
}

function stripItalics(value) {
  return value.trim().replace(/^\*/, "").replace(/\*$/, "").trim();
}

function cleanInline(value = "") {
  return value
    .replace(/\s{2,}/g, " ")
    .replace(/\s+$/g, "")
    .trim();
}

const stylesToBuild = buildStyles(outputBaseName, resumeTitle, emitNarrow);

for (const style of stylesToBuild) {
  writeFileSync(join(outDir, style.file), renderPage(resume, style, { skillsFirst: options.skillsFirst }));
}

const readmeFormats = stylesToBuild
  .map((style, index) => {
    const description = style.file.includes(" - Narrow.")
      ? "narrower ruled resume with larger print margins and slightly adjusted type."
      : "default ruled resume with aligned dates, company and location on the second line.";
    return `${index + 1}. \`${style.file}\` — ${description}`;
  })
  .join("\n");

const candidateFormats = stylesToBuild
  .map((style) => {
    const pdfName = style.file.replace(/\.html$/, ".pdf");
    const description = style.file.includes(" - Narrow.")
      ? "narrower candidate for more reader breathing room."
      : "default submission candidate.";
    return `- \`${pdfName}\` — ${description}`;
  })
  .join("\n");

writeFileSync(
  join(outDir, "README.md"),
  `# Resume Format Variants

These live HTML files use the same resume content with the active ruled visual treatments:

Hard rule: these are active ready-to-send general resumes, not stale exports. Keep them available for recruiter InMail, hiring events, email requests, and low-information or stretch applications where full tailoring is not warranted.

Narrow exports are ${emitNarrow ? "enabled" : "disabled"} by \`resume-format.config.json\`. Use \`--with-narrow\` or \`--no-narrow\` to override for a single build.

Skills placement: ${options.skillsFirst ? "immediately below the headline (\`--skills-first\`)" : "after Selected Projects (default)"}.

${readmeFormats}

Each file is single-column, text-based, print-ready, and avoids tables, text boxes, columns, and image-rendered text.

Current candidates:
${candidateFormats}
`,
);

let verifiedDefaultPdf = false;

if (options.export) {
  exportArtifacts(stylesToBuild);
  const absOutDir = isAbsolute(outDir) ? outDir : join(process.cwd(), outDir);
  verifyPdf(join(absOutDir, `${outputBaseName}.pdf`), requiredTerms());
  verifiedDefaultPdf = true;
}

if (options.deliver) {
  deliverArtifacts(options.deliver);
}

function deliverArtifacts(deliverDir) {
  if (!options.export) {
    throw new Error("--deliver requires --export (the PDF must be built in the same run)");
  }
  if (!existsSync(deliverDir)) {
    const alt = join(workDir(config), deliverDir);
    if (existsSync(alt)) {
      deliverDir = alt;
    } else {
      throw new Error(`--deliver target does not exist: ${deliverDir}`);
    }
  }

  const absOutDir = isAbsolute(outDir) ? outDir : join(process.cwd(), outDir);
  const builtPdf = join(absOutDir, `${outputBaseName}.pdf`);

  if (!verifiedDefaultPdf) {
    verifyPdf(builtPdf, requiredTerms());
  }

  const namedPdfTarget = join(deliverDir, `${outputBaseName} - Resume.pdf`);
  const htmlTarget = join(deliverDir, "resume.html");
  copyFileSync(builtPdf, namedPdfTarget);
  copyFileSync(join(absOutDir, `${outputBaseName}.html`), htmlTarget);
  console.log(`delivered: ${namedPdfTarget}`);
  console.log(`delivered: ${htmlTarget}`);
}

function verifyPdf(pdfPath, terms) {
  const pythonCheck = `
import sys
try:
    import pdfplumber
except ImportError:
    print("verify: SKIPPED (pdfplumber not installed; run the manual parse-check instead)")
    sys.exit(0)
pdf = pdfplumber.open(sys.argv[1])
pages = len(pdf.pages)
text = " ".join(" ".join((page.extract_text() or "").split()) for page in pdf.pages)
ok = True
if pages == 2:
    print("verify: pages=2 PASS")
else:
    print(f"verify: pages={pages} FAIL (expected 2)")
    ok = False
missing = [t for t in sys.argv[2:] if t.lower() not in text.lower()]
if sys.argv[2:]:
    if missing:
        print("verify: terms FAIL, missing: " + ", ".join(missing))
        ok = False
    else:
        print(f"verify: all {len(sys.argv[2:])} required terms parse PASS")
if len(text) < 1000:
    print(f"verify: extracted text suspiciously short ({len(text)} chars) FAIL")
    ok = False
sys.exit(0 if ok else 1)
`;
  const result = spawnSync("python3", ["-c", pythonCheck, pdfPath, ...terms], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("PDF verification failed — see verify lines above");
  }
}

function exportArtifacts(stylesToExport) {
  const chromePath = resolveBrowserPath(config);

  for (const style of stylesToExport) {
    const htmlPath = join(isAbsolute(outDir) ? outDir : join(process.cwd(), outDir), style.file);
    const baseName = style.file.replace(/\.html$/, "");

    runChrome(chromePath, [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-pdf-header-footer",
      "--print-to-pdf-no-header",
      `--print-to-pdf=${join(outDir, `${baseName}.pdf`)}`,
      pathToFileURL(htmlPath).href,
    ]);

    runChrome(chromePath, [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--window-size=1100,1450",
      `--screenshot=${join(outDir, `${baseName}.png`)}`,
      pathToFileURL(htmlPath).href,
    ]);
  }
}

function runChrome(chromePath, args) {
  const result = spawnSync(chromePath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Chrome failed with exit code ${result.status}`);
  }
}
