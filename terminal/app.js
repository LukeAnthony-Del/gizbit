// Other phone. Keep TOPIC, encode, and decode identical in ../app.js.
const TOPIC = "gizbit-net-m3p8k2w7q9n4";
const NTFY = "https://ntfy.envs.net";
const LEDGER = "gizbit-terminal-ledger";
const CURSOR = "gizbit-terminal-cursor";
const MAX = 10n ** 18n;
const DEFAULT_PRESETS = ["100000000000", "250000000000", "500000000000", "750000000000", "1000000000000", "2000000000000"];
const DEFAULT_MIN = "50000000000";
const DEFAULT_TERMS = "An exchange is recorded on the main phone. You confirm the amount is correct and that the gizbits will be handed over as agreed.";
// Versions start at 1.00.000. A small fix adds 0.00.001, a feature adds 0.01.000, and a large change adds 1.00.000.
const VERSION = "1.01.000";

let ledger = loadLedger();
let sessionPh = "";
let liveThisSession = false;
let source = null;
let lastPing = 0;
let toastTimer = 0;
let pendingExchangeId = "";
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
      accounts: data.accounts.map(sanitize).filter(Boolean),
      settings: normalizeSettings(data.settings),
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
  return { presets: DEFAULT_PRESETS.slice(), terms: DEFAULT_TERMS, minAmount: DEFAULT_MIN, maxAmount: "" };
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
  const scales = [[10n ** 12n, "Trillion"], [10n ** 9n, "Billion"], [10n ** 6n, "Million"]];
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

function setStatus(text) {
  $("link-status").textContent = text;
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
  if (!ledger) setStatus("Looking for the main phone…");
  else if (Date.now() - ledger.ts < 20000) setStatus("Connected to the main phone");
  else setStatus("Showing the last balances from the main phone");
}

function matching(ph) {
  return (ledger?.accounts || []).filter((account) => account.ph === ph);
}

function acceptLedger(body) {
  if (!body || !Array.isArray(body.accounts)) return;
  const ts = Number(body.ts) || 0;
  if (ledger && ts && ledger.ts && ts < ledger.ts) return;
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
  window.dispatchEvent(new CustomEvent("gizbit-ledger"));
  if (sessionPh && !matching(sessionPh).length) {
    sessionPh = "";
    showLogin();
    $("login-msg").textContent = "That account was removed.";
    return;
  }
  if (sessionPh) renderBank();
  checkExchangeResult();
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
  if (body.kind === "ledger") acceptLedger(body);
  if (body.kind === "decision") finishExchange(body.id, body.status);
  if (body.kind === "reject" && body.id) {
    reasons.set(body.id, body.reason || "The main phone refused that.");
    if (body.id === pendingExchangeId) finishExchange(body.id, "denied");
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
let accountId = "";
let chosenOp = "";
let chosenAmount = "";
let signed = false;
let exchangeSent = false;

function showLogin() {
  $("login").hidden = false;
  $("bank").hidden = true;
  $("logout").hidden = true;
  $("password").value = "";
  $("password").type = "password";
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
  renderPresets();
  revealSteps();
}

function showHome() {
  $("stage").classList.remove("is-exchange");
  if (sessionPh) $("logout").hidden = false;
}

function showExchangePage() {
  $("stage").classList.add("is-exchange");
  $("logout").hidden = true;
  $("exchange-pane").scrollTop = 0;
}

function revealSteps() {
  const note = $("range-note");
  if (note) note.textContent = chosenOp ? rangeNote() : "";
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
    button.textContent = "Exchange";
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
  $("done").hidden = false;
}

function checkExchangeResult() {
  const found = (ledger?.requests || []).find((item) => item.id === pendingExchangeId);
  if (found) finishExchange(found.id, found.status);
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
    message.textContent = "Checking with the main phone…";
    const before = ledger?.ts || 0;
    const pingId = uid();
    try {
      await publish("Checking accounts", { v: 1, kind: "ping", id: pingId, ts: Date.now() });
    } catch {
      if (!(liveThisSession && matching(ph).length)) {
        message.textContent = "Couldn't reach the bank. Try again.";
        return;
      }
    }
    const live = await waitForLiveLedger(before, 12000);
    if (!live && !(liveThisSession && matching(ph).length)) {
      message.textContent = "Open Gizbit Network on the main phone, then try again.";
      return;
    }
    if (!matching(ph).length) {
      message.textContent = "That password doesn't match an account.";
      return;
    }
    sessionPh = ph;
    accountId = matching(ph)[0].id;
    $("login").hidden = true;
    $("bank").hidden = false;
    $("logout").hidden = false;
    showHome();
    resetExchange();
    renderBank();
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
  $("amount-step").hidden = false;
  $("amount-label").textContent = `How much do you wish to ${op === "withdraw" ? "withdraw" : "deposit"}?`;
  $("presets").hidden = op !== "withdraw";
  $("other-label").textContent = op === "deposit" ? "Amount" : "Other";
  $("move-msg").textContent = "";
  renderPresets();
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
  const amount = chosenAmount;
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
  message.textContent = "Sending to the main phone…";
  try {
    await publish(`Exchange pending from ${latest.name}`, {
      v: 1,
      kind: "request",
      id,
      accountId: latest.id,
      op,
      amount,
      ph: sessionPh,
      ts: Date.now(),
    });
  } catch {
    pendingExchangeId = "";
    exchangeSent = false;
    message.textContent = "Couldn't reach the bank. Try again.";
    revealSteps();
    return;
  }
  message.textContent = "Sent. Waiting for the network to confirm.";
  checkExchangeResult();
}

function bindPad() {
  const canvas = $("sign");
  const block = $("sign-block");
  const clearBtn = $("clear-sign");
  const ctx = canvas.getContext("2d");
  let drawing = false;
  function size() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2) return;
    const ink = signed;
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = 140 * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.strokeStyle = "#173a5a";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    if (!ink) signed = false;
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
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    event.preventDefault();
    const point = pos(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    signed = true;
    revealSteps();
  });
  canvas.addEventListener("pointerup", () => {
    drawing = false;
  });
  canvas.addEventListener("pointercancel", () => {
    drawing = false;
  });
  clearBtn.addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    signed = false;
    revealSteps();
  });
  return {
    size,
    setEnabled(on) {
      block.classList.toggle("is-locked", !on);
      clearBtn.disabled = !on;
      if (!on) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        signed = false;
      }
    },
  };
}

const pad = bindPad();

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
  showHome();
  showLogin();
});
$("open-exchange").addEventListener("click", () => {
  showExchangePage();
});
$("exchange-back").addEventListener("click", () => {
  showHome();
});
$("pick-withdraw").addEventListener("click", () => chooseOp("withdraw"));
$("pick-deposit").addEventListener("click", () => chooseOp("deposit"));
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
  let digits = formatted.replace(/\D/g, "");
  if (chosenOp === "withdraw" && digits) {
    const typed = BigInt(digits);
    const { max } = limits();
    if (typed > max) {
      let capped = max > 0n ? max : 0n;
      if (capped >= AMOUNT_STEP) capped -= capped % AMOUNT_STEP;
      digits = capped.toString();
      input.value = formatTyping(digits);
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  chosenAmount = parseAmount(digits) || "";
  if (digits && !onAmountStep(digits)) $("move-msg").textContent = "Use a multiple of 50 billion.";
  else if (digits && !amountAllowed(chosenAmount)) $("move-msg").textContent = rangeNote();
  else $("move-msg").textContent = "";
  renderPresets();
  revealSteps();
  liftAmount();
});
$("account-pick").addEventListener("change", () => {
  accountId = $("account-pick").value;
  paintAccount();
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
showLogin();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

catchUp().catch(() => setStatus("Looking for the main phone…")).finally(() => {
  listen();
  publishPing().catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  catchUp().catch(() => {});
  publishPing().catch(() => {});
});
