(() => {
  "use strict";

  const APP_VERSION = "2.0.0";
  const STORAGE_KEY = "focus-tracker-state-v1";
  const PRE_V2_BACKUP_KEY = "focus-tracker-pre-v2-backup";
  const RECOVERY_DB = "focus-tracker-recovery-v2";
  const RECOVERY_STORE = "snapshots";
  const RECOVERY_FALLBACK_KEY = "focus-tracker-recovery-fallback";
  const DAY_MS = 86400000;
  const DEFAULT_THEMES = [
    { id: "health", name: "Health", icon: "♡", colour: "green", builtIn: true },
    { id: "personal", name: "Personal", icon: "○", colour: "plum", builtIn: true },
    { id: "work", name: "Work", icon: "▣", colour: "blue", builtIn: true }
  ];
  const STATUS = {
    complete: { label: "Complete", score: 1.08 },
    comfortable: { label: "Comfortable", score: 1 },
    recoverable: { label: "Recoverable", score: .76 },
    attention: { label: "Needs attention", score: .42 },
    risk: { label: "At risk", score: .12 }
  };

  let deferredInstallPrompt = null;
  let toastTimer = null;
  let state;
  let recoveryAvailable = true;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function localISO(date = new Date()) {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function parseISO(value) { return new Date(`${value}T12:00:00`); }
  function addDaysISO(dateString, days) { const date = parseISO(dateString); date.setDate(date.getDate() + days); return localISO(date); }
  function addMonthsISO(dateString, months) { const date = parseISO(dateString); date.setMonth(date.getMonth() + months); date.setDate(date.getDate() - 1); return localISO(date); }
  function uid(prefix = "id") { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function daysInclusive(start, end) { return Math.max(1, Math.round((parseISO(end) - parseISO(start)) / DAY_MS) + 1); }
  function clamp(number, min, max) { return Math.min(Math.max(number, min), max); }
  function round1(number) { return Math.round((number + Number.EPSILON) * 10) / 10; }
  function deepClone(value) { return JSON.parse(JSON.stringify(value)); }
  function formatDate(dateString, options = { day: "numeric", month: "short", year: "numeric" }) { return parseISO(dateString).toLocaleDateString("en-GB", options); }
  function plural(number, singular, pluralWord = `${singular}s`) { return `${number} ${number === 1 ? singular : pluralWord}`; }
  function escapeHTML(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  function titleCase(value) { return String(value).replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase()); }
  function joinNames(names) { if (names.length <= 1) return names[0] || ""; if (names.length === 2) return `${names[0]} and ${names[1]}`; return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`; }

  function defaultState() {
    const start = localISO();
    return {
      version: 2,
      appVersion: APP_VERSION,
      currentFocus: { id: uid("focus"), name: "My 90-day focus", start, end: addMonthsISO(start, 3) },
      focusHistory: [],
      themes: deepClone(DEFAULT_THEMES),
      targets: [
        { id: uid("target"), name: "Floss", emoji: "🦷", themeId: "health", goalMode: "frequency", goalValue: 7, frequencyUnit: "week", briefingMode: "auto", active: true, createdAt: start },
        { id: uid("target"), name: "Physio", emoji: "◒", themeId: "health", goalMode: "frequency", goalValue: 4, frequencyUnit: "week", briefingMode: "auto", active: true, createdAt: start },
        { id: uid("target"), name: "Good eating days", emoji: "♨", themeId: "health", goalMode: "frequency", goalValue: 5, frequencyUnit: "week", briefingMode: "auto", active: true, createdAt: start },
        { id: uid("target"), name: "Exercise", emoji: "⚽", themeId: "health", goalMode: "frequency", goalValue: 3, frequencyUnit: "week", briefingMode: "auto", active: true, createdAt: start }
      ],
      events: [],
      contextEntries: [],
      settings: { briefingThreshold: 10, contextEnabled: true, analysisTargetId: "" },
      meta: { migratedAt: null, lastExportAt: null, persistentStorage: null }
    };
  }

  function inferTheme(name = "") {
    const text = name.toLowerCase();
    if (/meeting|work|brief|patent|presentation|career|email/.test(text)) return "work";
    if (/parent|family|flower|card|friend|date|catherine|personal/.test(text)) return "personal";
    return "health";
  }

  function migrateState(candidate) {
    if (!candidate || typeof candidate !== "object") throw new Error("Backup is not valid.");
    if (!candidate.currentFocus || !Array.isArray(candidate.targets) || !Array.isArray(candidate.events)) throw new Error("Backup is missing required information.");

    if (Number(candidate.version) >= 2) {
      const migrated = deepClone(candidate);
      migrated.version = 2;
      migrated.appVersion = APP_VERSION;
      migrated.focusHistory = Array.isArray(migrated.focusHistory) ? migrated.focusHistory : [];
      migrated.themes = Array.isArray(migrated.themes) && migrated.themes.length ? migrated.themes : deepClone(DEFAULT_THEMES);
      DEFAULT_THEMES.forEach(theme => { if (!migrated.themes.some(item => item.id === theme.id)) migrated.themes.push(deepClone(theme)); });
      migrated.targets = migrated.targets.map(target => ({
        briefingMode: "auto", active: true, frequencyUnit: "week", themeId: inferTheme(target.name), createdAt: localISO(), ...target,
        goalMode: target.goalMode === "weekly" ? "frequency" : target.goalMode
      }));
      migrated.contextEntries = Array.isArray(migrated.contextEntries) ? migrated.contextEntries : [];
      migrated.settings = { briefingThreshold: 10, contextEnabled: true, analysisTargetId: "", ...(migrated.settings || {}) };
      migrated.meta = { migratedAt: null, lastExportAt: null, persistentStorage: null, ...(migrated.meta || {}) };
      return migrated;
    }

    if (!localStorage.getItem(PRE_V2_BACKUP_KEY)) localStorage.setItem(PRE_V2_BACKUP_KEY, JSON.stringify(candidate));
    const now = new Date().toISOString();
    return {
      version: 2,
      appVersion: APP_VERSION,
      currentFocus: deepClone(candidate.currentFocus),
      focusHistory: Array.isArray(candidate.focusHistory) ? deepClone(candidate.focusHistory) : [],
      themes: deepClone(DEFAULT_THEMES),
      targets: candidate.targets.map(target => ({
        id: target.id || uid("target"),
        name: target.name || "Untitled target",
        emoji: target.emoji || "✓",
        themeId: inferTheme(target.name),
        goalMode: target.goalMode === "weekly" ? "frequency" : "period",
        goalValue: Number(target.goalValue) || 1,
        frequencyUnit: "week",
        briefingMode: "auto",
        active: target.active !== false,
        createdAt: target.createdAt || candidate.currentFocus.start || localISO()
      })),
      events: deepClone(candidate.events),
      contextEntries: [],
      settings: { briefingThreshold: 10, contextEnabled: true, analysisTargetId: "" },
      meta: { migratedAt: now, lastExportAt: null, persistentStorage: null }
    };
  }

  function loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const loaded = stored ? migrateState(JSON.parse(stored)) : defaultState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
      return loaded;
    } catch (error) {
      console.error(error);
      return defaultState();
    }
  }

  function saveState(message = "") {
    state.appVersion = APP_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
    if (message) showToast(message);
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
  }

  function focusMetrics(focus = state.currentFocus) {
    const today = localISO();
    const totalDays = daysInclusive(focus.start, focus.end);
    const before = today < focus.start;
    const after = today > focus.end;
    const elapsedDays = before ? 0 : after ? totalDays : daysInclusive(focus.start, today);
    const availableDays = before ? totalDays : after ? 0 : daysInclusive(today, focus.end);
    return { today, totalDays, elapsedDays, availableDays, daysLeft: availableDays, before, after };
  }

  function targetGoal(target, focus = state.currentFocus) {
    if (target.goalMode === "period") return Math.max(1, Math.round(Number(target.goalValue) || 1));
    const totalDays = daysInclusive(focus.start, focus.end);
    const value = Number(target.goalValue) || 0;
    const divisor = target.frequencyUnit === "day" ? 1 : target.frequencyUnit === "month" ? 30.4375 : 7;
    return Math.max(1, Math.ceil(value * totalDays / divisor));
  }

  function targetOriginalRate(target, focus = state.currentFocus) { return targetGoal(target, focus) / daysInclusive(focus.start, focus.end) * 7; }
  function entriesForTarget(targetId, start, end) { return state.events.filter(event => event.targetId === targetId && event.date >= start && event.date <= end); }
  function countForTarget(targetId, start, end) { return entriesForTarget(targetId, start, end).length; }

  function targetMetrics(target, focus = state.currentFocus) {
    const fm = focusMetrics(focus);
    const goal = targetGoal(target, focus);
    const count = countForTarget(target.id, focus.start, focus.end);
    const remaining = Math.max(goal - count, 0);
    const originalRate = targetOriginalRate(target, focus);
    const requiredRate = remaining === 0 ? 0 : fm.availableDays > 0 ? remaining / fm.availableDays * 7 : remaining;
    const paceRatio = originalRate > 0 ? requiredRate / originalRate : 0;
    let statusKey = "comfortable";
    if (remaining === 0) statusKey = "complete";
    else if (fm.availableDays === 0) statusKey = "risk";
    else if (paceRatio <= 1.05) statusKey = "comfortable";
    else if (paceRatio <= 1.25) statusKey = "recoverable";
    else if (paceRatio <= 1.6) statusKey = "attention";
    else statusKey = "risk";
    const nextRatio = fm.availableDays > 1 && remaining > 0 ? (remaining / (fm.availableDays - 1) * 7) / originalRate : Infinity;
    const closeToSlip = ["comfortable", "recoverable"].includes(statusKey) && nextRatio > 1.25;
    const expected = goal * fm.elapsedDays / fm.totalDays;
    return { ...fm, goal, count, remaining, originalRate, requiredRate, paceRatio, statusKey, status: STATUS[statusKey], closeToSlip, expected, progress: clamp(Math.round(count / goal * 100), 0, 100) };
  }

  function themeFor(target) { return state.themes.find(theme => theme.id === target.themeId) || state.themes[0] || DEFAULT_THEMES[0]; }
  function themeTargets(themeId, activeOnly = true) { return state.targets.filter(target => target.themeId === themeId && (!activeOnly || target.active)); }
  function themeAssessment(theme) {
    const targets = themeTargets(theme.id);
    if (!targets.length) return { score: 1, key: "empty", label: "No active targets" };
    const score = targets.reduce((sum, target) => sum + targetMetrics(target).status.score, 0) / targets.length;
    if (score >= .9) return { score, key: "strong", label: "looking strong" };
    if (score >= .67) return { score, key: "steady", label: "broadly on track" };
    if (score >= .4) return { score, key: "work", label: "needs some work" };
    return { score, key: "attention", label: "needs attention" };
  }

  function briefingEligible(target, metrics) {
    if (target.briefingMode === "never") return false;
    if (target.briefingMode === "always") return true;
    if (metrics.goal >= Number(state.settings.briefingThreshold || 10)) return true;
    const urgentWindow = Math.max(7, Math.round(metrics.totalDays * .18));
    return ["attention", "risk"].includes(metrics.statusKey) && metrics.daysLeft <= urgentWindow;
  }

  function lowerName(target) { return target.name ? target.name.charAt(0).toLowerCase() + target.name.slice(1) : "this target"; }

  function buildBriefing() {
    const activeThemes = state.themes.filter(theme => themeTargets(theme.id).length);
    const assessments = activeThemes.map(theme => ({ theme, ...themeAssessment(theme) }));
    const strong = assessments.filter(item => item.key === "strong").map(item => item.theme.name);
    const weak = assessments.filter(item => ["work", "attention"].includes(item.key)).map(item => item.theme.name);
    const steady = assessments.filter(item => item.key === "steady").map(item => item.theme.name);

    let headline = "Your focus is taking shape.";
    if (strong.length && weak.length) headline = `${joinNames(strong)} ${strong.length === 1 ? "is" : "are"} looking strong. ${joinNames(weak)} ${weak.length === 1 ? "needs" : "need"} some work.`;
    else if (strong.length === assessments.length && strong.length) headline = `${strong.length === 1 ? strong[0] + " is" : "Everything is"} looking strong.`;
    else if (strong.length) headline = `${joinNames(strong)} ${strong.length === 1 ? "is" : "are"} looking strong. The rest is broadly recoverable.`;
    else if (weak.length) headline = `${joinNames(weak)} ${weak.length === 1 ? "needs" : "need"} some attention, but the period is still recoverable.`;
    else if (steady.length) headline = "You are broadly on track across your themes.";

    const eligible = state.targets.filter(target => target.active).map(target => ({ target, metrics: targetMetrics(target) })).filter(item => briefingEligible(item.target, item.metrics));
    const praise = eligible.filter(item => ["complete", "comfortable"].includes(item.metrics.statusKey) && item.metrics.count > 0).sort((a, b) => (b.metrics.count - b.metrics.expected) - (a.metrics.count - a.metrics.expected)).slice(0, 2);
    const warnings = eligible.filter(item => item.metrics.remaining > 0).sort((a, b) => STATUS[a.metrics.statusKey].score - STATUS[b.metrics.statusKey].score || b.metrics.paceRatio - a.metrics.paceRatio);

    const sentences = [];
    if (praise.length) sentences.push(`You’re nailing ${joinNames(praise.map(item => lowerName(item.target)))}.`);
    const warning = warnings.find(item => ["risk", "attention"].includes(item.metrics.statusKey)) || warnings.find(item => item.metrics.closeToSlip) || warnings.find(item => item.metrics.statusKey === "recoverable");
    if (warning) {
      const name = warning.target.name;
      const pace = round1(warning.metrics.requiredRate);
      if (warning.metrics.statusKey === "risk") sentences.push(`${name} is at risk and now needs ${pace} per week from now.`);
      else if (warning.metrics.statusKey === "attention") sentences.push(`${name} needs attention: ${pace} per week from now.`);
      else if (warning.metrics.closeToSlip) sentences.push(`${name} is on track, but close to slipping behind.`);
      else sentences.push(`${name} remains recoverable at ${pace} per week from now.`);
    }
    if (!sentences.length) sentences.push("Keep logging and the briefing will become more specific.");
    return { headline, detail: sentences.join(" "), assessments };
  }

  function statusClass(key) { return ["recoverable", "attention", "risk", "complete"].includes(key) ? key : ""; }
  function goalDescription(target, focus = state.currentFocus) {
    const total = targetGoal(target, focus);
    if (target.goalMode === "period") return `${total} across this focus`;
    const unit = target.frequencyUnit || "week";
    return `${target.goalValue}/${unit} · ${total} across this focus`;
  }

  function renderBriefing() {
    const briefing = buildBriefing();
    const fm = focusMetrics();
    const activeTargets = state.targets.filter(target => target.active);
    const onPace = activeTargets.filter(target => ["complete", "comfortable"].includes(targetMetrics(target).statusKey)).length;
    const focusEvents = state.events.filter(event => event.date >= state.currentFocus.start && event.date <= state.currentFocus.end).length;
    const ringItems = briefing.assessments.slice(0, 3);
    const colours = { green: "#6f9465", plum: "#9c6d80", blue: "#6688ad", amber: "#b7853c", teal: "#5e918d", slate: "#778088" };
    const rings = ringItems.map((item, index) => {
      const inset = index * 17;
      const progress = `${clamp(Math.round(item.score * 100), 7, 100)}%`;
      return `<span class="ring" style="--inset:${inset}px;--progress:${progress};--ring-colour:${colours[item.theme.colour] || colours.green}"></span>`;
    }).join("");
    $("#briefingCard").innerHTML = `<article class="briefing-card">
      <div class="rings" aria-hidden="true">${rings}<span class="ring-centre">✦</span></div>
      <div class="briefing-copy">
        <h2>${escapeHTML(briefing.headline)}</h2>
        <p>${escapeHTML(briefing.detail)}</p>
        <div class="briefing-stats">
          <div class="briefing-stat"><strong>${fm.daysLeft}</strong><span>days left</span></div>
          <div class="briefing-stat"><strong>${onPace} of ${activeTargets.length}</strong><span>targets comfortable</span></div>
          <div class="briefing-stat"><strong>${focusEvents}</strong><span>logged this period</span></div>
        </div>
      </div>
    </article>`;

    const totalDays = fm.totalDays;
    const modes = activeTargets.reduce((set, target) => set.add(target.goalMode), new Set());
    const modeText = modes.size > 1 ? "Total + frequency goals" : modes.has("frequency") ? "Frequency goals" : "Total-over-period goals";
    $("#focusMeta").innerHTML = `<span class="meta-chip">▣ <span>Focus period: <strong>${totalDays} days</strong></span></span><span class="meta-chip">◎ <span><strong>${escapeHTML(modeText)}</strong></span></span><span class="meta-chip">↗ <span>Recovery recalculated <strong>from today</strong></span></span><button class="meta-chip meta-button" data-open-log="" type="button">＋ Log another date</button>`;
  }

  function contextLabel(entry) {
    if (!entry) return null;
    const stress = { not_workday: "Not a workday", low: "Low stress", manageable: "Manageable stress", high: "High stress", extreme: "Extreme stress" }[entry.stress] || "Stress not set";
    const illness = { well: "Well", mild: "Mild symptoms", reduced: "Activity reduced", significant: "Significantly ill" }[entry.illness] || "Health not set";
    return { stress, alcohol: `${round1(Number(entry.alcoholUnits) || 0)} units`, illness };
  }

  function renderDailyContext() {
    const container = $("#dailyContextCard");
    if (!state.settings.contextEnabled) { container.innerHTML = ""; return; }
    const todayEntry = state.contextEntries.find(entry => entry.date === localISO());
    if (!todayEntry) {
      container.innerHTML = `<article class="context-card"><div><h3>Daily context</h3><p>Three quick questions about work stress, alcohol and illness.</p></div><button class="button secondary small" data-open-context="${localISO()}" type="button">Add today’s context</button></article>`;
      return;
    }
    const labels = contextLabel(todayEntry);
    container.innerHTML = `<article class="context-card"><div><h3>Today’s context is recorded</h3><div class="context-pills"><span class="context-pill">${escapeHTML(labels.stress)}</span><span class="context-pill">${escapeHTML(labels.alcohol)}</span><span class="context-pill">${escapeHTML(labels.illness)}</span></div></div><button class="button secondary small" data-open-context="${localISO()}" type="button">Edit</button></article>`;
  }

  function renderThemes() {
    const container = $("#themeSections");
    const themes = state.themes.filter(theme => themeTargets(theme.id).length);
    if (!themes.length) { container.innerHTML = `<div class="empty-state">No active targets yet. Add one in Manage.</div>`; return; }
    container.innerHTML = themes.map(theme => {
      const targets = themeTargets(theme.id);
      return `<section class="theme-section" data-theme-id="${theme.id}" data-colour="${theme.colour}">
        <div class="theme-heading"><div class="theme-heading-main"><span class="theme-symbol">${escapeHTML(theme.icon)}</span><h2>${escapeHTML(theme.name)}</h2></div><button data-collapse-theme="${theme.id}" type="button">${targets.length} ${targets.length === 1 ? "target" : "targets"}⌄</button></div>
        <div class="target-list">${targets.map(target => renderTargetRow(target)).join("")}</div>
      </section>`;
    }).join("");
  }

  function renderTargetRow(target) {
    const m = targetMetrics(target);
    return `<article class="target-row">
      <div class="target-cell target-name-cell"><span class="target-icon">${escapeHTML(target.emoji || "✓")}</span><div><h3 class="target-name">${escapeHTML(target.name)}</h3><p class="target-sub">${escapeHTML(goalDescription(target))}</p></div></div>
      <div class="target-cell target-count-cell"><strong class="metric-strong">${m.count} <small>/ ${m.goal}</small></strong><span class="metric-label">completed</span></div>
      <div class="target-cell target-status-cell"><span class="status-line"><span class="status-dot ${statusClass(m.statusKey)}"></span>${escapeHTML(m.status.label)}</span><span class="metric-label">${m.closeToSlip ? "close to slipping" : "recoverability"}</span></div>
      <div class="target-cell target-remaining-cell"><strong class="metric-strong">${m.remaining}</strong><span class="metric-label">remaining</span></div>
      <div class="target-cell target-pace-cell"><strong class="metric-strong">${round1(m.requiredRate)}<small> /week</small></strong><span class="metric-label">needed from now</span></div>
      <div class="log-actions"><button class="log-minus" data-undo="${target.id}" type="button" aria-label="Remove latest ${escapeHTML(target.name)} entry">−</button><button class="log-plus" data-add="${target.id}" type="button" aria-label="Log ${escapeHTML(target.name)} today">＋</button></div>
    </article>`;
  }

  function renderStats() {
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;
    const yearEnd = `${now.getFullYear()}-12-31`;
    const focus = state.currentFocus;
    const focusEvents = state.events.filter(event => event.date >= focus.start && event.date <= focus.end).length;
    const yearEvents = state.events.filter(event => event.date >= yearStart && event.date <= yearEnd).length;
    $("#statsOverview").innerHTML = `<div class="stats-grid"><div class="stat-card"><strong>${focusEvents}</strong><span>This focus</span></div><div class="stat-card"><strong>${yearEvents}</strong><span>This year</span></div><div class="stat-card"><strong>${state.events.length}</strong><span>All time</span></div></div>`;

    const targets = [...state.targets].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    $("#targetStats").innerHTML = targets.length ? `<div class="stats-list">${targets.map(target => {
      const m = targetMetrics(target);
      return `<article class="stats-row"><div class="stats-row-heading"><div class="stats-name"><span class="target-icon">${escapeHTML(target.emoji || "✓")}</span><div><h3>${escapeHTML(target.name)}</h3><p class="muted">${escapeHTML(goalDescription(target))}${target.active ? "" : " · Paused"}</p></div></div>${target.active ? `<span class="status-pill ${statusClass(m.statusKey)}">${escapeHTML(m.status.label)}</span>` : ""}</div><div class="stat-periods"><div class="stat-period"><strong>${countForTarget(target.id, focus.start, focus.end)}</strong><span>This focus</span></div><div class="stat-period"><strong>${countForTarget(target.id, yearStart, yearEnd)}</strong><span>This year</span></div><div class="stat-period"><strong>${state.events.filter(event => event.targetId === target.id).length}</strong><span>All time</span></div></div></article>`;
    }).join("")}</div>` : `<div class="empty-state">Statistics will appear after you add a target.</div>`;
    renderContextInsights();
  }

  function dayHasTarget(targetId, date) { return state.events.some(event => event.targetId === targetId && event.date === date); }
  function percentage(records, targetId, lag) {
    if (!records.length) return null;
    const hits = records.filter(entry => dayHasTarget(targetId, addDaysISO(entry.date, lag))).length;
    return Math.round(hits / records.length * 100);
  }
  function alcoholBand(units) { const n = Number(units) || 0; if (n === 0) return "0"; if (n <= 2) return "1–2"; if (n <= 4) return "3–4"; return "5+"; }
  function stressBand(stress) { if (["high", "extreme"].includes(stress)) return "High+"; if (stress === "manageable") return "Manageable"; if (stress === "low") return "Low"; return "Not a workday"; }
  function illnessBand(illness) { if (["reduced", "significant"].includes(illness)) return "Ill"; if (illness === "mild") return "Mild"; return "Well"; }

  function groupContext(entries, factor) {
    const groups = new Map();
    entries.forEach(entry => {
      const key = factor === "alcohol" ? alcoholBand(entry.alcoholUnits) : factor === "stress" ? stressBand(entry.stress) : illnessBand(entry.illness);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    return groups;
  }

  const CONTEXT_LAGS = [0, 1, 2, 3, 4, 5, 6, 7];

  function strongestFindings(entries, targets) {
    const findings = [];
    const configs = [
      { factor: "alcohol", baseline: "0", comparisons: ["1–2", "3–4", "5+"], label: value => `${value} alcohol units` },
      { factor: "stress", baseline: "Low", comparisons: ["Manageable", "High+"], label: value => `${value.toLowerCase()} work stress` },
      { factor: "illness", baseline: "Well", comparisons: ["Mild", "Ill"], label: value => value === "Ill" ? "illness reducing activity" : "mild illness" }
    ];
    targets.forEach(target => {
      configs.forEach(config => {
        const groups = groupContext(entries, config.factor);
        const baselineRecords = groups.get(config.baseline) || [];
        config.comparisons.forEach(comparison => {
          const comparisonRecords = groups.get(comparison) || [];
          if (baselineRecords.length < 5 || comparisonRecords.length < 5) return;
          CONTEXT_LAGS.forEach(lag => {
            const basePct = percentage(baselineRecords, target.id, lag);
            const compPct = percentage(comparisonRecords, target.id, lag);
            findings.push({ target, factor: config.factor, comparison, comparisonLabel: config.label(comparison), lag, basePct, compPct, difference: compPct - basePct, baseN: baselineRecords.length, compN: comparisonRecords.length });
          });
        });
      });
    });
    return findings.sort((a, b) => a.difference - b.difference);
  }

  function lagLabel(lag) {
    if (lag === 0) return "the same day";
    if (lag === 1) return "the following day";
    return `${lag} days later`;
  }

  function factorTable(title, factor, entries, targetId, order) {
    const groups = groupContext(entries, factor);
    const lagHeaders = CONTEXT_LAGS.map(lag => `<th>${lag === 0 ? "Same" : `+${lag}d`}</th>`).join("");
    const rows = order.map(key => {
      const records = groups.get(key) || [];
      const values = CONTEXT_LAGS.map(lag => `<td>${records.length ? percentage(records, targetId, lag) + "%" : "—"}</td>`).join("");
      return `<tr><td>${escapeHTML(key)}</td><td>${records.length}</td>${values}</tr>`;
    }).join("");
    return `<article class="analysis-card"><h3>${escapeHTML(title)}</h3><div class="analysis-table-wrap"><table class="analysis-table extended"><thead><tr><th>Recorded context</th><th>Days</th>${lagHeaders}</tr></thead><tbody>${rows}</tbody></table></div><p class="analysis-note">The table follows the target from the same day through seven days later. Percentages show days when it was logged at least once; read them alongside the sample size. Repeated drinking, stress or illness can overlap across the seven-day window.</p></article>`;
  }

  function renderContextInsights() {
    const container = $("#contextInsights");
    if (!state.settings.contextEnabled) { container.innerHTML = ""; return; }
    const eligibleTargets = state.targets.filter(target => targetGoal(target) >= Number(state.settings.briefingThreshold || 10));
    if (!eligibleTargets.length) { container.innerHTML = ""; return; }
    const selected = eligibleTargets.find(target => target.id === state.settings.analysisTargetId) || eligibleTargets[0];
    if (state.settings.analysisTargetId !== selected.id) state.settings.analysisTargetId = selected.id;
    const entries = state.contextEntries.filter(entry => entry.date >= state.currentFocus.start && entry.date <= state.currentFocus.end);
    const findings = strongestFindings(entries, eligibleTargets).filter(item => item.difference <= -8).slice(0, 3);
    const findingHTML = findings.length ? findings.map(item => `<div class="finding"><strong>${escapeHTML(item.target.name)}</strong> was logged ${Math.abs(item.difference)} percentage points less often ${lagLabel(item.lag)} after ${escapeHTML(item.comparisonLabel)} (${item.compPct}% across ${item.compN} days, versus ${item.basePct}% across ${item.baseN} baseline days).</div>`).join("") : `<div class="finding">Not enough evidence for a clear pattern yet. The app needs at least five days in two comparable groups, and more is better.</div>`;
    container.innerHTML = `<section class="analysis-wrap"><div class="analysis-heading"><div><p class="eyebrow">PERSONAL EXPERIMENT</p><h2>Context insights</h2></div><select id="analysisTargetSelect" aria-label="Target to analyse">${eligibleTargets.map(target => `<option value="${target.id}" ${target.id === selected.id ? "selected" : ""}>${escapeHTML(target.name)}</option>`).join("")}</select></div><div class="analysis-grid"><article class="analysis-card"><h3>Strongest observed links</h3><div class="finding-list">${findingHTML}</div><p class="analysis-note">These are associations in your records, not proof of cause. The app checks the same day and each of the following seven days; work patterns, weekends, sleep and repeated exposures can overlap.</p></article>${factorTable("Alcohol dose and delay", "alcohol", entries, selected.id, ["0", "1–2", "3–4", "5+"])}${factorTable("Work stress and delay", "stress", entries, selected.id, ["Not a workday", "Low", "Manageable", "High+"])}${factorTable("Illness and recovery", "illness", entries, selected.id, ["Well", "Mild", "Ill"])}</div></section>`;
  }

  function renderManage() {
    $("#focusName").value = state.currentFocus.name;
    $("#focusStart").value = state.currentFocus.start;
    $("#focusEnd").value = state.currentFocus.end;
    $("#briefingThreshold").value = state.settings.briefingThreshold;
    $("#contextEnabled").checked = state.settings.contextEnabled;

    $("#manageTargets").innerHTML = state.targets.length ? state.targets.map(target => {
      const theme = themeFor(target);
      return `<div class="manage-item"><div class="manage-item-main"><span class="manage-icon">${escapeHTML(target.emoji || "✓")}</span><div><h4>${escapeHTML(target.name)}${target.active ? "" : " · Paused"}</h4><p>${escapeHTML(theme.name)} · ${escapeHTML(goalDescription(target))} · ${state.events.filter(event => event.targetId === target.id).length} all-time</p></div></div><div class="manage-actions"><button class="text-button" data-edit="${target.id}" type="button">Edit</button><button class="text-button" data-toggle="${target.id}" type="button">${target.active ? "Pause" : "Resume"}</button></div></div>`;
    }).join("") : `<div class="empty-state">Add your first target.</div>`;

    $("#manageThemes").innerHTML = state.themes.map(theme => `<div class="manage-item"><div class="manage-item-main"><span class="manage-icon">${escapeHTML(theme.icon)}</span><div><h4>${escapeHTML(theme.name)}</h4><p>${plural(state.targets.filter(target => target.themeId === theme.id).length, "target")}</p></div></div>${theme.builtIn ? "" : `<button class="text-button danger-text" data-delete-theme="${theme.id}" type="button">Delete</button>`}</div>`).join("");

    $("#focusHistory").innerHTML = state.focusHistory.length ? [...state.focusHistory].reverse().map(focus => { const count = state.events.filter(event => event.date >= focus.start && event.date <= focus.end).length; return `<div class="history-item"><div><h4>${escapeHTML(focus.name)}</h4><p>${formatDate(focus.start)} – ${formatDate(focus.end)} · ${plural(count, "entry", "entries")}</p></div></div>`; }).join("") : `<p class="muted">No completed focus periods yet.</p>`;

    const lastSnapshot = localStorage.getItem("focus-tracker-last-recovery-date");
    const persistText = state.meta.persistentStorage === true ? "Stronger storage granted" : state.meta.persistentStorage === false ? "Stronger storage not granted" : "Stronger storage not yet checked";
    $("#protectionStatus").innerHTML = `<div class="context-pills"><span class="context-pill">Daily recovery: ${lastSnapshot ? escapeHTML(formatDate(lastSnapshot)) : "pending"}</span><span class="context-pill">${escapeHTML(persistText)}</span></div>`;
    $("#backupMeta").textContent = state.meta.lastExportAt ? `Last exported ${new Date(state.meta.lastExportAt).toLocaleString("en-GB")}.` : "No export recorded yet.";

    const activeTargets = state.targets.filter(target => target.active);
    $("#logTarget").innerHTML = activeTargets.map(target => `<option value="${target.id}">${escapeHTML(target.emoji || "✓")} ${escapeHTML(target.name)}</option>`).join("");
    $("#logDate").value = localISO();
  }

  function render() {
    renderBriefing();
    renderDailyContext();
    renderThemes();
    renderStats();
    renderManage();
  }

  function addEntries(targetId, date, quantity = 1) {
    const target = state.targets.find(item => item.id === targetId);
    if (!target) return;
    for (let index = 0; index < quantity; index += 1) state.events.push({ id: uid("event"), targetId, date, createdAt: new Date().toISOString() });
    saveState(`${target.name} logged`);
  }

  function undoLatest(targetId) {
    const candidates = state.events.map((event, index) => ({ event, index })).filter(item => item.event.targetId === targetId && item.event.date >= state.currentFocus.start && item.event.date <= state.currentFocus.end).sort((a, b) => (b.event.createdAt || "").localeCompare(a.event.createdAt || ""));
    if (!candidates.length) return showToast("No current-focus entry to remove");
    const target = state.targets.find(item => item.id === targetId);
    state.events.splice(candidates[0].index, 1);
    saveState(`Latest ${target?.name || "entry"} removed`);
  }

  function openLogDialog(targetId = "", date = localISO()) {
    renderManage();
    if (targetId) $("#logTarget").value = targetId;
    $("#logDate").value = date;
    $("#logQuantity").value = 1;
    $("#logDialog").showModal();
  }

  function goalModeValue() { return document.querySelector('input[name="goalMode"]:checked')?.value || "period"; }
  function briefingModeValue() { return document.querySelector('input[name="briefingMode"]:checked')?.value || "auto"; }

  function openTargetDialog(targetId = "") {
    const target = state.targets.find(item => item.id === targetId);
    $("#targetDialogTitle").textContent = target ? "Edit target" : "New target";
    $("#targetId").value = target?.id || "";
    $("#targetName").value = target?.name || "";
    $("#targetEmoji").value = target?.emoji || "";
    $("#targetTheme").innerHTML = state.themes.map(theme => `<option value="${theme.id}">${escapeHTML(theme.icon)} ${escapeHTML(theme.name)}</option>`).join("");
    $("#targetTheme").value = target?.themeId || state.themes[0]?.id || "health";
    const mode = target?.goalMode || "period";
    document.querySelector(`input[name="goalMode"][value="${mode}"]`).checked = true;
    $("#periodGoalValue").value = target?.goalMode === "period" ? target.goalValue : 10;
    $("#frequencyGoalValue").value = target?.goalMode === "frequency" ? target.goalValue : 3;
    $("#frequencyUnit").value = target?.frequencyUnit || "week";
    document.querySelector(`input[name="briefingMode"][value="${target?.briefingMode || "auto"}"]`).checked = true;
    updateGoalForm();
    $("#targetDialog").showModal();
    setTimeout(() => $("#targetName").focus(), 50);
  }

  function updateGoalForm() {
    const mode = goalModeValue();
    $("#periodGoalWrap").classList.toggle("hidden", mode !== "period");
    $("#frequencyGoalWrap").classList.toggle("hidden", mode !== "frequency");
    const temporary = mode === "period" ? { goalMode: "period", goalValue: Number($("#periodGoalValue").value || 1) } : { goalMode: "frequency", goalValue: Number($("#frequencyGoalValue").value || 1), frequencyUnit: $("#frequencyUnit").value };
    const total = targetGoal(temporary);
    const text = mode === "period" ? `${plural(total, "occurrence")} by ${formatDate(state.currentFocus.end)}. Missed weeks are fine: the app recalculates the pace needed from today.` : `${temporary.goalValue} per ${temporary.frequencyUnit} works out at about ${plural(total, "occurrence")} across this ${daysInclusive(state.currentFocus.start, state.currentFocus.end)}-day focus.`;
    $("#goalPreview").textContent = text;
  }

  function openContextDialog(date = localISO()) {
    const entry = state.contextEntries.find(item => item.date === date);
    $("#contextDate").value = date;
    const stress = entry?.stress || "manageable";
    const illness = entry?.illness || "well";
    const stressRadio = document.querySelector(`input[name="stress"][value="${stress}"]`);
    const illnessRadio = document.querySelector(`input[name="illness"][value="${illness}"]`);
    if (stressRadio) stressRadio.checked = true;
    if (illnessRadio) illnessRadio.checked = true;
    $("#alcoholUnits").value = entry ? entry.alcoholUnits : 0;
    $("#contextDialog").showModal();
  }

  function startNewFocus() {
    const confirmed = window.confirm("Archive the current focus period and start a fresh one? Targets, context and all historical totals will be kept.");
    if (!confirmed) return;
    state.focusHistory.push({ ...deepClone(state.currentFocus), targetSnapshot: deepClone(state.targets) });
    const start = localISO();
    state.currentFocus = { id: uid("focus"), name: "My next 90-day focus", start, end: addMonthsISO(start, 3) };
    saveState("New focus period started");
  }

  function exportData() {
    state.meta.lastExportAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const payload = { ...deepClone(state), exportedAt: state.meta.lastExportAt };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `focus-backup-v2-${localISO()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    renderManage();
    showToast("Backup exported");
  }

  async function importData(file) {
    try {
      const text = await file.text();
      const imported = migrateState(JSON.parse(text));
      const confirmed = window.confirm(`Replace the data on this device with this backup? It contains ${imported.targets.length} targets and ${imported.events.length} logged entries.`);
      if (!confirmed) return;
      await createRecoverySnapshot("Before import");
      state = imported;
      saveState(`Imported ${imported.events.length} entries`);
    } catch (error) {
      console.error(error);
      window.alert(`Could not import this backup. ${error.message}`);
    } finally { $("#importInput").value = ""; }
  }

  async function resetEverything() {
    const confirmed = window.confirm("Delete every target, context record and entry on this device? Export first if you may need them later.");
    if (!confirmed) return;
    await createRecoverySnapshot("Before reset");
    state = defaultState();
    saveState("App reset");
  }

  function openRecoveryDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
      const request = indexedDB.open(RECOVERY_DB, 1);
      request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(RECOVERY_STORE)) db.createObjectStore(RECOVERY_STORE, { keyPath: "date" }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function recoveryPut(snapshot) {
    try {
      const db = await openRecoveryDB();
      await new Promise((resolve, reject) => { const tx = db.transaction(RECOVERY_STORE, "readwrite"); tx.objectStore(RECOVERY_STORE).put(snapshot); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      db.close();
      recoveryAvailable = true;
    } catch (error) {
      recoveryAvailable = false;
      const items = JSON.parse(localStorage.getItem(RECOVERY_FALLBACK_KEY) || "[]").filter(item => item.date !== snapshot.date);
      items.push(snapshot);
      localStorage.setItem(RECOVERY_FALLBACK_KEY, JSON.stringify(items.slice(-7)));
    }
  }

  async function recoveryGetAll() {
    try {
      const db = await openRecoveryDB();
      const items = await new Promise((resolve, reject) => { const tx = db.transaction(RECOVERY_STORE, "readonly"); const req = tx.objectStore(RECOVERY_STORE).getAll(); req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error); });
      db.close();
      return items.sort((a, b) => b.date.localeCompare(a.date));
    } catch (error) { return JSON.parse(localStorage.getItem(RECOVERY_FALLBACK_KEY) || "[]").sort((a, b) => b.date.localeCompare(a.date)); }
  }

  async function recoveryDeleteOld() {
    const items = await recoveryGetAll();
    const excess = items.slice(30);
    if (!excess.length || !recoveryAvailable) return;
    const db = await openRecoveryDB();
    await new Promise((resolve, reject) => { const tx = db.transaction(RECOVERY_STORE, "readwrite"); const store = tx.objectStore(RECOVERY_STORE); excess.forEach(item => store.delete(item.date)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }

  async function createRecoverySnapshot(label = "Daily automatic snapshot") {
    const date = localISO();
    const snapshot = { date, createdAt: new Date().toISOString(), label, state: deepClone(state) };
    await recoveryPut(snapshot);
    await recoveryDeleteOld();
    localStorage.setItem("focus-tracker-last-recovery-date", date);
    return snapshot;
  }

  async function ensureDailySnapshot() {
    const today = localISO();
    if (localStorage.getItem("focus-tracker-last-recovery-date") === today) return;
    await createRecoverySnapshot("Daily automatic snapshot");
    renderManage();
  }

  async function showRecoveryDialog() {
    const items = await recoveryGetAll();
    $("#recoveryList").innerHTML = items.length ? items.map(item => `<div class="recovery-item"><div><h4>${formatDate(item.date)}</h4><p>${escapeHTML(item.label || "Recovery snapshot")} · ${item.state?.events?.length || 0} entries</p></div><button class="button secondary small" data-restore-date="${item.date}" type="button">Restore</button></div>`).join("") : `<div class="empty-state">No recovery points yet.</div>`;
    $("#recoveryDialog").showModal();
  }

  async function restoreRecovery(date) {
    const items = await recoveryGetAll();
    const item = items.find(snapshot => snapshot.date === date);
    if (!item) return;
    const confirmed = window.confirm(`Restore the recovery point from ${formatDate(date)}? This replaces the current data.`);
    if (!confirmed) return;
    await createRecoverySnapshot("Before recovery restore");
    state = migrateState(item.state);
    $("#recoveryDialog").close();
    saveState(`Restored ${formatDate(date)}`);
  }

  async function requestPersistentStorage() {
    if (!navigator.storage?.persist) { state.meta.persistentStorage = null; saveState("Persistent storage is not supported here"); return; }
    try {
      const granted = await navigator.storage.persist();
      state.meta.persistentStorage = granted;
      saveState(granted ? "Stronger local storage granted" : "Browser did not grant stronger storage");
    } catch (error) { state.meta.persistentStorage = false; saveState("Could not request stronger storage"); }
  }

  // Navigation
  $$(".nav-item").forEach(button => button.addEventListener("click", () => {
    $$(".nav-item").forEach(item => item.classList.toggle("active", item === button));
    $$(".view").forEach(view => view.classList.toggle("active", view.id === button.dataset.view));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));

  document.addEventListener("click", event => {
    const add = event.target.closest("[data-add]"); if (add) addEntries(add.dataset.add, localISO(), 1);
    const undo = event.target.closest("[data-undo]"); if (undo) undoLatest(undo.dataset.undo);
    const logOpener = event.target.closest("[data-open-log]"); if (logOpener) openLogDialog(logOpener.dataset.openLog || "", localISO());
    const edit = event.target.closest("[data-edit]"); if (edit) openTargetDialog(edit.dataset.edit);
    const opener = event.target.closest("[data-open-target]"); if (opener) openTargetDialog(opener.dataset.openTarget || "");
    const context = event.target.closest("[data-open-context]"); if (context) openContextDialog(context.dataset.openContext || localISO());
    const collapse = event.target.closest("[data-collapse-theme]"); if (collapse) collapse.closest(".theme-section")?.classList.toggle("collapsed");
    const toggle = event.target.closest("[data-toggle]"); if (toggle) { const target = state.targets.find(item => item.id === toggle.dataset.toggle); if (target) { target.active = !target.active; saveState(target.active ? `${target.name} resumed` : `${target.name} paused`); } }
    const deleteTheme = event.target.closest("[data-delete-theme]"); if (deleteTheme) { const id = deleteTheme.dataset.deleteTheme; if (state.targets.some(target => target.themeId === id)) window.alert("Move or delete the targets in this theme first."); else if (window.confirm("Delete this empty theme?")) { state.themes = state.themes.filter(theme => theme.id !== id); saveState("Theme deleted"); } }
    const units = event.target.closest("[data-units]"); if (units) $("#alcoholUnits").value = units.dataset.units;
    const restore = event.target.closest("[data-restore-date]"); if (restore) restoreRecovery(restore.dataset.restoreDate);
  });

  $("#contextHeaderButton").addEventListener("click", () => openContextDialog(localISO()));
  $("#focusForm").addEventListener("submit", event => { event.preventDefault(); const start = $("#focusStart").value; const end = $("#focusEnd").value; if (end < start) return window.alert("The end date must be after the start date."); state.currentFocus = { ...state.currentFocus, name: $("#focusName").value.trim(), start, end }; saveState("Focus period saved"); });
  $("#newFocusButton").addEventListener("click", startNewFocus);

  $("#targetForm").addEventListener("submit", event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const id = $("#targetId").value;
    const mode = goalModeValue();
    const details = { name: $("#targetName").value.trim(), emoji: $("#targetEmoji").value.trim() || "✓", themeId: $("#targetTheme").value, goalMode: mode, goalValue: Number(mode === "period" ? $("#periodGoalValue").value : $("#frequencyGoalValue").value), frequencyUnit: $("#frequencyUnit").value, briefingMode: briefingModeValue() };
    if (!details.name || !(details.goalValue > 0)) return;
    if (id) Object.assign(state.targets.find(target => target.id === id), details);
    else state.targets.push({ id: uid("target"), ...details, active: true, createdAt: localISO() });
    $("#targetDialog").close();
    saveState(id ? "Target updated" : "Target added");
  });
  $$('input[name="goalMode"]').forEach(input => input.addEventListener("change", updateGoalForm));
  $("#periodGoalValue").addEventListener("input", updateGoalForm);
  $("#frequencyGoalValue").addEventListener("input", updateGoalForm);
  $("#frequencyUnit").addEventListener("change", updateGoalForm);

  $("#logForm").addEventListener("submit", event => { if (event.submitter?.value === "cancel") return; event.preventDefault(); addEntries($("#logTarget").value, $("#logDate").value, Number($("#logQuantity").value)); $("#logDialog").close(); });

  $("#contextForm").addEventListener("submit", event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const date = $("#contextDate").value;
    const details = { stress: document.querySelector('input[name="stress"]:checked')?.value || "manageable", alcoholUnits: Number($("#alcoholUnits").value || 0), illness: document.querySelector('input[name="illness"]:checked')?.value || "well", updatedAt: new Date().toISOString() };
    const existing = state.contextEntries.find(entry => entry.date === date);
    if (existing) Object.assign(existing, details);
    else state.contextEntries.push({ id: uid("context"), date, createdAt: new Date().toISOString(), ...details });
    $("#contextDialog").close();
    saveState("Daily context saved");
  });

  $("#addThemeButton").addEventListener("click", () => { $("#themeName").value = ""; $("#themeIcon").value = ""; $("#themeColour").value = "green"; $("#themeDialog").showModal(); });
  $("#themeForm").addEventListener("submit", event => { if (event.submitter?.value === "cancel") return; event.preventDefault(); const name = $("#themeName").value.trim(); if (!name) return; state.themes.push({ id: uid("theme"), name, icon: $("#themeIcon").value.trim() || "✦", colour: $("#themeColour").value, builtIn: false }); $("#themeDialog").close(); saveState("Theme added"); });

  $("#briefingThreshold").addEventListener("change", () => { state.settings.briefingThreshold = clamp(Number($("#briefingThreshold").value || 10), 1, 999); saveState("Briefing threshold saved"); });
  $("#contextEnabled").addEventListener("change", () => { state.settings.contextEnabled = $("#contextEnabled").checked; saveState(state.settings.contextEnabled ? "Context tracking enabled" : "Context tracking disabled"); });
  $("#statsView").addEventListener("change", event => { if (event.target.id === "analysisTargetSelect") { state.settings.analysisTargetId = event.target.value; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); renderContextInsights(); } });

  $("#exportButton").addEventListener("click", exportData);
  $("#importInput").addEventListener("change", event => { const [file] = event.target.files; if (file) importData(file); });
  $("#resetButton").addEventListener("click", resetEverything);
  $("#restoreButton").addEventListener("click", showRecoveryDialog);
  $("#persistentButton").addEventListener("click", requestPersistentStorage);

  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; $("#installButton").classList.remove("hidden"); });
  $("#installButton").addEventListener("click", async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $("#installButton").classList.add("hidden"); });
  window.addEventListener("appinstalled", () => { showToast("Focus installed"); $("#installButton").classList.add("hidden"); });

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(console.error));

  state = loadState();
  render();
  ensureDailySnapshot().catch(console.error);
})();
