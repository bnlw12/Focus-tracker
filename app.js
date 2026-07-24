(() => {
  "use strict";

  const STORAGE_KEY = "focus-tracker-state-v1";
  const DAY_MS = 86400000;
  let deferredInstallPrompt = null;
  let toastTimer = null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function localISO(date = new Date()) {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function parseISO(value) {
    return new Date(`${value}T12:00:00`);
  }

  function addMonthsISO(dateString, months) {
    const date = parseISO(dateString);
    date.setMonth(date.getMonth() + months);
    date.setDate(date.getDate() - 1);
    return localISO(date);
  }

  function uid(prefix = "id") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function daysInclusive(start, end) {
    return Math.max(1, Math.round((parseISO(end) - parseISO(start)) / DAY_MS) + 1);
  }

  function clamp(number, min, max) {
    return Math.min(Math.max(number, min), max);
  }

  function formatDate(dateString, options = { day: "numeric", month: "short", year: "numeric" }) {
    return parseISO(dateString).toLocaleDateString("en-GB", options);
  }

  function plural(number, singular, pluralWord = `${singular}s`) {
    return `${number} ${number === 1 ? singular : pluralWord}`;
  }

  function defaultState() {
    const start = localISO();
    return {
      version: 1,
      currentFocus: {
        id: uid("focus"),
        name: "My 90-day focus",
        start,
        end: addMonthsISO(start, 3)
      },
      focusHistory: [],
      targets: [
        { id: uid("target"), name: "Floss", emoji: "🦷", goalMode: "weekly", goalValue: 7, active: true, createdAt: start },
        { id: uid("target"), name: "Physio", emoji: "🧘", goalMode: "weekly", goalValue: 4, active: true, createdAt: start },
        { id: uid("target"), name: "Eat well", emoji: "🥗", goalMode: "weekly", goalValue: 5, active: true, createdAt: start },
        { id: uid("target"), name: "Exercise", emoji: "⚽", goalMode: "weekly", goalValue: 3, active: true, createdAt: start }
      ],
      events: []
    };
  }

  function validateState(candidate) {
    if (!candidate || typeof candidate !== "object") throw new Error("Backup is not valid.");
    if (!candidate.currentFocus || !Array.isArray(candidate.targets) || !Array.isArray(candidate.events)) {
      throw new Error("Backup is missing required information.");
    }
    return {
      version: 1,
      currentFocus: candidate.currentFocus,
      focusHistory: Array.isArray(candidate.focusHistory) ? candidate.focusHistory : [],
      targets: candidate.targets,
      events: candidate.events
    };
  }

  function loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? validateState(JSON.parse(stored)) : defaultState();
    } catch (error) {
      console.error(error);
      return defaultState();
    }
  }

  let state = loadState();

  function saveState(message) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
    if (message) showToast(message);
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function focusMetrics() {
    const { start, end } = state.currentFocus;
    const today = localISO();
    const totalDays = daysInclusive(start, end);
    let elapsedDays = 0;
    if (today >= start) {
      elapsedDays = today > end ? totalDays : daysInclusive(start, today);
    }
    elapsedDays = clamp(elapsedDays, 0, totalDays);
    const remainingDays = Math.max(totalDays - elapsedDays, 0);
    return { today, totalDays, elapsedDays, remainingDays };
  }

  function targetGoal(target, focus = state.currentFocus) {
    if (target.goalMode === "period") return Number(target.goalValue);
    return Math.ceil(Number(target.goalValue) * daysInclusive(focus.start, focus.end) / 7);
  }

  function entriesForTarget(targetId, start, end) {
    return state.events.filter(event =>
      event.targetId === targetId &&
      event.date >= start &&
      event.date <= end
    );
  }

  function countForTarget(targetId, start, end) {
    return entriesForTarget(targetId, start, end).length;
  }

  function currentTargetMetrics(target) {
    const focus = state.currentFocus;
    const { totalDays, elapsedDays, remainingDays, today } = focusMetrics();
    const goal = targetGoal(target);
    const count = countForTarget(target.id, focus.start, focus.end);
    const remaining = Math.max(goal - count, 0);
    const expected = totalDays ? goal * elapsedDays / totalDays : 0;
    const onTrack = count + 0.0001 >= expected;
    const currentRate = elapsedDays > 0 ? count / elapsedDays * 7 : 0;
    let requiredRate = 0;
    if (remaining > 0) {
      if (today < focus.start) requiredRate = goal / totalDays * 7;
      else if (remainingDays > 0) requiredRate = remaining / remainingDays * 7;
      else requiredRate = remaining;
    }
    return { goal, count, remaining, expected, onTrack, currentRate, requiredRate };
  }

  function goalDescription(target, focus = state.currentFocus) {
    if (target.goalMode === "weekly") {
      return `${target.goalValue} per week · ${targetGoal(target, focus)} across this focus`;
    }
    return `${target.goalValue} across this focus period`;
  }

  function renderFocusSummary() {
    const activeTargets = state.targets.filter(target => target.active);
    const metrics = focusMetrics();
    const targetMetrics = activeTargets.map(currentTargetMetrics);
    const totalGoals = targetMetrics.reduce((sum, item) => sum + item.goal, 0);
    const totalDone = targetMetrics.reduce((sum, item) => sum + Math.min(item.count, item.goal), 0);
    const completion = totalGoals ? Math.round(totalDone / totalGoals * 100) : 0;
    const onTrackCount = targetMetrics.filter(item => item.onTrack).length;

    $("#focusSummary").innerHTML = `
      <article class="focus-hero">
        <div class="hero-top">
          <div>
            <p class="eyebrow muted-light">CURRENT FOCUS</p>
            <h2>${escapeHTML(state.currentFocus.name)}</h2>
            <p class="muted-light">${formatDate(state.currentFocus.start)} – ${formatDate(state.currentFocus.end)}</p>
          </div>
          <div class="hero-score">
            <strong>${completion}%</strong>
            <span>complete</span>
          </div>
        </div>
        <div class="hero-stats">
          <div class="hero-stat">
            <strong>${metrics.remainingDays}</strong>
            <span>days remaining</span>
          </div>
          <div class="hero-stat">
            <strong>${onTrackCount}/${activeTargets.length}</strong>
            <span>targets on pace</span>
          </div>
          <div class="hero-stat">
            <strong>${state.events.filter(e => e.date === metrics.today).length}</strong>
            <span>logged today</span>
          </div>
        </div>
      </article>`;
  }

  function renderTargetCards() {
    const targets = state.targets.filter(target => target.active);
    const container = $("#targetCards");

    if (!targets.length) {
      container.innerHTML = `<div class="empty-state">No active targets yet. Add one in Manage.</div>`;
      return;
    }

    container.innerHTML = targets.map(target => {
      const m = currentTargetMetrics(target);
      const progress = m.goal ? clamp(Math.round(m.count / m.goal * 100), 0, 100) : 0;
      const hasEntry = m.count > 0;
      const remainingText = m.remaining === 0 ? "Target reached" : `${plural(m.remaining, "more time")} needed`;
      return `
        <article class="target-card ${m.onTrack ? "" : "behind"}">
          <div class="target-card-top">
            <div class="target-emoji">${escapeHTML(target.emoji || "✓")}</div>
            <div class="target-title">
              <h3>${escapeHTML(target.name)}</h3>
              <p>${escapeHTML(goalDescription(target))}</p>
            </div>
            <div class="target-count">
              <strong>${m.count}/${m.goal}</strong>
              <span>${progress}%</span>
            </div>
          </div>
          <div class="progress-track" aria-label="${progress}% complete">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
          <p class="muted">${remainingText}</p>
          <div class="pace-row">
            <div class="pace-box">
              <strong>${m.currentRate.toFixed(1)}/week</strong>
              <span>Your run rate</span>
            </div>
            <div class="pace-box">
              <strong>${m.requiredRate.toFixed(1)}/week</strong>
              <span>Needed from now</span>
            </div>
          </div>
          <div class="card-actions">
            <button class="button primary" data-add="${target.id}" type="button">+ Log today</button>
            <button class="icon-button" data-undo="${target.id}" type="button" aria-label="Undo latest ${escapeHTML(target.name)} entry" ${hasEntry ? "" : "disabled"}>−</button>
          </div>
        </article>`;
    }).join("");
  }

  function renderStats() {
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;
    const yearEnd = `${now.getFullYear()}-12-31`;
    const focus = state.currentFocus;
    const allEvents = state.events.length;
    const yearEvents = state.events.filter(event => event.date >= yearStart && event.date <= yearEnd).length;
    const focusEvents = state.events.filter(event => event.date >= focus.start && event.date <= focus.end).length;

    $("#statsOverview").innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><strong>${focusEvents}</strong><span>This focus</span></div>
        <div class="stat-card"><strong>${yearEvents}</strong><span>This year</span></div>
        <div class="stat-card"><strong>${allEvents}</strong><span>All time</span></div>
      </div>`;

    const targets = [...state.targets].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    if (!targets.length) {
      $("#statsTable").innerHTML = `<div class="empty-state">Statistics will appear after you add a target.</div>`;
      return;
    }

    $("#statsTable").innerHTML = `<div class="stats-list">${targets.map(target => {
      const m = currentTargetMetrics(target);
      const focusCount = countForTarget(target.id, focus.start, focus.end);
      const yearCount = countForTarget(target.id, yearStart, yearEnd);
      const allCount = state.events.filter(event => event.targetId === target.id).length;
      return `
        <article class="stats-row">
          <div class="stats-row-heading">
            <div class="stats-name">
              <div class="target-emoji">${escapeHTML(target.emoji || "✓")}</div>
              <div>
                <h3>${escapeHTML(target.name)}</h3>
                <p class="muted">${target.active ? escapeHTML(goalDescription(target)) : "Paused"}</p>
              </div>
            </div>
            ${target.active ? `<span class="status-pill ${m.onTrack ? "" : "behind"}">${m.onTrack ? "On pace" : "Behind pace"}</span>` : ""}
          </div>
          <div class="stat-periods">
            <div class="stat-period"><strong>${focusCount}</strong><span>This focus</span></div>
            <div class="stat-period"><strong>${yearCount}</strong><span>This year</span></div>
            <div class="stat-period"><strong>${allCount}</strong><span>All time</span></div>
          </div>
        </article>`;
    }).join("")}</div>`;
  }

  function renderManage() {
    $("#focusName").value = state.currentFocus.name;
    $("#focusStart").value = state.currentFocus.start;
    $("#focusEnd").value = state.currentFocus.end;

    const targetContainer = $("#manageTargets");
    if (!state.targets.length) {
      targetContainer.innerHTML = `<div class="empty-state">Add your first target.</div>`;
    } else {
      targetContainer.innerHTML = state.targets.map(target => `
        <div class="manage-item">
          <div class="manage-item-main">
            <div class="target-emoji">${escapeHTML(target.emoji || "✓")}</div>
            <div>
              <h4>${escapeHTML(target.name)} ${target.active ? "" : "· Paused"}</h4>
              <p>${escapeHTML(goalDescription(target))} · ${state.events.filter(e => e.targetId === target.id).length} all-time</p>
            </div>
          </div>
          <div class="manage-actions">
            <button class="text-button" data-edit="${target.id}" type="button">Edit</button>
            <button class="text-button" data-toggle="${target.id}" type="button">${target.active ? "Pause" : "Resume"}</button>
          </div>
        </div>`).join("");
    }

    const historyContainer = $("#focusHistory");
    if (!state.focusHistory.length) {
      historyContainer.innerHTML = `<p class="muted">No completed focus periods yet.</p>`;
    } else {
      historyContainer.innerHTML = [...state.focusHistory].reverse().map(focus => {
        const count = state.events.filter(event => event.date >= focus.start && event.date <= focus.end).length;
        return `
          <div class="history-item">
            <div>
              <h4>${escapeHTML(focus.name)}</h4>
              <p>${formatDate(focus.start)} – ${formatDate(focus.end)} · ${plural(count, "entry", "entries")}</p>
            </div>
          </div>`;
      }).join("");
    }

    const activeTargets = state.targets.filter(target => target.active);
    $("#logTarget").innerHTML = activeTargets.map(target =>
      `<option value="${target.id}">${escapeHTML(target.emoji || "✓")} ${escapeHTML(target.name)}</option>`
    ).join("");
    $("#logDate").value = localISO();
  }

  function render() {
    renderFocusSummary();
    renderTargetCards();
    renderStats();
    renderManage();
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function addEntries(targetId, date, quantity = 1) {
    const target = state.targets.find(item => item.id === targetId);
    if (!target) return;
    for (let i = 0; i < quantity; i += 1) {
      state.events.push({
        id: uid("event"),
        targetId,
        date,
        createdAt: new Date().toISOString()
      });
    }
    saveState(`${target.name} logged`);
  }

  function undoLatest(targetId) {
    const focus = state.currentFocus;
    const candidates = state.events
      .map((event, index) => ({ event, index }))
      .filter(item =>
        item.event.targetId === targetId &&
        item.event.date >= focus.start &&
        item.event.date <= focus.end
      )
      .sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt));

    if (!candidates.length) return;
    const target = state.targets.find(item => item.id === targetId);
    state.events.splice(candidates[0].index, 1);
    saveState(`Latest ${target?.name || "entry"} removed`);
  }

  function openTargetDialog(targetId = "") {
    const target = state.targets.find(item => item.id === targetId);
    $("#targetDialogTitle").textContent = target ? "Edit target" : "Add target";
    $("#targetId").value = target?.id || "";
    $("#targetName").value = target?.name || "";
    $("#targetEmoji").value = target?.emoji || "";
    $("#targetGoalMode").value = target?.goalMode || "weekly";
    $("#targetGoalValue").value = target?.goalValue || 3;
    updateGoalPreview();
    $("#targetDialog").showModal();
    setTimeout(() => $("#targetName").focus(), 50);
  }

  function updateGoalPreview() {
    const target = {
      goalMode: $("#targetGoalMode").value,
      goalValue: Number($("#targetGoalValue").value || 0)
    };
    const total = targetGoal(target);
    $("#goalPreview").textContent = target.goalMode === "weekly"
      ? `That works out at approximately ${plural(total, "time")} during this focus period.`
      : `You will aim for ${plural(total, "time")} by the end of this focus period.`;
  }

  function startNewFocus() {
    const confirmed = window.confirm(
      "This will archive the current focus period and start a fresh three-month period. Your targets and all statistics will be kept."
    );
    if (!confirmed) return;

    state.focusHistory.push({
      ...state.currentFocus,
      targetSnapshot: state.targets.map(({ id, name, emoji, goalMode, goalValue, active }) =>
        ({ id, name, emoji, goalMode, goalValue, active })
      )
    });

    const start = localISO();
    state.currentFocus = {
      id: uid("focus"),
      name: "My next 90-day focus",
      start,
      end: addMonthsISO(start, 3)
    };
    saveState("New focus period started");
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `focus-backup-${localISO()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Backup exported");
  }

  async function importData(file) {
    try {
      const text = await file.text();
      const imported = validateState(JSON.parse(text));
      const confirmed = window.confirm("Replace the data on this device with this backup?");
      if (!confirmed) return;
      state = imported;
      saveState("Backup imported");
    } catch (error) {
      console.error(error);
      window.alert(`Could not import this backup. ${error.message}`);
    } finally {
      $("#importInput").value = "";
    }
  }

  function resetEverything() {
    const confirmed = window.confirm("Delete every target and entry on this device? This cannot be undone unless you have exported a backup.");
    if (!confirmed) return;
    state = defaultState();
    saveState("App reset");
  }

  // Navigation
  $$(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      $$(".nav-item").forEach(item => item.classList.toggle("active", item === button));
      $$(".view").forEach(view => view.classList.toggle("active", view.id === button.dataset.view));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  // Generic dialog openers
  $$("[data-open-dialog]").forEach(button => {
    button.addEventListener("click", () => {
      const dialogId = button.dataset.openDialog;
      if (dialogId === "targetDialog") openTargetDialog();
      else {
        renderManage();
        $(`#${dialogId}`).showModal();
      }
    });
  });

  // Dynamic dashboard/manage actions
  document.addEventListener("click", event => {
    const addButton = event.target.closest("[data-add]");
    if (addButton) addEntries(addButton.dataset.add, localISO(), 1);

    const undoButton = event.target.closest("[data-undo]");
    if (undoButton) undoLatest(undoButton.dataset.undo);

    const editButton = event.target.closest("[data-edit]");
    if (editButton) openTargetDialog(editButton.dataset.edit);

    const toggleButton = event.target.closest("[data-toggle]");
    if (toggleButton) {
      const target = state.targets.find(item => item.id === toggleButton.dataset.toggle);
      if (target) {
        target.active = !target.active;
        saveState(target.active ? `${target.name} resumed` : `${target.name} paused`);
      }
    }
  });

  $("#focusForm").addEventListener("submit", event => {
    event.preventDefault();
    const start = $("#focusStart").value;
    const end = $("#focusEnd").value;
    if (end < start) {
      window.alert("The end date must be after the start date.");
      return;
    }
    state.currentFocus.name = $("#focusName").value.trim();
    state.currentFocus.start = start;
    state.currentFocus.end = end;
    saveState("Focus period saved");
  });

  $("#targetForm").addEventListener("submit", event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();

    const id = $("#targetId").value;
    const details = {
      name: $("#targetName").value.trim(),
      emoji: $("#targetEmoji").value.trim() || "✓",
      goalMode: $("#targetGoalMode").value,
      goalValue: Number($("#targetGoalValue").value)
    };

    if (!details.name || details.goalValue < 1) return;

    if (id) {
      const target = state.targets.find(item => item.id === id);
      Object.assign(target, details);
    } else {
      state.targets.push({
        id: uid("target"),
        ...details,
        active: true,
        createdAt: localISO()
      });
    }

    $("#targetDialog").close();
    saveState(id ? "Target updated" : "Target added");
  });

  $("#logForm").addEventListener("submit", event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    addEntries(
      $("#logTarget").value,
      $("#logDate").value,
      Number($("#logQuantity").value)
    );
    $("#logDialog").close();
    $("#logQuantity").value = 1;
  });

  $("#targetGoalMode").addEventListener("change", updateGoalPreview);
  $("#targetGoalValue").addEventListener("input", updateGoalPreview);
  $("#newFocusButton").addEventListener("click", startNewFocus);
  $("#exportButton").addEventListener("click", exportData);
  $("#importInput").addEventListener("change", event => {
    const [file] = event.target.files;
    if (file) importData(file);
  });
  $("#resetButton").addEventListener("click", resetEverything);

  // Install prompt
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("#installButton").classList.remove("hidden");
  });

  $("#installButton").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $("#installButton").classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    showToast("Focus installed");
    $("#installButton").classList.add("hidden");
  });

  // Offline support
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(console.error);
    });
  }

  render();
})();
