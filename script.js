'use strict';

// ============================================================
// State
// ============================================================

const config = {
  totalLaps: 5,
  targetLapMs: null,
};

let racers = [];
let nextRacerId = 0;

let records = [];      // persistent across resets
let nextRecordId = 0;

const timerState = {
  running: false,
  startTime: null,
  elapsed: 0,
  pauseAt: null,
  rafId: null,
};

let raceState = 'idle';
let expandedRacerId = null;
let expandedRecordId = null;

// ============================================================
// Time Utilities
// ============================================================

function pad2(n) {
  return String(Math.floor(n)).padStart(2, '0');
}

function formatTime(ms) {
  const totalCs  = Math.floor(ms / 10);
  const cs       = totalCs % 100;
  const totalSec = Math.floor(ms / 1000);
  const sec      = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min      = totalMin % 60;
  const hr       = Math.floor(totalMin / 60);

  if (hr > 0) return `${hr}:${pad2(min)}:${pad2(sec)}.${pad2(cs)}`;
  return `${pad2(min)}:${pad2(sec)}.${pad2(cs)}`;
}

function parseTargetTime(str) {
  str = str.trim();
  if (!str) return null;
  const match = str.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const min = parseInt(match[1], 10);
  const sec = parseInt(match[2], 10);
  let sub = 0;
  if (match[3]) {
    const padded = match[3].padEnd(2, '0').slice(0, 2);
    sub = parseInt(padded, 10) * 10;
  }
  return (min * 60 + sec) * 1000 + sub;
}

// ============================================================
// Timer Engine
// ============================================================

function timerTick() {
  const now = performance.now();
  const elapsed = timerState.elapsed + (now - timerState.startTime);
  document.getElementById('timer-display').textContent = formatTime(elapsed);
  updateLeaderboardRealtime(now);
  timerState.rafId = requestAnimationFrame(timerTick);
}

// Update total-time cells and re-sort leaderboard rows every frame
function updateLeaderboardRealtime(now) {
  const tbody = document.getElementById('leaderboard-body');
  if (!tbody) return;

  // Update running totals for each non-finished racer
  racers.forEach(r => {
    if (r.finished || !r.currentLapStart) return;
    const row = tbody.querySelector(`.lb-row[data-racer-id="${r.id}"]`);
    if (!row) return;
    const runningTotal = getTotalTimeMs(r) + (now - r.currentLapStart);
    row.querySelector('.col-total').textContent = formatTime(runningTotal);
  });

  // Re-sort DOM rows if order changed
  const sorted = sortedRacersRealtime(now);
  const currentOrder = [...tbody.querySelectorAll('.lb-row')].map(r => r.dataset.racerId).join(',');
  const newOrder = sorted.map(r => String(r.id)).join(',');

  if (currentOrder !== newOrder) {
    sorted.forEach((racer, i) => {
      const mainRow   = tbody.querySelector(`.lb-row[data-racer-id="${racer.id}"]`);
      const detailRow = tbody.querySelector(`.lb-detail-row[data-racer-id="${racer.id}"]`);
      if (mainRow)   tbody.appendChild(mainRow);
      if (detailRow) tbody.appendChild(detailRow);

      // Update position badge
      if (mainRow) {
        mainRow.querySelector('.col-pos').textContent = i + 1;
        mainRow.classList.remove('is-p1', 'is-p2', 'is-p3');
        if (i === 0) mainRow.classList.add('is-p1');
        else if (i === 1) mainRow.classList.add('is-p2');
        else if (i === 2) mainRow.classList.add('is-p3');
      }
    });
  }
}

function sortedRacersRealtime(now) {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.finishPosition - b.finishPosition;
    if (a.finished) return -1;
    if (b.finished) return 1;

    const lapDiff = b.lapTimes.length - a.lapTimes.length;
    if (lapDiff !== 0) return lapDiff;

    const aTotal = getTotalTimeMs(a) + (a.currentLapStart ? now - a.currentLapStart : 0);
    const bTotal = getTotalTimeMs(b) + (b.currentLapStart ? now - b.currentLapStart : 0);
    return aTotal - bTotal;
  });
}

// ============================================================
// Race State Transitions
// ============================================================

function startRace() {
  if (racers.length === 0) {
    shakeElement(document.getElementById('racer-name-input'));
    return;
  }

  const now = performance.now();
  timerState.startTime = now;
  timerState.elapsed = 0;
  timerState.running = true;

  racers.forEach(r => {
    r.lapTimes = [];
    r.currentLapStart = now;
    r.finished = false;
    r.finishPosition = null;
    r.recorded = false;
  });

  timerState.rafId = requestAnimationFrame(timerTick);
  setRaceState('running');
}

function pauseRace() {
  const now = performance.now();
  timerState.elapsed += now - timerState.startTime;
  timerState.pauseAt = now;
  timerState.running = false;
  cancelAnimationFrame(timerState.rafId);
  setRaceState('paused');
}

function resumeRace() {
  const now = performance.now();
  const pauseDuration = now - timerState.pauseAt;

  racers.forEach(r => {
    if (!r.finished && r.currentLapStart !== null) {
      r.currentLapStart += pauseDuration;
    }
  });

  timerState.startTime = now;
  timerState.running = true;
  timerState.rafId = requestAnimationFrame(timerTick);
  setRaceState('running');
}

function resetRace() {
  cancelAnimationFrame(timerState.rafId);
  timerState.running = false;
  timerState.startTime = null;
  timerState.elapsed = 0;
  timerState.rafId = null;

  // Save any racer with laps that hasn't been recorded yet
  racers.forEach(r => {
    if (!r.recorded && r.lapTimes.length > 0) {
      saveRacerRecord(r);
    }
  });

  racers.forEach(r => {
    r.lapTimes = [];
    r.currentLapStart = null;
    r.finished = false;
    r.finishPosition = null;
    r.recorded = false;
  });

  expandedRacerId = null;
  document.getElementById('timer-display').textContent = formatTime(0);

  setRaceState('idle');
  renderAll();
}

function setRaceState(state) {
  raceState = state;
  document.body.className = 'state-' + state;

  const badge    = document.getElementById('race-status-badge');
  const startBtn = document.getElementById('start-btn');
  const stopBtn  = document.getElementById('stop-btn');
  const resetBtn = document.getElementById('reset-btn');

  badge.className = 'status-badge';

  switch (state) {
    case 'idle':
      badge.classList.add('status-idle');
      badge.textContent = 'READY';
      startBtn.textContent = 'START';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      resetBtn.disabled = true;
      lockConfig(false);
      break;

    case 'running':
      badge.classList.add('status-running');
      badge.textContent = 'RACING';
      stopBtn.textContent = 'PAUSE';
      stopBtn.disabled = false;
      resetBtn.disabled = false;
      lockConfig(true);
      break;

    case 'paused':
      badge.classList.add('status-paused');
      badge.textContent = 'PAUSED';
      startBtn.textContent = 'RESUME';
      startBtn.disabled = false;
      resetBtn.disabled = false;
      lockConfig(true);
      break;

    case 'finished':
      badge.classList.add('status-finished');
      badge.textContent = 'FINISHED';
      resetBtn.disabled = false;
      lockConfig(true);
      break;
  }

  renderLapButtons();
  renderLeaderboard();
}

function lockConfig(locked) {
  document.getElementById('lap-count-input').disabled = locked;
  document.getElementById('target-lap-input').disabled = locked;
  document.getElementById('racer-name-input').disabled = locked;
  document.getElementById('add-racer-btn').disabled = locked;
  document.querySelectorAll('.btn-remove').forEach(b => b.disabled = locked);
}

// ============================================================
// Records (persistent)
// ============================================================

function saveRacerRecord(racer) {
  records.push({
    recordId: nextRecordId++,
    name: racer.name,
    lapTimes: [...racer.lapTimes],
    totalMs: racer.lapTimes.reduce((a, b) => a + b, 0),
    bestLapMs: racer.lapTimes.length ? Math.min(...racer.lapTimes) : null,
    totalLaps: config.totalLaps,
    finished: racer.finished,
    timestamp: new Date(),
  });
  racer.recorded = true;
  renderRecords();
}

function deleteRecord(recordId) {
  records = records.filter(r => r.recordId !== recordId);
  if (expandedRecordId === recordId) expandedRecordId = null;
  renderRecords();
}

function renderRecords() {
  const section  = document.getElementById('records-section');
  const empty    = document.getElementById('records-empty');
  const tbody    = document.getElementById('records-body');
  const table    = document.getElementById('records-table');

  if (records.length === 0) {
    empty.style.display = 'block';
    table.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  table.style.display = '';

  // Find overall best lap across all records
  let overallBest = null;
  records.forEach(r => {
    if (r.bestLapMs !== null && (overallBest === null || r.bestLapMs < overallBest)) {
      overallBest = r.bestLapMs;
    }
  });

  tbody.innerHTML = '';

  // Sort: finished first, then by total time ascending
  const sorted = [...records].sort((a, b) => {
    if (a.finished && !b.finished) return -1;
    if (!a.finished && b.finished) return 1;
    return a.totalMs - b.totalMs;
  });

  sorted.forEach((rec, i) => {
    const mainRow = document.createElement('tr');
    mainRow.className = 'rec-row';
    mainRow.dataset.recordId = rec.recordId;
    if (i === 0) mainRow.classList.add('is-p1');
    else if (i === 1) mainRow.classList.add('is-p2');
    else if (i === 2) mainRow.classList.add('is-p3');
    if (expandedRecordId === rec.recordId) mainRow.classList.add('is-expanded');

    const dateStr = rec.timestamp.toLocaleDateString() + ' ' +
                    rec.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const bestClass = rec.bestLapMs === overallBest ? 'lb-best-overall' : '';
    const bestText  = rec.bestLapMs !== null ? formatTime(rec.bestLapMs) : '—';
    const totalText = formatTime(rec.totalMs);
    const lapsText  = `${rec.lapTimes.length}/${rec.totalLaps}`;
    const statusBadge = rec.finished
      ? `<span class="lb-status-badge status-done">FINISHED</span>`
      : `<span class="lb-status-badge status-racing">PARTIAL</span>`;

    mainRow.innerHTML = `
      <td class="col-racer">
        <span class="lb-racer-name">${escHtml(rec.name)}</span>
        <span class="lb-expand-icon">&#x25BE;</span>
      </td>
      <td class="col-lap">${lapsText}</td>
      <td class="col-best ${bestClass}">${bestText}</td>
      <td class="col-total">${totalText}</td>
      <td class="rec-date">${dateStr}</td>
      <td class="rec-status">${statusBadge}</td>
      <td class="rec-del">
        <button class="btn-rec-delete" data-delete-id="${rec.recordId}" title="Delete">&#x2715;</button>
      </td>
    `;

    const detailRow = document.createElement('tr');
    detailRow.className = 'lb-detail-row' + (expandedRecordId === rec.recordId ? ' is-expanded' : '');
    detailRow.dataset.recordId = rec.recordId;

    const chips = rec.lapTimes.map((ms, idx) => {
      let cls = 'no-target';
      if (config.targetLapMs !== null) {
        cls = ms <= config.targetLapMs ? 'is-faster' : 'is-slower';
      }
      return `<div class="lb-lap-chip">
        <span class="lb-lap-num">Lap ${idx + 1}</span>
        <span class="lb-lap-time ${cls}">${formatTime(ms)}</span>
      </div>`;
    }).join('');

    detailRow.innerHTML = `
      <td colspan="7">
        <div class="lb-detail-inner">
          <div class="lb-detail-content">
            <div class="lb-detail-grid">${chips || '<span style="color:var(--text-dim);font-size:0.8rem;">No laps recorded.</span>'}</div>
          </div>
        </div>
      </td>
    `;

    tbody.appendChild(mainRow);
    tbody.appendChild(detailRow);
  });
}

// ============================================================
// Racer Management
// ============================================================

function addRacer() {
  const input = document.getElementById('racer-name-input');
  const name = input.value.trim();
  if (!name) { shakeElement(input); return; }

  racers.push({
    id: nextRacerId++,
    name,
    lapTimes: [],
    currentLapStart: null,
    finished: false,
    finishPosition: null,
    recorded: false,
  });

  input.value = '';
  input.focus();
  renderRacerList();
  renderLeaderboard();
}

function removeRacer(id) {
  racers = racers.filter(r => r.id !== id);
  if (expandedRacerId === id) expandedRacerId = null;
  renderRacerList();
  renderLeaderboard();
}

function renderRacerList() {
  const list  = document.getElementById('racer-list');
  const empty = document.getElementById('racer-list-empty');

  list.innerHTML = '';
  empty.style.display = racers.length ? 'none' : 'block';

  racers.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="racer-list-name">${escHtml(r.name)}</span>
      <button class="btn-remove" data-remove-id="${r.id}" title="Remove">&#x2715;</button>
    `;
    list.appendChild(li);
  });
}

// ============================================================
// Lap Recording
// ============================================================

function recordLap(racerId) {
  const racer = racers.find(r => r.id === racerId);
  if (!racer || racer.finished || raceState !== 'running') return;

  const now = performance.now();
  const lapMs = now - racer.currentLapStart;

  racer.lapTimes.push(lapMs);
  racer.currentLapStart = now;

  if (racer.lapTimes.length >= config.totalLaps) {
    racer.finished = true;
    racer.finishPosition = racers.filter(r => r.finished).length;
    saveRacerRecord(racer);
    flashFinish(racerId);

    if (racers.every(r => r.finished)) {
      cancelAnimationFrame(timerState.rafId);
      timerState.running = false;
      setRaceState('finished');
      return;
    }
  }

  renderLapButtons();
  renderLeaderboard();
}

function flashFinish(racerId) {
  const row = document.querySelector(`.lb-row[data-racer-id="${racerId}"]`);
  if (!row) return;
  row.style.transition = 'none';
  row.style.background = 'rgba(0, 200, 83, 0.3)';
  setTimeout(() => {
    row.style.transition = 'background 1s ease';
    row.style.background = '';
  }, 50);
}

// ============================================================
// Leaderboard (active race)
// ============================================================

function getBestLapMs(racer) {
  if (racer.lapTimes.length === 0) return null;
  return Math.min(...racer.lapTimes);
}

function getTotalTimeMs(racer) {
  return racer.lapTimes.reduce((a, b) => a + b, 0);
}

function overallBestLapMs() {
  let best = null;
  racers.forEach(r => {
    const b = getBestLapMs(r);
    if (b !== null && (best === null || b < best)) best = b;
  });
  return best;
}

function sortedRacers() {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.finishPosition - b.finishPosition;
    if (a.finished) return -1;
    if (b.finished) return 1;
    const lapDiff = b.lapTimes.length - a.lapTimes.length;
    if (lapDiff !== 0) return lapDiff;
    return getTotalTimeMs(a) - getTotalTimeMs(b);
  });
}

function renderLeaderboard() {
  const tbody    = document.getElementById('leaderboard-body');
  const emptyMsg = document.getElementById('leaderboard-empty');
  const table    = document.getElementById('leaderboard');

  if (racers.length === 0) {
    emptyMsg.style.display = 'block';
    table.style.display = 'none';
    return;
  }
  emptyMsg.style.display = 'none';
  table.style.display = '';

  const sorted      = sortedRacers();
  const overallBest = overallBestLapMs();

  const existingRows = {};
  tbody.querySelectorAll('.lb-row').forEach(row => { existingRows[row.dataset.racerId] = row; });
  const existingDetails = {};
  tbody.querySelectorAll('.lb-detail-row').forEach(row => { existingDetails[row.dataset.racerId] = row; });

  sorted.forEach((racer, index) => {
    const pos = index + 1;
    let mainRow   = existingRows[racer.id];
    let detailRow = existingDetails[racer.id];

    if (!mainRow) {
      mainRow   = createMainRow(racer.id);
      detailRow = createDetailRow(racer.id);
    }

    updateMainRow(mainRow, racer, pos, overallBest);
    updateDetailRow(detailRow, racer);

    tbody.appendChild(mainRow);
    tbody.appendChild(detailRow);
  });

  Object.keys(existingRows).forEach(id => {
    if (!racers.find(r => r.id == id)) {
      existingRows[id].remove();
      if (existingDetails[id]) existingDetails[id].remove();
    }
  });
}

function createMainRow(racerId) {
  const tr = document.createElement('tr');
  tr.className = 'lb-row';
  tr.dataset.racerId = racerId;
  tr.innerHTML = `
    <td class="col-pos"></td>
    <td class="col-racer"><span class="lb-racer-name"></span><span class="lb-expand-icon">&#x25BE;</span></td>
    <td class="col-lap"></td>
    <td class="col-best"></td>
    <td class="col-total"></td>
    <td class="col-status"></td>
  `;
  return tr;
}

function updateMainRow(row, racer, pos, overallBest) {
  row.className = 'lb-row';
  if (racer.finished) row.classList.add('is-finished');
  if (pos === 1) row.classList.add('is-p1');
  else if (pos === 2) row.classList.add('is-p2');
  else if (pos === 3) row.classList.add('is-p3');
  if (expandedRacerId === racer.id) row.classList.add('is-expanded');

  row.querySelector('.col-pos').textContent = pos;
  row.querySelector('.lb-racer-name').textContent = racer.name;

  const lapDone = racer.lapTimes.length;
  row.querySelector('.col-lap').textContent =
    raceState === 'idle' ? '—' : `${lapDone}/${config.totalLaps}`;

  const bestMs  = getBestLapMs(racer);
  const bestEl  = row.querySelector('.col-best');
  bestEl.textContent = bestMs !== null ? formatTime(bestMs) : '—';
  bestEl.className   = 'col-best' + (bestMs !== null && bestMs === overallBest ? ' lb-best-overall' : '');

  const totalMs = getTotalTimeMs(racer);
  row.querySelector('.col-total').textContent = lapDone > 0 ? formatTime(totalMs) : '—';

  const statusEl = row.querySelector('.col-status');
  if (racer.finished) {
    const label = racer.finishPosition === 1 ? 'P1 FINISHED' : 'FINISHED';
    statusEl.innerHTML = `<span class="lb-status-badge status-done">${label}</span>`;
  } else if (raceState === 'running' || raceState === 'paused') {
    statusEl.innerHTML = `<span class="lb-status-badge status-racing">RACING</span>`;
  } else {
    statusEl.textContent = '—';
  }
}

function createDetailRow(racerId) {
  const tr = document.createElement('tr');
  tr.className = 'lb-detail-row';
  tr.dataset.racerId = racerId;
  tr.innerHTML = `
    <td colspan="6">
      <div class="lb-detail-inner">
        <div class="lb-detail-content">
          <div class="lb-detail-grid"></div>
        </div>
      </div>
    </td>
  `;
  return tr;
}

function updateDetailRow(row, racer) {
  row.classList.toggle('is-expanded', expandedRacerId === racer.id);
  const grid = row.querySelector('.lb-detail-grid');
  grid.innerHTML = '';

  racer.lapTimes.forEach((ms, i) => {
    const chip = document.createElement('div');
    chip.className = 'lb-lap-chip';
    let timeClass = 'no-target';
    if (config.targetLapMs !== null) {
      timeClass = ms <= config.targetLapMs ? 'is-faster' : 'is-slower';
    }
    chip.innerHTML = `
      <span class="lb-lap-num">Lap ${i + 1}</span>
      <span class="lb-lap-time ${timeClass}">${formatTime(ms)}</span>
    `;
    grid.appendChild(chip);
  });

  if (racer.lapTimes.length === 0) {
    grid.innerHTML = '<span style="color:var(--text-dim);font-size:0.8rem;">No laps recorded.</span>';
  }
}

// ============================================================
// Lap Buttons
// ============================================================

function renderLapButtons() {
  const list = document.getElementById('lap-buttons-list');
  list.innerHTML = '';

  racers.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'lap-btn' + (r.finished ? ' is-finished' : '');
    btn.dataset.racerId = r.id;
    const lapNum    = r.lapTimes.length + 1;
    const displayLap = r.finished ? 'FINISHED' : `Lap ${lapNum} / ${config.totalLaps}`;
    btn.innerHTML = `
      <span class="lap-btn-name">${escHtml(r.name)}</span>
      <span class="lap-btn-lap">${displayLap}</span>
    `;
    list.appendChild(btn);
  });
}

// ============================================================
// Rendering helpers
// ============================================================

function renderLapIndicator() {
  const el     = document.getElementById('lap-indicator');
  const target = config.targetLapMs !== null ? ` · Target ${formatTime(config.targetLapMs)}/lap` : '';
  el.textContent = `${config.totalLaps} LAP RACE${target}`;
}

function renderAll() {
  renderRacerList();
  renderLapButtons();
  renderLeaderboard();
  renderRecords();
  renderLapIndicator();
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shakeElement(el) {
  el.style.animation = 'none';
  el.getBoundingClientRect();
  el.style.animation = 'shake 0.3s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

// ============================================================
// Events
// ============================================================

function bindEvents() {
  document.getElementById('start-btn').addEventListener('click', () => {
    if (raceState === 'idle') startRace();
    else if (raceState === 'paused') resumeRace();
  });

  document.getElementById('stop-btn').addEventListener('click', () => {
    if (raceState === 'running') pauseRace();
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset the race? (Lap records will be saved to history.)')) return;
    resetRace();
  });

  document.getElementById('add-racer-btn').addEventListener('click', addRacer);

  document.getElementById('racer-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addRacer();
  });

  document.getElementById('lap-count-input').addEventListener('change', e => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 99) val = 99;
    e.target.value = val;
    config.totalLaps = val;
    renderLapIndicator();
    renderLapButtons();
    renderLeaderboard();
  });

  document.getElementById('target-lap-input').addEventListener('change', e => {
    const parsed = parseTargetTime(e.target.value);
    config.targetLapMs = parsed;
    e.target.style.borderColor = (e.target.value.trim() && parsed === null) ? 'var(--accent-red)' : '';
    renderLapIndicator();
  });

  document.getElementById('racer-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-remove-id]');
    if (btn) removeRacer(parseInt(btn.dataset.removeId, 10));
  });

  document.getElementById('lap-buttons-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-racer-id]');
    if (btn) recordLap(parseInt(btn.dataset.racerId, 10));
  });

  // Leaderboard expand/collapse
  document.getElementById('leaderboard-body').addEventListener('click', e => {
    const row = e.target.closest('.lb-row');
    if (!row) return;
    const id = parseInt(row.dataset.racerId, 10);
    expandedRacerId = expandedRacerId === id ? null : id;
    renderLeaderboard();
  });

  // Records: expand/collapse and delete
  document.getElementById('records-body').addEventListener('click', e => {
    const delBtn = e.target.closest('[data-delete-id]');
    if (delBtn) {
      deleteRecord(parseInt(delBtn.dataset.deleteId, 10));
      return;
    }
    const row = e.target.closest('.rec-row');
    if (row) {
      const id = parseInt(row.dataset.recordId, 10);
      expandedRecordId = expandedRecordId === id ? null : id;
      renderRecords();
    }
  });
}

// ============================================================
// Shake keyframe (injected)
// ============================================================

(function injectShakeKeyframe() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%,100%{transform:translateX(0)}
      20%{transform:translateX(-6px)}
      40%{transform:translateX(6px)}
      60%{transform:translateX(-4px)}
      80%{transform:translateX(4px)}
    }
  `;
  document.head.appendChild(style);
})();

// ============================================================
// Init
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  config.totalLaps = parseInt(document.getElementById('lap-count-input').value, 10);
  bindEvents();
  renderAll();
  setRaceState('idle');
});
