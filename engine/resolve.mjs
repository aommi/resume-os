// Deterministic resolver: task type -> skill docs to load.
//
// Pure routing-table lookup (no model, no judgment). Reads engine/resolver.json.
// Unknown/ambiguous tasks fall back to the default route, which degrades to the
// old cold-start behavior, so the sparse resolver is never worse than the monolith.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(readFileSync(join(here, "resolver.json"), "utf8"));

export function resolve(task) {
  const routes = table.routes || {};
  const docs = Object.prototype.hasOwnProperty.call(routes, task)
    ? routes[task]
    : table.default || [];
  const always = table.always || [];
  return { task, matched: task in routes, load: [...always, ...docs] };
}

export function routeDocs(task) {
  return resolve(task).load;
}

export const knownTasks = Object.keys(table.routes || {});
