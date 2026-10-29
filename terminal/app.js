// Other phone. Keep TOPIC, encode, and decode identical in ../app.js.
const TOPIC = "gizbit-net-m3p8k2w7q9n4";
const LEDGER = "gizbit-terminal-ledger";
const CURSOR = "gizbit-terminal-cursor";
const MAX = 1000000000;

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
    };
  } catch {
    return null;
  }
}

function sanitize(account) {
  if (!account || typeof account.id !== "string") return null;
  if (!/^[0-9a-f]{64}$/.test(account.ph || "")) return null;
  if (!Number.isInteger(account.bal)) return null;
  return {
    id: account.id,
    name: String(account.name || "").slice(0, 40),
    type: String(account.type || "Account").slice(0, 24),
    bal: account.bal,
    ph: account.ph,
  };
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseAmount(value) {
  let text = String(value || "").trim().replace(/\s/g, "");
  if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX) return null;
  return cents;
}

function formatAmount(cents) {
  const amount = Math.abs(Number(cents) || 0);
  const whole = Math.floor(amount / 100);
  const frac = amount % 100;
  return frac ? `${whole}.${String(frac).padStart(2, "0")}` : String(whole);
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

function showLogin() {
  $("login").hidden = false;
  $("bank").hidden = true;
  $("password").value = "";
}

function renderBank() {
  const cards = $("cards");
  const drafts = new Map();
  cards.querySelectorAll("[data-amount]").forEach((input) => {
    drafts.set(input.dataset.amount, input.value);
  });
  const focusId = document.activeElement?.dataset?.amount || "";
  cards.replaceChildren();
  matching(sessionPh).forEach((account) => {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = account.id;
    const type = document.createElement("p");
    type.className = "type";
    type.textContent = account.type;
    const name = document.createElement("h2");
    name.textContent = account.name;
    const balance = document.createElement("p");
    balance.className = "bal";
    balance.textContent = `₲ ${formatAmount(account.bal)}`;
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = "Amount (₲)";
    const input = document.createElement("input");
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "0";
    input.dataset.amount = account.id;
    input.value = drafts.get(account.id) || "";
    label.append(span, input);
    const actions = document.createElement("div");
    actions.className = "actions";
    const deposit = document.createElement("button");
    deposit.type = "button";
    deposit.className = "btn silver";
    deposit.dataset.op = "deposit";
    deposit.textContent = "Deposit";
    deposit.addEventListener("click", () => sendMove(account, "deposit", input));
    const withdraw = document.createElement("button");
    withdraw.type = "button";
    withdraw.className = "btn line";
    withdraw.dataset.op = "withdraw";
    withdraw.textContent = "Withdraw";
    withdraw.addEventListener("click", () => sendMove(account, "withdraw", input));
    actions.append(deposit, withdraw);
    const status = document.createElement("p");
    status.className = "status";
    status.dataset.status = account.id;
    card.append(type, name, balance, label, actions, status);
    cards.append(card);
  });
  if (!cards.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "lead";
    empty.textContent = "Those accounts are no longer on the main phone.";
    cards.append(empty);
  }
  if (focusId) {
    const input = [...cards.querySelectorAll("[data-amount]")].find((node) => node.dataset.amount === focusId);
    if (input) input.focus();
  }
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
    $("login").hidden = true;
    $("bank").hidden = false;
    renderBank();
    message.textContent = "";
  } catch {
    message.textContent = "This page needs a secure connection before it can check a password.";
  } finally {
    button.disabled = false;
  }
}

async function sendMove(account, op, input) {
  const status = [...document.querySelectorAll("[data-status]")].find((node) => node.dataset.status === account.id);
  const amount = parseAmount(input.value);
  if (amount == null) {
    if (status) status.textContent = "Enter an amount like 10 or 10.50.";
    return;
  }
  const latest = matching(sessionPh).find((item) => item.id === account.id) || account;
  if (op === "withdraw" && latest.bal < amount) {
    if (status) status.textContent = "Not enough gizbits in that account.";
    return;
  }
  if (op === "deposit" && latest.bal + amount > MAX) {
    if (status) status.textContent = "That would make the balance too large.";
    return;
  }
  const id = uid();
  const sentence = op === "withdraw"
    ? `Withdraw ${formatAmount(amount)} ₲ from ${latest.name}.`
    : `Deposit ${formatAmount(amount)} ₲ to ${latest.name}.`;
  if (status) status.textContent = "Sending to the main phone…";
  const buttons = input.closest(".card").querySelectorAll("button");
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    await publish(sentence, {
      v: 1,
      kind: "tx",
      id,
      accountId: latest.id,
      op,
      amount,
      ph: sessionPh,
      ts: Date.now(),
    });
  } catch {
    if (status) status.textContent = "Couldn't reach the bank. Try again.";
    buttons.forEach((button) => {
      button.disabled = false;
    });
    return;
  }
  const result = await waitFor(id, 8000);
  const card = [...document.querySelectorAll(".card")].find((node) => node.dataset.id === latest.id);
  const liveStatus = card?.querySelector(".status");
  const liveInput = card?.querySelector("input");
  card?.querySelectorAll("button").forEach((button) => {
    button.disabled = false;
  });
  if (result === "ok") {
    if (liveInput) liveInput.value = "";
    if (liveStatus) liveStatus.textContent = "The main phone updated this balance.";
    toast(sentence);
  } else if (result === "reject") {
    if (liveStatus) liveStatus.textContent = reasons.get(id) || "The main phone refused that.";
  } else if (liveStatus) {
    liveStatus.textContent = "Sent. Open Gizbit Network on the main phone to finish it.";
  }
}

function bindViewport() {
  const apply = () => {
    const viewport = window.visualViewport;
    const height = viewport ? viewport.height : window.innerHeight;
    const top = viewport ? viewport.offsetTop : 0;
    document.documentElement.style.setProperty("--vvh", `${height}px`);
    document.documentElement.style.setProperty("--vvtop", `${top}px`);
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
$("logout").addEventListener("click", () => {
  sessionPh = "";
  showLogin();
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
