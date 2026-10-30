// Other phone. Keep TOPIC, encode, and decode identical in ../app.js.
const TOPIC = "gizbit-net-m3p8k2w7q9n4";
const NTFY = "https://ntfy.envs.net";
const LEDGER = "gizbit-terminal-ledger";
const CURSOR = "gizbit-terminal-cursor";
const MAX = 10n ** 18n;
const DEFAULT_PRESETS = ["100000000000", "250000000000", "500000000000", "750000000000", "1000000000000", "2000000000000"];
const DEFAULT_MIN = "50000000000";
const DEFAULT_EURO = "5000000000";
const DEFAULT_VAT = "20";
const DEFAULT_PROFIT_LOW = "25";
const DEFAULT_PROFIT_HIGH = "40";
const DEFAULT_PROFIT_THRESHOLD = "8000000000000";
const DEFAULT_TERMS = "An exchange is recorded on the main phone. You confirm the amount is correct and that the gizbits will be handed over as agreed.";
const DEFAULT_TAX_TERMS = "This tax return is filed with the National Gizbit Government centre. The amounts are correct and the VAT and profit tax are accepted.";
const LOCAL_TAXES = "gizbit-terminal-taxes";
const LOCAL_BIZ = "gizbit-terminal-businesses";
// Versions start at 1.00.000. A small fix adds 0.00.001, a feature adds 0.01.000, and a large change adds 1.00.000.
const VERSION = "2.10.002";
const SETTINGS_PASSWORD = "321kittymiss";
const WIPED = "gizbit-terminal-wiped";

let ledger = loadLedger();
let sessionPh = "";
let liveThisSession = false;
let wipedAt = Number(localStorage.getItem(WIPED)) || 0;
let source = null;
let streamOpen = false;
let lastPing = 0;
let toastTimer = 0;
let pendingExchangeId = "";
let pendingSendId = "";
let taxLines = [];
let taxSigned = false;
let taxBusy = false;
const waits = new Map();
const reasons = new Map();

const $ = (id) => document.getElementById(id);

function loadLedger() {
  try {
    const data = JSON.parse(localStorage.getItem(LEDGER) || "");
    if (!data || !Array.isArray(data.accounts)) return null;
    return {
      rev: Number.isInteger(data.rev) ? data.rev : 0,
      ts: Number(data.ts) || 0,
      device: typeof data.device === "string" ? data.device : "",
      deviceName: typeof data.deviceName === "string" ? data.deviceName.slice(0, 40) : "",
      accounts: data.accounts.map(sanitize).filter(Boolean),
      settings: normalizeSettings(data.settings),
      requests: Array.isArray(data.requests) ? data.requests : [],
    };
  } catch {
    return null;
  }
}

function sanitize(account) {
  if (!account || typeof account.id !== "string") return null;
  if (!/^[0-9a-f]{64}$/.test(account.ph || "")) return null;
  const bal = moneyText(account.bal, typeof account.bal === "number");
  if (bal == null) return null;
  return {
    id: account.id,
    name: String(account.name || "").slice(0, 40),
    type: String(account.type || "Account").slice(0, 24),
    bal,
    ph: account.ph,
  };
}

function defaultSettings() {
  return {
    presets: DEFAULT_PRESETS.slice(),
    terms: DEFAULT_TERMS,
    minAmount: DEFAULT_MIN,
    maxAmount: "",
    euroRate: DEFAULT_EURO,
    vatRate: DEFAULT_VAT,
    profitLow: DEFAULT_PROFIT_LOW,
    profitHigh: DEFAULT_PROFIT_HIGH,
    profitThreshold: DEFAULT_PROFIT_THRESHOLD,
    taxTerms: DEFAULT_TAX_TERMS,
  };
}

function percentText(value, fallback) {
  const raw = String(value ?? "").replace(/[,\s%]/g, "");
  if (!/^\d{1,3}$/.test(raw)) return fallback;
  const rate = BigInt(raw);
  if (rate > 100n) return fallback;
  return rate.toString();
}

function normalizeSettings(value) {
  const presets = Array.isArray(value?.presets) ? value.presets.map((item) => moneyText(item, false)).filter(Boolean) : [];
  while (presets.length < 6) presets.push(DEFAULT_PRESETS[presets.length]);
  const maxAmount = moneyText(value?.maxAmount, false);
  return {
    presets: presets.slice(0, 6),
    terms: String(value?.terms || DEFAULT_TERMS).slice(0, 800),
    minAmount: moneyText(value?.minAmount, false) || DEFAULT_MIN,
    maxAmount: maxAmount && maxAmount !== "0" ? maxAmount : "",
    euroRate: moneyText(value?.euroRate, false) || DEFAULT_EURO,
    vatRate: percentText(value?.vatRate, DEFAULT_VAT),
    profitLow: percentText(value?.profitLow, DEFAULT_PROFIT_LOW),
    profitHigh: percentText(value?.profitHigh, DEFAULT_PROFIT_HIGH),
    profitThreshold: moneyText(value?.profitThreshold, false) || DEFAULT_PROFIT_THRESHOLD,
    taxTerms: String(value?.taxTerms || DEFAULT_TAX_TERMS).slice(0, 400),
  };
}

function activeSettings() {
  return normalizeSettings(ledger?.settings);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function moneyText(value, fromCents) {
  const raw = String(value ?? "").replace(/[,\s]/g, "");
  if (!/^\d+$/.test(raw)) return null;
  let amount = BigInt(raw);
  if (fromCents) amount = amount / 100n;
  if (amount < 0n || amount > MAX) return null;
  return amount.toString();
}

function parseAmount(value) {
  const amount = moneyText(value, false);
  if (amount == null || BigInt(amount) <= 0n) return null;
  return amount;
}

function formatFull(value) {
  const text = moneyText(value, false) || "0";
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatAmount(value) {
  const amount = BigInt(moneyText(value, false) || "0");
  const scales = [[10n ** 12n, "Trillion"], [10n ** 9n, "Billion"]];
  for (const [unit, label] of scales) {
    if (amount < unit) continue;
    const scaled = (amount * 1000n) / unit;
    const whole = scaled / 1000n;
    const frac = scaled % 1000n;
    if (frac === 0n) return `${formatFull(whole)} ${label}`;
    const decimals = frac.toString().padStart(3, "0").replace(/0+$/, "");
    return `${formatFull(whole)}.${decimals} ${label}`;
  }
  return formatFull(amount);
}

function encode(sentence, payload) {
  return `${sentence}\n${JSON.stringify(payload)}`;
}

function decode(message) {
  if (!message || typeof message !== "string") return null;
  const trimmed = message.trim();
  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === "object") return direct;
  } catch {
    /* The human sentence sits on the first line. */
  }
  const line = trimmed.split("\n").map((part) => part.trim()).reverse().find((part) => part.startsWith("{"));
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function publish(sentence, payload) {
  const body = encode(sentence, payload);
  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`${NTFY}/${TOPIC}`, {
        method: "POST",
        body,
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await attempt();
  } catch (first) {
    if (payload && payload.id && await posted(payload.id)) return;
    try {
      await attempt();
    } catch (second) {
      if (payload && payload.id && await posted(payload.id)) return;
      throw second || first;
    }
  }
}

async function posted(id) {
  try {
    const since = String(Math.floor(Date.now() / 1000) - 30);
    const res = await fetch(`${NTFY}/${TOPIC}/json?poll=1&since=${since}`, { cache: "no-store" });
    if (!res.ok) return false;
    return (await res.text()).includes(id);
  } catch {
    return false;
  }
}

function publishPing() {
  const now = Date.now();
  if (now - lastPing < 5000) return Promise.resolve();
  lastPing = now;
  return publish("Checking accounts", { v: 1, kind: "ping", id: uid(), ts: now });
}

function setLink(on) {
  const mark = $("link-mark");
  if (!mark) return;
  mark.classList.toggle("is-on", on);
  mark.setAttribute("aria-label", on ? "Connected" : "Not connected");
}

function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 2800);
}

function refreshStatus() {
  const fresh = streamOpen && ledger && Date.now() - (ledger.ts || 0) < 20000;
  setLink(Boolean(fresh));
}

function matching(ph) {
  return (ledger?.accounts || []).filter((account) => account.ph === ph);
}

function forgetBook() {
  ledger = null;
  liveThisSession = false;
  localStorage.removeItem(LEDGER);
  refreshStatus();
  if (!$("settings").hidden) renderSettingsAccounts();
  window.dispatchEvent(new CustomEvent("gizbit-ledger"));
}

function acceptReset(body) {
  const ts = Number(body?.ts) || Date.now();
  if (wipedAt && ts < wipedAt) return;
  wipedAt = ts;
  localStorage.setItem(WIPED, String(ts));
  sessionPh = "";
  pendingExchangeId = "";
  forgetBook();
  showLogin();
  $("login-msg").textContent = "The main phone deleted every account.";
}

function acceptLedger(body) {
  if (!body || !Array.isArray(body.accounts) || !body.accounts.length) return;
  const ts = Number(body.ts) || 0;
  if (wipedAt && ts && ts <= wipedAt) return;
  if (ledger && ts && ledger.ts && ts < ledger.ts) return;
  if (wipedAt) {
    wipedAt = 0;
    localStorage.removeItem(WIPED);
  }
  ledger = {
    rev: Number.isInteger(body.rev) ? body.rev : (ledger?.rev || 0),
    ts: body.ts || Date.now(),
    answered: body.answered || ledger?.answered || "",
    accounts: body.accounts.map(sanitize).filter(Boolean),
    settings: normalizeSettings(body.settings),
    requests: Array.isArray(body.requests) ? body.requests : (ledger?.requests || []),
  };
  localStorage.setItem(LEDGER, JSON.stringify(ledger));
  liveThisSession = true;
  refreshStatus();
  if (!$("settings").hidden) renderSettingsAccounts();
  window.dispatchEvent(new CustomEvent("gizbit-ledger"));
  if (sessionPh && !matching(sessionPh).length) {
    sessionPh = "";
    showLogin();
    $("login-msg").textContent = "That account was removed.";
    return;
  }
  if (sessionPh) renderBank();
  checkExchangeResult();
  checkSendResult();
  (body.applied || []).forEach((id) => resolveWait(id, "ok"));
}

function waitFor(id, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waits.delete(id);
      resolve("timeout");
    }, ms);
    waits.set(id, (result) => {
      clearTimeout(timer);
      waits.delete(id);
      resolve(result);
    });
  });
}

function resolveWait(id, result) {
  const done = waits.get(id);
  if (done) done(result);
}

function sinceQuery() {
  try {
    const saved = JSON.parse(localStorage.getItem(CURSOR) || "");
    if (saved && Number.isFinite(saved.time)) return String(saved.time);
  } catch {
    /* First connection reads the recent queue. */
  }
  return "12h";
}

function noteCursor(data) {
  if (!data || !data.id || !Number.isFinite(data.time)) return;
  localStorage.setItem(CURSOR, JSON.stringify({ id: data.id, time: data.time }));
}

function handleMessage(data) {
  noteCursor(data);
  if (data.event && data.event !== "message") return;
  const body = decode(data.message);
  if (!body || body.v !== 1) return;
  if (body.kind === "reset") {
    acceptReset(body);
    return;
  }
  if (body.kind === "ledger") acceptLedger(body);
  if (body.kind === "decision") finishExchange(body.id, body.status);
  if (body.kind === "reject" && body.id) {
    reasons.set(body.id, body.reason || "The main phone refused that.");
    if (body.id === pendingExchangeId) finishExchange(body.id, "denied");
    if (body.id === pendingSendId) {
      pendingSendId = "";
      $("send-msg").textContent = body.reason || "The main phone could not transfer that.";
      revealSend();
    }
    resolveWait(body.id, "reject");
  }
}

async function catchUp() {
  const res = await fetch(`${NTFY}/${TOPIC}/json?poll=1&since=${encodeURIComponent(sinceQuery())}`, { cache: "no-store" });
  if (res.status === 404) {
    refreshStatus();
    return;
  }
  if (!res.ok) throw new Error(String(res.status));
  for (const line of (await res.text()).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handleMessage(JSON.parse(trimmed));
    } catch {
      /* Skip a line that is not a message. */
    }
  }
  refreshStatus();
}

function listen() {
  if (source) source.close();
  source = new EventSource(`${NTFY}/${TOPIC}/sse?since=${encodeURIComponent(sinceQuery())}`);
  source.onopen = () => {
    streamOpen = true;
    refreshStatus();
  };
  source.onerror = () => {
    streamOpen = false;
    refreshStatus();
  };
  source.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch {
      /* Ignore a malformed event. */
    }
  };
}

function waitLedger(ms) {
  const start = ledger?.rev ?? -1;
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      window.removeEventListener("gizbit-ledger", onLedger);
      resolve((ledger?.rev ?? -1) !== start);
    }
    function onLedger() {
      if ((ledger?.rev ?? -1) !== start) finish();
    }
    window.addEventListener("gizbit-ledger", onLedger);
  });
}

const AMOUNT_STEP = 50000000000n;
const TEN_BILLION = 10000000000n;
let accountId = "";
let chosenOp = "";
let chosenAmount = "";
let signed = false;
let sendSigned = false;
let exchangeSent = false;

function showLogin() {
  $("settings").hidden = true;
  $("login").hidden = false;
  $("bank").hidden = true;
  $("logout").hidden = true;
  $("password").value = "";
  $("password").type = "password";
  clearIdle();
}

function renderSettingsAccounts() {
  const list = $("account-list");
  const accounts = ledger?.accounts || [];
  list.replaceChildren();
  if (!accounts.length) {
    const empty = document.createElement("li");
    empty.className = "quiet";
    empty.textContent = "No accounts on this phone yet.";
    list.append(empty);
    return;
  }
  accounts.forEach((account) => {
    const item = document.createElement("li");
    item.className = "account-row";
    const name = document.createElement("p");
    name.className = "who";
    name.textContent = account.name || "Account";
    const type = document.createElement("p");
    type.className = "quiet";
    type.textContent = account.type || "Account";
    const bal = document.createElement("p");
    bal.className = "bal";
    bal.textContent = `${formatAmount(account.bal)} ₲`;
    item.append(name, type, bal);
    list.append(item);
  });
}

function openSettings() {
  $("settings-lock").hidden = true;
  $("settings-password").value = "";
  $("settings-lock-msg").textContent = "";
  $("login").hidden = true;
  $("bank").hidden = true;
  $("logout").hidden = true;
  $("settings").hidden = false;
  $("main").scrollTop = 0;
  renderSettingsAccounts();
}

function closeSettings() {
  $("settings").hidden = true;
  if (sessionPh) {
    $("login").hidden = true;
    $("bank").hidden = false;
    const stage = $("stage");
    const away = stage.classList.contains("is-side");
    $("logout").hidden = away;
    return;
  }
  showLogin();
}

function waitNewerLedger(beforeTs, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      window.removeEventListener("gizbit-ledger", onLedger);
      resolve((ledger?.ts || 0) > beforeTs);
    }
    function onLedger() {
      if ((ledger?.ts || 0) > beforeTs) finish();
    }
    window.addEventListener("gizbit-ledger", onLedger);
  });
}

function currentAccount() {
  const list = matching(sessionPh);
  return list.find((item) => item.id === accountId) || list[0] || null;
}

function paintAccount() {
  const list = matching(sessionPh);
  const account = currentAccount();
  const pick = $("account-pick");
  const wrap = $("account-pick-wrap");
  wrap.hidden = list.length < 2;
  pick.replaceChildren();
  list.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    pick.append(option);
  });
  if (!account) {
    $("welcome").textContent = "Welcome";
    $("balance").textContent = "";
    $("balance-full").textContent = "";
    return;
  }
  accountId = account.id;
  pick.value = account.id;
  $("welcome").textContent = `Welcome, ${account.name}`;
  $("balance").textContent = `${formatAmount(account.bal)} ₲`;
  $("balance-full").textContent = formatFull(account.bal);
}

function limits() {
  const settings = activeSettings();
  const account = currentAccount();
  const min = BigInt(settings.minAmount || DEFAULT_MIN);
  const balance = account ? BigInt(account.bal) : 0n;
  const configured = settings.maxAmount ? BigInt(settings.maxAmount) : null;
  if (chosenOp === "withdraw") {
    const max = configured == null || balance < configured ? balance : configured;
    return { min, max };
  }
  return { min, max: configured == null ? MAX : configured };
}

function onAmountStep(amount) {
  if (!amount) return false;
  return BigInt(amount) % AMOUNT_STEP === 0n;
}

function amountAllowed(amount) {
  if (!amount || !onAmountStep(amount)) return false;
  const value = BigInt(amount);
  const { min, max } = limits();
  return max >= min && value >= min && value <= max;
}

function rangeNote() {
  const { min, max } = limits();
  if (max < min) return `This account is below the minimum of ${formatAmount(min)} ₲.`;
  if (max >= MAX) return `At least ${formatAmount(min)} ₲.`;
  return `From ${formatAmount(min)} to ${formatAmount(max)} ₲.`;
}

function renderPresets() {
  const box = $("presets");
  const settings = activeSettings();
  box.replaceChildren();
  settings.presets.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn line";
    button.textContent = formatAmount(value);
    button.dataset.amount = value;
    const allowed = amountAllowed(value);
    button.disabled = !allowed;
    if (chosenAmount === value && !$("other-amount").value.trim()) button.classList.add("is-on");
    button.addEventListener("click", () => {
      if (!allowed) return;
      chosenAmount = value;
      $("other-amount").value = "";
      $("move-msg").textContent = "";
      renderPresets();
      revealSteps();
    });
    box.append(button);
  });
}

function renderBank() {
  paintAccount();
  renderHistory();
  renderPresets();
  revealSteps();
}

function formatDate(ts) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(ts);
}

function formatClock(ts) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(ts);
}

const SIGNS = "gizbit-terminal-signs";

function loadSigns() {
  try {
    const data = JSON.parse(localStorage.getItem(SIGNS) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveSign(id, strokes) {
  if (!id || !strokes || !strokes.length) return;
  const all = loadSigns();
  all[id] = strokes;
  const ids = Object.keys(all);
  while (ids.length > 40) delete all[ids.shift()];
  localStorage.setItem(SIGNS, JSON.stringify(all));
}

function renderHistory() {
  const list = $("history");
  const empty = $("activity-empty");
  if (!list) return;
  const account = currentAccount();
  const signs = loadSigns();
  const items = (ledger?.requests || []).filter((item) => {
    if (!account) return true;
    return item.accountId === account.id || item.toId === account.id;
  }).slice(0, 20);
  list.replaceChildren();
  if (empty) empty.hidden = items.length > 0;
  items.forEach((item) => {
    const li = document.createElement("li");
    const when = document.createElement("time");
    const ts = Number(item.ts) || Date.now();
    when.textContent = `${formatDate(ts)} · ${formatClock(ts)}`;
    const incoming = account && item.toId === account.id && item.accountId !== account.id;
    const kind = document.createElement("p");
    kind.className = "who";
    if (item.op === "send" || item.op === "transfer") kind.textContent = incoming ? `Received from ${item.name}` : `Transferred to ${item.toName || "another account"}`;
    else kind.textContent = item.op === "withdraw" ? "Withdrawal" : "Deposit";
    const money = document.createElement("p");
    money.className = "quiet";
    const alleged = formatAmount(item.amount);
    const actual = item.applied ? formatAmount(item.applied) : "";
    if (item.status === "denied") money.textContent = `${alleged} ₲ · Denied`;
    else if (actual && String(item.applied) !== String(item.amount)) money.textContent = `${alleged} ₲ asked · ${actual} ₲`;
    else money.textContent = `${alleged} ₲`;
    li.append(when, kind, money);
    const strokes = signs[item.id] || item.sign;
    if (Array.isArray(strokes) && strokes.length) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sign-btn";
      button.setAttribute("aria-label", "Show signature");
      button.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 16c2-3 3-3 4 0s2 3 3.5 0 2-5 3.5-1 2 2 3.5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M14 4.5l4 4-7.5 7.5H6.5V12L14 4.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
      button.addEventListener("click", () => showSavedSignature(strokes));
      li.append(button);
    }
    list.append(li);
  });
}

function signSpace(strokes) {
  let max = 0;
  strokes.forEach((stroke) => stroke.forEach((point) => {
    if (point > max) max = point;
  }));
  return max > 999 ? 9999 : 999;
}

function drawSignature(canvas, strokes) {
  const cssWidth = canvas.clientWidth || 320;
  const cssHeight = canvas.clientHeight || 180;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const ctx = canvas.getContext("2d");
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.strokeStyle = "#173a5a";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const space = signSpace(strokes);
  strokes.forEach((stroke) => {
    const points = [];
    for (let i = 0; i + 1 < stroke.length; i += 2) {
      points.push([(stroke[i] / space) * cssWidth, (stroke[i + 1] / space) * cssHeight]);
    }
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (points[i][0] + points[i + 1][0]) / 2;
      const midY = (points[i][1] + points[i + 1][1]) / 2;
      ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  });
}

function showSavedSignature(strokes) {
  const clean = Array.isArray(strokes) ? strokes : [];
  $("sign-empty").hidden = clean.length > 0;
  $("sign-sheet").hidden = false;
  requestAnimationFrame(() => drawSignature($("sign-view"), clean));
}

function resampleStroke(points) {
  const raw = [];
  for (let i = 0; i + 1 < points.length; i += 2) raw.push([points[i], points[i + 1]]);
  if (raw.length < 2) return points.slice(0, 80);
  let length = 0;
  const walked = [0];
  for (let i = 1; i < raw.length; i += 1) {
    length += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    walked.push(length);
  }
  const count = Math.min(40, raw.length);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const dist = count === 1 ? 0 : (length * i) / (count - 1);
    let index = 1;
    while (index < walked.length && walked[index] < dist) index += 1;
    const span = walked[index] - walked[index - 1] || 1;
    const t = (dist - walked[index - 1]) / span;
    out.push(
      Math.round(raw[index - 1][0] + (raw[index][0] - raw[index - 1][0]) * t),
      Math.round(raw[index - 1][1] + (raw[index][1] - raw[index - 1][1]) * t),
    );
  }
  return out;
}

function accountIsEmpty() {
  const account = currentAccount();
  return !!account && BigInt(account.bal) === 0n;
}

let idleTimer = 0;

function clearIdle() {
  clearTimeout(idleTimer);
}

function bumpIdle() {
  clearIdle();
  if (!sessionPh) return;
  idleTimer = setTimeout(() => {
    if (!sessionPh) return;
    sessionPh = "";
    pendingExchangeId = "";
    pendingSendId = "";
    showHome();
    showLogin();
    $("login-msg").textContent = "Timer ran out, log in again.";
  }, 60000);
}

document.addEventListener("pointerdown", bumpIdle);
document.addEventListener("keydown", bumpIdle);

function showHome() {
  const stage = $("stage");
  stage.classList.remove("is-side");
  ["exchange", "activity", "calc", "gov", "tax"].forEach((name) => $(`${name}-pane`).classList.remove("is-front"));
  if (sessionPh) $("logout").hidden = false;
}

function showSide(name) {
  const stage = $("stage");
  ["exchange", "activity", "calc", "gov", "tax"].forEach((pane) => $(`${pane}-pane`).classList.toggle("is-front", pane === name));
  stage.classList.add("is-side");
  $("logout").hidden = true;
  const pane = $(`${name}-pane`);
  if (pane) pane.scrollTop = 0;
}

function showExchangePage() {
  showSide("exchange");
}

function revealSteps() {
  const transfer = chosenOp === "transfer";
  const empty = (chosenOp === "withdraw" || transfer) && accountIsEmpty();
  $("transfer-section").hidden = !transfer || empty;
  if (!chosenOp) {
    $("empty-note").hidden = true;
    $("amount-step").hidden = true;
    $("terms-step").hidden = true;
    $("sign-block").hidden = true;
    $("exchange").hidden = true;
    return;
  }
  if (empty) {
    $("empty-note").hidden = false;
    $("amount-step").hidden = true;
    $("terms-step").hidden = true;
    $("sign-block").hidden = true;
    $("exchange").hidden = true;
    return;
  }
  $("empty-note").hidden = true;
  if (transfer) {
    $("amount-step").hidden = true;
    $("terms-step").hidden = true;
    $("sign-block").hidden = true;
    $("exchange").hidden = true;
    revealSend();
    return;
  }
  $("amount-step").hidden = false;
  const note = $("range-note");
  if (note) {
    note.hidden = chosenOp !== "withdraw";
    note.textContent = chosenOp === "withdraw" ? rangeNote() : "";
  }
  const valid = Boolean(chosenOp && amountAllowed(chosenAmount));
  $("terms-step").hidden = !valid;
  const showSign = valid && $("agree").checked;
  $("sign-block").hidden = !showSign;
  $("exchange").hidden = !showSign;
  if (showSign) {
    pad.setEnabled(true);
    if (!$("sign").dataset.ready) {
      pad.size();
      $("sign").dataset.ready = "1";
    }
  } else {
    pad.setEnabled(false);
    delete $("sign").dataset.ready;
  }
  const ready = Boolean(showSign && signed && currentAccount());
  $("exchange").disabled = !ready;
  paintExchangeButton();
}

function paintExchangeButton() {
  const button = $("exchange");
  if (!exchangeSent) {
    button.textContent = "Exchange ₲";
    return;
  }
  button.hidden = false;
  button.disabled = false;
  button.textContent = "Return to home";
}

let audioCtx = null;
let soundBuffer = null;
let soundLoading = null;

function audioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

function loadSound() {
  const ctx = audioContext();
  if (!ctx || soundBuffer || soundLoading) return soundLoading;
  soundLoading = fetch("success.mp3")
    .then((res) => res.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => {
      soundBuffer = decoded;
    })
    .catch(() => {
      soundLoading = null;
    });
  return soundLoading;
}

function playBuffer() {
  const ctx = audioContext();
  if (!ctx || !soundBuffer) return;
  if (ctx.state === "suspended") ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = soundBuffer;
  src.connect(ctx.destination);
  src.start(0);
}

function playSuccess() {
  const audio = $("success-sound");
  audio.muted = false;
  audio.volume = 1;
  try { audio.currentTime = 0; } catch { /* The file may still be loading. */ }
  const played = audio.play();
  if (played) played.catch(() => playBuffer());
  else playBuffer();
}

function unlockSound() {
  const audio = $("success-sound");
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended") ctx.resume();
  loadSound();
  audio.muted = false;
  audio.volume = 0.01;
  const played = audio.play();
  if (!played) return;
  played.then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1;
  }).catch(() => {});
}

function waitForLiveLedger(before, ms) {
  const ready = () => ledger && ledger.ts > before;
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), ms);
    function done(ok) {
      clearTimeout(timer);
      window.removeEventListener("gizbit-ledger", onLedger);
      resolve(ok);
    }
    function onLedger() {
      if (ready()) done(true);
    }
    window.addEventListener("gizbit-ledger", onLedger);
  });
}

function finishExchange(id, status) {
  if (!id || id !== pendingExchangeId || !status || status === "pending") return;
  pendingExchangeId = "";
  if (status === "denied") {
    $("move-msg").textContent = reasons.get(id) || "The network denied this exchange.";
    revealSteps();
    return;
  }
  resetExchange();
  showHome();
  renderBank();
  playSuccess();
  $("done-title").textContent = "Successfully exchanged";
  $("done").hidden = false;
}

function checkExchangeResult() {
  const found = (ledger?.requests || []).find((item) => item.id === pendingExchangeId);
  if (found) finishExchange(found.id, found.status);
}

const BILLION_STEP = 1000000000n;
let sendAccountId = "";
let sendAmount = "";

function floorTo(digits, step, max) {
  if (!/^\d+$/.test(digits)) return "";
  let amount = BigInt(digits) - (BigInt(digits) % step);
  if (max != null) {
    let cap = max;
    if (cap >= step) cap -= cap % step;
    else cap = 0n;
    if (amount > cap) amount = cap;
  }
  return amount > 0n ? amount.toString() : "";
}

function cleanTenBillion(digits) {
  const plain = String(digits || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(plain) || plain.length < 11) return plain;
  const amount = BigInt(plain) - (BigInt(plain) % TEN_BILLION);
  return amount > 0n ? amount.toString() : "0";
}

function renderSendAccounts() {
  const select = $("send-account");
  const mine = currentAccount();
  const others = (ledger?.accounts || []).filter((item) => !mine || item.id !== mine.id);
  select.replaceChildren();
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = others.length ? "Choose an account" : "No other accounts";
  select.append(blank);
  others.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  });
  if (others.some((item) => item.id === sendAccountId)) select.value = sendAccountId;
  else sendAccountId = "";
}

function revealSend() {
  const account = currentAccount();
  const balance = account ? BigInt(account.bal) : 0n;
  const chosen = Boolean(sendAccountId);
  $("send-amount-step").hidden = !chosen;
  const valid = chosen && /^\d+$/.test(sendAmount) && BigInt(sendAmount) > 0n && BigInt(sendAmount) <= balance && BigInt(sendAmount) % BILLION_STEP === 0n;
  $("send-terms-step").hidden = !valid;
  const showSign = valid && $("send-agree").checked;
  $("send-sign-block").hidden = !showSign;
  $("send-go").hidden = !showSign;
    if (showSign) {
    sendPad.setEnabled(true);
    if (!$("send-sign").dataset.ready) {
      sendPad.size();
      if ($("send-sign").getBoundingClientRect().width >= 2) $("send-sign").dataset.ready = "1";
    }
  } else if (!showSign) {
    sendPad.setEnabled(false);
    delete $("send-sign").dataset.ready;
  }
  $("send-go").disabled = !(showSign && sendSigned);
}

function resetSend() {
  sendAccountId = "";
  sendAmount = "";
  sendSigned = false;
  pendingSendId = "";
  $("send-amount").value = "";
  $("send-agree").checked = false;
  $("send-msg").textContent = "";
  $("send-amount-step").hidden = true;
  $("send-terms-step").hidden = true;
  $("send-sign-block").hidden = true;
  $("send-go").hidden = true;
  renderSendAccounts();
  revealSend();
}

function checkSendResult() {
  if (!pendingSendId) return;
  const found = (ledger?.requests || []).find((item) => item.id === pendingSendId);
  if (!found) return;
  pendingSendId = "";
  if (found.status === "denied") {
    $("send-msg").textContent = reasons.get(found.id) || "The main phone could not transfer that.";
    revealSend();
    return;
  }
  resetSend();
  showHome();
  renderBank();
  playSuccess();
  $("done-title").textContent = "Gizbits transferred";
  $("done").hidden = false;
}

async function sendGizbits() {
  const message = $("send-msg");
  message.textContent = "";
  const from = currentAccount();
  const to = (ledger?.accounts || []).find((item) => item.id === sendAccountId);
  let amount = sendAmount;
  if (amount && BigInt(amount) % BILLION_STEP !== 0n) {
    amount = floorTo(amount, BILLION_STEP, from ? BigInt(from.bal) : 0n);
    sendAmount = amount;
    if (amount) $("send-amount").value = formatTyping(amount);
  }
  if (!from || !to || !amount || !$("send-agree").checked || !sendSigned) return;
  if (BigInt(amount) > BigInt(from.bal)) {
    message.textContent = "Not enough gizbits in that account.";
    return;
  }
  const id = uid();
  unlockSound();
  const strokes = sendPad.strokes();
  $("send-go").disabled = true;
  message.textContent = "Transferring…";
  try {
    await publish(`${from.name} transferred gizbits to ${to.name}`, {
      v: 1,
      kind: "transfer",
      id,
      fromId: from.id,
      toId: to.id,
      amount,
      ph: sessionPh,
      sign: strokes,
      ts: Date.now(),
    });
  } catch {
    message.textContent = "Couldn't reach the bank. Try again.";
    revealSend();
    return;
  }
  saveSign(id, strokes);
  pendingSendId = id;
  message.textContent = "Transferred. The main phone moves the gizbits as soon as it receives this.";
  checkSendResult();
}

async function login(password) {
  const message = $("login-msg");
  message.textContent = "";
  if (!password.trim()) {
    message.textContent = "Enter a password.";
    return;
  }
  const button = $("login-go");
  button.disabled = true;
  try {
    const ph = await sha256(password.trim());
    const before = ledger?.ts || 0;
    const known = matching(ph).length > 0;
    if (!known) message.textContent = "Checking with the main phone…";
    publish("Checking accounts", { v: 1, kind: "ping", id: uid(), ts: Date.now() }).catch(() => {});
    if (!known) {
      const live = await waitForLiveLedger(before, 12000);
      if (!live && !matching(ph).length) {
        message.textContent = "Open Gizbit Network on the main phone, then try again.";
        return;
      }
      if (!matching(ph).length) {
        message.textContent = "That password doesn't match an account.";
        return;
      }
    } else {
      waitForLiveLedger(before, 4000).then(() => {
        if (sessionPh) renderBank();
      });
    }
    sessionPh = ph;
    accountId = matching(ph)[0].id;
    $("settings").hidden = true;
    $("login").hidden = true;
    $("bank").hidden = false;
    $("logout").hidden = false;
    showHome();
    resetExchange();
    resetSend();
    renderBank();
    bumpIdle();
    message.textContent = "";
  } catch {
    message.textContent = "This page needs a secure connection before it can check a password.";
  } finally {
    button.disabled = false;
  }
}

function chooseOp(op) {
  if (chosenOp !== op) {
    chosenAmount = "";
    $("other-amount").value = "";
    $("agree").checked = false;
    signed = false;
  }
  chosenOp = op;
  $("type-slider").dataset.op = op;
  $("move-msg").textContent = "";
  if (op === "withdraw" || op === "deposit") {
    $("amount-label").textContent = `How much do you wish to ${op === "withdraw" ? "withdraw" : "deposit"}?`;
    $("presets").hidden = op !== "withdraw";
    $("other-label").textContent = op === "deposit" ? "Amount" : "Other";
    renderPresets();
  }
  revealSteps();
}

function resetExchange() {
  chosenOp = "";
  chosenAmount = "";
  signed = false;
  exchangeSent = false;
  $("agree").checked = false;
  $("other-amount").value = "";
  $("move-msg").textContent = "";
  $("type-slider").dataset.op = "";
  $("amount-step").hidden = true;
  $("empty-note").hidden = true;
  $("presets").hidden = false;
  $("other-label").textContent = "Other";
  $("terms-step").hidden = true;
  $("sign-block").hidden = true;
  $("exchange").hidden = true;
  pad.setEnabled(false);
  revealSteps();
}

async function exchange() {
  if (exchangeSent) {
    showHome();
    return;
  }
  const message = $("move-msg");
  message.textContent = "";
  const account = currentAccount();
  let amount = chosenAmount;
  if (amount && !onAmountStep(amount)) {
    amount = snapTyped(amount);
    chosenAmount = amount;
    if (amount) $("other-amount").value = formatTyping(amount);
  }
  const op = chosenOp;
  if (!account || !op || !amount || !$("agree").checked || !signed) return;
  const latest = matching(sessionPh).find((item) => item.id === account.id) || account;
  const next = op === "deposit" ? BigInt(latest.bal) + BigInt(amount) : BigInt(latest.bal) - BigInt(amount);
  if (next < 0n) {
    message.textContent = "Not enough gizbits in that account.";
    return;
  }
  if (next > MAX) {
    message.textContent = "That would make the balance too large.";
    return;
  }
  if (!amountAllowed(amount)) {
    message.textContent = rangeNote();
    return;
  }
  const id = uid();
  unlockSound();
  pendingExchangeId = id;
  exchangeSent = true;
  paintExchangeButton();
  message.textContent = "Asking the main phone…";
  try {
    await publish(`Exchange pending from ${latest.name}`, {
      v: 1,
      kind: "request",
      id,
      accountId: latest.id,
      op,
      amount,
      ph: sessionPh,
      sign: pad.strokes(),
      ts: Date.now(),
    });
    saveSign(id, pad.strokes());
  } catch {
    pendingExchangeId = "";
    exchangeSent = false;
    message.textContent = "Couldn't reach the bank. Try again.";
    revealSteps();
    return;
  }
  message.textContent = "Waiting for the network to confirm.";
  checkExchangeResult();
}

function bindPad(canvasId, blockId, clearId, onInk) {
  const canvas = $(canvasId);
  const block = $(blockId);
  const clearBtn = $(clearId);
  const ctx = canvas.getContext("2d");
  let drawing = false;
  let hasInk = false;
  let strokes = [];
  let current = null;
  function norm(point) {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 140;
    const x = Math.max(0, Math.min(9999, Math.round((point.x / width) * 9999)));
    const y = Math.max(0, Math.min(9999, Math.round((point.y / height) * 9999)));
    return [x, y];
  }
  function size() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2) return;
    const ink = hasInk;
    const ratio = Math.min(devicePixelRatio || 1, 3);
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.strokeStyle = "#173a5a";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (!ink) hasInk = false;
  }
  function pos(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (block.classList.contains("is-locked")) return;
    event.preventDefault();
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const point = pos(event);
    current = [];
    strokes.push(current);
    current.push(...norm(point));
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    event.preventDefault();
    const point = pos(event);
    if (current && current.length < 400) current.push(...norm(point));
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    hasInk = true;
    onInk(true);
  });
  canvas.addEventListener("pointerup", () => {
    drawing = false;
    if (current && current.length >= 4) {
      const next = resampleStroke(current);
      current.length = 0;
      current.push(...next);
    }
  });
  canvas.addEventListener("pointercancel", () => {
    drawing = false;
  });
  clearBtn.addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes = [];
    hasInk = false;
    onInk(false);
  });
  return {
    size,
    setEnabled(on) {
      block.classList.toggle("is-locked", !on);
      clearBtn.disabled = !on;
      if (!on && (hasInk || strokes.length)) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        strokes = [];
        hasInk = false;
        onInk(false);
      }
    },
    strokes() {
      return strokes.slice(-8).map((stroke) => stroke.slice(0, 80));
    },
  };
}

const pad = bindPad("sign", "sign-block", "clear-sign", (on) => {
  signed = on;
  revealSteps();
});
const sendPad = bindPad("send-sign", "send-sign-block", "send-clear-sign", (on) => {
  sendSigned = on;
  revealSend();
});
const taxPad = bindPad("tax-sign", "tax-sign-block", "tax-clear-sign", (on) => {
  taxSigned = on;
  paintTaxCommit();
});

function bindViewport() {
  const apply = () => {
    const viewport = window.visualViewport;
    const height = viewport ? viewport.height : window.innerHeight;
    const top = viewport ? viewport.offsetTop : 0;
    document.documentElement.style.setProperty("--vvh", `${height}px`);
    document.documentElement.style.setProperty("--vvtop", `${top}px`);
    requestAnimationFrame(() => {
      if (!$("login").hidden) $("login-go").scrollIntoView({ block: "end" });
      liftAmount();
      setTimeout(liftAmount, 80);
    });
  };
  apply();
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", apply);
    window.visualViewport.addEventListener("scroll", apply);
  }
  window.addEventListener("resize", apply);
}

function stopOverscroll(scroller) {
  let startY = 0;
  scroller.addEventListener("touchstart", (event) => {
    if (event.touches.length === 1) startY = event.touches[0].clientY;
  }, { passive: true });
  scroller.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) {
      if (event.cancelable) event.preventDefault();
      return;
    }
    const delta = event.touches[0].clientY - startY;
    const top = scroller.scrollTop <= 0;
    const bottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    if ((top && delta > 10) || (bottom && delta < -10)) {
      if (event.cancelable) event.preventDefault();
    }
  }, { passive: false });
}

function lockGestures() {
  document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
  document.addEventListener("gesturechange", (event) => event.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1 && event.cancelable) event.preventDefault();
  }, { passive: false });
  document.addEventListener("wheel", (event) => {
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });
}

function setupInstall() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone) document.body.classList.add("standalone");
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    $("install-go").hidden = false;
  });
  $("install-go").addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $("install-go").hidden = true;
  });
}

$("settings-lock-cancel").addEventListener("click", () => {
  $("settings-lock").hidden = true;
  $("settings-password").value = "";
  $("settings-lock-msg").textContent = "";
});
$("settings-lock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("settings-password").value !== SETTINGS_PASSWORD) {
    $("settings-lock-msg").textContent = "Wrong password.";
    return;
  }
  openSettings();
});
$("settings-password").addEventListener("focus", () => {
  setTimeout(() => $("settings-open").scrollIntoView({ block: "end" }), 50);
});
$("settings-back").addEventListener("click", closeSettings);
$("sync-phones").addEventListener("click", async () => {
  const button = $("sync-phones");
  button.disabled = true;
  const before = ledger?.ts || 0;
  lastPing = 0;
  try {
    await publishPing();
    const synced = await waitNewerLedger(before, 8000);
    renderSettingsAccounts();
    toast(synced ? "Synced with the main phone" : "Open Gizbit Network on the main phone, then try again.");
  } catch {
    toast("Couldn't reach the bank.");
  } finally {
    button.disabled = false;
  }
});
$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  login($("password").value);
});
$("password").addEventListener("focus", () => {
  setTimeout(() => $("login-go").scrollIntoView({ block: "end" }), 50);
});
let peekTimer = 0;
$("peek").addEventListener("pointerdown", (event) => {
  event.preventDefault();
});
$("peek").addEventListener("click", () => {
  const input = $("password");
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.type = "text";
  input.focus();
  if (start != null && end != null) input.setSelectionRange(start, end);
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    const caret = input.selectionStart;
    input.type = "password";
    input.focus();
    if (caret != null) input.setSelectionRange(caret, caret);
  }, 1000);
});
$("logout").addEventListener("click", () => {
  sessionPh = "";
  pendingExchangeId = "";
  pendingSendId = "";
  showHome();
  showLogin();
  $("login-msg").textContent = "";
});
$("open-exchange").addEventListener("click", () => {
  showExchangePage();
});
$("exchange-back").addEventListener("click", () => {
  showHome();
});
$("open-activity").addEventListener("click", () => {
  renderHistory();
  showSide("activity");
});
$("activity-back").addEventListener("click", () => showHome());

function euroRate() {
  try {
    const value = BigInt(activeSettings().euroRate || DEFAULT_EURO);
    return value > 0n ? value : BigInt(DEFAULT_EURO);
  } catch {
    return BigInt(DEFAULT_EURO);
  }
}

function paintRate() {
  $("rate-line").textContent = `1 euro = ${formatAmount(euroRate())} ₲`;
}

function readEuro(value) {
  const cleaned = String(value || "").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  const wholeRaw = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const frac = dot === -1 ? "" : cleaned.slice(dot + 1).replace(/\D/g, "").slice(0, 2);
  const text = dot === -1 ? wholeRaw : `${wholeRaw || "0"}.${frac}`;
  return { text, whole: wholeRaw || "0", frac, empty: !wholeRaw && frac === "" && dot === -1 };
}

function showGovTab(name) {
  $("gov-taxes-panel").hidden = name !== "taxes";
  $("gov-assets-panel").hidden = name !== "assets";
  $("gov-taxes").classList.toggle("is-on", name === "taxes");
  $("gov-assets").classList.toggle("is-on", name === "assets");
  $("gov-taxes").setAttribute("aria-selected", name === "taxes" ? "true" : "false");
  $("gov-assets").setAttribute("aria-selected", name === "assets" ? "true" : "false");
  $("gov-plus").hidden = name !== "taxes";
  if (name === "taxes") renderTaxDash();
}

function loadTaxes() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_TAXES) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function loadBizMap() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_BIZ) || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function businessesFor(accountId) {
  const list = loadBizMap()[accountId];
  if (!Array.isArray(list)) return [];
  return list.filter((name) => typeof name === "string" && name.trim()).map((name) => name.slice(0, 60));
}

function nextSheet(accountId) {
  const filed = loadTaxes().filter((item) => item.accountId === accountId);
  const max = filed.reduce((highest, item) => Math.max(highest, Number(String(item.sheet || "").replace(/\D/g, "")) || 0), 0);
  return String(max + 1);
}

function taxTotals(lines, rates) {
  let revenue = 0n;
  let vat = 0n;
  let profit = 0n;
  lines.forEach((line) => {
    const amount = BigInt(line.revenue);
    const due = (amount * BigInt(rates.vat)) / 100n;
    revenue += amount;
    vat += due;
    profit += amount - due;
  });
  const threshold = BigInt(rates.threshold);
  const tax = profit <= threshold
    ? (profit * BigInt(rates.low)) / 100n
    : (threshold * BigInt(rates.low)) / 100n + ((profit - threshold) * BigInt(rates.high)) / 100n;
  return {
    revenue: revenue.toString(),
    vat: vat.toString(),
    profit: profit.toString(),
    tax: tax.toString(),
    invoice: (vat + tax).toString(),
  };
}

function taxRates() {
  const settings = activeSettings();
  return {
    vat: settings.vatRate,
    low: settings.profitLow,
    high: settings.profitHigh,
    threshold: settings.profitThreshold,
  };
}

function chosenBusiness() {
  const value = $("tax-business").value;
  if (!value || value === "__new__") return "";
  return value;
}

function lineComplete(line) {
  const qty = moneyText(line.qty, false);
  const revenue = moneyText(line.revenue, false);
  return Boolean(line.name.trim() && qty && qty !== "0" && revenue != null);
}

function taxReady() {
  return Boolean(chosenBusiness()) && taxLines.length > 0 && taxLines.every(lineComplete);
}

function renderTaxDash() {
  const panel = $("gov-taxes-panel");
  const account = currentAccount();
  const filed = loadTaxes().filter((item) => item.accountId === account?.id);
  panel.replaceChildren();
  if (!filed.length) {
    const empty = document.createElement("p");
    empty.className = "quiet";
    empty.textContent = "No tax records yet.";
    panel.append(empty);
    return;
  }
  filed.forEach((item) => {
    const card = document.createElement("article");
    card.className = "tax-card";
    const title = document.createElement("strong");
    title.textContent = item.business;
    const meta = document.createElement("p");
    meta.textContent = `Sheet ${item.sheet} · Session ${item.session} · Total invoice ${formatAmount(item.totals?.invoice || "0")} ₲`;
    card.append(title, meta);
    panel.append(card);
  });
}

function fillBusinesses(selected) {
  const select = $("tax-business");
  const names = businessesFor(currentAccount()?.id || "");
  select.replaceChildren();
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Choose a business";
  select.append(blank);
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.append(option);
  });
  const add = document.createElement("option");
  add.value = "__new__";
  add.textContent = "Add new";
  select.append(add);
  select.value = names.includes(selected) ? selected : "";
}

function paintLine(card, line) {
  const revenue = moneyText(line.revenue, false);
  const rate = taxRates().vat;
  if (revenue == null || line.revenue === "") {
    card.querySelector(".tax-vat").textContent = `VAT due (${rate}%) —`;
    card.querySelector(".tax-net").textContent = "Net profit —";
    return;
  }
  const due = (BigInt(revenue) * BigInt(rate)) / 100n;
  const net = BigInt(revenue) - due;
  card.querySelector(".tax-vat").textContent = `VAT due (${rate}%) ${formatAmount(due)} ₲`;
  card.querySelector(".tax-net").textContent = `Net profit ${formatAmount(net)} ₲`;
}

function renderTaxLines() {
  const box = $("tax-lines");
  box.replaceChildren();
  taxLines.forEach((line, index) => {
    const card = document.createElement("div");
    card.className = "tax-line";
    const name = document.createElement("input");
    name.maxLength = 40;
    name.autocomplete = "off";
    name.value = line.name;
    name.addEventListener("input", () => {
      line.name = name.value;
      markTaxDirty();
    });
    const qty = document.createElement("input");
    qty.inputMode = "numeric";
    qty.autocomplete = "off";
    qty.value = line.qty ? formatFull(line.qty) : "";
    qty.addEventListener("input", () => {
      const digits = qty.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      line.qty = digits;
      const shown = digits ? formatFull(digits) : "";
      if (qty.value !== shown) {
        qty.value = shown;
        qty.setSelectionRange(shown.length, shown.length);
      }
      paintLine(card, line);
      markTaxDirty();
    });
    const revenue = document.createElement("input");
    revenue.inputMode = "numeric";
    revenue.autocomplete = "off";
    revenue.value = line.revenue ? formatFull(line.revenue) : "";
    revenue.addEventListener("input", () => {
      let digits = revenue.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      if (digits && BigInt(digits) > MAX) digits = MAX.toString();
      line.revenue = digits;
      const shown = digits ? formatFull(digits) : "";
      if (revenue.value !== shown) {
        revenue.value = shown;
        revenue.setSelectionRange(shown.length, shown.length);
      }
      paintLine(card, line);
      markTaxDirty();
    });
    const calc = document.createElement("div");
    calc.className = "tax-calc";
    const vat = document.createElement("p");
    vat.className = "tax-vat";
    const net = document.createElement("p");
    net.className = "tax-net";
    calc.append(vat, net);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn ghost slim";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      taxLines.splice(index, 1);
      if (!taxLines.length) taxLines.push({ name: "", qty: "", revenue: "" });
      renderTaxLines();
    });
    card.append(labeled("Product", name), labeled("Total quantities sold", qty), labeled("Revenue", revenue), calc, remove);
    paintLine(card, line);
    box.append(card);
  });
  paintTaxTotals();
  paintTaxFinish();
}

function labeled(text, input) {
  const label = document.createElement("label");
  label.className = "field";
  const span = document.createElement("span");
  span.textContent = text;
  label.append(span, input);
  return label;
}

function paintTaxTotals() {
  const rates = taxRates();
  const lines = taxLines.filter((line) => moneyText(line.revenue, false) != null && line.revenue !== "").map((line) => ({
    revenue: moneyText(line.revenue, false),
  }));
  const totals = lines.length ? taxTotals(lines, rates) : null;
  $("tax-gross-revenue").textContent = totals ? `${formatAmount(totals.revenue)} ₲` : "—";
  $("tax-gross-vat").textContent = totals ? `${formatAmount(totals.vat)} ₲` : "—";
  $("tax-gross-profit").textContent = totals ? `${formatAmount(totals.profit)} ₲` : "—";
  $("tax-profit-tax").textContent = totals ? `${formatAmount(totals.tax)} ₲` : "—";
  $("tax-invoice").textContent = totals ? `${formatAmount(totals.invoice)} ₲` : "—";
  $("tax-rate-note").textContent = `VAT is ${rates.vat}% of revenue. Profit tax is ${rates.low}% up to ${formatAmount(rates.threshold)} ₲ and ${rates.high}% on anything over that. These rates are set on the network phone.`;
}

function paintTaxFinish() {
  const ready = taxReady();
  const finish = $("tax-finish");
  if (!ready) {
    if (!finish.hidden) {
      $("tax-agree").checked = false;
      taxPad.setEnabled(false);
    }
    finish.hidden = true;
    paintTaxCommit();
    return;
  }
  const opening = finish.hidden;
  finish.hidden = false;
  $("tax-terms-text").textContent = activeSettings().taxTerms;
  if (opening) requestAnimationFrame(() => taxPad.size());
  paintTaxCommit();
}

function paintTaxCommit() {
  $("tax-commit").disabled = taxBusy || !taxReady() || !$("tax-agree").checked || !taxSigned;
}

function markTaxDirty() {
  if ($("tax-agree").checked || taxSigned) {
    $("tax-agree").checked = false;
    taxPad.setEnabled(false);
  }
  paintTaxTotals();
  paintTaxFinish();
}

function openTaxForm() {
  const account = currentAccount();
  if (!account) return;
  taxLines = [{ name: "", qty: "", revenue: "" }];
  taxSigned = false;
  taxBusy = false;
  $("tax-msg").textContent = "";
  $("tax-biz-msg").textContent = "";
  $("tax-owner").value = account.name;
  $("tax-session").value = "1";
  $("tax-sheet").value = nextSheet(account.id);
  fillBusinesses("");
  $("tax-new").hidden = true;
  $("tax-business-name").value = "";
  $("tax-agree").checked = false;
  $("tax-terms-text").textContent = activeSettings().taxTerms;
  renderTaxLines();
  taxPad.setEnabled(false);
  showSide("tax");
}

function saveBusiness() {
  const account = currentAccount();
  const name = $("tax-business-name").value.trim().slice(0, 60);
  $("tax-biz-msg").textContent = "";
  if (!account || !name) {
    $("tax-biz-msg").textContent = "Enter the business name.";
    return;
  }
  const map = loadBizMap();
  const list = businessesFor(account.id);
  if (!list.some((item) => item.toLowerCase() === name.toLowerCase())) list.push(name);
  map[account.id] = list.slice(0, 40);
  localStorage.setItem(LOCAL_BIZ, JSON.stringify(map));
  fillBusinesses(name);
  $("tax-new").hidden = true;
  $("tax-business-name").value = "";
  paintTaxFinish();
}

async function commitTax() {
  if (taxBusy || !taxReady() || !$("tax-agree").checked || !taxSigned) return;
  const account = currentAccount();
  if (!account) return;
  const rates = taxRates();
  const lines = taxLines.map((line) => ({
    name: line.name.trim().slice(0, 40),
    qty: moneyText(line.qty, false),
    revenue: moneyText(line.revenue, false),
  }));
  const totals = taxTotals(lines, rates);
  const id = uid();
  const ts = Date.now();
  const payload = {
    v: 1,
    kind: "tax",
    id,
    accountId: account.id,
    ph: sessionPh,
    owner: account.name,
    business: chosenBusiness(),
    session: "1",
    sheet: $("tax-sheet").value,
    vatRate: rates.vat,
    lowRate: rates.low,
    highRate: rates.high,
    threshold: rates.threshold,
    lines,
    sign: taxPad.strokes(),
    ts,
  };
  if (encode(`${account.name} filed a tax return`, payload).length > 4000) {
    $("tax-msg").textContent = "That return is too long. Remove a product or use a shorter signature.";
    return;
  }
  taxBusy = true;
  paintTaxCommit();
  $("tax-thanks").hidden = false;
  $("tax-wait").hidden = false;
  $("tax-thanks-body").hidden = true;
  const started = Date.now();
  try {
    await publish(`${account.name} filed a tax return`, payload);
  } catch {
    taxBusy = false;
    paintTaxCommit();
    $("tax-thanks").hidden = true;
    $("tax-msg").textContent = "Couldn't reach the network. Try again.";
    return;
  }
  const wait = 900 - (Date.now() - started);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const stored = loadTaxes();
  stored.unshift({
    id,
    accountId: account.id,
    owner: account.name,
    business: chosenBusiness(),
    session: "1",
    sheet: $("tax-sheet").value,
    totals,
    ts,
  });
  localStorage.setItem(LOCAL_TAXES, JSON.stringify(stored.slice(0, 40)));
  taxBusy = false;
  $("tax-wait").hidden = true;
  $("tax-thanks-body").hidden = false;
}

$("open-calc").addEventListener("click", () => {
  paintRate();
  showSide("calc");
});
$("calc-back").addEventListener("click", () => showHome());
$("euro-input").addEventListener("input", () => {
  const input = $("euro-input");
  const read = readEuro(input.value);
  if (input.value !== read.text) {
    input.value = read.text;
    input.setSelectionRange(input.value.length, input.value.length);
  }
  if (read.empty) {
    $("euro-out").textContent = "";
    return;
  }
  const gizbits = (BigInt(read.whole) * 100n + BigInt((read.frac || "0").padEnd(2, "0"))) * euroRate() / 100n;
  $("euro-out").textContent = `${formatAmount(gizbits)} ₲`;
});
$("giz-input").addEventListener("input", () => {
  const input = $("giz-input");
  const digits = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  input.value = formatTyping(digits);
  if (!digits) {
    $("giz-out").textContent = "";
    return;
  }
  const cents = (BigInt(digits) * 100n) / euroRate();
  $("giz-out").textContent = `€${formatFull(cents / 100n)}.${String(cents % 100n).padStart(2, "0")}`;
});
$("open-gov").addEventListener("click", () => {
  showGovTab("taxes");
  showSide("gov");
});
$("gov-back").addEventListener("click", () => showHome());
$("gov-taxes").addEventListener("click", () => showGovTab("taxes"));
$("gov-assets").addEventListener("click", () => showGovTab("assets"));
$("gov-plus").addEventListener("click", () => openTaxForm());
$("tax-back").addEventListener("click", () => showSide("gov"));
$("tax-business").addEventListener("change", () => {
  const adding = $("tax-business").value === "__new__";
  $("tax-new").hidden = !adding;
  if (adding) $("tax-business-name").focus();
  paintTaxFinish();
});
$("tax-business-save").addEventListener("click", saveBusiness);
$("tax-business-name").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveBusiness();
  }
});
$("tax-add-line").addEventListener("click", () => {
  if (taxLines.length >= 12) return;
  taxLines.push({ name: "", qty: "", revenue: "" });
  renderTaxLines();
});
$("tax-agree").addEventListener("change", () => {
  taxPad.setEnabled($("tax-agree").checked);
  if ($("tax-agree").checked) requestAnimationFrame(() => taxPad.size());
  paintTaxCommit();
});
$("tax-commit").addEventListener("click", () => commitTax());
$("tax-ok").addEventListener("click", () => {
  $("tax-thanks").hidden = true;
  showGovTab("taxes");
  showSide("gov");
});
$("send-account").addEventListener("change", () => {
  sendAccountId = $("send-account").value;
  sendAmount = "";
  $("send-amount").value = "";
  $("send-agree").checked = false;
  sendSigned = false;
  $("send-msg").textContent = "";
  revealSend();
});
$("send-amount").addEventListener("input", () => {
  const input = $("send-amount");
  const formatted = formatTyping(input.value);
  input.value = formatted;
  let digits = cleanTenBillion(formatted.replace(/\D/g, ""));
  const balance = currentAccount() ? BigInt(currentAccount().bal) : 0n;
  if (digits && BigInt(digits) > balance) digits = floorTo(digits, BILLION_STEP, balance);
  if (formatTyping(digits) !== formatted) {
    input.value = formatTyping(digits);
    input.setSelectionRange(input.value.length, input.value.length);
  }
  sendAmount = digits;
  $("send-msg").textContent = "";
  revealSend();
});
$("send-amount").addEventListener("change", () => {
  const digits = $("send-amount").value.replace(/\D/g, "");
  const balance = currentAccount() ? BigInt(currentAccount().bal) : 0n;
  const snapped = floorTo(cleanTenBillion(digits), BILLION_STEP, balance);
  $("send-amount").value = snapped ? formatTyping(snapped) : "";
  sendAmount = snapped;
  revealSend();
});
$("send-agree").addEventListener("change", revealSend);
$("send-go").addEventListener("click", () => sendGizbits());
$("send-terms-open").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  $("terms-body").textContent = activeSettings().terms;
  $("terms").hidden = false;
});
$("sign-close").addEventListener("click", () => {
  $("sign-sheet").hidden = true;
});
$("sign-sheet").addEventListener("click", (event) => {
  if (event.target === $("sign-sheet")) $("sign-sheet").hidden = true;
});
$("pick-withdraw").addEventListener("click", () => chooseOp("withdraw"));
$("pick-deposit").addEventListener("click", () => chooseOp("deposit"));
$("pick-transfer").addEventListener("click", () => chooseOp("transfer"));
function formatTyping(value) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function liftAmount() {
  const field = $("other-amount");
  const pane = $("exchange-pane");
  if (!$("bank") || $("bank").hidden || $("amount-step").hidden) return;
  if (document.activeElement !== field) return;
  const paneRect = pane.getBoundingClientRect();
  const fieldRect = field.getBoundingClientRect();
  const overflow = fieldRect.bottom - (paneRect.bottom - 20);
  if (overflow > 0) pane.scrollTop += overflow;
}

function snapTyped(digits) {
  const { max } = limits();
  return floorTo(digits, AMOUNT_STEP, max);
}

$("other-amount").addEventListener("change", () => {
  const digits = $("other-amount").value.replace(/\D/g, "");
  if (!digits || onAmountStep(digits)) return;
  const snapped = snapTyped(digits);
  $("other-amount").value = snapped ? formatTyping(snapped) : "";
  chosenAmount = snapped;
  $("move-msg").textContent = "";
  renderPresets();
  revealSteps();
});
$("other-amount").addEventListener("focus", () => {
  setTimeout(liftAmount, 50);
});
$("other-amount").addEventListener("input", () => {
  const input = $("other-amount");
  const caret = input.selectionStart || 0;
  const digitsBefore = input.value.slice(0, caret).replace(/\D/g, "").length;
  const formatted = formatTyping(input.value);
  input.value = formatted;
  let seen = 0;
  let pos = formatted.length;
  if (!digitsBefore) pos = 0;
  else {
    for (let i = 0; i < formatted.length; i += 1) {
      if (/\d/.test(formatted[i])) seen += 1;
      if (seen >= digitsBefore) {
        pos = i + 1;
        break;
      }
    }
  }
  input.setSelectionRange(pos, pos);
  let digits = cleanTenBillion(formatted.replace(/\D/g, ""));
  if ((chosenOp === "withdraw" || chosenOp === "deposit") && digits) {
    const { max } = limits();
    if (BigInt(digits) > max) digits = floorTo(digits, AMOUNT_STEP, max);
  }
  if (formatTyping(digits) !== formatted) {
    input.value = formatTyping(digits);
    input.setSelectionRange(input.value.length, input.value.length);
  }
  chosenAmount = parseAmount(digits) || "";
  if (digits && !amountAllowed(chosenAmount) && onAmountStep(digits)) $("move-msg").textContent = rangeNote();
  else $("move-msg").textContent = "";
  renderPresets();
  revealSteps();
  liftAmount();
});
$("account-pick").addEventListener("change", () => {
  accountId = $("account-pick").value;
  paintAccount();
  renderHistory();
  if (chosenOp) chooseOp(chosenOp);
  renderTaxDash();
  if ($("tax-pane").classList.contains("is-front")) openTaxForm();
});
$("agree").addEventListener("change", () => {
  if (!$("agree").checked) pad.setEnabled(false);
  revealSteps();
});
$("terms-open").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  $("terms-body").textContent = activeSettings().terms;
  $("terms").hidden = false;
});
$("terms-close").addEventListener("click", () => {
  $("terms").hidden = true;
});
$("terms").addEventListener("click", (event) => {
  if (event.target === $("terms")) $("terms").hidden = true;
});
$("exchange").addEventListener("click", () => exchange());
$("done-ok").addEventListener("click", () => {
  $("done").hidden = true;
});
bindViewport();
stopOverscroll($("main"));
lockGestures();
setupInstall();
refreshStatus();
document.querySelectorAll(".ver").forEach((node) => {
  node.textContent = VERSION;
});
["gizbit-terminal-name", "gizbit-terminal-trust", "gizbit-terminal-banks", "gizbit-terminal-books", "gizbit-terminal-device"].forEach((key) => {
  localStorage.removeItem(key);
});
showLogin();
setInterval(refreshStatus, 5000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

catchUp().catch(() => refreshStatus()).finally(() => {
  listen();
  publishPing().catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  catchUp().catch(() => {});
  publishPing().catch(() => {});
});
