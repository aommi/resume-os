import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  throw new Error("Usage: node scripts/inject-line-wrap-analyzer.mjs input.html output.html");
}

const script = `
<script>
(() => {
  function textNodesFor(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function wordPositions(text) {
    const positions = [];
    const re = /\\S+/g;
    let match;
    while ((match = re.exec(text))) {
      positions.push({ word: match[0], start: match.index, end: match.index + match[0].length });
    }
    return positions;
  }

  function lineWordsFor(el) {
    const range = document.createRange();
    const lines = [];
    const tolerance = 2;
    for (const node of textNodesFor(el)) {
      for (const pos of wordPositions(node.nodeValue)) {
        range.setStart(node, pos.start);
        range.setEnd(node, pos.end);
        const rect = range.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) continue;
        let line = lines.find((item) => Math.abs(item.top - rect.top) <= tolerance);
        if (!line) {
          line = { top: rect.top, words: [] };
          lines.push(line);
        }
        line.words.push(pos.word);
      }
    }
    range.detach();
    lines.sort((a, b) => a.top - b.top);
    return lines;
  }

  const orphans = [];
  const bullets = [];
  document.querySelectorAll("li").forEach((li, index) => {
    const lines = lineWordsFor(li);
    const last = lines[lines.length - 1];
    if (!last) return;
    bullets.push({
      index: index + 1,
      lines: lines.length,
      text: li.textContent.trim().slice(0, 80),
    });
    if (last.words.length <= 2 && lines.length > 1) {
      orphans.push({
        index: index + 1,
        lastLine: last.words.join(" "),
        lastCount: last.words.length,
        lines: lines.length,
        text: li.textContent.trim(),
      });
    }
  });

  const pre = document.createElement("pre");
  pre.id = "line-wrap-report";
  pre.textContent = "LINE_WRAP_REPORT_START\\n" + JSON.stringify({ bullets, orphans }, null, 2) + "\\nLINE_WRAP_REPORT_END";
  document.body.appendChild(pre);
})();
</script>`;

const html = readFileSync(input, "utf8").replace("</body>", `${script}\n</body>`);
writeFileSync(output, html);
