// Resume presentation template (layout + style), separated from the build harness.
//
// Restyle the generated resumes by editing THIS file — CSS variables, the two
// ruled variants, and the HTML skeleton. build-resume-formats.mjs only parses
// markdown and supplies the data; it does not contain layout/style.

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const renderInlineMarkdown = (value) =>
  escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

export const baseCss = `
@page { size: Letter; margin: 0.45in 0.55in; }
* { box-sizing: border-box; }
html { background: #f3f4f6; }
body { margin: 0; color: var(--ink); background: #fff; font-family: var(--body-font); font-size: var(--body-size); line-height: var(--line-height); }
.page { max-width: 8.5in; min-height: 11in; margin: 0 auto; padding: var(--page-padding); background: #fff; }
a { color: inherit; text-decoration: none; }
.top { border-bottom: var(--top-border); padding-bottom: var(--top-pad); margin-bottom: var(--section-gap); }
h1 { margin: 0; font-family: var(--heading-font); font-size: var(--name-size); line-height: 1; letter-spacing: var(--name-spacing); font-weight: var(--name-weight); color: var(--name-color); }
.positioning-title { margin-top: 7px; color: var(--accent); font-size: 10pt; line-height: 1.3; font-weight: 700; letter-spacing: 0.035em; }
.contact { margin-top: 8px; color: var(--muted); font-size: var(--contact-size); line-height: 1.5; }
.headline { margin-top: 10px; font-size: var(--headline-size); line-height: 1.36; color: var(--headline-color); font-weight: var(--headline-weight); max-width: 7.3in; }
section { margin-top: var(--section-gap); break-inside: auto; }
h2 { break-after: avoid; page-break-after: avoid; margin: 0 0 var(--h2-gap); padding-bottom: var(--h2-pad); border-bottom: var(--h2-border); font-family: var(--heading-font); color: var(--accent); font-size: var(--h2-size); line-height: 1.1; letter-spacing: var(--h2-spacing); text-transform: uppercase; font-weight: 700; }
.role { margin-top: var(--role-gap); break-inside: avoid; }
.role:first-of-type { margin-top: 0; }
.role-head { display: block; margin-bottom: 5px; }
.role-title { font-weight: 700; color: var(--ink); font-size: var(--role-title-size); }
.company { font-weight: var(--company-weight); color: var(--company-color); }
.meta { margin-top: 2px; color: var(--muted); font-size: var(--meta-size); font-style: var(--meta-style); }
ul { margin: 5px 0 0 0; padding-left: 20px; }
li { margin: var(--bullet-gap) 0; padding-left: 0; }
.project { margin-top: var(--project-gap); break-inside: avoid; }
.project:first-of-type { margin-top: 0; }
.project-name, .education-title, strong { font-weight: 700; color: var(--ink); }
.project-desc { margin-top: 3px; }
.project-links { margin-top: 3px; color: var(--muted); font-size: var(--meta-size); }
.skills { display: grid; gap: 4px; }
.skill-line strong { color: var(--ink); }
.education-item { margin-top: 8px; }
.education-meta { color: var(--muted); font-size: var(--meta-size); font-style: var(--meta-style); margin-top: 2px; }
.education-detail { margin-top: 2px; }
@media print {
  html, body { background: #fff; }
  .page { width: auto; min-height: auto; margin: 0; padding: 0; }
  a { text-decoration: none; }
}
`;

const roleTemplate = (job) =>
  `<div class="role-head"><div class="role-main"><div class="role-left"><span class="role-title">${job.role}</span><span class="company">${job.company}</span><span class="meta"> · ${job.location}</span></div><div class="role-dates">${job.dates}</div></div></div>`;

const defaultVariantCss = `
:root {
  --ink: #18282b; --muted: #526466; --accent: #236158; --name-color: #18282b; --company-color: #18282b; --headline-color: #18282b;
  --body-font: Arial, Helvetica, sans-serif; --heading-font: Arial, Helvetica, sans-serif;
  --body-size: 10pt; --line-height: 1.36; --name-size: 30pt; --name-weight: 700; --name-spacing: -1.1px;
  --contact-size: 8.6pt; --headline-size: 10.5pt; --headline-weight: 400;
  --page-padding: 0.5in; --top-border: 2px solid #236158; --top-pad: 12px; --section-gap: 12px; --project-gap: 8px;
  --h2-size: 8.4pt; --h2-spacing: 0.06em; --h2-border: 1px solid #c4d1cd; --h2-pad: 5px; --h2-gap: 8px;
  --role-gap: 8px; --role-title-size: 10.5pt; --company-weight: 400; --meta-size: 8.8pt; --meta-style: normal; --bullet-gap: 3px;
}
ul { padding-left: 20px; }
li { padding-left: 0; }
.role-head { margin-bottom: 4px; }
.role-main { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
.role-left { min-width: 0; }
.role-title { display: block; }
.company { display: inline; }
.role-dates { color: var(--muted); font-size: var(--meta-size); white-space: nowrap; }
`;

const narrowVariantCss = `${defaultVariantCss}
@page { size: Letter; margin: 0.62in; }
:root {
  --page-padding: 0.62in;
}
`;

// Build the variant list for a given output name/title; emitNarrow filters the narrow variant.
export function buildStyles(outputBaseName, resumeTitle, emitNarrow) {
  const styles = [
    {
      file: `${outputBaseName}.html`,
      label: `${resumeTitle}`,
      displayTitle: resumeTitle,
      omitSkills: false,
      css: defaultVariantCss,
      roleTemplate,
    },
    {
      file: `${outputBaseName} - Narrow.html`,
      label: `${resumeTitle} Narrow`,
      displayTitle: resumeTitle,
      omitSkills: false,
      css: narrowVariantCss,
      roleTemplate,
    },
  ];
  return emitNarrow ? styles : styles.filter((style) => !style.file.includes(" - Narrow."));
}

const renderBullets = (bullets) =>
  `<ul>${bullets.map((bullet) => `<li>${renderInlineMarkdown(bullet)}</li>`).join("")}</ul>`;

const renderSkills = (skills) => `<section>
      <h2>Skills</h2>
      <div class="skills">
        ${skills
          .map(
            (skill) =>
              `<div class="skill-line"><strong>${escapeHtml(skill.label)}:</strong> ${escapeHtml(skill.items)}</div>`,
          )
          .join("\n")}
      </div>
    </section>`;

export function renderPage(resume, style, { skillsFirst = false, displayTitle = style.displayTitle || style.label } = {}) {
  const skillsSection = style.omitSkills ? "" : renderSkills(resume.skills);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${resume.name} Resume — ${style.label}</title>
  <style>${baseCss}${style.css}</style>
</head>
<body>
  <main class="page">
    <header class="top">
      <h1>${resume.name}</h1>
      <div class="positioning-title">${escapeHtml(displayTitle)}</div>
      <div class="contact">${resume.contact.map(renderInlineMarkdown).join("<br>")}</div>
      <div class="headline">${escapeHtml(resume.headline)}</div>
    </header>

    ${skillsFirst ? skillsSection : ""}

    <section>
      <h2>Experience</h2>
      ${resume.experience
        .map(
          (job) => `<article class="role">
            ${style.roleTemplate(job)}
            ${renderBullets(job.bullets)}
          </article>`,
        )
        .join("\n")}
    </section>

    <section>
      <h2>Selected Projects</h2>
      ${resume.projects
        .map(
          (project) => `<div class="project">
        <div class="project-name">${escapeHtml(project.name)}</div>
        ${project.description ? `<div class="project-desc">${renderInlineMarkdown(project.description)}</div>` : ""}
        ${project.bullets?.length ? renderBullets(project.bullets) : ""}
        ${project.links ? `<div class="project-links">${renderInlineMarkdown(project.links)}</div>` : ""}
      </div>`,
        )
        .join("\n")}
    </section>

    ${skillsFirst ? "" : skillsSection}

    <section>
      <h2>Education</h2>
      ${resume.education
        .map(
          (edu) => `<div class="education-item">
            <div class="education-title">${escapeHtml(edu.degree)} — ${escapeHtml(edu.school)}</div>
            <div class="education-meta">${[edu.location, edu.dates].filter(Boolean).map(renderInlineMarkdown).join(" · ")}</div>
            ${edu.detail ? `<div class="education-detail">${renderInlineMarkdown(edu.detail)}</div>` : ""}
          </div>`,
        )
        .join("\n")}
    </section>
  </main>
</body>
</html>`;
}
