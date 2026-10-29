// Main bank. Keep TOPIC, encode, and decode identical in terminal/app.js.
const TOPIC = "gizbit-net-m3p8k2w7q9n4";
const STORAGE = "gizbit-accounts";
const ACTIVITY = "gizbit-activity";
const SEEN = "gizbit-seen";
const CURSOR = "gizbit-cursor";
const MAX = 10n ** 18n;
const DEFAULT_PRESETS = ["100000000000", "250000000000", "500000000000", "750000000000", "1000000000000", "2000000000000"];
const DEFAULT_TERMS = "An exchange is recorded on the main phone. You confirm the amount is correct and that the gizbits will be handed over as agreed.";

const state = loadState();
const activity = loadList(ACTIVITY);
const seen = new Set(loadList(SEEN));
let source = null;
let streamOpen = false;
let lastAnnounce = 0;
let postChain = Promise.resolve();
let toastTimer = 0;

const $ = (id) => document.getElementById(id);

function loadState() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) || "");
    if (!data || !Array.isArray(data.accounts)) return { rev: 0, accounts: [], settings: defaultSettings() };
    return {
      rev: Number.isInteger(data.rev) ? data.rev : 0,
      accounts: data.accounts.map(sanitize).filter(Boolean),
      settings: normalizeSettings(data.settings),
    };
  } catch {
    return { rev: 0, accounts: [], settings: defaultSettings() };
  }
}

function defaultSettings() {
  return { presets: DEFAULT_PRESETS.slice(), terms: DEFAULT_TERMS };
}

function normalizeSettings(value) {
  const presets = Array.isArray(value?.presets) ? value.presets.map((item) => moneyText(item)).filter(Boolean) : [];
  while (presets.length < 6) presets.push(DEFAULT_PRESETS[presets.length]);
  return {
    presets: presets.slice(0, 6),
    terms: String(value?.terms || DEFAULT_TERMS).slice(0, 800),
  };
}

function loadList(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function sanitize(account) {
  if (!account || typeof account.id !== "string" || !/^[\w-]{8,}$/.test(account.id)) return null;
  if (!/^[0-9a-f]{64}$/.test(account.ph || "")) return null;
  const bal = moneyText(account.bal, typeof account.bal === "number");
  if (bal == null) return null;
  const name = String(account.name || "").trim();
  const type = String(account.type || "").trim();
  if (!name || !type) return null;
  return { id: account.id, name: name.slice(0, 40), type: type.slice(0, 24), bal, ph: account.ph };
}

function saveAccounts() {
  state.rev += 1;
  localStorage.setItem(STORAGE, JSON.stringify({ rev: state.rev, accounts: state.accounts, settings: state.settings }));
}

function saveActivity() {
  localStorage.setItem(ACTIVITY, JSON.stringify(activity.slice(0, 40)));
}

function remember(id) {
  if (!id || seen.has(id)) return false;
  seen.add(id);
  localStorage.setItem(SEEN, JSON.stringify([...seen].slice(-500)));
  return true;
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

function publishLedger(applied) {
  const payload = {
    v: 1,
    kind: "ledger",
    rev: state.rev,
    applied: applied || [],
    accounts: state.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      bal: account.bal,
      ph: account.ph,
    })),
    settings: state.settings,
    ts: Date.now(),
  };
  return publish("Balances updated", payload);
}

function publishReject(id, reason) {
  return publish("Request refused", { v: 1, kind: "reject", id, reason, ts: Date.now() }).catch(() => {});
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

function logActivity(text, extra) {
  activity.unshift({
    id: extra?.id || uid(),
    text,
    ts: Date.now(),
    remote: Boolean(extra?.remote),
    reviewed: extra?.remote ? false : true,
  });
  activity.splice(40);
  saveActivity();
  renderActivity();
}

function formatWhen(ts) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ts);
}

function renderActivity() {
  const list = $("activity");
  list.replaceChildren();
  activity.forEach((item) => {
    const li = document.createElement("li");
    const pending = item.remote && !item.reviewed;
    if (pending) li.classList.add("is-pending");
    const time = document.createElement("time");
    time.dateTime = new Date(item.ts).toISOString();
    time.textContent = formatWhen(item.ts);
    li.append(time, document.createTextNode(item.text));
    if (pending) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-btn";
      button.textContent = "Review";
      button.addEventListener("click", () => openReview(item.id));
      li.append(button);
    }
    list.append(li);
  });
  $("activity-empty").hidden = activity.length > 0;
}

function bindSwipe(row, id) {
  let startX = 0;
  let startY = 0;
  let active = false;
  row.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    active = true;
  });
  row.addEventListener("pointermove", (event) => {
    if (!active) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (dx > 8 && Math.abs(dx) > Math.abs(dy)) {
      row.style.transform = `translateX(${Math.min(dx, 120)}px)`;
    }
  });
  const finish = (event) => {
    if (!active) return;
    active = false;
    const dx = event.clientX - startX;
    row.style.transform = "";
    if (dx > 72) askDelete(id);
  };
  row.addEventListener("pointerup", finish);
  row.addEventListener("pointercancel", () => {
    active = false;
    row.style.transform = "";
  });
}

function renderRows() {
  const body = $("rows");
  body.replaceChildren();
  state.accounts.forEach((account) => {
    const swipe = document.createElement("div");
    swipe.className = "swipe";
    const row = document.createElement("div");
    row.className = "acct";
    const name = document.createElement("span");
    name.textContent = account.name;
    const type = document.createElement("span");
    type.textContent = account.type;
    const short = document.createElement("span");
    short.className = "bal-short";
    short.textContent = `${formatAmount(account.bal)} ₲`;
    const full = document.createElement("span");
    full.className = "bal-full";
    full.textContent = formatFull(account.bal);
    row.append(name, type, short, full);
    swipe.append(row);
    bindSwipe(swipe, account.id);
    body.append(swipe);
  });
  $("empty").hidden = state.accounts.length > 0;
}

function renderAccounts() {
  const select = $("move-account");
  const current = select.value;
  select.replaceChildren();
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = state.accounts.length ? "Choose an account" : "No accounts yet";
  select.append(blank);
  state.accounts.forEach((account) => {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = `${account.name} · ${account.type} · ${formatAmount(account.bal)} ₲`;
    select.append(option);
  });
  if ([...select.options].some((option) => option.value === current && current)) select.value = current;
  else if (state.accounts.length === 1) select.value = state.accounts[0].id;
}

function render() {
  renderRows();
  renderAccounts();
  renderActivity();
}

function showTab(name) {
  document.querySelectorAll(".page").forEach((page) => {
    const on = page.id === name;
    page.classList.toggle("is-active", on);
    page.hidden = !on;
  });
  document.querySelectorAll(".tabs button").forEach((button) => {
    const on = button.dataset.tab === name;
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
  });
  $("add-account").hidden = name !== "balances";
  $("main").scrollTop = 0;
}

function openSheet() {
  $("account-error").textContent = "";
  $("sheet").hidden = false;
  $("acc-name").focus();
}

function closeSheet() {
  $("sheet").hidden = true;
}

function sinceQuery() {
  try {
    const saved = JSON.parse(localStorage.getItem(CURSOR) || "");
    if (saved && Number.isFinite(saved.time)) return String(saved.time);
  } catch {
    /* First run reads the recent queue. */
  }
  return "12h";
}

function noteCursor(data) {
  if (!data || !data.id || !Number.isFinite(data.time)) return;
  localStorage.setItem(CURSOR, JSON.stringify({ id: data.id, time: data.time }));
}

function handleMessage(data, bucket) {
  noteCursor(data);
  if (data.event && data.event !== "message") return;
  const body = decode(data.message);
  if (!body || body.v !== 1) return;
  if (body.kind === "ping") {
    if (!body.id || !body.ts || Date.now() - body.ts > 120000) return;
    if (!remember(`ping:${body.id}`)) return;
    bucket.ping = true;
    return;
  }
  if (body.kind === "tx") {
    const id = takeTx(body);
    if (id) bucket.applied.push(id);
  }
}

function takeTx(tx) {
  if (!tx || !tx.id || !remember(tx.id)) return "";
  const account = state.accounts.find((item) => item.id === tx.accountId);
  const amount = parseAmount(tx.amount);
  const op = tx.op === "deposit" || tx.op === "withdraw" ? tx.op : "";
  if (!account || !op || amount == null) return "";
  const direction = op === "deposit" ? "to" : "from";
  if (tx.ph !== account.ph) {
    logActivity(`Other phone tried to ${op} ${formatAmount(amount)} ₲ ${direction} ${account.name}. The password did not match.`);
    publishReject(tx.id, "The password did not match.");
    return "";
  }
  const next = op === "deposit" ? BigInt(account.bal) + BigInt(amount) : BigInt(account.bal) - BigInt(amount);
  if (next < 0n) {
    logActivity(`Other phone tried to withdraw ${formatAmount(amount)} ₲ from ${account.name}. Not enough gizbits.`);
    publishReject(tx.id, "Not enough gizbits.");
    return "";
  }
  if (next > MAX) {
    logActivity(`Other phone tried to deposit ${formatAmount(amount)} ₲ to ${account.name}. That balance would be too large.`);
    publishReject(tx.id, "That balance would be too large.");
    return "";
  }
  account.bal = next.toString();
  saveAccounts();
  const verb = op === "deposit" ? "deposited" : "withdrew";
  logActivity(`Other phone ${verb} ${formatAmount(amount)} ₲ ${direction} ${account.name}. Balance is ${formatAmount(account.bal)} ₲.`, { remote: true });
  render();
  return tx.id;
}

async function catchUp() {
  const res = await fetch(`https://ntfy.sh/${TOPIC}/json?poll=1&since=${encodeURIComponent(sinceQuery())}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const bucket = { ping: false, applied: [] };
  for (const line of (await res.text()).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handleMessage(JSON.parse(trimmed), bucket);
    } catch {
      /* Skip a line that is not a message. */
    }
  }
  const due = Date.now() - lastAnnounce > 15000;
  if (!bucket.ping && !bucket.applied.length && !due) return;
  await publishLedger(bucket.applied);
  lastAnnounce = Date.now();
  if (streamOpen) setStatus("Listening for the other phone");
}

function listen() {
  if (source) source.close();
  source = new EventSource(`https://ntfy.sh/${TOPIC}/sse?since=${encodeURIComponent(sinceQuery())}`);
  source.onopen = () => {
    streamOpen = true;
    setStatus("Listening for the other phone");
  };
  source.onerror = () => {
    streamOpen = false;
    setStatus("Reconnecting…");
  };
  source.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    const bucket = { ping: false, applied: [] };
    handleMessage(data, bucket);
    if (!bucket.ping && !bucket.applied.length) return;
    publishLedger(bucket.applied)
      .then(() => {
        lastAnnounce = Date.now();
        if (streamOpen) setStatus("Listening for the other phone");
      })
      .catch(() => setStatus("Saved on this phone. The other phone will catch up when the connection is back."));
  };
}

function move(op) {
  const error = $("move-error");
  error.textContent = "";
  const account = state.accounts.find((item) => item.id === $("move-account").value);
  const amount = parseAmount($("move-amount").value);
  if (!account) {
    error.textContent = "Choose an account.";
    return;
  }
  if (amount == null) {
    error.textContent = "Enter a whole number of gizbits.";
    return;
  }
  const next = op === "deposit" ? BigInt(account.bal) + BigInt(amount) : BigInt(account.bal) - BigInt(amount);
  if (next < 0n) {
    error.textContent = "Not enough gizbits in that account.";
    return;
  }
  if (next > MAX) {
    error.textContent = "That would make the balance too large.";
    return;
  }
  account.bal = next.toString();
  saveAccounts();
  const verb = op === "deposit" ? "Deposited" : "Withdrew";
  const prep = op === "deposit" ? "to" : "from";
  logActivity(`${verb} ${formatAmount(amount)} ₲ ${prep} ${account.name}. Balance is ${formatAmount(account.bal)} ₲.`);
  $("move-amount").value = "";
  render();
  toast(`${verb} ${formatAmount(amount)} ₲`);
  publishLedger([]).catch(() => setStatus("Saved on this phone. The other phone will catch up when the connection is back."));
}

let pendingDelete = "";
let pendingReview = "";

function askDelete(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  pendingDelete = id;
  $("confirm-text").textContent = `Delete ${account.name}? This removes the account from both phones.`;
  $("confirm").hidden = false;
}

function closeConfirm() {
  pendingDelete = "";
  $("confirm").hidden = true;
}

function confirmDelete() {
  const account = state.accounts.find((item) => item.id === pendingDelete);
  closeConfirm();
  if (!account) return;
  state.accounts = state.accounts.filter((item) => item.id !== account.id);
  saveAccounts();
  logActivity(`Removed ${account.name}.`);
  render();
  publishLedger([]).catch(() => {});
}

function openReview(id) {
  const item = activity.find((entry) => entry.id === id);
  if (!item) return;
  pendingReview = id;
  $("review-text").textContent = item.text;
  $("review").hidden = false;
}

function closeReview() {
  pendingReview = "";
  $("review").hidden = true;
}

function markReviewed() {
  const item = activity.find((entry) => entry.id === pendingReview);
  closeReview();
  if (!item) return;
  item.reviewed = true;
  saveActivity();
  renderActivity();
}

function fillSettings() {
  const box = $("preset-fields");
  box.replaceChildren();
  state.settings.presets.forEach((value, index) => {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = `Amount ${index + 1}`;
    const input = document.createElement("input");
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.dataset.preset = String(index);
    input.value = value;
    label.append(span, input);
    box.append(label);
  });
  $("terms-text").value = state.settings.terms;
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
  const button = $("install-go");
  const note = $("install-note");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone) {
    document.body.classList.add("standalone");
    button.hidden = true;
    return;
  }
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
  });
  window.addEventListener("appinstalled", () => {
    button.hidden = true;
    note.hidden = true;
  });
  button.addEventListener("click", async () => {
    if (deferred) {
      deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      if (choice.outcome === "accepted") button.hidden = true;
      return;
    }
    const iphone = /iPad|iPhone|iPod/.test(navigator.userAgent);
    note.hidden = false;
    note.textContent = iphone
      ? "Tap Share, then Add to Home Screen."
      : "Open the browser menu, then choose Install app or Add to Home Screen.";
  });
}

$("add-account").addEventListener("click", openSheet);
$("sheet-close").addEventListener("click", closeSheet);
$("sheet").addEventListener("click", (event) => {
  if (event.target === $("sheet")) closeSheet();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSheet();
});
$("account-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("account-error");
  error.textContent = "";
  const name = $("acc-name").value.trim();
  const type = $("acc-type").value.trim();
  const password = $("acc-pass").value.trim();
  if (!name || !type || !password) {
    error.textContent = "Enter a name, account type, and password.";
    return;
  }
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    state.accounts.push({ id: uid(), name: name.slice(0, 40), type: type.slice(0, 24), bal: "0", ph: await sha256(password) });
    saveAccounts();
    logActivity(`Opened ${name} with 0 gizbits.`);
    event.target.reset();
    closeSheet();
    render();
    toast("Account opened with 0 gizbits.");
    publishLedger([]).catch(() => setStatus("Saved on this phone. The other phone will catch up when the connection is back."));
  } catch {
    error.textContent = "This page needs a secure connection before it can save a password.";
  } finally {
    if (button) button.disabled = false;
  }
});
$("deposit").addEventListener("click", () => move("deposit"));
$("withdraw").addEventListener("click", () => move("withdraw"));
$("move-form").addEventListener("submit", (event) => event.preventDefault());
$("confirm-no").addEventListener("click", closeConfirm);
$("confirm-yes").addEventListener("click", confirmDelete);
$("confirm").addEventListener("click", (event) => {
  if (event.target === $("confirm")) closeConfirm();
});
$("review-no").addEventListener("click", closeReview);
$("review-yes").addEventListener("click", markReviewed);
$("review").addEventListener("click", (event) => {
  if (event.target === $("review")) closeReview();
});
$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const error = $("settings-error");
  error.textContent = "";
  const presets = [...document.querySelectorAll("[data-preset]")].map((input) => parseAmount(input.value));
  if (presets.some((value) => value == null)) {
    error.textContent = "Each preset needs a whole number of gizbits.";
    return;
  }
  state.settings = {
    presets,
    terms: $("terms-text").value.trim().slice(0, 800) || DEFAULT_TERMS,
  };
  saveAccounts();
  fillSettings();
  toast("Settings saved");
  publishLedger([]).catch(() => setStatus("Saved on this phone. The other phone will catch up when the connection is back."));
});
document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

bindViewport();
stopOverscroll($("main"));
stopOverscroll(document.querySelector(".sheet-card"));
lockGestures();
setupInstall();
fillSettings();
render();
showTab("balances");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

catchUp()
  .catch(() => setStatus("Saved on this phone. The other phone connects when this one is online."))
  .finally(listen);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    catchUp().catch(() => setStatus("Reconnecting…"));
  }
});
