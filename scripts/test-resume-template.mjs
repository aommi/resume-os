import assert from "node:assert/strict";
import { renderPage } from "../engine/templates/resume-template.mjs";

const resume = {
  name: "Example Candidate",
  contact: ["candidate@example.com"],
  headline: "Product leader",
  experience: [
    {
      role: "Product Manager",
      company: "Example Co.",
      location: "Remote",
      dates: "2024 - Present",
      bullets: ["Shipped a measurable workflow improvement."],
    },
  ],
  projects: [{ name: "Example Project", description: "Built a useful tool.", bullets: [], links: "" }],
  skills: [{ label: "Product", items: "Strategy" }],
  education: [{ degree: "M.Sc.", school: "Example University", location: "", dates: "", detail: "" }],
};

const style = {
  label: "Test",
  omitSkills: false,
  css: "",
  roleTemplate: (job) => `<div>${job.role}</div>`,
};

const defaultHtml = renderPage(resume, style);
assert.ok(defaultHtml.indexOf("<h2>Experience</h2>") < defaultHtml.indexOf("<h2>Skills</h2>"));

const skillsFirstHtml = renderPage(resume, style, { skillsFirst: true });
assert.ok(skillsFirstHtml.indexOf("<h2>Skills</h2>") < skillsFirstHtml.indexOf("<h2>Experience</h2>"));
assert.equal((skillsFirstHtml.match(/<h2>Skills<\/h2>/g) ?? []).length, 1);

const noSkillsHtml = renderPage(resume, { ...style, omitSkills: true }, { skillsFirst: true });
assert.equal(noSkillsHtml.includes("<h2>Skills</h2>"), false);

console.log("resume template order: PASS");
