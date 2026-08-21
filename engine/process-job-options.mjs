export function parseProcessJobArgs(args) {
  const options = {
    url: "",
    out: "",
    debugSignals: false,
    assessMatch: false,
    signalsOnly: false,
    screenshot: "",
    workflow: "",
    allowExisting: false,
    noSave: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out") options.out = args[++index] || "";
    else if (args[index] === "--debug-signals") options.debugSignals = true;
    else if (args[index] === "--assess-match") options.assessMatch = true;
    else if (args[index] === "--signals-only") options.signalsOnly = true;
    else if (args[index] === "--screenshot") options.screenshot = args[++index] || "";
    else if (args[index] === "--workflow") options.workflow = args[++index] || "";
    else if (args[index] === "--allow-existing") options.allowExisting = true;
    else if (args[index] === "--no-save") options.noSave = true;
    else if (!args[index].startsWith("--") && !options.url) options.url = args[index];
  }
  return options;
}

export function shouldAttemptLinkedInSave(options = {}) {
  return options.noSave !== true;
}
