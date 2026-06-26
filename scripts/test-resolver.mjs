// Deterministic resolver test (zero model cost). Asserts task -> doc list,
// including the fallback route for unknown/ambiguous intent.

import assert from "node:assert";
import { resolve, knownTasks } from "../engine/resolve.mjs";

const always = ["profiles/<activeProfile>/resume-project-tracker.md"];
let pass = 0;

function expect(task, expected) {
  const got = resolve(task).load;
  assert.deepStrictEqual(
    got,
    expected,
    `route '${task}': got ${JSON.stringify(got)} != expected ${JSON.stringify(expected)}`,
  );
  pass += 1;
  console.log(`PASS  ${task.padEnd(20)} -> ${got.join(", ")}`);
}

expect("tailor", [...always, "resume-os.md", "tailoring-methodology.md", "bullet-rubric.md", "eval-rubric.md"]);
expect("score", [...always, "eval-rubric.md", "tailoring-methodology.md"]);
expect("cover_letter", [...always, "resume-os.md", "tailoring-methodology.md"]);
expect("resume_maintenance", [...always, "resume-os.md", "bullet-rubric.md"]);
expect("pipeline_status", [...always]);
expect("discover", [...always]);
// Fallback: unknown/ambiguous intent -> default route (degrades to cold-start behavior).
expect("something_unmapped", [...always, "resume-os.md", "tailoring-methodology.md"]);
assert.ok(resolve("something_unmapped").matched === false, "unknown task must be unmatched");

console.log(`\nresolver-test: ALL ${pass} PASS (known tasks: ${knownTasks.join(", ")})`);
