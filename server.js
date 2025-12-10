const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const DURATION_MS = 5 * 60 * 1000; // 5 Minuten
const MAX_GOALS = 10;

// Zustand
let state = {
  timer: { running: false, startTime: null, elapsedMs: 0 },
  teams: Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    name: 'Team ' + (i + 1),
    goals: 0,
    lastGoalElapsedMs: null
  }))
};

// Abgeleiteter Zustand
function derived() {
  const now = Date.now();
  let elapsed = state.timer.elapsedMs;

  // nur weiterzählen, wenn Timer aktiv läuft
  if (state.timer.running && state.timer.startTime) {
    elapsed += now - state.timer.startTime;
  }

  if (elapsed < 0) elapsed = 0;
  if (elapsed > DURATION_MS) elapsed = DURATION_MS;

  const remaining = Math.max(0, DURATION_MS - elapsed);
  const running = state.timer.running && remaining > 0;

  return {
    timer: {
      running: running,
      startTime: state.timer.startTime,
      durationMs: DURATION_MS,
      currentElapsedMs: elapsed,
      remainingMs: remaining
    },
    teams: state.teams
  };
}

function broadcast() {
  const payload = JSON.stringify({ type: 'STATE', state: derived(), ts: Date.now() });
  wss.clients.forEach(function (c) {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  });
}

// Timersteuerung
function startTimer() {
  const d = derived();
  if (d.timer.remainingMs <= 0) return; // bereits abgelaufen
  if (!state.timer.running) {
    state.timer.running = true;
    state.timer.startTime = Date.now();
  }
}

function pauseTimer() {
  if (state.timer.running) {
    const now = Date.now();
    // exakt bis jetzt addieren
    state.timer.elapsedMs += now - (state.timer.startTime || now);
    state.timer.startTime = null;
    state.timer.running = false;
  }
}

function resetAll() {
  state.timer = { running: false, startTime: null, elapsedMs: 0 };
  state.teams = state.teams.map(function (t) {
    return { id: t.id, name: t.name, goals: 0, lastGoalElapsedMs: null };
  });
}

// WebSocket Logik
wss.on('connection', function (ws) {
  ws.send(JSON.stringify({ type: 'STATE', state: derived(), ts: Date.now() }));

  ws.on('message', function (msg) {
    try {
      var parsed = JSON.parse(msg);
      var type = parsed.type;
      var payload = parsed.payload;

      switch (type) {
        case 'TOGGLE_TIMER': {
          var d = derived();
          if (d.timer.remainingMs > 0) {
            if (state.timer.running) pauseTimer(); else startTimer();
          }
          break;
        }

        case 'ADD_GOAL': {
          var teamId = payload && payload.teamId;
          var team = state.teams.find(function (t) { return t.id === teamId; });
          if (!team) break;

          var d2 = derived();

          // Kein Tor, wenn Uhr nicht läuft
          if (!state.timer.running) break;

          // Nur während laufender Zeit und < MAX_GOALS
          if (d2.timer.remainingMs > 0 && team.goals < MAX_GOALS) {
            team.goals += 1;
            team.lastGoalElapsedMs = d2.timer.currentElapsedMs;
          }
          break;
        }

        case 'RESET_ALL': {
          resetAll();
          break;
        }

        default:
          break;
      }

      var d3 = derived();
      // Stoppe exakt bei 0
      if (d3.timer.remainingMs <= 0 && state.timer.running) pauseTimer();
      broadcast();
    } catch (e) {
      console.error('WS message error:', e);
    }
  });
});

// Regelmäßige Broadcasts für exakte Anzeige
setInterval(function () {
  var d = derived();
  if (d.timer.remainingMs <= 0 && state.timer.running) pauseTimer();
  broadcast();
}, 200);

var PORT = process.env.PORT || 3000;
server.listen(PORT, function () {
  console.log('Server läuft auf http://localhost:' + PORT);
});