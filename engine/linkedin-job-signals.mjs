const TOP_APPLICANT_CLAIM = /^(?:you(?:'d| would) be|you(?:'re| are)) (?:a )?top applicant(?:\s*[-–—]\s*.+)?[.!]?$/i;

export function classifyTopApplicantEvidence({
  detailFound = false,
  currentJobId = "",
  candidates = [],
} = {}) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate.text);
    if (!isTopApplicantClaim(text)) continue;

    const linkedJobIds = (candidate.linkedJobIds || []).map(String).filter(Boolean);
    const pointsToAnotherJob = linkedJobIds.some((jobId) => jobId !== String(currentJobId));
    if (candidate.inRecommendationRegion || pointsToAnotherJob) continue;

    return {
      value: true,
      status: "confirmed",
      text,
      method: "visible_target_job_claim",
    };
  }

  if (!detailFound) {
    return {
      value: null,
      status: "unknown",
      text: "",
      method: "job_detail_not_verified",
    };
  }

  return {
    value: false,
    status: "not_shown",
    text: "",
    method: "verified_job_detail_no_claim",
  };
}

export async function readLinkedInJobSignals(
  page,
  url,
  observedAt = new Date(),
  { requestMatchDetails = false } = {},
) {
  const currentJobId = extractLinkedInJobId(url);
  let matchDetailsRequested = false;
  let matchDetailsError = "";
  let matchAccessibilityText = "";
  if (requestMatchDetails) {
    try {
      const matchDetailsButton = page.getByText(/^show match details$/i, { exact: true }).first();
      await matchDetailsButton.waitFor({ state: "visible", timeout: 5_000 });
      if (await matchDetailsButton.isVisible()) {
        await matchDetailsButton.click({ force: true });
        matchDetailsRequested = true;
        let outcomeRendered = false;
        const deadline = Date.now() + 55_000;
        const cdpSession = await page.context().newCDPSession(page).catch(() => null);
        while (!outcomeRendered && Date.now() < deadline) {
          if (cdpSession) {
            const tree = await cdpSession.send("Accessibility.getFullAXTree").catch(() => ({ nodes: [] }));
            const text = tree.nodes
              .map((node) => node.name?.value || node.value?.value || "")
              .filter(Boolean)
              .join("\n");
            if (/matches \d+ of (?:the )?\d+ required qualifications/i.test(text)) {
              matchAccessibilityText = text;
              outcomeRendered = true;
            }
          }
          for (const frame of page.frames()) {
            const text = await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
            if (/matches \d+ of (?:the )?\d+ required qualifications/i.test(text)) {
              outcomeRendered = true;
              break;
            }
          }
          if (!outcomeRendered) await page.waitForTimeout(1_000);
        }
        await cdpSession?.detach().catch(() => {});
        await page.waitForTimeout(1_000);
      }
    } catch (error) {
      matchDetailsError = error.message;
    }
    const viewport = page.viewportSize() || { width: 1920, height: 1080 };
    await page.mouse.click(viewport.width - 240, Math.min(320, viewport.height / 3));
    await page.keyboard.press("Home");
    await page.mouse.wheel(0, -20_000);
    await page.evaluate(async () => {
      const rightPanelElements = [...document.querySelectorAll("body *")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= window.innerWidth * 0.62 &&
            rect.width >= 250 &&
            rect.height >= 250 &&
            element.scrollHeight > element.clientHeight + 100;
        });
      for (const element of rightPanelElements) element.style.overflowAnchor = "none";
      for (let index = 0; index < 30; index += 1) {
        for (const element of rightPanelElements) element.scrollTop = 0;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });
    await page.waitForTimeout(1_000);
  }
  const evidence = await page.evaluate(({ currentJobId }) => {
    const detailRoot = document.querySelector([
      ".jobs-search__job-details--container",
      ".scaffold-layout__detail",
      ".jobs-details",
      "main",
    ].join(", ")) || document.body;
    const topCard = document.querySelector([
      ".job-details-jobs-unified-top-card__container--two-pane",
      ".job-details-jobs-unified-top-card__container--one-pane",
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card",
      ".jobs-details-top-card",
    ].join(", "));

    const detailText = (detailRoot?.innerText || detailRoot?.textContent || "").replace(/\s+/g, " ");
    const signalRoot = document.body || detailRoot;
    const aboutJobIndex = detailText.search(/\bAbout the job\b/i);
    const detailFound = Boolean(
      detailRoot &&
      !/sign in|join linkedin/i.test(document.title || "") &&
      (topCard || detailRoot.querySelector("h1, h2") || aboutJobIndex >= 0)
    );
    const candidates = [];

    if (signalRoot) {
      const elements = signalRoot.querySelectorAll("span, p, div, li, [aria-label]");
      for (const element of elements) {
        const visibleText = element.innerText || element.textContent || "";
        const ariaText = element.getAttribute?.("aria-label") || "";
        const text = `${visibleText} ${ariaText}`.replace(/\s+/g, " ").trim();
        if (!/top applicant/i.test(text)) continue;

        const childContainsClaim = [...element.children].some((child) =>
          /top applicant/i.test(child.innerText || child.textContent || "")
        );
        if (childContainsClaim) continue;

        const card = element.closest([
          "li",
          "[data-job-id]",
          ".job-card-container",
          ".jobs-search-results__list-item",
        ].join(", "));
        const linkScope = card || element;
        const linkedJobIds = [...linkScope.querySelectorAll('a[href*="/jobs/view/"]')]
          .map((link) => (link.getAttribute("href") || "").match(/\/jobs\/view\/(\d+)/)?.[1] || "")
          .filter(Boolean);

        let inRecommendationRegion = false;
        for (let ancestor = element; ancestor && ancestor !== signalRoot; ancestor = ancestor.parentElement) {
          const marker = [ancestor.className, ancestor.id, ancestor.getAttribute?.("aria-label")]
            .filter((value) => typeof value === "string")
            .join(" ");
          if (/similar|recommend|more-jobs|job-card-container|search-results/i.test(marker)) {
            inRecommendationRegion = true;
            break;
          }
        }

        candidates.push({ text, linkedJobIds, inRecommendationRegion });
      }
    }

    let postedTimeAgo = "";
    let postedAtDirect = "";
    if (topCard) {
      const time = topCard.querySelector("time[datetime]");
      postedAtDirect = time?.getAttribute("datetime") || "";
    }
    const postingHeaderText = topCard
      ? (topCard.innerText || topCard.textContent || "").replace(/\s+/g, " ")
      : aboutJobIndex >= 0
        ? detailText.slice(0, aboutJobIndex)
        : "";
    if (postingHeaderText) {
      const timeMatch = postingHeaderText.match(
        /(?:reposted\s+)?(just now|\d+\s+(?:minute|hour|day|week|month)s?\s+ago|\d+[dhm]\s+ago)/i,
      );
      postedTimeAgo = timeMatch?.[1] || "";
    }

    const signalText = (signalRoot?.innerText || signalRoot?.textContent || "");
    const matchDetailsControl = [...document.querySelectorAll("button, a, div, span")]
      .find((element) => /^show match details$/i.test((element.innerText || element.textContent || "").trim()));
    let matchPanel = matchDetailsControl;
    while (matchPanel?.parentElement) {
      const parentText = matchPanel.parentElement.innerText || matchPanel.parentElement.textContent || "";
      if (/premium/i.test(parentText) && parentText.length >= 300) matchPanel = matchPanel.parentElement;
      else if (matchPanel !== matchDetailsControl) break;
      else matchPanel = matchPanel.parentElement;
    }
    const matchPanelText = (matchPanel?.innerText || matchPanel?.textContent || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 12_000);
    const signalTextMatches = [...new Set(
      signalText
        .split(/\n|(?<=[.!?])\s+/)
        .map((text) => text.trim())
        .filter((text) => /top applicant|job match|match is (?:high|medium|low)/i.test(text))
        .slice(0, 20)
    )];
    const rightPanelText = [...new Set([
      ...document.elementsFromPoint(window.innerWidth - 200, 320),
      ...document.elementsFromPoint(window.innerWidth - 200, 600),
      ...document.elementsFromPoint(window.innerWidth - 350, 320),
    ])]
      .map((element) => (element.innerText || element.textContent || "").replace(/\n{3,}/g, "\n\n").trim())
      .filter((text) => /premium/i.test(text) && /match|qualification|applicant/i.test(text))
      .sort((a, b) => b.length - a.length)[0]
      ?.slice(0, 12_000) || "";

    return {
      candidates,
      detailFound,
      matchAssessmentAvailable: Boolean(matchDetailsControl),
      matchPanelText,
      rightPanelText,
      postedAtDirect,
      postedTimeAgo,
      signalTextMatches,
    };
  }, { currentJobId });

  const renderedPanelTexts = [];
  if (requestMatchDetails) {
    if (matchAccessibilityText) renderedPanelTexts.push(matchAccessibilityText);
    for (const frame of page.frames()) {
      try {
        const text = await frame.locator("body").innerText({ timeout: 2_000 });
        if (/top applicant|job match|required qualifications/i.test(text)) {
          renderedPanelTexts.push(text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 12_000));
        }
      } catch {}
    }
    if (evidence.rightPanelText) renderedPanelTexts.push(evidence.rightPanelText);
  }
  const renderedMatchText = [...new Set(renderedPanelTexts.map(extractCompletedAssessment).filter(Boolean))]
    .sort((a, b) => b.length - a.length)[0] || "";
  const renderedTopApplicantClaim = renderedMatchText
    .split("\n")
    .map(normalizeText)
    .find(isTopApplicantClaim) || "";
  if (renderedTopApplicantClaim) {
    evidence.candidates.unshift({
      text: renderedTopApplicantClaim,
      linkedJobIds: [],
      inRecommendationRegion: false,
    });
  }
  const jobMatchLevel = detectJobMatchLevel(renderedMatchText, renderedTopApplicantClaim);
  const requiredQualifications = parseRequiredQualifications(renderedMatchText);

  let topApplicant = classifyTopApplicantEvidence({
    detailFound: evidence.detailFound,
    currentJobId,
    candidates: evidence.candidates,
  });
  if (topApplicant.value === false && jobMatchLevel && jobMatchLevel !== "top_applicant") {
    topApplicant = {
      value: false,
      status: "not_shown",
      text: `Job match is ${jobMatchLevel}`,
      method: "completed_match_assessment",
    };
  } else if (topApplicant.value === false && evidence.matchAssessmentAvailable) {
    topApplicant = {
      value: null,
      status: "unknown",
      text: "",
      method: requestMatchDetails
        ? "match_details_outcome_not_captured"
        : "match_details_not_requested",
    };
  }
  const postedAt = normalizeDirectDate(evidence.postedAtDirect) ||
    parsePostedTimeAgo(evidence.postedTimeAgo, observedAt);

  return {
    topApplicant: topApplicant.value,
    topApplicantSignal: {
      status: topApplicant.status,
      text: topApplicant.text,
      method: topApplicant.method,
      observedAt: observedAt.toISOString(),
    },
    jobMatchLevel,
    requiredQualifications,
    postedAt,
    postedTimeAgo: evidence.postedTimeAgo,
    diagnostics: {
      detailFound: evidence.detailFound,
      currentJobId,
      matchAssessmentAvailable: evidence.matchAssessmentAvailable,
      candidateCount: evidence.candidates.length,
      candidates: evidence.candidates,
      matchPanelText: evidence.matchPanelText,
      renderedMatchText,
      signalTextMatches: evidence.signalTextMatches,
      matchDetailsRequested,
      matchDetailsError,
    },
  };
}

export function parsePostedTimeAgo(text, now = new Date()) {
  if (!text) return "";
  const normalized = normalizeText(text).replace(/^reposted\s+/i, "");
  if (/^just now$/i.test(normalized)) return now.toISOString().slice(0, 10);

  const match = normalized.match(/^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/i) ||
    normalized.match(/^(\d+)([dhm])\s+ago$/i);
  if (!match) return "";

  const amount = Number(match[1]);
  let unit = match[2].toLowerCase();
  if (unit === "d") unit = "day";
  if (unit === "h") unit = "hour";
  if (unit === "m") unit = "minute";
  const milliseconds = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
  }[unit];
  if (!milliseconds) return "";
  return new Date(now.getTime() - amount * milliseconds).toISOString().slice(0, 10);
}

function isTopApplicantClaim(text) {
  return TOP_APPLICANT_CLAIM.test(text) || /^top applicant[.!]?$/i.test(text);
}

function detectJobMatchLevel(text, topApplicantClaim = "") {
  if (topApplicantClaim) return "top_applicant";
  const normalized = normalizeText(text);
  const match = normalized.match(/\bjob match is (high|medium|low)\b/i) ||
    normalized.match(/\b(high|medium|low) (?:job )?match\b/i);
  return match?.[1]?.toLowerCase() || null;
}

function parseRequiredQualifications(text) {
  const match = String(text).match(/matches\s+(\d+)\s+of\s+(?:the\s+)?(\d+)\s+required qualifications/i);
  return match ? { matched: Number(match[1]), total: Number(match[2]) } : null;
}

function extractCompletedAssessment(text) {
  const source = String(text);
  const required = /matches\s+\d+\s+of\s+(?:the\s+)?\d+\s+required qualifications/i.exec(source);
  if (!required) return "";
  const prefix = source.slice(0, required.index);
  const headlines = [...prefix.matchAll(
    /(?:you(?:'d|’d| would) be (?:a )?top applicant|you(?:'re|’re| are) (?:a )?top applicant|job match is (?:high|medium|low)|(?:high|medium|low) (?:job )?match)/gi,
  )];
  const start = headlines.at(-1)?.index ?? Math.max(0, required.index - 1_500);
  return source.slice(start, Math.min(source.length, required.index + 6_000)).trim();
}

function extractLinkedInJobId(url) {
  return String(url || "").match(/\/jobs\/view\/(\d+)/)?.[1] || "";
}

function normalizeDirectDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizeText(value = "") {
  return String(value).replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}
