(() => {
  "use strict";

  const APP_VERSION = "3.2.0";
  const STORAGE_KEY = "focus-tracker-state-v1";
  const SCHEMA_VERSION = 4;
  const PRE_V2_BACKUP_KEY = "focus-tracker-pre-v2-backup";
  const PRE_V3_BACKUP_KEY = "focus-tracker-pre-v3-backup";
  const PRE_V4_BACKUP_KEY = "focus-tracker-pre-v4-backup";
  const LAST_GOOD_KEY = "focus-tracker-last-good-v4";
  const UNREADABLE_BACKUP_KEY = "focus-tracker-unreadable-backup-v4";
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
  let loadWarning = "";
  let migrationSnapshotPending = false;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function localISO(date = new Date()) {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }
  function localTimeHHMM(date = new Date()) { return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
  function isAfterMidnightWindow(date = new Date()) { return date.getHours() < 4; }
  function defaultContextDate(date = new Date()) { return isAfterMidnightWindow(date) ? addDaysISO(localISO(date), -1) : localISO(date); }
  function normaliseTime(value, fallback = "") {
    const text = String(value || "").trim();
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
  }
  function bedtimeMinutes(value) {
    const time = normaliseTime(value, "");
    if (!time) return null;
    const [hours, minutes] = time.split(":").map(Number);
    const total = hours * 60 + minutes;
    return hours < 12 ? total + 1440 : total;
  }
  function formatBedtimeMinutes(value) {
    if (!Number.isFinite(value)) return "";
    const wrapped = ((Math.round(value) % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
  }
  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
      version: SCHEMA_VERSION,
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
      settings: { briefingThreshold: 10, contextEnabled: true, analysisTargetId: "", collapsedThemes: [] },
      meta: { migratedAt: null, lastExportAt: null, persistentStorage: null, lastHealthCheckAt: null }
    };
  }
  function inferTheme(name = "") {
    const text = name.toLowerCase();
    if (/meeting|work|brief|patent|presentation|career|email/.test(text)) return "work";
    if (/parent|family|flower|card|friend|date|catherine|personal/.test(text)) return "personal";
    return "health";
  }

  function normaliseDate(value, fallback = "") {
    const text = String(value || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
  }

  function sameId(left, right) {
    return String(left ?? "") === String(right ?? "");
  }

  function normaliseFocus(focus, fallbackName = "Focus period") {
    const start = normaliseDate(focus?.start, localISO());
    const end = normaliseDate(focus?.end, addMonthsISO(start, 3));
    return {
      ...(focus || {}),
      id: String(focus?.id || uid("focus")),
      name: focus?.name || fallbackName,
      start,
      end: end < start ? start : end
    };
  }

  function inferEventFocusId(event, currentFocus, history) {
    if (event?.focusId) return String(event.focusId);
    const date = normaliseDate(event?.date, "");
    if (!date) return "";
    if (date >= currentFocus.start && date <= currentFocus.end) return currentFocus.id;
    const historical = history.find(focus => date >= focus.start && date <= focus.end);
    return historical?.id || "";
  }

  function makeIdsUnique(items, prefix) {
    const seen = new Set();
    return items.map(item => {
      let id = String(item.id || uid(prefix));
      if (seen.has(id)) id = uid(prefix);
      seen.add(id);
      return { ...item, id };
    });
  }

  function mergeContextByDate(entries) {
    const byDate = new Map();
    entries.forEach(entry => {
      if (!entry.date) return;
      const prior = byDate.get(entry.date);
      const currentStamp = entry.updatedAt || entry.createdAt || "";
      const priorStamp = prior?.updatedAt || prior?.createdAt || "";
      if (!prior || currentStamp >= priorStamp) byDate.set(entry.date, entry);
    });
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  function inspectState(candidate) {
    const issues = [];
    const add = (severity, code, message, repairable = false) => issues.push({ severity, code, message, repairable });
    if (!candidate || typeof candidate !== "object") return [{ severity: "error", code: "not_object", message: "Stored data is not a valid object.", repairable: false }];
    if (!candidate.currentFocus) add("error", "missing_focus", "The current focus period is missing.");
    if (!Array.isArray(candidate.targets)) add("error", "missing_targets", "The target list is missing.");
    if (!Array.isArray(candidate.events)) add("error", "missing_events", "The activity-entry list is missing.");
    if (!Array.isArray(candidate.contextEntries)) add("warning", "missing_context", "The context list is missing.", true);
    const targets = Array.isArray(candidate.targets) ? candidate.targets : [];
    const events = Array.isArray(candidate.events) ? candidate.events : [];
    const contexts = Array.isArray(candidate.contextEntries) ? candidate.contextEntries : [];
    const duplicateIds = list => list.length !== new Set(list.map(item => String(item.id || ""))).size;
    if (duplicateIds(targets)) add("warning", "duplicate_targets", "Some targets share an internal ID.", true);
    if (duplicateIds(events)) add("warning", "duplicate_events", "Some activity entries share an internal ID.", true);
    if (contexts.length !== new Set(contexts.map(item => item.date)).size) add("warning", "duplicate_context", "More than one context record exists for a date.", true);
    const targetIds = new Set(targets.map(target => String(target.id)));
    const orphanCount = events.filter(event => !targetIds.has(String(event.targetId))).length;
    if (orphanCount) add("warning", "orphan_events", `${orphanCount} activity ${orphanCount === 1 ? "entry points" : "entries point"} to a missing target.`);
    const invalidEventDates = events.filter(event => !/^\d{4}-\d{2}-\d{2}$/.test(String(event.date || ""))).length;
    if (invalidEventDates) add("warning", "invalid_event_dates", `${invalidEventDates} activity entries have an invalid date.`, true);
    const invalidContextDates = contexts.filter(entry => !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || ""))).length;
    if (invalidContextDates) add("warning", "invalid_context_dates", `${invalidContextDates} context records have an invalid date.`, true);
    const invalidBedtimes = contexts.filter(entry => entry.bedtime && !normaliseTime(entry.bedtime, "")).length;
    if (invalidBedtimes) add("warning", "invalid_bedtimes", `${invalidBedtimes} context records have an invalid bedtime.`, true);
    if (candidate.currentFocus?.end < candidate.currentFocus?.start) add("error", "focus_dates", "The current focus ends before it starts.", true);
    if (Number(candidate.version) !== SCHEMA_VERSION) add("warning", "schema_version", `Data schema ${candidate.version || "unknown"} is loaded instead of schema ${SCHEMA_VERSION}.`, true);
    if (candidate.appVersion && candidate.appVersion !== APP_VERSION) add("warning", "app_version", `Stored app version ${candidate.appVersion} differs from ${APP_VERSION}.`, true);
    return issues;
  }

  function hasCriticalIssues(candidate) { return inspectState(candidate).some(issue => issue.severity === "error" && !issue.repairable); }

  function migrateState(candidate) {
    if (!candidate || typeof candidate !== "object") throw new Error("Backup is not valid.");
    if (!candidate.currentFocus || !Array.isArray(candidate.targets) || !Array.isArray(candidate.events)) throw new Error("Backup is missing required information.");

    const previousVersion = Number(candidate.version) || 1;
    const currentFocus = normaliseFocus(candidate.currentFocus, "My 90-day focus");
    const focusHistory = (Array.isArray(candidate.focusHistory) ? candidate.focusHistory : []).map((focus, index) => ({
      ...normaliseFocus(focus, `Focus period ${index + 1}`),
      targetSnapshot: Array.isArray(focus.targetSnapshot) ? deepClone(focus.targetSnapshot) : []
    }));
    const themes = Array.isArray(candidate.themes) && candidate.themes.length ? deepClone(candidate.themes) : deepClone(DEFAULT_THEMES);
    DEFAULT_THEMES.forEach(theme => { if (!themes.some(item => sameId(item.id, theme.id))) themes.push(deepClone(theme)); });
    const normalisedThemes = makeIdsUnique(themes.map(theme => ({ ...theme, id: String(theme.id || uid("theme")) })), "theme");

    const rawTargets = candidate.targets.map(target => ({
      briefingMode: "auto",
      active: true,
      frequencyUnit: "week",
      themeId: inferTheme(target.name),
      createdAt: currentFocus.start,
      ...deepClone(target),
      id: String(target.id || uid("target")),
      themeId: String(target.themeId || inferTheme(target.name)),
      goalMode: target.goalMode === "weekly" ? "frequency" : (target.goalMode || "period"),
      goalValue: Number(target.goalValue) || 1,
      active: target.active !== false,
      createdAt: normaliseDate(target.createdAt, currentFocus.start)
    }));
    const targets = makeIdsUnique(rawTargets, "target");
    const targetIdMap = new Map();
    rawTargets.forEach((target, index) => targetIdMap.set(String(target.id), targets[index].id));

    const rawEvents = candidate.events.map(event => {
      const date = normaliseDate(event.date, normaliseDate(event.createdAt, ""));
      const mappedTargetId = targetIdMap.get(String(event.targetId ?? "")) || String(event.targetId ?? "");
      return {
        ...deepClone(event),
        id: String(event.id || uid("event")),
        targetId: mappedTargetId,
        date,
        focusId: inferEventFocusId({ ...event, date }, currentFocus, focusHistory),
        createdAt: event.createdAt || new Date().toISOString()
      };
    }).filter(event => event.targetId && event.date);
    const events = makeIdsUnique(rawEvents, "event");

    const contextEntries = mergeContextByDate(makeIdsUnique((Array.isArray(candidate.contextEntries) ? candidate.contextEntries : []).map(entry => ({
      ...deepClone(entry),
      id: String(entry.id || uid("context")),
      date: normaliseDate(entry.date, ""),
      alcoholUnits: Math.max(0, Number(entry.alcoholUnits) || 0),
      stress: entry.stress || "manageable",
      illness: entry.illness || "well",
      bedtime: normaliseTime(entry.bedtime, "")
    })).filter(entry => entry.date), "context"));

    const collapsedThemes = [...new Set((candidate.settings?.collapsedThemes || []).map(String))].filter(id => normalisedThemes.some(theme => sameId(theme.id, id)));
    const migrated = {
      version: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      currentFocus,
      focusHistory,
      themes: normalisedThemes,
      targets,
      events,
      contextEntries,
      settings: { briefingThreshold: 10, contextEnabled: true, analysisTargetId: "", collapsedThemes, ...(candidate.settings || {}), collapsedThemes },
      meta: { migratedAt: previousVersion < SCHEMA_VERSION ? new Date().toISOString() : candidate.meta?.migratedAt || null, lastExportAt: null, persistentStorage: null, lastHealthCheckAt: null, ...(candidate.meta || {}) }
    };
    if (hasCriticalIssues(migrated)) throw new Error("The migrated data did not pass its integrity check.");
    return migrated;
  }
  function loadState() {
    const mainRaw = localStorage.getItem(STORAGE_KEY);
    const candidates = [
      { raw: mainRaw, label: "current data" },
      { raw: localStorage.getItem(LAST_GOOD_KEY), label: "last known good copy" },
      { raw: localStorage.getItem(PRE_V4_BACKUP_KEY), label: "pre-Version 3.1 copy" },
      { raw: localStorage.getItem(PRE_V3_BACKUP_KEY), label: "pre-Version 3 copy" },
      { raw: localStorage.getItem(PRE_V2_BACKUP_KEY), label: "original pre-Version 2 copy" }
    ].filter(item => item.raw);

    if (mainRaw) {
      try {
        const parsed = JSON.parse(mainRaw);
        if ((Number(parsed.version) || 1) < SCHEMA_VERSION && !localStorage.getItem(PRE_V4_BACKUP_KEY)) {
          localStorage.setItem(PRE_V4_BACKUP_KEY, mainRaw);
          migrationSnapshotPending = true;
        }
      } catch (_) { /* fall through to recovery candidates */ }
    }

    for (const candidate of candidates) {
      try {
        const migrated = migrateState(JSON.parse(candidate.raw));
        const serialised = JSON.stringify(migrated);
        localStorage.setItem(STORAGE_KEY, serialised);
        localStorage.setItem(LAST_GOOD_KEY, serialised);
        if (candidate.label !== "current data") loadWarning = `Focus recovered from the ${candidate.label}.`;
        return migrated;
      } catch (error) {
        console.error(`Could not load ${candidate.label}`, error);
      }
    }

    if (mainRaw) {
      try { localStorage.setItem(UNREADABLE_BACKUP_KEY, mainRaw); } catch (_) { /* best effort */ }
      loadWarning = "Stored data could not be read. Focus preserved the unreadable text separately and opened a new empty copy.";
    }
    const fresh = defaultState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(fresh));
    return fresh;
  }
  function persistState(verification = {}) {
    state.version = SCHEMA_VERSION;
    state.appVersion = APP_VERSION;
    const serialised = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, serialised);
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) throw new Error("The browser did not retain the saved data.");
    const verified = JSON.parse(stored);
    const issues = inspectState(verified).filter(issue => issue.severity === "error");
    if (issues.length) throw new Error(issues[0].message);
    if (!Array.isArray(verified.events) || verified.events.length !== state.events.length) throw new Error("The saved entry count could not be verified.");
    const expectedIds = verification.expectedEventIds || [];
    if (expectedIds.some(id => !verified.events.some(event => sameId(event.id, id)))) throw new Error("A newly logged entry could not be read back from storage.");
    if (verification.targetId && Number.isFinite(verification.expectedFocusCount)) {
      const focus = verified.currentFocus;
      const storedCount = verified.events.filter(event => sameId(event.targetId, verification.targetId) && (sameId(event.focusId, focus.id) || (!event.focusId && event.date >= focus.start && event.date <= focus.end))).length;
      if (storedCount !== verification.expectedFocusCount) throw new Error("The target count did not match after saving.");
    }
    localStorage.setItem(LAST_GOOD_KEY, stored);
    return true;
  }
  function saveState(message = "", verification = {}) {
    try {
      persistState(verification);
      render();
      if (message) showToast(message);
      return true;
    } catch (error) {
      console.error(error);
      window.alert(`Focus could not save this change. ${error.message}`);
      return false;
    }
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
  function eventDate(event) { return normaliseDate(event?.date, ""); }
  function eventsForTarget(targetId) { return state.events.filter(event => sameId(event.targetId, targetId)); }
  function eventBelongsToFocus(event, focus) {
    if (event.focusId) return sameId(event.focusId, focus.id);
    const date = eventDate(event);
    return Boolean(date && date >= focus.start && date <= focus.end);
  }
  function entriesForTarget(targetId, start, end) { return eventsForTarget(targetId).filter(event => { const date = eventDate(event); return date >= start && date <= end; }); }
  function countForTarget(targetId, start, end) { return entriesForTarget(targetId, start, end).length; }
  function countForFocusTarget(targetId, focus = state.currentFocus) { return eventsForTarget(targetId).filter(event => eventBelongsToFocus(event, focus)).length; }

  function targetMetrics(target, focus = state.currentFocus) {
    const fm = focusMetrics(focus);
    const goal = targetGoal(target, focus);
    const count = countForFocusTarget(target.id, focus);
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

  function historicalTargetRecords(targetId, beforeDate = "9999-12-31") {
    return [...state.focusHistory]
      .filter(focus => focus.end < beforeDate)
      .sort((a, b) => a.end.localeCompare(b.end))
      .map(focus => {
        const count = countForFocusTarget(targetId, focus);
        const days = daysInclusive(focus.start, focus.end);
        const snapshot = (focus.targetSnapshot || []).find(target => sameId(target.id, targetId));
        return { focus, count, days, weeklyRate: count / days * 7, snapshot };
      })
      .filter(record => record.snapshot || record.count > 0);
  }

  function quantile(values, q) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function weightedMedian(values, weights) {
    const pairs = values.map((value, index) => ({ value, weight: weights[index] })).sort((a, b) => a.value - b.value);
    const half = pairs.reduce((sum, pair) => sum + pair.weight, 0) / 2;
    let running = 0;
    for (const pair of pairs) { running += pair.weight; if (running >= half) return pair.value; }
    return pairs.at(-1)?.value || 0;
  }

  function targetHistoryProfile(targetId, beforeDate = "9999-12-31") {
    const records = historicalTargetRecords(targetId, beforeDate).slice(-4);
    if (!records.length) return { records: [], confidence: "None", confidenceKey: "none" };
    const values = records.map(record => record.weeklyRate);
    const weights = values.map((_, index) => 1 + index * .35);
    const q1 = quantile(values, .25);
    const q3 = quantile(values, .75);
    const iqr = q3 - q1;
    const lowCap = Math.max(0, q1 - 1.5 * iqr);
    const highCap = q3 + 1.5 * iqr;
    const winsorised = values.map(value => clamp(value, lowCap, highCap));
    const weightedMean = winsorised.reduce((sum, value, index) => sum + value * weights[index], 0) / weights.reduce((a, b) => a + b, 0);
    const median = weightedMedian(values, weights);
    let baselineWeekly = median * .6 + weightedMean * .4;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    const firstHalf = values.slice(0, Math.max(1, Math.floor(values.length / 2)));
    const lastHalf = values.slice(Math.floor(values.length / 2));
    const firstAverage = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const lastAverage = lastHalf.reduce((a, b) => a + b, 0) / lastHalf.length;
    const trendChange = firstAverage > 0 ? (lastAverage - firstAverage) / firstAverage : 0;
    const trend = trendChange > .08 ? "rising" : trendChange < -.08 ? "falling" : "stable";
    if (trend === "rising") baselineWeekly *= 1.02;
    const consistency = cv <= .12 ? "very consistent" : cv <= .25 ? "fairly consistent" : "variable";
    const confidenceKey = records.length >= 3 && cv <= .25 ? "high" : records.length >= 2 ? "moderate" : "limited";
    const confidence = confidenceKey === "high" ? "High" : confidenceKey === "moderate" ? "Moderate" : "Limited";
    let bestSustained = Math.max(...values);
    if (values.length >= 2) bestSustained = Math.max(...values.slice(0, -1).map((value, index) => (value + values[index + 1]) / 2));
    const rangeLow = quantile(values, .25);
    const rangeHigh = quantile(values, .75);
    const totalDays = daysInclusive(state.currentFocus.start, state.currentFocus.end);
    const toTotal = rate => Math.max(1, Math.round(rate * totalDays / 7));
    let protect = toTotal(baselineWeekly * (consistency === "variable" ? .82 : .9));
    let maintain = Math.max(protect + 1, toTotal(baselineWeekly));
    let build = Math.max(maintain + 1, toTotal(Math.max(baselineWeekly * 1.1, baselineWeekly + .25)));
    let stretch = Math.max(build + 1, toTotal(Math.max(baselineWeekly * 1.22, bestSustained * 1.05)));
    return {
      records, values, baselineWeekly, rangeLow, rangeHigh, bestSustained, trend, trendChange,
      consistency, confidence, confidenceKey,
      recommendations: { protect, maintain, build, stretch }
    };
  }

  function recommendationValueForTarget(target, total) {
    if (target.goalMode === "period") return { goalValue: total, frequencyUnit: target.frequencyUnit || "week" };
    const weekly = total / daysInclusive(state.currentFocus.start, state.currentFocus.end) * 7;
    const unit = target.frequencyUnit || "week";
    const value = unit === "day" ? weekly / 7 : unit === "month" ? weekly * 30.4375 / 7 : weekly;
    return { goalValue: Math.max(.1, round1(value)), frequencyUnit: unit };
  }

  function recommendationDisplay(target, total) {
    if (target.goalMode === "period") return `${total} this focus`;
    const converted = recommendationValueForTarget(target, total);
    return `${converted.goalValue}/${converted.frequencyUnit}`;
  }

  function applyRecommendation(targetId, choice, closeDialog = false) {
    const target = state.targets.find(item => sameId(item.id, targetId));
    const profile = targetHistoryProfile(targetId);
    const total = profile.recommendations?.[choice];
    if (!target || !total) return;
    const converted = recommendationValueForTarget(target, total);
    target.goalValue = converted.goalValue;
    target.frequencyUnit = converted.frequencyUnit;
    target.recommendation = {
      choice, appliedAt: new Date().toISOString(), baselineWeekly: profile.baselineWeekly,
      historicalPeriods: profile.records.length, sustainableRangeWeekly: [profile.rangeLow, profile.rangeHigh],
      recommendedTotal: total, trend: profile.trend, confidence: profile.confidenceKey
    };
    saveState(`${target.name}: ${titleCase(choice)} target applied`);
    if ($("#targetDialog")?.open && sameId($("#targetId").value, targetId)) {
      if (target.goalMode === "period") $("#periodGoalValue").value = target.goalValue;
      else { $("#frequencyGoalValue").value = target.goalValue; $("#frequencyUnit").value = target.frequencyUnit; }
      $("#targetHistoryHint").innerHTML = recommendationCardHTML(target, true);
      updateGoalForm();
    }
    if (closeDialog) $("#recommendationDialog")?.close();
    else if ($("#recommendationDialog")?.open) renderRecommendationDialog();
  }

  function recommendationCardHTML(target, compact = false) {
    const profile = targetHistoryProfile(target.id);
    if (!profile.records.length) return `<article class="recommendation-card"><div><h3>${escapeHTML(target.name)}</h3><p class="muted">No completed focus-period history yet.</p></div></article>`;
    const insufficient = profile.records.length < 2;
    const actions = ["protect", "maintain", "build", "stretch"].map(choice => {
      const total = profile.recommendations?.[choice];
      return `<button class="recommendation-option" data-apply-recommendation="${target.id}" data-choice="${choice}" type="button" ${insufficient ? "disabled" : ""}><strong>${titleCase(choice)}</strong><span>${total ? escapeHTML(recommendationDisplay(target, total)) : "—"}</span></button>`;
    }).join("");
    return `<article class="recommendation-card ${compact ? "compact" : ""}"><div class="recommendation-card-heading"><div><h3>${escapeHTML(target.name)}</h3><p>${profile.records.length} completed ${profile.records.length === 1 ? "period" : "periods"} · ${escapeHTML(profile.confidence)} confidence</p></div><span class="status-pill">${escapeHTML(profile.trend)}</span></div><p class="recommendation-summary">Recent sustainable range: <strong>${round1(profile.rangeLow)}–${round1(profile.rangeHigh)} per week</strong>. Results are ${escapeHTML(profile.consistency)}.</p>${insufficient ? `<p class="field-help">One period is useful context, but Focus waits for two before recommending a target.</p>` : `<div class="recommendation-options">${actions}<button class="recommendation-option custom" data-custom-target="${target.id}" type="button"><strong>Custom</strong><span>Choose manually</span></button></div>`}</article>`;
  }

  function renderRecommendationDialog() {
    const targets = state.targets.filter(target => target.active);
    $("#recommendationList").innerHTML = targets.map(target => recommendationCardHTML(target)).join("") || `<div class="empty-state">No active targets to review.</div>`;
  }

  function openRecommendationDialog() {
    renderRecommendationDialog();
    $("#recommendationDialog").showModal();
  }

  function themeFor(target) { return state.themes.find(theme => sameId(theme.id, target.themeId)) || state.themes[0] || DEFAULT_THEMES[0]; }
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
    const focusEvents = state.events.filter(event => eventBelongsToFocus(event, state.currentFocus)).length;
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
    $("#focusMeta").innerHTML = `<button class="meta-chip meta-button" data-open-log="previous" type="button">＋ Log previous date</button>`;
  }
  function contextLabel(entry) {
    if (!entry) return null;
    const stress = { not_workday: "Not a workday", low: "Low stress", manageable: "Manageable stress", high: "High stress", extreme: "Extreme stress" }[entry.stress] || "Stress not set";
    const illness = { well: "Well", low_level: "Low-level illness", mild: "Mildly ill", reduced: "Ill — activity affected", significant: "Very ill" }[entry.illness] || "Health not set";
    return { stress, alcohol: `${round1(Number(entry.alcoholUnits) || 0)} units`, illness, bedtime: entry.bedtime ? `Bed ${entry.bedtime}` : "Bedtime not set" };
  }

  function renderDailyContext() {
    const container = $("#dailyContextCard");
    if (!state.settings.contextEnabled) { container.innerHTML = ""; return; }
    const today = localISO();
    const contextDate = defaultContextDate();
    const entry = state.contextEntries.find(item => item.date === contextDate);
    const weekday = formatDate(contextDate, { weekday: "long" });
    const label = contextDate === today ? (entry ? "✓ Today’s context added" : "Add today’s context") : (entry ? `✓ ${weekday}’s context added` : `Add ${weekday}’s context`);
    container.innerHTML = `<div class="context-action-row"><button class="button context-primary" data-open-context="${contextDate}" type="button">${escapeHTML(label)}</button></div>`;
  }
  function themeSummary(theme) {
    const targets = themeTargets(theme.id);
    const metrics = targets.map(target => targetMetrics(target));
    const count = metrics.reduce((sum, item) => sum + item.count, 0);
    const goal = metrics.reduce((sum, item) => sum + item.goal, 0);
    const attention = metrics.filter(item => ["attention", "risk"].includes(item.statusKey) || item.closeToSlip).length;
    const assessment = themeAssessment(theme);
    return { targets, metrics, count, goal, attention, assessment, progress: goal ? Math.round(count / goal * 100) : 0 };
  }

  function renderThemes() {
    const container = $("#themeSections");
    const themes = state.themes.filter(theme => themeTargets(theme.id).length);
    if (!themes.length) { container.innerHTML = `<div class="empty-state">No active targets yet. Add one in Manage.</div>`; return; }
    const collapsed = new Set((state.settings.collapsedThemes || []).map(String));
    container.innerHTML = themes.map(theme => {
      const summary = themeSummary(theme);
      const isCollapsed = collapsed.has(String(theme.id));
      const warning = summary.attention ? `${summary.attention} ${summary.attention === 1 ? "target needs" : "targets need"} attention` : "No urgent targets";
      return `<section class="theme-section ${isCollapsed ? "collapsed" : ""}" data-theme-id="${theme.id}" data-colour="${theme.colour}">
        <button class="theme-heading" data-collapse-theme="${theme.id}" type="button" aria-expanded="${!isCollapsed}">
          <div class="theme-heading-main"><span class="theme-symbol">${escapeHTML(theme.icon)}</span><div><h2>${escapeHTML(theme.name)}</h2><p>${escapeHTML(titleCase(summary.assessment.label))} · ${summary.count}/${summary.goal} completed · ${escapeHTML(warning)}</p></div></div>
          <span class="theme-chevron">${isCollapsed ? "⌄" : "⌃"}</span>
        </button>
        <div class="target-list">${summary.targets.map(target => renderTargetRow(target)).join("")}</div>
      </section>`;
    }).join("");
  }
  function renderTargetRow(target) {
    const m = targetMetrics(target);
    return `<article class="target-row">
      <div class="target-cell target-name-cell"><span class="target-icon">${escapeHTML(target.emoji || "✓")}</span><div><h3 class="target-name">${escapeHTML(target.name)}</h3><p class="target-sub">${escapeHTML(goalDescription(target))}</p></div></div>
      <div class="target-cell target-count-cell"><strong class="metric-strong">${m.count} <small>/ ${m.goal}</small></strong><span class="metric-label">completed</span></div>
      <div class="target-cell target-status-cell"><span class="status-line"><span class="status-dot ${statusClass(m.statusKey)}"></span>${escapeHTML(m.status.label)}</span>${m.closeToSlip ? '<span class="metric-label">close to slipping</span>' : ''}</div>
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
    const focusEvents = state.events.filter(event => eventBelongsToFocus(event, focus)).length;
    const yearEvents = state.events.filter(event => event.date >= yearStart && event.date <= yearEnd).length;
    $("#statsOverview").innerHTML = `<div class="stats-grid"><div class="stat-card"><strong>${focusEvents}</strong><span>This focus</span></div><div class="stat-card"><strong>${yearEvents}</strong><span>This year</span></div><div class="stat-card"><strong>${state.events.length}</strong><span>All time</span></div></div>`;

    const targets = [...state.targets].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    $("#targetStats").innerHTML = targets.length ? `<div class="stats-list">${targets.map(target => {
      const m = targetMetrics(target);
      return `<article class="stats-row"><div class="stats-row-heading"><div class="stats-name"><span class="target-icon">${escapeHTML(target.emoji || "✓")}</span><div><h3>${escapeHTML(target.name)}</h3><p class="muted">${escapeHTML(goalDescription(target))}${target.active ? "" : " · Paused"}</p></div></div>${target.active ? `<span class="status-pill ${statusClass(m.statusKey)}">${escapeHTML(m.status.label)}</span>` : ""}</div><div class="stat-periods"><div class="stat-period"><strong>${countForFocusTarget(target.id, focus)}</strong><span>This focus</span></div><div class="stat-period"><strong>${countForTarget(target.id, yearStart, yearEnd)}</strong><span>This year</span></div><div class="stat-period"><strong>${eventsForTarget(target.id).length}</strong><span>All time</span></div></div></article>`;
    }).join("")}</div>` : `<div class="empty-state">Statistics will appear after you add a target.</div>`;
    renderContextInsights();
  }

  function dayHasTarget(targetId, date) { return state.events.some(event => sameId(event.targetId, targetId) && eventDate(event) === date); }
  function percentage(records, targetId, lag) {
    if (!records.length) return null;
    const hits = records.filter(entry => dayHasTarget(targetId, addDaysISO(entry.date, lag))).length;
    return Math.round(hits / records.length * 100);
  }
  function alcoholBand(units) {
    const n = Math.max(0, Number(units) || 0);
    if (n === 0) return "0";
    if (n < 3) return "0.1–2.9";
    if (n < 6) return "3–5.9";
    if (n < 9) return "6–8.9";
    return "9+";
  }
  function stressBand(stress) { if (["high", "extreme"].includes(stress)) return "High+"; if (stress === "manageable") return "Manageable"; if (stress === "low") return "Low"; return "Not a workday"; }
  function illnessBand(illness) { if (["reduced", "significant"].includes(illness)) return "Ill"; if (illness === "mild") return "Mild"; if (illness === "low_level") return "Low-level"; return "Well"; }
  function usualBedtimeMinutes(entries) { return median(entries.map(entry => bedtimeMinutes(entry.bedtime))); }
  function bedtimeBand(value, usual) {
    const minutes = bedtimeMinutes(value);
    if (!Number.isFinite(minutes) || !Number.isFinite(usual)) return "";
    const difference = minutes - usual;
    if (difference <= -46) return "Earlier than usual";
    if (difference <= 45) return "Around usual";
    if (difference <= 90) return "46–90 min later";
    return "90+ min later";
  }

  function groupContext(entries, factor) {
    const groups = new Map();
    const usualBedtime = factor === "bedtime" ? usualBedtimeMinutes(entries) : null;
    entries.forEach(entry => {
      const key = factor === "alcohol" ? alcoholBand(entry.alcoholUnits)
        : factor === "stress" ? stressBand(entry.stress)
        : factor === "illness" ? illnessBand(entry.illness)
        : bedtimeBand(entry.bedtime, usualBedtime);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    return groups;
  }

  const CONTEXT_LAGS = [0, 1, 2, 3, 4, 5, 6, 7];

  function strongestFindings(entries, targets) {
    const findings = [];
    const configs = [
      { factor: "alcohol", baseline: "0", comparisons: ["0.1–2.9", "3–5.9", "6–8.9", "9+"], label: value => `${value} alcohol units` },
      { factor: "stress", baseline: "Low", comparisons: ["Manageable", "High+"], label: value => `${value.toLowerCase()} work stress` },
      { factor: "illness", baseline: "Well", comparisons: ["Low-level", "Mild", "Ill"], label: value => value === "Ill" ? "illness affecting activity" : value === "Low-level" ? "low-level illness" : "mild illness" },
      { factor: "bedtime", baseline: "Around usual", comparisons: ["46–90 min later", "90+ min later"], label: value => value === "90+ min later" ? "a bedtime more than 90 minutes later than usual" : "a bedtime 46–90 minutes later than usual" }
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

  function factorTable(title, factor, entries, targetId, order, note = "Based on logged context days. Sample sizes remain visible so tentative patterns are clear.") {
    const groups = groupContext(entries, factor);
    const rows = order.map(key => {
      const records = groups.get(key) || [];
      const cells = CONTEXT_LAGS.map(lag => {
        const value = records.length ? percentage(records, targetId, lag) : null;
        const tone = value === null ? "empty" : value >= 70 ? "strong" : value >= 50 ? "middle" : "low";
        return `<div class="lag-cell ${tone}"><span>${lag === 0 ? "Same day" : `+${lag}d`}</span><strong>${value === null ? "—" : value + "%"}</strong></div>`;
      }).join("");
      return `<div class="dose-card"><div class="dose-heading"><strong>${escapeHTML(key)}${factor === "alcohol" ? " units" : ""}</strong><span>${plural(records.length, "day")}</span></div><div class="lag-grid">${cells}</div></div>`;
    }).join("");
    return `<article class="analysis-card"><h3>${escapeHTML(title)}</h3><div class="dose-list">${rows}</div><p class="analysis-note compact-note">${escapeHTML(note)}</p></article>`;
  }
  function bedtimeFactorTable(entries, targetId) {
    const bedtimeEntries = entries.filter(entry => normaliseTime(entry.bedtime, ""));
    if (!bedtimeEntries.length) return `<article class="analysis-card"><h3>Bedtime and delay</h3><p class="analysis-note compact-note">Start recording bedtime in daily context to compare the same evening and the following seven days.</p></article>`;
    const usual = usualBedtimeMinutes(bedtimeEntries);
    const note = `Your usual bedtime is currently around ${formatBedtimeMinutes(usual)}, based on the median of ${plural(bedtimeEntries.length, "logged night")}. Same day refers to the evening attached to that bedtime.`;
    return factorTable("Bedtime and delay", "bedtime", bedtimeEntries, targetId, ["Earlier than usual", "Around usual", "46–90 min later", "90+ min later"], note);
  }
  function renderContextInsights() {
    const container = $("#contextInsights");
    if (!state.settings.contextEnabled) { container.innerHTML = ""; return; }
    const eligibleTargets = state.targets.filter(target => targetGoal(target) >= Number(state.settings.briefingThreshold || 10));
    if (!eligibleTargets.length) { container.innerHTML = ""; return; }
    const selected = eligibleTargets.find(target => sameId(target.id, state.settings.analysisTargetId)) || eligibleTargets[0];
    if (state.settings.analysisTargetId !== selected.id) state.settings.analysisTargetId = selected.id;
    const entries = state.contextEntries.filter(entry => entry.date >= state.currentFocus.start && entry.date <= state.currentFocus.end);
    const allFindings = strongestFindings(entries, [selected]).filter(item => item.difference <= -8);
    const findings = allFindings.slice(0, 3);
    let findingHTML = "";
    if (findings.length) {
      findingHTML = findings.map((item, index) => `<div class="finding"><strong>${index === 0 ? "The clearest observed link so far" : "Another observed pattern"}</strong> is that ${escapeHTML(selected.name.toLowerCase())} was logged ${Math.abs(item.difference)} percentage points less often ${lagLabel(item.lag)} after ${escapeHTML(item.comparisonLabel)}. That comparison uses ${item.compN} exposed days and ${item.baseN} baseline days${Math.min(item.compN, item.baseN) < 10 ? ", so it is still tentative" : ""}.</div>`).join("");
    } else {
      const alcoholDays = entries.filter(entry => Number(entry.alcoholUnits) > 0).length;
      findingHTML = `<div class="finding"><strong>There is still limited data for a reliable link.</strong> Focus has ${entries.length} context days, including ${alcoholDays} with alcohol recorded. It will highlight a pattern when comparable groups each have at least five days.</div>`;
    }
    container.innerHTML = `<section class="analysis-wrap"><div class="analysis-heading"><div><p class="eyebrow">PERSONAL EXPERIMENT</p><h2>Context insights</h2></div><select id="analysisTargetSelect" aria-label="Target to analyse">${eligibleTargets.map(target => `<option value="${target.id}" ${sameId(target.id, selected.id) ? "selected" : ""}>${escapeHTML(target.name)}</option>`).join("")}</select></div><div class="analysis-grid"><article class="analysis-card"><h3>Strongest observed links</h3><div class="finding-list">${findingHTML}</div></article>${factorTable("Alcohol dose and delay", "alcohol", entries, selected.id, ["0", "0.1–2.9", "3–5.9", "6–8.9", "9+"])}${bedtimeFactorTable(entries, selected.id)}${factorTable("Work stress and delay", "stress", entries, selected.id, ["Not a workday", "Low", "Manageable", "High+"])}${factorTable("Illness and recovery", "illness", entries, selected.id, ["Well", "Low-level", "Mild", "Ill"])}</div></section>`;
  }
  function renderAppHealth() {
    const issues = inspectState(state);
    const workerURL = navigator.serviceWorker?.controller?.scriptURL || "";
    if (workerURL && !workerURL.includes("service-worker-v3-2.js")) issues.push({ severity: "warning", code: "worker_version", message: "An older offline worker is still controlling this screen. Close and reopen Focus once.", repairable: false });
    const container = $("#appHealth");
    if (!container) return;
    if (!issues.length) {
      container.innerHTML = `<div class="health-status healthy"><strong>Everything looks healthy</strong><span>${state.targets.length} targets · ${state.events.length} activity entries · ${state.contextEntries.length} context days · schema ${SCHEMA_VERSION}</span></div>`;
    } else {
      const repairable = issues.some(issue => issue.repairable);
      container.innerHTML = `<div class="health-status warning"><strong>${issues.length} ${issues.length === 1 ? "check needs" : "checks need"} attention</strong>${issues.map(issue => `<span>${escapeHTML(issue.message)}</span>`).join("")}${repairable ? `<button class="button secondary small" data-repair-health type="button">Repair safe issues</button>` : ""}</div>`;
    }
  }

  async function repairSafeIssues() {
    await createRecoverySnapshot("Before app-health repair");
    state.targets = makeIdsUnique(state.targets, "target");
    state.events = makeIdsUnique(state.events.map(event => ({ ...event, date: normaliseDate(event.date, normaliseDate(event.createdAt, localISO())) })), "event");
    state.contextEntries = mergeContextByDate(makeIdsUnique(state.contextEntries.map(entry => ({ ...entry, date: normaliseDate(entry.date, ""), bedtime: normaliseTime(entry.bedtime, "") })).filter(entry => entry.date), "context"));
    state.settings.collapsedThemes = [...new Set((state.settings.collapsedThemes || []).map(String))].filter(id => state.themes.some(theme => sameId(theme.id, id)));
    if (state.currentFocus.end < state.currentFocus.start) state.currentFocus.end = state.currentFocus.start;
    state.meta.lastHealthCheckAt = new Date().toISOString();
    saveState("Safe repairs completed");
  }

  function openPeriodReview(focusId) {
    const focus = state.focusHistory.find(item => sameId(item.id, focusId));
    if (!focus) return;
    $("#periodReviewTitle").textContent = focus.name;
    const snapshots = (focus.targetSnapshot || []).filter(target => target.active !== false);
    const targets = snapshots.length ? snapshots : state.targets;
    $("#periodReviewContent").innerHTML = targets.map(target => {
      const count = countForFocusTarget(target.id, focus);
      const goal = targetGoal(target, focus);
      const profile = targetHistoryProfile(target.id, focus.start);
      const baselineTotal = profile.records.length ? Math.round(profile.baselineWeekly * daysInclusive(focus.start, focus.end) / 7) : null;
      const targetResult = count >= goal ? `Reached the target by ${count - goal}` : `${goal - count} short of the target`;
      const baselineResult = baselineTotal === null ? "This was the first usable historical period." : count > baselineTotal ? `${count - baselineTotal} above the earlier sustainable baseline` : count < baselineTotal ? `${baselineTotal - count} below the earlier sustainable baseline` : "Matched the earlier sustainable baseline";
      return `<article class="review-card"><div class="review-heading"><span class="target-icon">${escapeHTML(target.emoji || "✓")}</span><div><h3>${escapeHTML(target.name)}</h3><p>${count}/${goal} completed</p></div></div><p><strong>${escapeHTML(targetResult)}.</strong> ${escapeHTML(baselineResult)}.</p></article>`;
    }).join("") || `<div class="empty-state">No target snapshot is available for this period.</div>`;
    $("#periodReviewDialog").showModal();
  }

  function renderManage() {
    $("#focusName").value = state.currentFocus.name;
    $("#focusStart").value = state.currentFocus.start;
    $("#focusEnd").value = state.currentFocus.end;
    $("#briefingThreshold").value = state.settings.briefingThreshold;
    $("#contextEnabled").checked = state.settings.contextEnabled;

    $("#manageTargets").innerHTML = state.targets.length ? state.targets.map(target => {
      const theme = themeFor(target);
      return `<div class="manage-item"><div class="manage-item-main"><span class="manage-icon">${escapeHTML(target.emoji || "✓")}</span><div><h4>${escapeHTML(target.name)}${target.active ? "" : " · Paused"}</h4><p>${escapeHTML(theme.name)} · ${escapeHTML(goalDescription(target))} · ${eventsForTarget(target.id).length} all-time</p></div></div><div class="manage-actions"><button class="text-button" data-edit="${target.id}" type="button">Edit</button><button class="text-button" data-toggle="${target.id}" type="button">${target.active ? "Pause" : "Resume"}</button></div></div>`;
    }).join("") : `<div class="empty-state">Add your first target.</div>`;

    $("#manageThemes").innerHTML = state.themes.map(theme => `<div class="manage-item"><div class="manage-item-main"><span class="manage-icon">${escapeHTML(theme.icon)}</span><div><h4>${escapeHTML(theme.name)}</h4><p>${plural(state.targets.filter(target => sameId(target.themeId, theme.id)).length, "target")}</p></div></div>${theme.builtIn ? "" : `<button class="text-button danger-text" data-delete-theme="${theme.id}" type="button">Delete</button>`}</div>`).join("");

    $("#focusHistory").innerHTML = state.focusHistory.length ? [...state.focusHistory].reverse().map(focus => { const count = state.events.filter(event => eventBelongsToFocus(event, focus)).length; return `<div class="history-item"><div><h4>${escapeHTML(focus.name)}</h4><p>${formatDate(focus.start)} – ${formatDate(focus.end)} · ${plural(count, "entry", "entries")}</p></div><button class="text-button" data-review-focus="${focus.id}" type="button">Review</button></div>`; }).join("") : `<p class="muted">No completed focus periods yet.</p>`;

    const lastSnapshot = localStorage.getItem("focus-tracker-last-recovery-date");
    const persistText = state.meta.persistentStorage === true ? "Stronger storage granted" : state.meta.persistentStorage === false ? "Stronger storage not granted" : "Stronger storage not yet checked";
    $("#protectionStatus").innerHTML = `<div class="context-pills"><span class="context-pill">Daily recovery: ${lastSnapshot ? escapeHTML(formatDate(lastSnapshot)) : "pending"}</span><span class="context-pill">${escapeHTML(persistText)}</span></div>`;
    $("#backupMeta").textContent = state.meta.lastExportAt ? `Last exported ${new Date(state.meta.lastExportAt).toLocaleString("en-GB")}.` : "No export recorded yet.";
    const currentStored = state.events.filter(event => eventBelongsToFocus(event, state.currentFocus)).length;
    const lastEvent = [...state.events].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
    const versionText = $("#appVersionText");
    if (versionText) versionText.textContent = `Focus ${APP_VERSION} · Data schema ${SCHEMA_VERSION} · Local-first · No cloud database.`;
    const dataStatus = $("#dataStatus");
    if (dataStatus) dataStatus.textContent = `${state.events.length} stored entries · ${currentStored} in the current focus${lastEvent ? ` · Last log ${formatDate(eventDate(lastEvent))}` : ""}${loadWarning ? ` · ${loadWarning}` : ""}.`;

    const activeTargets = state.targets.filter(target => target.active);
    $("#logTarget").innerHTML = activeTargets.map(target => `<option value="${target.id}">${escapeHTML(target.emoji || "✓")} ${escapeHTML(target.name)}</option>`).join("");
    $("#logDate").max = localISO();
    $("#contextDate").max = localISO();
    renderAppHealth();
  }
  function render() {
    renderBriefing();
    renderDailyContext();
    renderThemes();
    renderStats();
    renderManage();
  }

  function addEntries(targetId, date, quantity = 1) {
    const target = state.targets.find(item => sameId(item.id, targetId));
    if (!target) return window.alert("Focus could not match this button to a target. Please refresh and try again.");
    const safeDate = normaliseDate(date, localISO());
    if (safeDate > localISO()) return window.alert("Activity cannot be logged for a future date.");
    const safeQuantity = clamp(Math.floor(Number(quantity) || 1), 1, 100);
    const before = deepClone(state.events);
    const insertedIds = [];
    for (let index = 0; index < safeQuantity; index += 1) {
      const id = uid("event");
      insertedIds.push(id);
      state.events.push({ id, targetId: String(target.id), focusId: safeDate >= state.currentFocus.start && safeDate <= state.currentFocus.end ? String(state.currentFocus.id) : "", date: safeDate, createdAt: new Date().toISOString() });
    }
    const focusCount = countForFocusTarget(target.id, state.currentFocus);
    try {
      persistState({ expectedEventIds: insertedIds, targetId: target.id, expectedFocusCount: focusCount });
      render();
      showToast(`${target.name}: ${focusCount} completed`);
    } catch (error) {
      state.events = before;
      try { persistState(); } catch (_) { /* preserve in-memory rollback */ }
      console.error(error);
      window.alert(`Focus could not verify this log, so it was rolled back. ${error.message}`);
    }
  }
  function undoLatest(targetId) {
    const candidates = state.events.map((event, index) => ({ event, index })).filter(item => sameId(item.event.targetId, targetId) && eventBelongsToFocus(item.event, state.currentFocus)).sort((a, b) => (b.event.createdAt || "").localeCompare(a.event.createdAt || ""));
    if (!candidates.length) return showToast("No current-focus entry to remove");
    const target = state.targets.find(item => sameId(item.id, targetId));
    const removed = state.events.splice(candidates[0].index, 1)[0];
    if (!saveState(`Latest ${target?.name || "entry"} removed`)) state.events.splice(candidates[0].index, 0, removed);
  }

  function openLogDialog(targetId = "", date = addDaysISO(localISO(), -1)) {
    renderManage();
    if (targetId) $("#logTarget").value = targetId;
    $("#logDate").max = localISO();
    $("#logDate").value = date > localISO() ? localISO() : date;
    $("#logQuantity").value = 1;
    $("#logDialog").showModal();
  }
  function goalModeValue() { return document.querySelector('input[name="goalMode"]:checked')?.value || "period"; }
  function briefingModeValue() { return document.querySelector('input[name="briefingMode"]:checked')?.value || "auto"; }

  function openTargetDialog(targetId = "") {
    const target = state.targets.find(item => sameId(item.id, targetId));
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
    $("#targetHistoryHint").innerHTML = target ? recommendationCardHTML(target, true) : `<p class="field-help">History-based suggestions appear after this target has completed at least two focus periods.</p>`;
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

  function updateAfterMidnightNotice() {
    const notice = $("#afterMidnightNotice");
    if (!notice) return;
    const today = localISO();
    const yesterday = addDaysISO(today, -1);
    const selected = $("#contextDate").value;
    const show = isAfterMidnightWindow() && selected === yesterday;
    notice.classList.toggle("hidden", !show);
    if (show) {
      const weekday = formatDate(yesterday, { weekday: "long" });
      $("#afterMidnightNoticeText").textContent = ` Focus is treating this as ${weekday} night’s context.`;
      $("#useTodayContextButton").textContent = `Use ${formatDate(today, { weekday: "long" })} instead`;
    }
  }

  function loadContextFormForDate(date) {
    const entry = state.contextEntries.find(item => item.date === date);
    const stress = entry?.stress || "manageable";
    const illness = entry?.illness || "well";
    const stressRadio = document.querySelector(`input[name="stress"][value="${stress}"]`);
    const illnessRadio = document.querySelector(`input[name="illness"][value="${illness}"]`);
    if (stressRadio) stressRadio.checked = true;
    if (illnessRadio) illnessRadio.checked = true;
    $("#alcoholUnits").value = entry ? round1(Number(entry.alcoholUnits) || 0) : 0;
    $("#bedtime").value = entry?.bedtime || "";
    $("#contextDialogTitle").textContent = date === localISO() ? "Today’s context" : `Context for ${formatDate(date, { day: "numeric", month: "short" })}`;
    updateAfterMidnightNotice();
  }

  function openContextDialog(date = defaultContextDate(), showDate = false) {
    const today = localISO();
    const safeDate = normaliseDate(date, defaultContextDate());
    const selectedDate = safeDate > today ? today : safeDate;
    const shiftedAfterMidnight = isAfterMidnightWindow() && selectedDate === addDaysISO(today, -1);
    $("#contextDate").max = today;
    $("#contextDate").value = selectedDate;
    $("#contextDateWrap").classList.toggle("hidden", !showDate && selectedDate === today && !shiftedAfterMidnight);
    $("#anotherContextDateButton").textContent = showDate || selectedDate !== today ? "Choose a different date" : "Add or edit another date";
    loadContextFormForDate(selectedDate);
    $("#contextDialog").showModal();
  }
  async function startNewFocus() {
    const confirmed = window.confirm("Archive the current focus period and start a fresh one? Targets, context and all historical totals will be kept.");
    if (!confirmed) return;
    await createRecoverySnapshot("Before starting a new focus period");
    state.focusHistory.push({ ...deepClone(state.currentFocus), completedAt: new Date().toISOString(), targetSnapshot: deepClone(state.targets) });
    const start = localISO();
    state.currentFocus = { id: uid("focus"), name: "My next 90-day focus", start, end: addMonthsISO(start, 3) };
    if (saveState("New focus period started")) {
      await createRecoverySnapshot("After starting a new focus period");
      if (state.targets.some(target => targetHistoryProfile(target.id).records.length >= 2)) setTimeout(openRecommendationDialog, 250);
    }
  }
  function exportData() {
    state.meta.lastExportAt = new Date().toISOString();
    persistState();
    const payload = { ...deepClone(state), exportedAt: state.meta.lastExportAt };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `focus-backup-v3-2-${localISO()}.json`;
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
      return items.map(item => ({ ...item, snapshotDate: item.snapshotDate || String(item.date || "").slice(0, 10) })).sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
    } catch (error) { return JSON.parse(localStorage.getItem(RECOVERY_FALLBACK_KEY) || "[]").map(item => ({ ...item, snapshotDate: item.snapshotDate || String(item.date || "").slice(0, 10) })).sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date)); }
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
    const snapshotDate = localISO();
    const isDaily = label === "Daily automatic snapshot";
    const date = isDaily ? `${snapshotDate}::daily` : `${snapshotDate}::${Date.now()}`;
    const snapshot = { date, snapshotDate, createdAt: new Date().toISOString(), label, state: deepClone(state) };
    await recoveryPut(snapshot);
    await recoveryDeleteOld();
    if (isDaily) localStorage.setItem("focus-tracker-last-recovery-date", snapshotDate);
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
    $("#recoveryList").innerHTML = items.length ? items.map(item => `<div class="recovery-item"><div><h4>${formatDate(item.snapshotDate)}</h4><p>${escapeHTML(item.label || "Recovery snapshot")} · ${item.state?.events?.length || 0} entries</p></div><button class="button secondary small" data-restore-date="${escapeHTML(item.date)}" type="button">Restore</button></div>`).join("") : `<div class="empty-state">No recovery points yet.</div>`;
    $("#recoveryDialog").showModal();
  }
  async function restoreRecovery(date) {
    const items = await recoveryGetAll();
    const item = items.find(snapshot => snapshot.date === date);
    if (!item) return;
    const confirmed = window.confirm(`Restore the recovery point from ${formatDate(item.snapshotDate)}? This replaces the current data.`);
    if (!confirmed) return;
    await createRecoverySnapshot("Before recovery restore");
    state = migrateState(item.state);
    $("#recoveryDialog").close();
    saveState(`Restored ${formatDate(item.snapshotDate)}`);
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
    const logOpener = event.target.closest("[data-open-log]"); if (logOpener) openLogDialog("", logOpener.dataset.openLog === "previous" ? addDaysISO(localISO(), -1) : localISO());
    const edit = event.target.closest("[data-edit]"); if (edit) openTargetDialog(edit.dataset.edit);
    const opener = event.target.closest("[data-open-target]"); if (opener) openTargetDialog(opener.dataset.openTarget || "");
    const context = event.target.closest("[data-open-context]"); if (context) openContextDialog(context.dataset.openContext || localISO());
    const collapse = event.target.closest("[data-collapse-theme]"); if (collapse) {
      const id = String(collapse.dataset.collapseTheme);
      const set = new Set((state.settings.collapsedThemes || []).map(String));
      set.has(id) ? set.delete(id) : set.add(id);
      state.settings.collapsedThemes = [...set];
      saveState();
    }
    const toggle = event.target.closest("[data-toggle]"); if (toggle) { const target = state.targets.find(item => sameId(item.id, toggle.dataset.toggle)); if (target) { target.active = !target.active; saveState(target.active ? `${target.name} resumed` : `${target.name} paused`); } }
    const deleteTheme = event.target.closest("[data-delete-theme]"); if (deleteTheme) { const id = deleteTheme.dataset.deleteTheme; if (state.targets.some(target => sameId(target.themeId, id))) window.alert("Move or delete the targets in this theme first."); else if (window.confirm("Delete this empty theme?")) { state.themes = state.themes.filter(theme => !sameId(theme.id, id)); saveState("Theme deleted"); } }
    const alcoholStep = event.target.closest("[data-alcohol-step]"); if (alcoholStep) { const next = Math.max(0, Number($("#alcoholUnits").value || 0) + Number(alcoholStep.dataset.alcoholStep)); $("#alcoholUnits").value = round1(next); }
    const restore = event.target.closest("[data-restore-date]"); if (restore) restoreRecovery(restore.dataset.restoreDate);
    const apply = event.target.closest("[data-apply-recommendation]"); if (apply) applyRecommendation(apply.dataset.applyRecommendation, apply.dataset.choice);
    const custom = event.target.closest("[data-custom-target]"); if (custom) { $("#recommendationDialog")?.close(); openTargetDialog(custom.dataset.customTarget); }
    const review = event.target.closest("[data-review-focus]"); if (review) openPeriodReview(review.dataset.reviewFocus);
    const repair = event.target.closest("[data-repair-health]"); if (repair) repairSafeIssues();
  });
  $("#focusForm").addEventListener("submit", event => { event.preventDefault(); const start = $("#focusStart").value; const end = $("#focusEnd").value; if (end < start) return window.alert("The end date must be after the start date."); state.currentFocus = { ...state.currentFocus, name: $("#focusName").value.trim(), start, end }; saveState("Focus period saved"); });
  $("#newFocusButton").addEventListener("click", startNewFocus);
  $("#recommendationsButton").addEventListener("click", openRecommendationDialog);
  $("#runHealthCheckButton").addEventListener("click", () => { state.meta.lastHealthCheckAt = new Date().toISOString(); persistState(); renderAppHealth(); showToast("App health checked"); });

  $("#targetForm").addEventListener("submit", event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const id = $("#targetId").value;
    const mode = goalModeValue();
    const details = { name: $("#targetName").value.trim(), emoji: $("#targetEmoji").value.trim() || "✓", themeId: $("#targetTheme").value, goalMode: mode, goalValue: Number(mode === "period" ? $("#periodGoalValue").value : $("#frequencyGoalValue").value), frequencyUnit: $("#frequencyUnit").value, briefingMode: briefingModeValue() };
    if (!details.name || !(details.goalValue > 0)) return;
    if (id) { const target = state.targets.find(target => sameId(target.id, id)); Object.assign(target, details); target.recommendation = { ...(target.recommendation || {}), choice: "custom", appliedAt: new Date().toISOString() }; }
    else state.targets.push({ id: uid("target"), ...details, active: true, createdAt: localISO(), recommendation: { choice: "custom", appliedAt: new Date().toISOString() } });
    $("#targetDialog").close();
    saveState(id ? "Target updated" : "Target added");
  });
  $$('input[name="goalMode"]').forEach(input => input.addEventListener("change", updateGoalForm));
  $("#periodGoalValue").addEventListener("input", updateGoalForm);
  $("#frequencyGoalValue").addEventListener("input", updateGoalForm);
  $("#frequencyUnit").addEventListener("change", updateGoalForm);

  $("#logForm").addEventListener("submit", event => { if (event.submitter?.value === "cancel") return; event.preventDefault(); if ($("#logDate").value > localISO()) return window.alert("Activity cannot be logged for a future date."); addEntries($("#logTarget").value, $("#logDate").value, Number($("#logQuantity").value)); $("#logDialog").close(); });

  $("#contextForm").addEventListener("submit", event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const date = $("#contextDate").value;
    if (date > localISO()) return window.alert("Context cannot be recorded for a future date.");
    const details = { stress: document.querySelector('input[name="stress"]:checked')?.value || "manageable", alcoholUnits: Math.max(0, Number($("#alcoholUnits").value || 0)), illness: document.querySelector('input[name="illness"]:checked')?.value || "well", bedtime: normaliseTime($("#bedtime").value, ""), updatedAt: new Date().toISOString() };
    const existing = state.contextEntries.find(entry => entry.date === date);
    if (existing) Object.assign(existing, details);
    else state.contextEntries.push({ id: uid("context"), date, createdAt: new Date().toISOString(), ...details });
    state.contextEntries = mergeContextByDate(state.contextEntries);
    $("#contextDialog").close();
    saveState(date === localISO() ? "Today’s context saved" : `Context saved for ${formatDate(date)}`);
  });
  $("#anotherContextDateButton").addEventListener("click", () => {
    $("#contextDateWrap").classList.remove("hidden");
    const yesterday = addDaysISO(localISO(), -1);
    if ($("#contextDate").value === localISO()) $("#contextDate").value = yesterday;
    loadContextFormForDate($("#contextDate").value);
    $("#contextDate").focus();
  });
  $("#contextDate").addEventListener("change", () => {
    if ($("#contextDate").value > localISO()) $("#contextDate").value = localISO();
    loadContextFormForDate($("#contextDate").value);
  });
  $("#useCurrentTimeButton").addEventListener("click", () => {
    const now = new Date();
    const today = localISO(now);
    if (isAfterMidnightWindow(now) && $("#contextDate").value === today) {
      $("#contextDateWrap").classList.remove("hidden");
      $("#contextDate").value = addDaysISO(today, -1);
      loadContextFormForDate($("#contextDate").value);
    }
    $("#bedtime").value = localTimeHHMM(now);
    updateAfterMidnightNotice();
  });
  $("#useTodayContextButton").addEventListener("click", () => {
    $("#contextDate").value = localISO();
    loadContextFormForDate($("#contextDate").value);
    $("#contextDateWrap").classList.remove("hidden");
  });

  $("#addThemeButton").addEventListener("click", () => { $("#themeName").value = ""; $("#themeIcon").value = ""; $("#themeColour").value = "green"; $("#themeDialog").showModal(); });
  $("#themeForm").addEventListener("submit", event => { if (event.submitter?.value === "cancel") return; event.preventDefault(); const name = $("#themeName").value.trim(); if (!name) return; state.themes.push({ id: uid("theme"), name, icon: $("#themeIcon").value.trim() || "✦", colour: $("#themeColour").value, builtIn: false }); $("#themeDialog").close(); saveState("Theme added"); });

  $("#briefingThreshold").addEventListener("change", () => { state.settings.briefingThreshold = clamp(Number($("#briefingThreshold").value || 10), 1, 999); saveState("Briefing threshold saved"); });
  $("#contextEnabled").addEventListener("change", () => { state.settings.contextEnabled = $("#contextEnabled").checked; saveState(state.settings.contextEnabled ? "Context tracking enabled" : "Context tracking disabled"); });
  $("#statsView").addEventListener("change", event => { if (event.target.id === "analysisTargetSelect") { state.settings.analysisTargetId = event.target.value; persistState(); renderContextInsights(); } });

  $("#exportButton").addEventListener("click", exportData);
  $("#importInput").addEventListener("change", event => { const [file] = event.target.files; if (file) importData(file); });
  $("#resetButton").addEventListener("click", resetEverything);
  $("#restoreButton").addEventListener("click", showRecoveryDialog);
  $("#persistentButton").addEventListener("click", requestPersistentStorage);

  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; $("#installButton").classList.remove("hidden"); });
  $("#installButton").addEventListener("click", async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $("#installButton").classList.add("hidden"); });
  window.addEventListener("appinstalled", () => { showToast("Focus installed"); $("#installButton").classList.add("hidden"); });

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker-v3-2.js", { updateViaCache: "none" }).catch(console.error));

  state = loadState();
  render();
  document.documentElement.dataset.focusReady = "true";
  document.documentElement.dataset.focusVersion = APP_VERSION;
  const bootFallback = document.getElementById("bootFallback");
  if (bootFallback) bootFallback.hidden = true;
  ensureDailySnapshot().then(async () => {
    if (migrationSnapshotPending) {
      await createRecoverySnapshot("After successful Focus 3.2 migration");
      migrationSnapshotPending = false;
    }
  }).catch(console.error);
  window.FocusDiagnostics = {
    version: APP_VERSION,
    schema: SCHEMA_VERSION,
    inspect: () => inspectState(deepClone(state)),
    snapshot: () => deepClone(state),
    profile: targetId => targetHistoryProfile(targetId),
    defaultContextDate: date => defaultContextDate(date ? new Date(date) : new Date()),
    bedtimeMinutes,
    bedtimeBand: (time, usual) => bedtimeBand(time, usual)
  };
})();
