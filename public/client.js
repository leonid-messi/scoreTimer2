function $(id) { return document.getElementById(id); }

var timeDisplay = $('timeDisplay');
var toggleBtn = $('toggleBtn');
var resetAllBtn = $('resetAllBtn');
var tilesEl = $('tiles');

var ws;
var serverState = null;
var lastSyncTs = 0;     // wann kam der letzte STATE beim Client an
var lastServerTs = 0;   // Server-Zeitstempel des letzten STATE
var MAX_GOALS = 10;

function connect() {
  var proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host);

  ws.addEventListener('open', function () { });
  ws.addEventListener('close', function () { setTimeout(connect, 1000); });
  ws.addEventListener('message', function (ev) {
    var data = JSON.parse(ev.data);
    if (data.type === 'STATE') {
      serverState = data.state;
      lastSyncTs = Date.now();
      lastServerTs = data.ts || lastSyncTs;
      renderAll();
    }
  });
}

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: type, payload: payload }));
  }
}

function msToMMSS(ms) {
  var t = Math.max(0, Math.floor(ms / 1000));
  var m = String(Math.floor(t / 60)); if (m.length < 2) m = '0' + m;
  var s = String(t % 60); if (s.length < 2) s = '0' + s;
  return m + ':' + s;
}

// Sanfte Extrapolation basierend auf Serverdaten
function getRemaining() {
  if (!serverState) return 5 * 60 * 1000;
  var t = serverState.timer;
  if (!t) return 5 * 60 * 1000;

  if (!t.running) return t.remainingMs;

  // vergangene Zeit seit Server-State (Clientuhr)
  var deltaClient = Date.now() - lastSyncTs;
  if (deltaClient < 0) deltaClient = 0;
  if (deltaClient > 10000) deltaClient = 10000; // harte Kappe gegen Sprünge

  var elapsed = t.currentElapsedMs + deltaClient;
  if (elapsed < 0) elapsed = 0;
  if (elapsed > t.durationMs) elapsed = t.durationMs;

  return Math.max(0, t.durationMs - elapsed);
}

function renderTop() {
  var rem = getRemaining();
  timeDisplay.textContent = msToMMSS(rem);

  var running = serverState && serverState.timer && serverState.timer.running;
  toggleBtn.textContent = running ? 'Pause' : 'Start';
  toggleBtn.disabled = rem <= 0; // bei 0 kein Start möglich
}

function makeTile(team) {
  var div = document.createElement('div');
  div.className = 'tile';

  var btn = document.createElement('button');
  btn.addEventListener('click', function () {
    var st = null;
    if (serverState && serverState.teams) {
      for (var i = 0; i < serverState.teams.length; i++) {
        if (serverState.teams[i].id === team.id) { st = serverState.teams[i]; break; }
      }
    }
    var remaining = getRemaining();
    if (!st || remaining <= 0 || st.goals >= MAX_GOALS) {
      if ('vibrate' in navigator) navigator.vibrate([6, 8, 6]);
      return;
    }
    send('ADD_GOAL', { teamId: team.id });
    if ('vibrate' in navigator) navigator.vibrate(8);
  });

  var name = document.createElement('div');
  name.className = 'name';
  name.textContent = team.name; // nicht änderbar

  var score = document.createElement('div');
  score.className = 'score';
  score.textContent = team.goals;

  var time = document.createElement('div');
  time.className = 'time';
  time.textContent = team.lastGoalElapsedMs == null ? '—' : ('t: ' + msToMMSS(team.lastGoalElapsedMs));

  btn.appendChild(name);
  btn.appendChild(score);
  btn.appendChild(time);
  div.appendChild(btn);

  return div;
}

function renderTiles() {
  if (!serverState) return;
  tilesEl.innerHTML = '';
  for (var i = 0; i < serverState.teams.length; i++) {
    tilesEl.appendChild(makeTile(serverState.teams[i]));
  }
}

function renderAll() {
  renderTop();
  renderTiles();
}

// UI
toggleBtn.addEventListener('click', function () {
  send('TOGGLE_TIMER');
  if ('vibrate' in navigator) navigator.vibrate(5);
});

resetAllBtn.addEventListener('click', function () {
  if (confirm('Wirklich ALLES zurücksetzen (Timer + Tore)?')) {
    send('RESET_ALL');
    if ('vibrate' in navigator) navigator.vibrate([10, 20, 10]);
  }
});

// Timeranzeige weich aktualisieren (nur Anzeige, Logik bleibt am Server)
(function raf() { renderTop(); requestAnimationFrame(raf); })();

connect();