// Other phone. Keep TOPIC, encode, and decode identical in ../app.js.
const TOPIC = "gizbit-net-m3p8k2w7q9n4";
const LEDGER = "gizbit-terminal-ledger";
const CURSOR = "gizbit-terminal-cursor";
const MAX = 10n ** 18n;
const DEFAULT_PRESETS = ["100000000000", "250000000000", "500000000000", "750000000000", "1000000000000", "2000000000000"];
const DEFAULT_TERMS = "An exchange is recorded on the main phone. You confirm the amount is correct and that the gizbits will be handed over as agreed.";

let ledger = loadLedger();
let sessionPh = "";
let source = null;
let lastPing = 0;
let postChain = Promise.resolve();
let toastTimer = 0;
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
  return { presets: DEFAULT_PRESETS.slice(), terms: DEFAULT_TERMS };
}

function normalizeSettings(value) {
  const presets = Array.isArray(value?.presets) ? value.presets.map((item) => moneyText(item, false)).filter(Boolean) : [];
  while (presets.length < 6) presets.push(DEFAULT_PRESETS[presets.length]);
  return {
    presets: presets.slice(0, 6),
    terms: String(value?.terms || DEFAULT_TERMS).slice(0, 800),
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
    if (amount % unit === 0n) return `${formatFull(amount / unit)} ${label}`;
    const tenths = (amount * 10n) / unit;
    return `${tenths / 10n}.${tenths % 10n} ${label}`;
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

function publish(sentence, payload) {
  const job = postChain.then(async () => {
    const res = await fetch(`https://ntfy.sh/${TOPIC}`, {
      method: "POST",
      body: encode(sentence, payload),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
  });
  postChain = job.catch(() => {});
  return job;
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
    accounts: body.accounts.map(sanitize).filter(Boolean),
    settings: normalizeSettings(body.settings),
  };
  localStorage.setItem(LEDGER, JSON.stringify(ledger));
  refreshStatus();
  window.dispatchEvent(new CustomEvent("gizbit-ledger"));
  if (sessionPh) renderBank();
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
  if (body.kind === "reject" && body.id) {
    reasons.set(body.id, body.reason || "The main phone refused that.");
    resolveWait(body.id, "reject");
  }
}

async function catchUp() {
  const res = await fetch(`https://ntfy.sh/${TOPIC}/json?poll=1&since=${encodeURIComponent(sinceQuery())}`, { cache: "no-store" });
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
  source = new EventSource(`https://ntfy.sh/${TOPIC}/sse?since=${encodeURIComponent(sinceQuery())}`);
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

let accountId = "";
let chosenOp = "";
let chosenAmount = "";
let photoTaken = false;
let signed = false;
let selfieToken = 0;

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
    $("who").textContent = "Those accounts are no longer on the main phone.";
    $("balance").textContent = "";
    $("balance-full").textContent = "";
    return;
  }
  accountId = account.id;
  pick.value = account.id;
  $("welcome").textContent = `Welcome, ${account.name}`;
  $("who").textContent = account.name;
  $("balance").textContent = `${formatAmount(account.bal)} ₲`;
  $("balance-full").textContent = formatFull(account.bal);
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
    if (chosenAmount === value && !$("other-amount").value.trim()) button.classList.add("is-on");
    button.addEventListener("click", () => {
      chosenAmount = value;
      $("other-amount").value = "";
      renderPresets();
      refreshExchange();
    });
    box.append(button);
  });
}

function renderBank() {
  paintAccount();
  renderPresets();
  refreshExchange();
}

function refreshExchange() {
  const ready = Boolean(chosenOp && chosenAmount && $("agree").checked && photoTaken && signed && currentAccount());
  $("exchange").disabled = !ready;
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
    const fresh = ledger && Date.now() - ledger.ts < 8000;
    if (!matching(ph).length || !fresh) {
      message.textContent = "Checking with the main phone…";
      try {
        await publishPing();
      } catch {
        /* The saved balances can still be used if the bank is offline. */
      }
      await waitLedger(matching(ph).length ? 2500 : 5000);
    }
    if (!matching(ph).length) {
      message.textContent = ledger
        ? "That password doesn't match an account."
        : "Open Gizbit Network on the main phone, then try again.";
      return;
    }
    sessionPh = ph;
    accountId = matching(ph)[0].id;
    $("login").hidden = true;
    $("bank").hidden = false;
    $("logout").hidden = false;
    resetExchange();
    renderBank();
    pad.size();
    message.textContent = "";
  } catch {
    message.textContent = "This page needs a secure connection before it can check a password.";
  } finally {
    button.disabled = false;
  }
}

function resetExchange() {
  chosenOp = "";
  chosenAmount = "";
  photoTaken = false;
  signed = false;
  selfieToken += 1;
  $("agree").checked = false;
  $("other-amount").value = "";
  $("move-msg").textContent = "";
  $("pick-withdraw").classList.remove("is-on");
  $("pick-deposit").classList.remove("is-on");
  pad.setEnabled(false);
  refreshExchange();
}

async function takePhoto() {
  const token = ++selfieToken;
  photoTaken = false;
  const message = $("move-msg");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $("agree").checked = false;
    pad.setEnabled(false);
    message.textContent = "This phone cannot take a photo from the browser.";
    refreshExchange();
    return;
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "user" }, width: { ideal: 480 }, height: { ideal: 640 } },
    });
    if (token !== selfieToken) return;
    const video = document.createElement("video");
    video.setAttribute("playsinline", "");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (video.readyState < 2) {
      await new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (token !== selfieToken || !$("agree").checked) return;
    const width = 320;
    const ratio = video.videoWidth ? video.videoHeight / video.videoWidth : 1.25;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(width * ratio));
    const ctx = canvas.getContext("2d");
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    photoTaken = true;
    message.textContent = "";
    pad.setEnabled(true);
    pad.size();
  } catch {
    if (token !== selfieToken) return;
    photoTaken = false;
    $("agree").checked = false;
    pad.setEnabled(false);
    message.textContent = "Allow the front camera so a photo can be taken.";
  } finally {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    refreshExchange();
  }
}

async function exchange() {
  const message = $("move-msg");
  message.textContent = "";
  const account = currentAccount();
  const amount = chosenAmount;
  const op = chosenOp;
  if (!account || !op || !amount || !$("agree").checked || !photoTaken || !signed) return;
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
  const id = uid();
  const sentence = op === "withdraw"
    ? `Withdraw ${formatAmount(amount)} ₲ from ${latest.name}.`
    : `Deposit ${formatAmount(amount)} ₲ to ${latest.name}.`;
  $("exchange").disabled = true;
  message.textContent = "Sending to the main phone…";
  try {
    await publish(sentence, {
      v: 1,
      kind: "tx",
      id,
      accountId: latest.id,
      op,
      amount,
      ph: sessionPh,
      photo: true,
      ts: Date.now(),
    });
  } catch {
    message.textContent = "Couldn't reach the bank. Try again.";
    refreshExchange();
    return;
  }
  const result = await waitFor(id, 12000);
  if (result === "ok") {
    resetExchange();
    renderBank();
    $("done").hidden = false;
    return;
  }
  if (result === "reject") message.textContent = reasons.get(id) || "The main phone refused that.";
  else message.textContent = "Sent. Open Gizbit Network on the main phone to finish it.";
  refreshExchange();
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
    refreshExchange();
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
    refreshExchange();
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
$("peek").addEventListener("click", () => {
  const input = $("password");
  input.type = "text";
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    input.type = "password";
  }, 1000);
});
$("logout").addEventListener("click", () => {
  sessionPh = "";
  showLogin();
});
$("pick-withdraw").addEventListener("click", () => {
  chosenOp = "withdraw";
  $("pick-withdraw").classList.add("is-on");
  $("pick-deposit").classList.remove("is-on");
  refreshExchange();
});
$("pick-deposit").addEventListener("click", () => {
  chosenOp = "deposit";
  $("pick-deposit").classList.add("is-on");
  $("pick-withdraw").classList.remove("is-on");
  refreshExchange();
});
$("other-amount").addEventListener("input", () => {
  chosenAmount = parseAmount($("other-amount").value) || "";
  renderPresets();
  refreshExchange();
});
$("account-pick").addEventListener("change", () => {
  accountId = $("account-pick").value;
  paintAccount();
});
$("agree").addEventListener("change", () => {
  if (!$("agree").checked) {
    photoTaken = false;
    selfieToken += 1;
    pad.setEnabled(false);
    refreshExchange();
    return;
  }
  takePhoto();
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
