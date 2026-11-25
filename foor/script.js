//  SEADED: saab kõiki aegu ja reegleid muuta
const CONFIG = {
  modes: {
    morning: { name: "Hommik", greenA: 40, greenB: 15, pedAuto: false },
    day: { name: "Lõuna", greenA: 25, greenB: 20, pedAuto: true },
    evening: { name: "Õhtu",   greenA: 30, greenB: 25, pedAuto: true  },
    night:   { name: "Öö" },
  },
  // Automaatse režiimi kellaajad (täistunnid). Ülejäänud aeg = öö.
  hours: { morning: [6, 10], day: [10, 16], evening: [16, 23], night: [23, 6] },
  yellow: 3,             // kollane (s)
  redYellow: 2,          // punane + kollane (s)
  allRed: 2,             // kõik punased faaside vahel (s)
  pedGreen: 7,           // jalakäija roheline (s)
  pedBlink: 4,           // jalakäija vilkuv roheline (s)
  minGreenOnRequest: 12, // õhtul: nupp lühendab autode rohelist, aga mitte alla selle (s)
  heartbeatMs: 2000,     // kui tihti olekut Arduinole korratakse
  // Millise autogrupi rohelisega KOOS jalakäija roheliseks läheb.
  // NB! Kontrolli kohapeal ja muuda vajadusel.
  peds: {
    J1: { group: "A", label: "Üle Vesivärava (põhja pool)" },
    J2: { group: "B", label: "Üle Gonsiori (lääne pool)" },
    J3: { group: "A", label: "Üle Vesivärava (lõuna pool)" },
  },
};

// Faasid ringis. A ja B ei ole kunagi korraga rohelised.
const PHASES = [
  { id: "A_GREEN",     name: "A roheline",          A: "G",  B: "R",  dur: m => m.greenA, group: "A" },
  { id: "A_YELLOW",    name: "A kollane",           A: "Y",  B: "R",  dur: () => CONFIG.yellow },
  { id: "ALL_RED_1",   name: "Kõik punased",        A: "R",  B: "R",  dur: () => CONFIG.allRed },
  { id: "B_REDYELLOW", name: "B punane + kollane",  A: "R",  B: "RY", dur: () => CONFIG.redYellow },
  { id: "B_GREEN",     name: "B roheline",          A: "R",  B: "G",  dur: m => m.greenB, group: "B" },
  { id: "B_YELLOW",    name: "B kollane",           A: "R",  B: "Y",  dur: () => CONFIG.yellow },
  { id: "ALL_RED_2",   name: "Kõik punased",        A: "R",  B: "R",  dur: () => CONFIG.allRed },
  { id: "A_REDYELLOW", name: "A punane + kollane",  A: "RY", B: "R",  dur: () => CONFIG.redYellow },
];
const RESTART_PHASE = 6; // pärast öörežiimi alustame "kõik punased" faasist

//  OLEK
const pedIds = Object.keys(CONFIG.peds);
const state = {
  manualMode: null,       // null = automaatne kella järgi
  mode: null,
  phaseIdx: RESTART_PHASE,
  phaseStart: Date.now(),
  phaseDur: CONFIG.allRed,
  requests: Object.fromEntries(pedIds.map(j => [j, false])), // nuppu vajutatud, ootab
  pedActive: Object.fromEntries(pedIds.map(j => [j, false])), // saab selles faasis rohelise
};

function autoMode(date = new Date()) {
  const h = date.getHours();
  for (const mode of ["morning", "day", "evening"]) {
    const [start, end] = CONFIG.hours[mode];
    if (h >= start && h < end) return mode;
  }
  return "night";
}
const currentMode = () => state.manualMode || autoMode();
const elapsed = () => (Date.now() - state.phaseStart) / 1000;
const modeCfg = () => CONFIG.modes[state.mode];

//  FAASIMASIN
function startPhase(idx) {
  state.phaseIdx = idx;
  state.phaseStart = Date.now();
  const ph = PHASES[idx];
  let dur = ph.dur(modeCfg());
  if (ph.group) {
    // Rohelise faasi alguses otsustame, millised jalakäijad rohelise saavad
    for (const j of pedIds) {
      if (CONFIG.peds[j].group !== ph.group) continue;
      const go = modeCfg().pedAuto || state.requests[j];
      state.pedActive[j] = go;
      if (go) state.requests[j] = false;
    }
    // Roheline peab kestma vähemalt jalakäija aja
    dur = Math.max(dur, CONFIG.pedGreen + CONFIG.pedBlink + 1);
  } else {
    for (const j of pedIds) state.pedActive[j] = false;
  }
  state.phaseDur = dur;
  sendLights();
}

function changeMode(newMode) {
  const old = state.mode;
  state.mode = newMode;
  logLine("ev", `● režiim: ${CONFIG.modes[newMode].name}`);
  if (newMode === "night") {
    for (const j of pedIds) { state.requests[j] = false; state.pedActive[j] = false; }
    send(currentPacket());
  } else if (old === "night" || old === null) {
    startPhase(RESTART_PHASE);
  }
  // hommik <-> õhtu: uued ajad hakkavad kehtima järgmisest faasist
}

function tick() {
  const m = currentMode();
  if (m !== state.mode) changeMode(m);

  // Öörežiimis saadame Arduinole iga vilkumise muutuse (vaikselt, et logi ei täituks)
  if (state.mode === "night" && writer) {
    const p = currentPacket();
    if (JSON.stringify(p) !== JSON.stringify(lastPacket)) send(p, true);
  }

  if (state.mode !== "night") {
    const ph = PHASES[state.phaseIdx];
    // Õhtul: kui keegi ootab teise grupi juures, lühendame praegust rohelist
    if (ph.group && modeCfg().pedAuto) {
      const otherWaiting = pedIds.some(j => state.requests[j] && CONFIG.peds[j].group !== ph.group);
      if (otherWaiting) {
        state.phaseDur = Math.min(state.phaseDur, Math.max(elapsed(), CONFIG.minGreenOnRequest));
      }
    }
    if (elapsed() >= state.phaseDur) startPhase((state.phaseIdx + 1) % PHASES.length);
  }
  render();
}

// Jalakäija foori olek: R, G, GB (vilkuv roheline) või OFF
function pedState(j) {
  if (state.mode === "night") return "OFF";
  const ph = PHASES[state.phaseIdx];
  if (ph.group === CONFIG.peds[j].group && state.pedActive[j]) {
    const t = elapsed();
    if (t < CONFIG.pedGreen) return "G";
    if (t < CONFIG.pedGreen + CONFIG.pedBlink) return "GB";
  }
  return "R";
}

function pressButton(j) {
  if (state.mode === "night") { logLine("ev", `● ${j} nupp – öörežiimis nupp ei tööta`); return; }
  const s = pedState(j);
  if (s === "G" || s === "GB" || state.requests[j]) return;
  state.requests[j] = true;
  logLine("ev", `● ${j} nupp vajutatud → OOTA`);
}

//  KUVAMINE
function setCar(el, s, blinkOn) {
  el.querySelector(".r").classList.toggle("on", s === "R" || s === "RY");
  el.querySelector(".y").classList.toggle("on", s === "Y" || s === "RY" || (s === "BLINK" && blinkOn));
  el.querySelector(".g").classList.toggle("on", s === "G");
}
function setPed(el, s, blinkOn) {
  el.querySelector(".r").classList.toggle("on", s === "R");
  el.querySelector(".g").classList.toggle("on", s === "G" || (s === "GB" && blinkOn));
}

function render() {
  const now = new Date();
  const blinkOn = Math.floor(Date.now() / 500) % 2 === 0;
  const night = state.mode === "night";
  const ph = PHASES[state.phaseIdx];

  document.getElementById("clock").textContent = now.toLocaleTimeString("et-EE");
  document.getElementById("modeName").textContent =
    CONFIG.modes[state.mode].name + (state.manualMode ? " (käsitsi)" : " (kella järgi)");
  document.getElementById("phaseName").textContent = night ? "Kollane vilkur" : ph.name;
  document.getElementById("remaining").textContent =
    night ? "–" : Math.max(0, state.phaseDur - elapsed()).toFixed(1) + " s";

  const nightBlink = nightOn(); // sama rütm, mida saadetakse Arduinole
  setCar(document.getElementById("tl-A1"), night ? "BLINK" : ph.A, nightBlink);
  setCar(document.getElementById("tl-A2"), night ? "BLINK" : ph.A, nightBlink);
  setCar(document.getElementById("tl-B"),  night ? "BLINK" : ph.B, nightBlink);

  // Liikumissuuna nooled: näha ainult rohelise ajal
  document.getElementById("flow-A").classList.toggle("show", !night && ph.A === "G");
  document.getElementById("flow-B").classList.toggle("show", !night && ph.B === "G");

  for (const j of pedIds) {
    const s = pedState(j);
    document.getElementById("flow-" + j).classList.toggle("show", s === "G" || s === "GB");
    setPed(document.getElementById("map-" + j), s, blinkOn);
    setPed(document.getElementById("big-" + j), s, blinkOn);
    document.getElementById("wait-" + j).classList.toggle("on", state.requests[j]);
    document.getElementById("btn-" + j).disabled = night;
  }

  const sel = state.manualMode || "auto";
  document.querySelectorAll("#modeButtons button").forEach(b =>
    b.classList.toggle("active", b.dataset.mode === sel));
}

function buildPedPanel() {
  const box = document.getElementById("peds");
  for (const j of pedIds) {
    const p = CONFIG.peds[j];
    const row = document.createElement("div");
    row.className = "ped";
    row.innerHTML = `
      <div class="big" id="big-${j}"><div class="lamp r"><svg class="ico"><use href="#ico-seis"/></svg></div><div class="lamp g"><svg class="ico"><use href="#ico-kond"/></svg></div></div>
      <div class="info"><b>${j}</b> · ${p.label}<br>roheline koos grupiga ${p.group}
        <span class="wait" id="wait-${j}">OOTA</span></div>
      <button id="btn-${j}">Nupp</button>`;
    box.appendChild(row);
    row.querySelector("button").addEventListener("click", () => pressButton(j));
  }
}

//  LOGI
function logLine(cls, text) {
  const log = document.getElementById("log");
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = `${new Date().toLocaleTimeString("et-EE")}  ${text}`;
  log.appendChild(line);
  while (log.children.length > 300) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

//  WEB SERIAL (Arduino ühendus)
let port = null, writer = null, reader = null, writeDone = null, readDone = null;
let lastPacket = null;

// Öörežiimis vilgutab veebileht ise: sama kell nagu ekraanil, nii on füüsiline foor sünkroonis
const nightOn = () => Math.floor(Date.now() / 1000) % 2 === 0;

function currentPacket() {
  if (state.mode === "night") return nightOn() ? { A: "Y", B: "Y" } : { A: "OFF", B: "OFF" };
  const ph = PHASES[state.phaseIdx];
  return { A: ph.A, B: ph.B };
}

function send(obj, quiet = false) {
  const line = JSON.stringify(obj);
  lastPacket = obj;
  if (!quiet) logLine("out", `→ ${line}`);
  if (writer) writer.write(line + "\n").catch(err => logLine("err", "Saatmise viga: " + err.message));
}
function sendLights() { send(currentPacket()); }

async function connect() {
  if (!("serial" in navigator)) {
    logLine("err", "See brauser ei toeta Web Seriali. Kasuta Chrome'i või Edge'i.");
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    const enc = new TextEncoderStream();
    writeDone = enc.readable.pipeTo(port.writable);
    writer = enc.writable.getWriter();
    const dec = new TextDecoderStream();
    readDone = port.readable.pipeTo(dec.writable);
    reader = dec.readable.getReader();
    setConn(true);
    logLine("ev", "● Arduino ühendatud");
    readLoop();
    // Arduino teeb ühendamisel restardi – ootame natuke ja saadame oleku
    setTimeout(() => send(currentPacket()), 2000);
  } catch (err) {
    logLine("err", "Ühendamine ebaõnnestus: " + err.message);
    await disconnect();
  }
}

async function readLoop() {
  let buf = "";
  try {
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) logLine(line.includes("err") || line.includes("warn") ? "err" : "in", `← ${line}`);
      }
    }
  } catch (err) {
    logLine("err", "Lugemise viga: " + err.message);
  }
  await disconnect();
}

async function disconnect() {
  const p = port;
  if (!p) return;
  port = null;
  try { if (reader) { await reader.cancel(); reader = null; } } catch {}
  try { if (readDone) await readDone.catch(() => {}); } catch {}
  try { if (writer) { await writer.close(); writer = null; } } catch {}
  try { if (writeDone) await writeDone.catch(() => {}); } catch {}
  try { await p.close(); } catch {}
  reader = writer = null;
  setConn(false);
  logLine("ev", "● Arduino lahti ühendatud");
}

function setConn(ok) {
  document.getElementById("connDot").classList.toggle("ok", ok);
  document.getElementById("connText").textContent = ok ? "Ühendatud" : "Ühendamata (simulatsioon töötab ka ilma)";
  document.getElementById("connectBtn").textContent = ok ? "Katkesta ühendus" : "Ühenda Arduino";
}

//  KÄIVITAMINE
buildPedPanel();
document.getElementById("connectBtn").addEventListener("click", () => port ? disconnect() : connect());
document.querySelectorAll("#modeButtons button").forEach(b =>
  b.addEventListener("click", () => {
    state.manualMode = b.dataset.mode === "auto" ? null : b.dataset.mode;
  }));
// Kordame olekut regulaarselt, et Arduino teaks, et veebileht töötab (muidu läheb kollasele vilkurile)
setInterval(() => { if (writer && lastPacket) send(currentPacket(), true); }, CONFIG.heartbeatMs);
setInterval(tick, 100);
tick();
