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
const DEFAULT_BANK_LIMIT = "30000000000000000";
const LOCAL_TAXES = "gizbit-terminal-taxes";
const LOCAL_BIZ = "gizbit-terminal-businesses";
const LOCAL_ASSETS = "gizbit-terminal-assets";
// Versions start at 1.00.000. A small fix adds 0.00.001, a feature adds 0.01.000, and a large change adds 1.00.000.
const VERSION = "2.33.000";
const DEFAULT_LOAN_TERMS = "A loan is approved by the Gizbit Financial Group. You agree to the interest rate and the payments for the amount that is approved.";
const DEFAULT_LOAN_BANDS = [
  { min: "5000000000000", max: "10000000000000", rate: "16", count: "20" },
  { min: "10000000000000", max: "15000000000000", rate: "12", count: "40" },
  { min: "15000000000000", max: "20000000000000", rate: "10", count: "60" },
];
const SETTINGS_PASSWORD = "321kittymiss";
const WIPED = "gizbit-terminal-wiped";
const WAIT_EXCHANGE = "gizbit-terminal-wait-exchange";
const WAIT_SEND = "gizbit-terminal-wait-send";

let ledger = loadLedger();
let sessionPh = "";
let pendingPassword = null;
let passStep = 1;
let passNext = "";
let liveThisSession = false;
let wipedAt = Number(localStorage.getItem(WIPED)) || 0;
let source = null;
let streamOpen = false;
let lastStream = 0;
let lastPong = 0;
let lastPing = 0;
let linkBroken = false;
let toastTimer = 0;
let pendingExchangeId = loadHold(WAIT_EXCHANGE);
let pendingSendId = loadHold(WAIT_SEND);
let pendingLoanId = "";
let taxLines = [];
let taxExpenses = [];
let taxSigned = false;
let taxBusy = false;
let pendingTaxId = "";
const waits = new Map();
const reasons = new Map();

const $ = (id) => document.getElementById(id);

function loadHold(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "null");
    if (data && typeof data.id === "string") return data.id;
  } catch {
    /* Nothing is waiting. */
  }
  return "";
}

function holdExchange(id) {
  pendingExchangeId = id || "";
  if (pendingExchangeId) localStorage.setItem(WAIT_EXCHANGE, JSON.stringify({ id: pendingExchangeId, ts: Date.now() }));
  else localStorage.removeItem(WAIT_EXCHANGE);
}

function holdSend(id) {
  pendingSendId = id || "";
  if (pendingSendId) localStorage.setItem(WAIT_SEND, JSON.stringify({ id: pendingSendId, ts: Date.now() }));
  else localStorage.removeItem(WAIT_SEND);
}

const OUTBOX = "gizbit-terminal-outbox";

function loadOutbox() {
  try {
    const data = JSON.parse(localStorage.getItem(OUTBOX) || "[]");
    return Array.isArray(data) ? data.filter((item) => item && item.payload && typeof item.payload.id === "string") : [];
  } catch {
    return [];
  }
}

function rememberOutbox(sentence, payload) {
  const items = loadOutbox().filter((item) => item.payload.id !== payload.id);
  items.push({ sentence, payload });
  localStorage.setItem(OUTBOX, JSON.stringify(items.slice(-20)));
}

function dropOutbox(id) {
  localStorage.setItem(OUTBOX, JSON.stringify(loadOutbox().filter((item) => item.payload.id !== id)));
}

let flushingOutbox = false;
async function flushOutbox() {
  if (flushingOutbox) return;
  const items = loadOutbox();
  if (!items.length) return;
  flushingOutbox = true;
  try {
    for (const item of items) {
      let payload = item.payload;
      if (payload.kind === "tax") payload = fitTaxPayload(payload);
      if (payload.kind === "tax" && encode(item.sentence, payload).length > 3500) {
        dropOutbox(payload.id);
        continue;
      }
      try {
        await publish(item.sentence, payload);
        dropOutbox(payload.id);
      } catch {
        break;
      }
    }
  } finally {
    flushingOutbox = false;
  }
}

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
      plays: sanitizePlays(data.plays),
      lastBooks: sanitizeBooks(data.lastBooks),
      loans: Array.isArray(data.loans) ? data.loans : [],
      sessionNo: String(data.sessionNo || "").replace(/\D/g, "").replace(/^0+/, "").slice(0, 6),
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
    taxAccountId: "",
    gamingAccountId: "",
    gamingTax: "20",
    interestAccountId: "",
    loanAccountId: "",
    loanTerms: DEFAULT_LOAN_TERMS,
    loanBands: DEFAULT_LOAN_BANDS.map((band) => ({ ...band })),
    bankLimit: DEFAULT_BANK_LIMIT,
    skipInterest: [],
    boardSkip: [],
    skipAttend: [],
  };
}

function percentText(value, fallback) {
  const raw = String(value ?? "").replace(/[,\s%]/g, "");
  if (!/^\d{1,3}$/.test(raw)) return fallback;
  const rate = BigInt(raw);
  if (rate > 100n) return fallback;
  return rate.toString();
}

function normalizeLoanBands(value) {
  const rows = Array.isArray(value) ? value : [];
  const clean = rows.slice(0, 8).map((row) => {
    const min = moneyText(row?.min, false);
    const max = moneyText(row?.max, false);
    const rate = percentText(row?.rate, "");
    const count = String(row?.count ?? "").replace(/\D/g, "");
    if (!min || !max || rate === "" || !count) return null;
    if (BigInt(count) < 1n || BigInt(count) > 500n || BigInt(max) < BigInt(min)) return null;
    return { min, max, rate, count: BigInt(count).toString() };
  }).filter(Boolean);
  return clean.length ? clean : DEFAULT_LOAN_BANDS.map((band) => ({ ...band }));
}

function normalizeSettings(value) {
  const presets = Array.isArray(value?.presets) ? value.presets.map((item) => moneyText(item, false)).filter(Boolean) : [];
  if (!presets.length) presets.push(DEFAULT_PRESETS[0]);
  const maxAmount = moneyText(value?.maxAmount, false);
  return {
    presets: presets.slice(0, 40),
    terms: String(value?.terms || DEFAULT_TERMS).slice(0, 800),
    minAmount: moneyText(value?.minAmount, false) || DEFAULT_MIN,
    maxAmount: maxAmount && maxAmount !== "0" ? maxAmount : "",
    euroRate: moneyText(value?.euroRate, false) || DEFAULT_EURO,
    vatRate: percentText(value?.vatRate, DEFAULT_VAT),
    profitLow: percentText(value?.profitLow, DEFAULT_PROFIT_LOW),
    profitHigh: percentText(value?.profitHigh, DEFAULT_PROFIT_HIGH),
    profitThreshold: moneyText(value?.profitThreshold, false) || DEFAULT_PROFIT_THRESHOLD,
    taxTerms: String(value?.taxTerms || DEFAULT_TAX_TERMS).slice(0, 400),
    taxAccountId: typeof value?.taxAccountId === "string" && /^[\w-]{8,}$/.test(value.taxAccountId) ? value.taxAccountId : "",
    gamingAccountId: typeof value?.gamingAccountId === "string" && /^[\w-]{8,}$/.test(value.gamingAccountId) ? value.gamingAccountId : "",
    gamingTax: percentText(value?.gamingTax, "20"),
    interestAccountId: typeof value?.interestAccountId === "string" && /^[\w-]{8,}$/.test(value.interestAccountId) ? value.interestAccountId : "",
    loanAccountId: typeof value?.loanAccountId === "string" && /^[\w-]{8,}$/.test(value.loanAccountId) ? value.loanAccountId : "",
    loanTerms: String(value?.loanTerms || DEFAULT_LOAN_TERMS).slice(0, 400),
    loanBands: normalizeLoanBands(value?.loanBands),
    bankLimit: moneyText(value?.bankLimit, false) || DEFAULT_BANK_LIMIT,
    skipInterest: Array.isArray(value?.skipInterest)
      ? [...new Set(value.skipInterest.filter((id) => typeof id === "string" && /^[\w-]{8,}$/.test(id)))].slice(0, 40)
      : [],
    boardSkip: cleanIdList(value?.boardSkip, 40),
    skipAttend: cleanIdList(value?.skipAttend, 40),
  };
}

function cleanIdList(value, limit) {
  const seen = new Set();
  const ids = [];
  (Array.isArray(value) ? value : []).forEach((id) => {
    if (typeof id !== "string" || !/^[\w-]{8,}$/.test(id) || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids.slice(0, limit);
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
    if (payload && payload.id && await posted(payload.id)) {
      linkBroken = false;
      refreshStatus();
      return;
    }
    try {
      await attempt();
    } catch (second) {
      if (payload && payload.id && await posted(payload.id)) {
        linkBroken = false;
        refreshStatus();
        return;
      }
      linkBroken = true;
      setLink(false);
      throw second || first;
    }
  }
  linkBroken = false;
  refreshStatus();
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

function publishPing(sync) {
  const now = Date.now();
  if (now - lastPing < 5000) return Promise.resolve();
  lastPing = now;
  const payload = { v: 1, kind: "ping", id: uid(), ts: now };
  if (sync) payload.sync = true;
  return publish(sync ? "Syncing with terminal" : "Checking accounts", payload);
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
  setLink(!linkBroken && lastPong > 0 && Date.now() - lastPong < 50000);
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
  holdExchange("");
  holdSend("");
  forgetBook();
  showLogin();
  $("login-msg").textContent = "The main phone deleted every account.";
  setTerminalLock(false);
}

function sanitizeBooks(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((row) => {
    if (!row || typeof row.id !== "string") return null;
    const bal = moneyText(row.bal, false);
    if (bal == null) return null;
    return { id: row.id, bal };
  }).filter(Boolean);
}

function sanitizePlays(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((item) => {
    if (!item || typeof item.id !== "string" || !/^[\w-]{8,}$/.test(item.id)) return null;
    const amount = moneyText(item.amount, false);
    if (amount == null) return null;
    const status = item.status === "review" || item.status === "chips" || item.status === "out" ? item.status : "";
    if (!status) return null;
    const cashOut = item.cashOut === "" || item.cashOut == null ? "" : moneyText(item.cashOut, false);
    if (cashOut == null) return null;
    return {
      id: item.id,
      accountId: typeof item.accountId === "string" ? item.accountId : "",
      name: String(item.name || "").slice(0, 40),
      amount,
      cashOut,
      tax: moneyText(item.tax, false) || "0",
      status,
      ts: Number(item.ts) || 0,
    };
  }).filter(Boolean);
}

function acceptPlay(body) {
  if (!ledger || !body || typeof body.id !== "string") return;
  const status = body.status === "review" || body.status === "chips" || body.status === "out" ? body.status : "";
  const amount = moneyText(body.amount, false);
  if (!status || amount == null) return;
  const plays = Array.isArray(ledger.plays) ? ledger.plays.slice() : [];
  const next = {
    id: body.id,
    accountId: typeof body.accountId === "string" ? body.accountId : "",
    name: String(body.name || "").slice(0, 40),
    amount,
    cashOut: body.cashOut == null || body.cashOut === "" ? "" : (moneyText(body.cashOut, false) || ""),
    tax: moneyText(body.tax, false) || "0",
    status,
    ts: Number(body.ts) || Date.now(),
  };
  const index = plays.findIndex((item) => item.id === next.id);
  if (index >= 0) plays[index] = { ...plays[index], ...next };
  else plays.unshift(next);
  ledger.plays = plays.slice(0, 40);
  ledger.ts = Date.now();
  localStorage.setItem(LEDGER, JSON.stringify(ledger));
  liveThisSession = true;
  if (pendingPlay && pendingPlay.id === next.id && next.status !== "review") pendingPlay = null;
  refreshStatus();
  if (sessionPh) renderBank();
}

function setTerminalLock(on) {
  localStorage.setItem("gizbit-term-locked", on ? "1" : "0");
  const node = $("term-lock");
  if (node) node.hidden = !on;
}

function mergeById(current, incoming, limit) {
  const map = new Map();
  (Array.isArray(current) ? current : []).forEach((item) => {
    if (item && item.id) map.set(item.id, item);
  });
  (Array.isArray(incoming) ? incoming : []).forEach((item) => {
    if (!item || !item.id) return;
    map.set(item.id, { ...(map.get(item.id) || {}), ...item });
  });
  return [...map.values()].sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0)).slice(0, limit);
}

function saveLedger() {
  if (ledger) localStorage.setItem(LEDGER, JSON.stringify(ledger));
}

function noteLocalRequest(row) {
  if (!ledger || !row || !row.id) return;
  ledger.requests = mergeById(ledger.requests, [row], 40);
  saveLedger();
  renderHistory();
}

function noteLocalPlay(row) {
  if (!ledger || !row || !row.id) return;
  ledger.plays = mergeById(ledger.plays, [row], 40);
  saveLedger();
  renderGame();
}

function acceptActivity(body) {
  if (!ledger || !body) return;
  if (Array.isArray(body.requests)) ledger.requests = mergeById(ledger.requests, body.requests, 40);
  if (Array.isArray(body.interest)) ledger.requests = mergeById(ledger.requests, body.interest, 40);
  if (Array.isArray(body.plays)) ledger.plays = mergeById(ledger.plays, sanitizePlays(body.plays), 40);
  saveLedger();
  if (sessionPh) renderBank();
}

function acceptLedger(body) {
  if (body && typeof body.locked === "boolean") setTerminalLock(body.locked);
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
    requests: mergeById(ledger?.requests, Array.isArray(body.requests) ? body.requests : [], 40),
    plays: mergeById(ledger?.plays, Array.isArray(body.plays) ? sanitizePlays(body.plays) : [], 40),
    lastBooks: Array.isArray(body.lastBooks) ? sanitizeBooks(body.lastBooks) : (ledger?.lastBooks || []),
    loans: Array.isArray(ledger?.loans) ? ledger.loans : [],
    sessionNo: String(body.sessionNo || ledger?.sessionNo || "").replace(/\D/g, "").replace(/^0+/, "").slice(0, 6),
  };
  localStorage.setItem(LEDGER, JSON.stringify(ledger));
  liveThisSession = true;
  refreshStatus();
  if (!$("settings").hidden) renderSettingsAccounts();
  if ($("tax-pane").classList.contains("is-up")) $("tax-session").value = filingSessionNo();
  window.dispatchEvent(new CustomEvent("gizbit-ledger"));
  if (pendingPassword && sessionPh === pendingPassword.oldPh) {
    const moved = ledger.accounts.find((item) => item.id === pendingPassword.accountId && item.ph === pendingPassword.newPh);
    if (moved) {
      sessionPh = pendingPassword.newPh;
      pendingPassword = null;
    }
  }
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

async function messageText(data) {
  const text = typeof data?.message === "string" ? data.message : "";
  const url = data?.attachment && typeof data.attachment.url === "string" ? data.attachment.url : "";
  if (!url || !url.startsWith(`${NTFY}/`) || decode(text)) return text;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return text;
    return await res.text();
  } catch {
    return text;
  }
}

async function handleMessage(data) {
  noteCursor(data);
  if (data.event && data.event !== "message") return;
  const body = decode(await messageText(data));
  if (!body || body.v !== 1) return;
  if (body.kind === "reset") {
    acceptReset(body);
    return;
  }
  if (body.kind === "ledger") acceptLedger(body);
  if (body.kind === "pong" || body.kind === "ledger") {
    lastPong = Date.now();
    linkBroken = false;
    refreshStatus();
  }
  if (body.kind === "lock") setTerminalLock(body.locked === true);
  if (body.kind === "ring") {
    const ring = $("ring");
    if (ring) ring.hidden = false;
  }
  if (body.kind === "activity") acceptActivity(body);
  if (body.kind === "loans") acceptLoans(body);
  if (body.kind === "call") takeTerminalCall(body);
  if (body.kind === "play") acceptPlay(body);
  if (body.kind === "tax-delete" && body.id) {
    const stored = loadTaxes().filter((item) => item.id !== body.id);
    localStorage.setItem(LOCAL_TAXES, JSON.stringify(stored));
    if (sessionPh) {
      renderTaxDash();
      renderDash();
    }
  }
  if (body.kind === "assets") acceptAssets(body);
  if (body.kind === "tax-clear") {
    localStorage.setItem(LOCAL_TAXES, "[]");
    if (sessionPh) {
      renderTaxDash();
      renderDash();
    }
  }
  if (body.kind === "decision") finishExchange(body.id, body.status);
  if (body.kind === "tax-ack" && body.id) resolveWait(body.id, "ok");
  if (body.kind === "reject" && body.id) {
    reasons.set(body.id, body.reason || "The main phone refused that.");
    if (body.id === pendingExchangeId) finishExchange(body.id, "denied");
    if (body.id === pendingSendId) {
      holdSend("");
      $("send-msg").textContent = body.reason || "The main phone could not transfer that.";
      revealSend();
    }
    if (body.id === pendingLoanId) {
      pendingLoanId = "";
      $("gfg-msg").textContent = body.reason || "The main phone could not do that.";
    }
    if (pendingPassword && body.id === pendingPassword.id) {
      pendingPassword = null;
      $("pass-sheet").hidden = false;
      $("pass-msg").textContent = body.reason || "The main phone could not change that password.";
    }
    resolveWait(body.id, "reject");
    if (/asset/i.test(body.reason || "")) toast(body.reason);
  }
  if (body.kind === "play-delete" && body.id && ledger) {
    ledger.plays = (ledger.plays || []).filter((item) => item.id !== body.id);
    localStorage.setItem(LEDGER, JSON.stringify(ledger));
    if (sessionPh) renderBank();
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
      await handleMessage(JSON.parse(trimmed));
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
    lastStream = Date.now();
    refreshStatus();
  };
  source.onerror = () => {
    streamOpen = false;
    setTimeout(refreshStatus, 4000);
  };
  let inbound = Promise.resolve();
  source.onmessage = (event) => {
    lastStream = Date.now();
    inbound = inbound.then(async () => {
      try {
        await handleMessage(JSON.parse(event.data));
      } catch {
        /* Ignore a malformed event. */
      }
    }).catch(() => {});
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
let sendSent = false;
let exchangeSent = false;

function showLogin(keepKeyboard) {
  $("settings").hidden = true;
  $("login").hidden = false;
  const password = $("password");
  if (keepKeyboard) password.focus();
  $("bank").hidden = true;
  $("logout").hidden = true;
  resetCalculator();
  password.value = "";
  password.type = "password";
  if (keepKeyboard) password.focus();
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

function bindAccountMenu(select) {
  if (!select || select.dataset.menu) return;
  select.dataset.menu = "1";
  const menu = document.createElement("div");
  menu.className = "account-menu";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "account-menu-btn";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.className = "account-menu-list";
  list.hidden = true;
  list.setAttribute("role", "listbox");
  menu.append(button, list);
  select.after(menu);
  function refresh() {
    const selected = [...select.options].find((option) => option.value === select.value) || select.options[0];
    button.textContent = selected ? selected.textContent : "Choose an account";
    list.replaceChildren();
    [...select.options].forEach((option) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "account-menu-item";
      item.setAttribute("role", "option");
      if (option.value === select.value) item.classList.add("is-on");
      if (option.value === "__new__") {
        item.classList.add("is-add");
        const plus = document.createElement("span");
        plus.className = "menu-plus";
        plus.textContent = "+";
        const label = document.createElement("span");
        label.textContent = "Add new";
        item.append(plus, label);
      } else item.textContent = option.textContent;
      let dragged = false;
      item.addEventListener("click", () => {
        if (dragged) {
          dragged = false;
          return;
        }
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        list.hidden = true;
        button.setAttribute("aria-expanded", "false");
        refresh();
      });
      const removable = select.id === "tax-business" && option.value && option.value !== "__new__";
      if (!removable) {
        list.append(item);
        return;
      }
      const swipe = document.createElement("div");
      swipe.className = "menu-swipe";
      const bin = document.createElement("button");
      bin.type = "button";
      bin.className = "menu-bin";
      bin.textContent = "Delete";
      bin.setAttribute("aria-label", `Delete ${option.textContent}`);
      bin.addEventListener("click", (event) => {
        event.stopPropagation();
        if (businessUsed(option.value)) {
          $("tax-menu-msg").textContent = "That business is already on a return.";
          return;
        }
        deleteBusiness(option.value);
      });
      bindMenuSwipe(item, option.value, () => {
        dragged = true;
      });
      swipe.append(bin, item);
      list.append(swipe);
    });
  }
  button.addEventListener("click", () => {
    const willOpen = list.hidden;
    document.querySelectorAll(".account-menu-list").forEach((node) => {
      node.hidden = true;
    });
    document.querySelectorAll(".account-menu-btn").forEach((node) => node.setAttribute("aria-expanded", "false"));
    list.hidden = !willOpen;
    button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen) {
      document.body.append(list);
      const rect = button.getBoundingClientRect();
      list.style.position = "fixed";
      list.style.top = `${Math.round(rect.bottom + 6)}px`;
      list.style.left = `${Math.round(rect.left)}px`;
      list.style.width = `${Math.round(rect.width)}px`;
      list.style.right = "auto";
      list.style.zIndex = "80";
    }
  });
  select._refreshMenu = refresh;
  refresh();
}

function refreshAccountMenu(select) {
  if (!select) return;
  if (!select.dataset.menu) bindAccountMenu(select);
  else select._refreshMenu();
}

function closeAccountMenus() {
  document.querySelectorAll(".account-menu-list").forEach((node) => {
    node.hidden = true;
  });
  document.querySelectorAll(".account-menu-btn").forEach((node) => node.setAttribute("aria-expanded", "false"));
}

document.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".account-menu, .account-menu-list")) return;
  closeAccountMenus();
});
document.addEventListener("scroll", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest(".tax-step")) return;
  closeAccountMenus();
}, true);

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
    refreshAccountMenu(pick);
    $("welcome").textContent = "Welcome";
    $("balance").textContent = "";
    $("balance-full").textContent = "";
    return;
  }
  accountId = account.id;
  pick.value = account.id;
  refreshAccountMenu(pick);
  $("welcome").textContent = `Welcome, ${account.name}`;
  $("balance").textContent = `${formatAmount(account.bal)} ₲`;
  $("balance-full").textContent = `${formatFull(account.bal)} GZBT`;
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
  renderBoard();
  renderGame();
}

function boardArrow(account) {
  const span = document.createElement("span");
  span.className = "board-move";
  const previous = (ledger?.lastBooks || []).find((row) => row.id === account.id);
  const now = BigInt(account.bal || "0");
  const then = previous ? BigInt(previous.bal || "0") : now;
  if (previous && now > then) {
    span.classList.add("up");
    span.textContent = "↑";
  } else if (previous && now < then) {
    span.classList.add("down");
    span.textContent = "↓";
  } else {
    span.classList.add("flat");
    span.textContent = "–";
  }
  return span;
}

function boardLine(account, moving) {
  const item = document.createElement("li");
  const name = document.createElement("span");
  if (moving) name.append(boardArrow(account));
  name.append(document.createTextNode(account.name));
  const money = document.createElement("span");
  money.textContent = `${formatAmount(account.bal)} ₲`;
  item.append(name, money);
  return item;
}

function byRichest(a, b) {
  const left = BigInt(b.bal || "0");
  const right = BigInt(a.bal || "0");
  if (left > right) return 1;
  if (left < right) return -1;
  return String(a.name).localeCompare(String(b.name));
}

function renderBoard() {
  const top = $("board-top");
  const rest = $("board-rest");
  const out = $("board-out");
  const outTitle = $("board-out-title");
  if (!top || !rest || !out) return;
  const accounts = ledger?.accounts || [];
  const skip = new Set(activeSettings().boardSkip || []);
  const playing = accounts.filter((account) => !skip.has(account.id)).sort(byRichest);
  const aside = accounts.filter((account) => skip.has(account.id)).sort(byRichest);
  const places = ["1st", "2nd", "3rd"];
  top.replaceChildren();
  if (!playing.length) {
    const empty = document.createElement("p");
    empty.className = "quiet";
    empty.textContent = accounts.length ? "No accounts are on the leaderboard." : "No accounts yet.";
    top.append(empty);
  }
  playing.slice(0, 3).forEach((account, index) => {
    const card = document.createElement("article");
    card.className = `board-place ${["gold", "silver", "bronze"][index] || ""}`;
    const place = document.createElement("p");
    place.className = "board-rank";
    place.textContent = places[index] || "";
    const name = document.createElement("p");
    name.className = "who";
    name.append(boardArrow(account), document.createTextNode(account.name));
    const money = document.createElement("p");
    money.className = "bal";
    money.textContent = `${formatAmount(account.bal)} ₲`;
    card.append(place, name, money);
    top.append(card);
  });
  rest.replaceChildren();
  playing.slice(3).forEach((account) => rest.append(boardLine(account, true)));
  out.replaceChildren();
  aside.forEach((account) => out.append(boardLine(account, false)));
  if (outTitle) outTitle.hidden = aside.length === 0;
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

function exchangeMemo(item) {
  const saved = String(item.memo || "").trim();
  if (saved) return saved.slice(0, 40);
  if (String(item.id || "").endsWith("-pay")) return "Income tax invoice";
  if (item.note) return "Asset purchase";
  if (item.op === "withdraw") return "Withdrawal";
  if (item.op === "deposit") return "Deposit";
  if (item.op === "send" || item.op === "transfer") return "Transfer";
  return "Exchange";
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
    const swipe = document.createElement("li");
    swipe.className = "history-swipe";
    const strokes = signs[item.id] || item.sign;
    const signBtn = document.createElement("button");
    signBtn.type = "button";
    signBtn.className = "history-sign";
    signBtn.setAttribute("aria-label", "Show signature");
    signBtn.innerHTML = `<img src="sign-pen.png" alt="" />`;
    signBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      showSavedSignature(Array.isArray(strokes) ? strokes : []);
    });
    const row = document.createElement("div");
    row.className = "history-row";
    const when = document.createElement("time");
    const ts = Number(item.ts) || Date.now();
    when.textContent = `${formatDate(ts)} · ${formatClock(ts)}`;
    const incoming = account && item.toId === account.id && item.accountId !== account.id;
    const kind = document.createElement("p");
    kind.className = "who";
    if (item.note) kind.textContent = incoming ? `Sold ${item.note}` : `Bought ${item.note}`;
    else if (item.op === "send" || item.op === "transfer") kind.textContent = incoming ? `Received from ${item.name}` : `Transferred to ${item.toName || "another account"}`;
    else kind.textContent = item.op === "withdraw" ? "Withdrawal" : "Deposit";
    const money = document.createElement("p");
    money.className = "quiet";
    const alleged = formatAmount(item.amount);
    const actual = item.applied ? formatAmount(item.applied) : "";
    if (item.status === "denied") money.textContent = `${alleged} ₲ · Denied`;
    else if (item.status === "pending") money.textContent = `${alleged} ₲ · Waiting`;
    else if (actual && String(item.applied) !== String(item.amount)) money.textContent = `${alleged} ₲ asked · ${actual} ₲`;
    else money.textContent = `${alleged} ₲`;
    const memo = document.createElement("p");
    memo.className = "memo";
    memo.textContent = exchangeMemo(item);
    row.append(when, kind, money, memo);
    swipe.append(signBtn, row);
    bindHistorySwipe(row);
    list.append(swipe);
  });
}

function bindHistorySwipe(row) {
  const open = 64;
  let startX = 0;
  let startY = 0;
  let active = false;
  let origin = 0;
  row.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest("button")) return;
    startX = event.clientX;
    startY = event.clientY;
    origin = row.classList.contains("is-sign") ? -open : 0;
    active = true;
  });
  row.addEventListener("pointermove", (event) => {
    if (!active) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
    const next = Math.max(-open, Math.min(0, origin + dx));
    row.style.transform = `translateX(${next}px)`;
  });
  const finish = (event) => {
    if (!active) return;
    active = false;
    const end = origin + (event.clientX - startX);
    row.style.transform = "";
    row.classList.toggle("is-sign", end < -open * 0.45);
  };
  row.addEventListener("pointerup", finish);
  row.addEventListener("pointercancel", () => {
    active = false;
    row.style.transform = "";
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

let idleUntil = 0;

function clearIdle() {
  idleUntil = 0;
}

function inGov() {
  const gov = $("gov-pane");
  const tax = $("tax-pane");
  return Boolean((gov && gov.classList.contains("is-front")) || (tax && tax.classList.contains("is-up")));
}

function bumpIdle() {
  if (!sessionPh || inGov()) {
    idleUntil = 0;
    return;
  }
  idleUntil = Date.now() + 60000;
}

function checkIdle() {
  if (!idleUntil || !sessionPh || inGov()) return;
  if (Date.now() < idleUntil) return;
  idleUntil = 0;
  const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  sessionPh = "";
  showHome();
  showLogin(typing);
  $("login-msg").textContent = "Timer ran out, log in again.";
}

setInterval(checkIdle, 1000);

document.addEventListener("pointerdown", bumpIdle);
document.addEventListener("keydown", bumpIdle);

function showHome() {
  const stage = $("stage");
  stage.classList.remove("is-side");
  stage.scrollLeft = 0;
  ["exchange", "activity", "calc", "prefs", "gov", "tax", "board", "game", "gfg"].forEach((name) => $(`${name}-pane`).classList.remove("is-front"));
  closeTaxForm();
  if (sessionPh) {
    $("logout").hidden = false;
    bumpIdle();
  }
}

function showSide(name) {
  const stage = $("stage");
  ["exchange", "activity", "calc", "prefs", "gov", "tax", "board", "game", "gfg"].forEach((pane) => $(`${pane}-pane`).classList.toggle("is-front", pane === name));
  stage.classList.add("is-side");
  stage.scrollLeft = 0;
  $("logout").hidden = true;
  const pane = $(`${name}-pane`);
  if (pane) pane.scrollTop = 0;
  if (name === "gov") clearIdle();
  else if (sessionPh) bumpIdle();
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
    button.textContent = "Exchange";
    return;
  }
  button.hidden = false;
  button.disabled = false;
  button.textContent = "Back to home";
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
  noteLocalRequest({ id, status, ts: Date.now() });
  holdExchange("");
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
  refreshAccountMenu(select);
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
  if (sendSent) {
    $("send-go").hidden = false;
    $("send-go").disabled = false;
    $("send-go").textContent = "Back to home";
  } else {
    $("send-go").textContent = "Transfer";
    $("send-go").disabled = !(showSign && sendSigned);
  }
}

function resetSend() {
  sendAccountId = "";
  sendAmount = "";
  sendSigned = false;
  sendSent = false;
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
  if (!found || !found.status || found.status === "pending") return;
  holdSend("");
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
  if (sendSent) {
    resetSend();
    showHome();
    return;
  }
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
  const sentence = `${from.name} transferred gizbits to ${to.name}`;
  const payload = {
    v: 1,
    kind: "transfer",
    id,
    fromId: from.id,
    toId: to.id,
    amount,
    ph: sessionPh,
    sign: strokes,
    ts: Date.now(),
  };
  sendSent = true;
  saveSign(id, strokes);
  holdSend(id);
  noteLocalRequest({
    id,
    accountId: from.id,
    name: from.name,
    op: "transfer",
    amount,
    status: "pending",
    toId: to.id,
    toName: to.name,
    ts: Date.now(),
  });
  revealSend();
  message.textContent = "Transferring…";
  try {
    await publish(sentence, payload);
  } catch {
    rememberOutbox(sentence, payload);
    message.textContent = "Saved on this phone. It sends when the connection is back.";
    return;
  }
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
    resetCalculator();
    resetExchange();
    resetSend();
    renderBank();
    bumpIdle();
    checkExchangeResult();
    checkSendResult();
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
  if (op === "transfer") renderSendAccounts();
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
    resetExchange();
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
  const strokes = pad.strokes();
  const sentence = `Exchange pending from ${latest.name}`;
  const payload = {
    v: 1,
    kind: "request",
    id,
    accountId: latest.id,
    op,
    amount,
    ph: sessionPh,
    sign: strokes,
    ts: Date.now(),
  };
  holdExchange(id);
  noteLocalRequest({
    id,
    accountId: latest.id,
    name: latest.name,
    op,
    amount,
    status: "pending",
    ts: Date.now(),
  });
  exchangeSent = true;
  saveSign(id, strokes);
  paintExchangeButton();
  message.textContent = "Asking the main phone…";
  try {
    await publish(sentence, payload);
  } catch {
    rememberOutbox(sentence, payload);
    message.textContent = "Saved on this phone. It sends when the connection is back.";
    paintExchangeButton();
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
  function redraw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#173a5a";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokes.forEach((stroke) => {
      const points = [];
      for (let i = 0; i + 1 < stroke.length; i += 2) {
        points.push([(stroke[i] / 9999) * rect.width, (stroke[i + 1] / 9999) * rect.height]);
      }
      if (points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
      ctx.stroke();
    });
  }
  function size() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2) return;
    const ratio = Math.min(devicePixelRatio || 1, 3);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.strokeStyle = "#173a5a";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (strokes.length) redraw();
  }
  function pos(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function inkPoint(event) {
    const point = pos(event);
    if (current) current.push(...norm(point));
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    hasInk = true;
    onInk(true);
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (block.classList.contains("is-locked")) return;
    event.preventDefault();
    size();
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
    const batch = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    (batch.length ? batch : [event]).forEach(inkPoint);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!drawing) return;
    drawing = false;
    if (current) inkPoint(event);
    if (current && current.length >= 4) {
      const next = resampleStroke(current);
      current.length = 0;
      current.push(...next);
      redraw();
    }
  });
  canvas.addEventListener("pointercancel", () => {
    if (!drawing) return;
    drawing = false;
    if (current && current.length >= 4) {
      const next = resampleStroke(current);
      current.length = 0;
      current.push(...next);
      redraw();
    }
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
let gameSigned = false;
let pendingPlay = null;
const gamePad = bindPad("game-sign", "game-sign-block", "game-clear-sign", (on) => {
  gameSigned = on;
  paintGameSend();
});

function revealTaxField() {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !field.closest("#tax-pane")) return;
  const step = field.closest(".tax-step");
  if (!step) return;
  const edge = step.getBoundingClientRect();
  const rect = field.getBoundingClientRect();
  if (rect.bottom > edge.bottom - 12) step.scrollTop += rect.bottom - (edge.bottom - 12);
  else if (rect.top < edge.top + 8) step.scrollTop -= (edge.top + 8) - rect.top;
}

function bindViewport() {
  const apply = () => {
    const viewport = window.visualViewport;
    const height = viewport ? viewport.height : window.innerHeight;
    document.documentElement.style.setProperty("--vvh", `${Math.round(height)}px`);
    document.documentElement.style.setProperty("--vvtop", "0px");
    if (window.scrollY) window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      revealTaxField();
      fitFxAmounts();
      liftAmount();
    });
  };
  apply();
  document.addEventListener("focusin", apply);
  document.addEventListener("focusout", () => setTimeout(apply, 80));
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", apply);
    window.visualViewport.addEventListener("scroll", () => {
      if (window.visualViewport.offsetTop > 0) window.scrollTo(0, 0);
      apply();
    });
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
    let node = event.target instanceof Element ? event.target : event.target.parentElement;
    while (node && node !== scroller) {
      const style = getComputedStyle(node);
      const scrollable = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
      if (scrollable) {
        const atTop = node.scrollTop <= 0;
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
        if (!(atTop && delta > 0) && !(atBottom && delta < 0)) return;
      }
      node = node.parentElement;
    }
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
  setTimeout(() => window.scrollTo(0, 0), 50);
});
$("settings-back").addEventListener("click", closeSettings);
$("sync-phones").addEventListener("click", async () => {
  const button = $("sync-phones");
  button.disabled = true;
  const before = ledger?.ts || 0;
  lastPing = 0;
  try {
    await publishPing(true);
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
  setTimeout(() => window.scrollTo(0, 0), 50);
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

let fxEuroOnTop = true;

function oneGzbtInEuro(rate) {
  if (rate <= 0n) return "0";
  if (rate === 1n) return "1.00";
  const scale = BigInt(rate.toString().length + 2);
  const scaled = (10n ** scale) / rate;
  if (scaled <= 0n) return `0.${"0".repeat(Number(scale))}`;
  const digits = scaled.toString().padStart(Number(scale), "0").replace(/0+$/, "");
  return `0.${digits}`;
}

function paintRate() {
  const rate = euroRate();
  $("rate-line").textContent = fxEuroOnTop
    ? `1.00 EUR = ${formatFull(rate)} GZBT`
    : `1 GZBT = ${oneGzbtInEuro(rate)} EUR`;
}

function fitFxAmount(input) {
  if (!input || input.clientWidth < 8) return;
  const symbol = input.previousElementSibling;
  let size = 28;
  input.style.fontSize = "28px";
  if (symbol) symbol.style.fontSize = "28px";
  while (size > 13 && input.scrollWidth > input.clientWidth + 1) {
    size -= 2;
    input.style.fontSize = `${size}px`;
    if (symbol) symbol.style.fontSize = `${size}px`;
  }
}

function fitFxAmounts() {
  fitFxAmount($("euro-input"));
  fitFxAmount($("giz-input"));
}

function resetCalculator() {
  fxEuroOnTop = true;
  const euroCard = $("fx-euro");
  const gizCard = $("fx-giz");
  if (euroCard && gizCard && gizCard.parentElement) gizCard.parentElement.insertBefore(euroCard, gizCard);
  const pane = $("calc-pane");
  if (pane) pane.classList.remove("is-typing");
  const euro = $("euro-input");
  const giz = $("giz-input");
  if (!euro || !giz) return;
  euro.value = "1.00";
  giz.value = formatTyping(euroRate().toString());
  paintRate();
  fitFxAmounts();
}

function readEuro(value) {
  const cleaned = String(value || "").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  const wholeRaw = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const frac = dot === -1 ? "" : cleaned.slice(dot + 1).replace(/\D/g, "").slice(0, 2);
  const text = dot === -1 ? wholeRaw : `${wholeRaw || "0"}.${frac}`;
  return { text, whole: wholeRaw || "0", frac, empty: !wholeRaw && frac === "" && dot === -1 };
}

function loadListed() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_ASSETS) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function acceptAssets(body) {
  if (!Array.isArray(body?.items)) return;
  const ts = Number(body.ts) || 0;
  const prev = Number(localStorage.getItem(`${LOCAL_ASSETS}-ts`) || "0");
  if (ts && prev && ts < prev) return;
  const items = body.items.slice(0, 40).map((item) => {
    const id = String(item?.id || "");
    const name = String(item?.name || "").trim().slice(0, 40);
    const note = String(item?.note || "").trim().slice(0, 200);
    const price = moneyText(item?.price, false);
    const paid = moneyText(item?.paid, false) || "";
    if (!/^[\w-]{8,}$/.test(id) || !name || !price) return null;
    return { id, name, note, price, claimed: Boolean(item?.claimed), owner: String(item?.owner || "").slice(0, 40), paid };
  }).filter(Boolean);
  localStorage.setItem(LOCAL_ASSETS, JSON.stringify(items));
  if (ts) localStorage.setItem(`${LOCAL_ASSETS}-ts`, String(ts));
  renderListed();
}

function renderListed() {
  const panel = $("gov-assets-panel");
  if (!panel) return;
  panel.replaceChildren();
  const items = loadListed();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "quiet";
    empty.textContent = "No assets yet.";
    panel.append(empty);
    return;
  }
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "asset-card";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const price = document.createElement("span");
    price.textContent = item.claimed ? `Owned by ${item.owner || "someone"} · ${formatAmount(item.paid || item.price)} ₲` : `${formatAmount(item.price)} ₲`;
    button.append(name, price);
    if (!item.claimed) button.addEventListener("click", () => openListed(item.id));
    panel.append(button);
  });
}

let listedId = "";

function openListed(id) {
  const item = loadListed().find((entry) => entry.id === id);
  if (!item || item.claimed) return;
  listedId = id;
  $("listed-name").textContent = item.name;
  $("listed-note").textContent = item.note || "";
  $("listed-price").textContent = `${formatAmount(item.price)} ₲`;
  $("listed-msg").textContent = "";
  $("listed-sheet").hidden = false;
}

function requestListed() {
  const item = loadListed().find((entry) => entry.id === listedId);
  const account = currentAccount();
  const msg = $("listed-msg");
  if (!item || item.claimed || !account || !sessionPh) {
    msg.textContent = "Log in before requesting an asset.";
    return;
  }
  publish("Asset request", {
    v: 1,
    kind: "asset-buy",
    id: uid(),
    assetId: item.id,
    accountId: account.id,
    ph: sessionPh,
    ts: Date.now(),
  }).then(() => {
    $("listed-sheet").hidden = true;
    toast("Request sent");
  }).catch(() => {
    msg.textContent = "The request could not be sent. Try again when the connection is back.";
  });
}

function showGovTab(name) {
  $("gov-dash-panel").hidden = name !== "dash";
  $("gov-taxes-panel").hidden = name !== "taxes";
  $("gov-assets-panel").hidden = name !== "assets";
  ["dash", "taxes", "assets"].forEach((tab) => {
    const button = $(`gov-${tab}`);
    button.classList.toggle("is-on", tab === name);
    button.setAttribute("aria-selected", tab === name ? "true" : "false");
  });
  $("gov-plus").hidden = name !== "taxes";
  if (name === "taxes") renderTaxDash();
  if (name === "dash") renderDash();
  if (name === "assets") renderListed();
}

function renderDash() {
  const account = currentAccount();
  const filed = loadTaxes().filter((item) => item.accountId === account?.id);
  const paid = filed.reduce((sum, item) => sum + BigInt(item.totals?.invoice || "0"), 0n);
  const parts = [
    ["Tax on gaming profits", (ledger?.plays || []).filter((item) => item.accountId === account?.id).reduce((sum, item) => sum + BigInt(item.tax || "0"), 0n)],
    ["Income tax", filed.reduce((sum, item) => sum + BigInt(item.totals?.tax || "0"), 0n)],
    ["VAT", filed.reduce((sum, item) => sum + BigInt(item.totals?.vat || "0"), 0n)],
    ["Capital gains tax", 0n],
  ];
  $("tax-paid").textContent = `${formatAmount(paid.toString())} ₲`;
  const box = $("tax-bars");
  box.replaceChildren();
  const biggest = parts.reduce((max, item) => (item[1] > max ? item[1] : max), 0n);
  parts.forEach(([label, amount]) => {
    const row = document.createElement("div");
    row.className = "tax-bar-row";
    const name = document.createElement("span");
    name.textContent = label;
    const figure = document.createElement("strong");
    figure.textContent = `${formatAmount(amount.toString())} ₲`;
    const track = document.createElement("div");
    track.className = "tax-bar-track";
    const fill = document.createElement("div");
    fill.className = "tax-bar-fill";
    const width = biggest > 0n ? Number((amount * 100n) / biggest) : 0;
    fill.style.width = `${amount > 0n ? Math.max(width, 4) : 0}%`;
    track.append(fill);
    row.append(name, figure, track);
    box.append(row);
  });
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

function businessUsed(name) {
  const accountId = currentAccount()?.id;
  return loadTaxes().some((item) => item.accountId === accountId && item.business === name);
}

function deleteBusiness(name) {
  const account = currentAccount();
  if (!account || businessUsed(name)) return;
  const map = loadBizMap();
  map[account.id] = businessesFor(account.id).filter((item) => item !== name);
  localStorage.setItem(LOCAL_BIZ, JSON.stringify(map));
  const select = $("tax-business");
  const next = select.value === name ? "" : select.value;
  if (!next) taxPicked = false;
  $("tax-menu-msg").textContent = "";
  fillBusinesses(next);
  closeAccountMenus();
}

function bindMenuSwipe(row, name, onDrag) {
  const open = 72;
  let startX = 0;
  let startY = 0;
  let active = false;
  let origin = 0;
  row.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    origin = row.classList.contains("is-open") ? open : 0;
    active = true;
  });
  row.addEventListener("pointermove", (event) => {
    if (!active || businessUsed(name)) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
    onDrag();
    const next = Math.max(0, Math.min(open, origin + dx));
    row.style.transform = `translateX(${next}px)`;
  });
  const finish = (event) => {
    if (!active) return;
    active = false;
    const end = origin + (event.clientX - startX);
    row.style.transform = "";
    if (businessUsed(name)) {
      row.classList.remove("is-open");
      if (end > open * 0.45) $("tax-menu-msg").textContent = "That business is already on a return.";
      return;
    }
    row.classList.toggle("is-open", end > open * 0.45);
  };
  row.addEventListener("pointerup", finish);
  row.addEventListener("pointercancel", () => {
    active = false;
    row.style.transform = "";
  });
}

function filingSessionNo() {
  const digits = String(ledger?.sessionNo || "").replace(/\D/g, "").replace(/^0+/, "");
  return digits || "1";
}

function nextSheet() {
  const filed = loadTaxes();
  const max = filed.reduce((highest, item) => Math.max(highest, Number(String(item.sheet || "").replace(/\D/g, "")) || 0), 0);
  return String(Math.max(max, filed.length) + 1);
}

function floorBillion(value) {
  const amount = BigInt(value || "0");
  if (amount <= 0n) return 0n;
  return amount - (amount % BILLION_STEP);
}

function splitVat(revenue, rate) {
  const amount = floorBillion(revenue);
  const percent = BigInt(rate || "0");
  const net = (amount * 100n) / (100n + percent);
  return { revenue: amount, vat: floorBillion(amount - net), profit: floorBillion(net) };
}

function taxTotals(lines, rates, expenses) {
  let revenue = 0n;
  let vat = 0n;
  let profit = 0n;
  lines.forEach((line) => {
    const parts = splitVat(line.revenue, rates.vat);
    revenue += parts.revenue;
    vat += parts.vat;
    profit += parts.profit;
  });
  const spent = (expenses || []).reduce((sum, item) => sum + floorBillion(item.amount), 0n);
  const taxable = profit > spent ? profit - spent : 0n;
  const threshold = BigInt(rates.threshold);
  const rawTax = taxable <= threshold
    ? (taxable * BigInt(rates.low)) / 100n
    : (threshold * BigInt(rates.low)) / 100n + ((taxable - threshold) * BigInt(rates.high)) / 100n;
  const tax = floorBillion(rawTax);
  return {
    revenue: revenue.toString(),
    vat: vat.toString(),
    profit: taxable.toString(),
    expenses: spent.toString(),
    tax: tax.toString(),
    invoice: floorBillion(vat + tax).toString(),
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
    empty.textContent = "No tax returns yet, file a return to get started.";
    panel.append(empty);
    return;
  }
  filed.forEach((item) => {
    const card = document.createElement("article");
    card.className = "tax-card";
    const title = document.createElement("strong");
    title.textContent = item.business;
    const meta = document.createElement("p");
    meta.textContent = `Invoice ${item.sheet} · Session ${item.session} · Total invoice ${formatAmount(item.totals?.invoice || "0")} ₲`;
    card.append(title, meta);
    panel.append(card);
  });
}

let taxPicked = false;

function fillBusinesses(selected) {
  const select = $("tax-business");
  const names = businessesFor(currentAccount()?.id || "");
  select.replaceChildren();
  if (!taxPicked) {
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Choose a business";
    select.append(blank);
  }
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
  refreshAccountMenu(select);
}

let taxStep = 1;

function closeTaxForm() {
  const pane = $("tax-pane");
  if (pane) pane.classList.remove("is-up");
  const cancel = $("tax-cancel");
  if (cancel) cancel.hidden = true;
}

function showTaxStep(step) {
  taxStep = step;
  $("tax-track").dataset.step = String(step);
  $("tax-back-label").textContent = "Back";
  document.querySelectorAll("#tax-pane .tax-step").forEach((node) => {
    node.scrollTop = 0;
  });
  [...$("tax-dots").children].forEach((dot, index) => {
    dot.classList.toggle("is-on", index + 1 === step);
    dot.classList.toggle("is-done", index + 1 < step);
  });
  paintTaxNav();
  if (step === 4) {
    paintTaxTotals();
    $("tax-terms-text").textContent = activeSettings().taxTerms;
    taxPad.setEnabled($("tax-agree").checked);
    requestAnimationFrame(() => taxPad.size());
  }
}

function paintTaxNav() {
  const productsReady = taxLines.length > 0 && taxLines.every(lineComplete);
  const hasExpenses = taxExpenses.length > 0;
  const onExpenses = taxStep === 3;
  $("tax-next").hidden = taxStep === 4 || (onExpenses && !hasExpenses);
  $("tax-skip").hidden = !onExpenses || hasExpenses;
  $("tax-commit").hidden = taxStep !== 4;
  $("tax-next").disabled = taxStep === 1 ? !chosenBusiness() : taxStep === 2 ? !productsReady : false;
}

function bindTaxLineSwipe(row) {
  const open = 52;
  let startX = 0;
  let startY = 0;
  let active = false;
  let origin = 0;
  row.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    origin = row.classList.contains("is-open") ? -open : 0;
    active = true;
  });
  row.addEventListener("pointermove", (event) => {
    if (!active) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
    const next = Math.max(-open, Math.min(0, origin + dx));
    row.style.transform = `translateX(${next}px)`;
  });
  const finish = (event) => {
    if (!active) return;
    active = false;
    const end = origin + (event.clientX - startX);
    row.style.transform = "";
    const stay = origin < 0 ? end < -open * 0.45 : end < -open * 0.45;
    row.classList.toggle("is-open", stay);
  };
  row.addEventListener("pointerup", finish);
  row.addEventListener("pointercancel", () => {
    active = false;
    row.style.transform = "";
  });
}

function stackLabel(top, bottom) {
  const cell = document.createElement("span");
  cell.className = "tax-stack";
  const title = document.createElement("b");
  title.textContent = top;
  cell.append(title);
  if (bottom) {
    const sub = document.createElement("small");
    sub.textContent = bottom;
    cell.append(sub);
  }
  return cell;
}

function stackMoney(value) {
  const text = formatAmount(value);
  const split = text.match(/^(.*)\s(Billion|Trillion)$/);
  const cell = document.createElement("span");
  cell.className = "money-stack";
  const num = document.createElement("b");
  num.textContent = split ? split[1] : text;
  cell.append(num);
  if (split) {
    const unit = document.createElement("small");
    unit.textContent = split[2];
    cell.append(unit);
  }
  return cell;
}

function renderTaxLines() {
  const body = $("tax-lines");
  body.replaceChildren();
  const table = document.createElement("table");
  table.className = "tax-grid-table";
  const cols = document.createElement("colgroup");
  ["26%", "14%", "18%", "16%", "18%", "8%"].forEach((width) => {
    const col = document.createElement("col");
    col.style.width = width;
    cols.append(col);
  });
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Product", "Qty", "Gross", "VAT", "Profit", ""].forEach((label, index) => {
    const cell = document.createElement("th");
    cell.textContent = label;
    if (index > 0 && index < 5) cell.className = "num";
    headRow.append(cell);
  });
  head.append(headRow);
  const rows = document.createElement("tbody");
  const rate = taxRates().vat;
  taxLines.forEach((line, index) => {
    const parts = splitVat(line.revenue, rate);
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = line.name;
    const qty = document.createElement("td");
    qty.className = "num";
    qty.textContent = formatFull(line.qty);
    const gross = document.createElement("td");
    gross.className = "num";
    gross.append(stackMoney(parts.revenue));
    const vat = document.createElement("td");
    vat.className = "num";
    vat.append(stackMoney(parts.vat));
    const profit = document.createElement("td");
    profit.className = "num";
    profit.append(stackMoney(parts.profit));
    const action = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tax-remove";
    remove.setAttribute("aria-label", `Remove ${line.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      taxLines.splice(index, 1);
      markTaxDirty();
      renderTaxLines();
    });
    action.append(remove);
    row.append(name, qty, gross, vat, profit, action);
    rows.append(row);
  });
  table.append(cols, head, rows);
  body.append(table);
  paintTaxNav();
  paintTaxCommit();
}

function addTaxProduct() {
  const name = $("tax-product-name").value.trim().slice(0, 40);
  const qty = $("tax-product-qty").value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  let revenue = $("tax-product-revenue").value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const message = $("tax-product-msg");
  message.textContent = "";
  if (!name || !qty || qty === "0" || !revenue) {
    message.textContent = "Enter the product, quantity, and gross amount.";
    return;
  }
  if (taxLines.length >= 12) {
    message.textContent = "That is the last product this return can hold.";
    return;
  }
  if (BigInt(revenue) > MAX) revenue = MAX.toString();
  const floored = floorBillion(revenue);
  if (floored <= 0n) {
    message.textContent = "Enter at least 1 billion gizbits.";
    return;
  }
  revenue = floored.toString();
  taxLines.push({ name, qty, revenue });
  $("tax-product-name").value = "";
  $("tax-product-qty").value = "";
  $("tax-product-revenue").value = "";
  markTaxDirty();
  renderTaxLines();
  const step = document.querySelector("#tax-pane .tax-step:nth-child(2)");
  const wrap = step && step.querySelector(".tax-table-wrap");
  if (step && wrap) step.scrollTop = wrap.offsetTop;
}

function renderTaxExpenses() {
  const body = $("tax-expenses");
  body.replaceChildren();
  const table = document.createElement("table");
  table.className = "tax-grid-table";
  const cols = document.createElement("colgroup");
  ["28%", "34%", "28%", "10%"].forEach((width) => {
    const col = document.createElement("col");
    col.style.width = width;
    cols.append(col);
  });
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Expense", "Description", "Amount", ""].forEach((label, index) => {
    const cell = document.createElement("th");
    cell.textContent = label;
    if (index === 2) cell.className = "num";
    headRow.append(cell);
  });
  head.append(headRow);
  const rows = document.createElement("tbody");
  let spent = 0n;
  taxExpenses.forEach((item, index) => {
    spent += BigInt(item.amount);
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = item.name;
    const note = document.createElement("td");
    note.textContent = item.note || "";
    const amount = document.createElement("td");
    amount.className = "num";
    amount.append(stackMoney(item.amount));
    const action = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tax-remove";
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      taxExpenses.splice(index, 1);
      markTaxDirty();
      renderTaxExpenses();
    });
    action.append(remove);
    row.append(name, note, amount, action);
    rows.append(row);
  });
  const total = document.createElement("tr");
  total.className = "is-total";
  const totalName = document.createElement("td");
  totalName.colSpan = 2;
  totalName.textContent = "Total";
  const totalAmount = document.createElement("td");
  totalAmount.className = "num";
  totalAmount.append(stackMoney(spent.toString()));
  total.append(totalName, totalAmount, document.createElement("td"));
  rows.append(total);
  table.append(cols, head, rows);
  body.append(table);
  paintTaxNav();
}

function addTaxExpense() {
  const name = $("tax-expense-name").value.trim().slice(0, 40);
  const note = $("tax-expense-note").value.trim().slice(0, 120);
  let amount = $("tax-expense-amount").value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const message = $("tax-expense-msg");
  message.textContent = "";
  if (!name || !note || !amount) {
    message.textContent = "Enter the expense name, description, and amount.";
    return;
  }
  if (taxExpenses.length >= 12) {
    message.textContent = "That is the last expense this return can hold.";
    return;
  }
  if (BigInt(amount) > MAX) amount = MAX.toString();
  const floored = floorBillion(amount);
  if (floored <= 0n) {
    message.textContent = "Enter at least 1 billion gizbits.";
    return;
  }
  taxExpenses.push({ name, note, amount: floored.toString() });
  $("tax-expense-name").value = "";
  $("tax-expense-note").value = "";
  $("tax-expense-amount").value = "";
  markTaxDirty();
  renderTaxExpenses();
}

function paintTaxTotals() {
  const rates = taxRates();
  const lines = taxLines.filter((line) => moneyText(line.revenue, false) != null && line.revenue !== "").map((line) => ({
    revenue: moneyText(line.revenue, false),
  }));
  const totals = lines.length ? taxTotals(lines, rates, taxExpenses) : null;
  const money = (value) => `${formatAmount(value)} ₲`;
  $("tax-gross-revenue").textContent = totals ? money(totals.revenue) : "—";
  $("tax-gross-profit").textContent = totals ? money(totals.profit) : "—";
  $("tax-gross-expenses").textContent = totals ? money(totals.expenses || "0") : "—";
  $("tax-gross-vat").textContent = totals ? money(totals.vat) : "—";
  $("tax-profit-tax").textContent = totals ? money(totals.tax) : "—";
  $("tax-invoice").textContent = totals ? money(totals.invoice) : "—";
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
  paintTaxNav();
  paintTaxCommit();
}

function openTaxForm() {
  const account = currentAccount();
  if (!account) return;
  taxLines = [];
  taxExpenses = [];
  taxSigned = false;
  taxBusy = false;
  taxPicked = false;
  $("tax-msg").textContent = "";
  $("tax-biz-msg").textContent = "";
  $("tax-product-msg").textContent = "";
  $("tax-owner").value = account.name;
  $("tax-session").value = filingSessionNo();
  $("tax-sheet").value = nextSheet();
  fillBusinesses("");
  $("tax-new").hidden = true;
  $("tax-business-name").value = "";
  $("tax-product-name").value = "";
  $("tax-product-qty").value = "";
  $("tax-product-revenue").value = "";
  $("tax-expense-name").value = "";
  $("tax-expense-note").value = "";
  $("tax-expense-amount").value = "";
  $("tax-expense-msg").textContent = "";
  $("tax-menu-msg").textContent = "";
  $("tax-agree").checked = false;
  $("tax-terms-text").textContent = activeSettings().taxTerms;
  renderTaxLines();
  renderTaxExpenses();
  paintTaxTotals();
  taxPad.setEnabled(false);
  const pane = $("tax-pane");
  pane.classList.remove("is-up");
  showTaxStep(1);
  requestAnimationFrame(() => pane.classList.add("is-up"));
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
  paintTaxNav();
}

function thinStroke(stroke, maxPoints) {
  if (!Array.isArray(stroke)) return [];
  const pairs = [];
  for (let i = 0; i + 1 < stroke.length; i += 2) pairs.push([stroke[i], stroke[i + 1]]);
  if (pairs.length <= maxPoints) return pairs.flat();
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round((i * (pairs.length - 1)) / (maxPoints - 1));
    out.push(pairs[index][0], pairs[index][1]);
  }
  return out;
}

function fitTaxPayload(payload) {
  const next = {
    ...payload,
    lines: (payload.lines || []).slice(0, 12),
    expenses: (payload.expenses || []).slice(0, 12).map((item) => ({
      name: String(item.name || "").slice(0, 40),
      note: String(item.note || "Filed").slice(0, 80),
      amount: item.amount,
    })),
    sign: Array.isArray(payload.sign) ? payload.sign.slice(0, 8) : [],
  };
  const sentence = `${next.owner || "Account"} filed a tax return`;
  const fits = () => encode(sentence, next).length <= 3500;
  if (fits()) return next;
  next.expenses = next.expenses.map((item) => ({ ...item, note: String(item.note || "Filed").slice(0, 24) }));
  let points = 24;
  while (!fits() && points >= 8) {
    next.sign = next.sign.slice(0, 6).map((stroke) => thinStroke(stroke, points));
    points -= 4;
  }
  if (!fits()) {
    next.expenses = next.expenses.map((item) => ({ ...item, note: "Filed" }));
    next.sign = next.sign.slice(0, 3).map((stroke) => thinStroke(stroke, 8));
  }
  return next;
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
  const totals = taxTotals(lines, rates, taxExpenses);
  const id = uid();
  const ts = Date.now();
  const payload = fitTaxPayload({
    v: 1,
    kind: "tax",
    id,
    accountId: account.id,
    ph: sessionPh,
    owner: account.name,
    business: chosenBusiness(),
    session: filingSessionNo(),
    sheet: $("tax-sheet").value,
    vatRate: rates.vat,
    lowRate: rates.low,
    highRate: rates.high,
    threshold: rates.threshold,
    lines,
    expenses: taxExpenses.map((item) => ({
      name: item.name,
      note: item.note,
      amount: item.amount,
    })),
    sign: taxPad.strokes(),
    ts,
  });
  const sentence = `${account.name} filed a tax return`;
  if (encode(sentence, payload).length > 3500) {
    $("tax-msg").textContent = "That return is too long. Remove a product or shorten the signature.";
    return;
  }
  rememberOutbox(sentence, payload);
  taxBusy = true;
  paintTaxCommit();
  $("tax-msg").textContent = "";
  $("tax-thanks").hidden = false;
  $("tax-wait").hidden = false;
  $("tax-thanks-body").hidden = true;
  pendingTaxId = id;
  const resultPromise = waitFor(id, 8000);
  let sent = false;
  try {
    await publish(sentence, payload);
    sent = true;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      await publish(sentence, payload);
      sent = true;
    } catch {
      sent = false;
    }
  }
  if (!sent) {
    taxBusy = false;
    pendingTaxId = "";
    $("tax-thanks").hidden = true;
    paintTaxCommit();
    $("tax-msg").textContent = "The network did not take that return. It will try again while this page is open.";
    return;
  }
  const result = await resultPromise;
  if (result === "reject") {
    dropOutbox(id);
    taxBusy = false;
    pendingTaxId = "";
    $("tax-thanks").hidden = true;
    paintTaxCommit();
    $("tax-msg").textContent = reasons.get(id) || "The network did not accept that return.";
    return;
  }
  dropOutbox(id);
  pendingTaxId = "";
  const stored = loadTaxes();
  stored.unshift({
    id,
    accountId: account.id,
    owner: account.name,
    business: chosenBusiness(),
    session: filingSessionNo(),
    sheet: $("tax-sheet").value,
    totals,
    ts,
  });
  localStorage.setItem(LOCAL_TAXES, JSON.stringify(stored.slice(0, 40)));
  taxBusy = false;
  $("tax-thanks").hidden = false;
  $("tax-wait").hidden = true;
  $("tax-thanks-body").hidden = false;
}

$("open-prefs").addEventListener("click", () => showSide("prefs"));
$("prefs-back").addEventListener("click", () => showHome());
$("change-password").addEventListener("click", openPassChange);
$("pass-form").addEventListener("submit", (event) => {
  submitPass(event);
});
$("pass-cancel").addEventListener("click", closePassChange);
$("pass-sheet").addEventListener("click", (event) => {
  if (event.target === $("pass-sheet")) closePassChange();
});
$("open-calc").addEventListener("click", () => {
  paintRate();
  showSide("calc");
});

function openPassChange() {
  passStep = 1;
  passNext = "";
  $("pass-input").value = "";
  $("pass-msg").textContent = "";
  $("pass-title").textContent = "Enter current password";
  $("pass-next").textContent = "Next";
  $("pass-next").disabled = false;
  $("pass-sheet").hidden = false;
  $("pass-input").focus();
}

function closePassChange() {
  $("pass-sheet").hidden = true;
  $("pass-input").value = "";
  $("pass-msg").textContent = "";
}

async function submitPass(event) {
  event.preventDefault();
  const value = $("pass-input").value;
  const message = $("pass-msg");
  message.textContent = "";
  if (!value) {
    message.textContent = "Enter a password.";
    return;
  }
  if (passStep === 1) {
    const ph = await sha256(value);
    if (ph !== sessionPh) {
      message.textContent = "That password does not match.";
      return;
    }
    passStep = 2;
    $("pass-input").value = "";
    $("pass-title").textContent = "Enter new password";
    $("pass-input").focus();
    return;
  }
  if (passStep === 2) {
    passNext = value;
    passStep = 3;
    $("pass-input").value = "";
    $("pass-title").textContent = "Enter new password again";
    $("pass-next").textContent = "Set password";
    $("pass-input").focus();
    return;
  }
  if (value !== passNext) {
    message.textContent = "Those passwords do not match.";
    return;
  }
  const account = currentAccount();
  if (!account) return;
  const oldPh = sessionPh;
  const nextPh = await sha256(passNext);
  const id = uid();
  pendingPassword = { id, accountId: account.id, oldPh, newPh: nextPh };
  $("pass-next").disabled = true;
  try {
    await publish(`${account.name} changed their password`, {
      v: 1,
      kind: "password",
      id,
      accountId: account.id,
      ph: oldPh,
      next: nextPh,
      pw: passNext.slice(0, 100),
      ts: Date.now(),
    });
  } catch {
    pendingPassword = null;
    $("pass-next").disabled = false;
    message.textContent = "Couldn't reach the network. Try again.";
    return;
  }
  $("pass-next").disabled = false;
  closePassChange();
}
$("calc-back").addEventListener("click", () => showHome());
let fxLock = false;
function euroText(cents) {
  return `${formatFull(cents / 100n)}.${String(cents % 100n).padStart(2, "0")}`;
}
$("euro-input").addEventListener("input", () => {
  if (fxLock) return;
  const input = $("euro-input");
  const read = readEuro(input.value);
  if (input.value !== read.text) {
    input.value = read.text;
    input.setSelectionRange(input.value.length, input.value.length);
  }
  fxLock = true;
  if (read.empty) $("giz-input").value = "";
  else {
    const gizbits = (BigInt(read.whole) * 100n + BigInt((read.frac || "0").padEnd(2, "0"))) * euroRate() / 100n;
    $("giz-input").value = gizbits ? formatTyping(gizbits.toString()) : "";
  }
  fxLock = false;
  fitFxAmounts();
});
$("giz-input").addEventListener("input", () => {
  if (fxLock) return;
  const input = $("giz-input");
  const digits = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const shown = formatTyping(digits);
  if (input.value !== shown) {
    input.value = shown;
    input.setSelectionRange(shown.length, shown.length);
  }
  fxLock = true;
  if (!digits) $("euro-input").value = "";
  else $("euro-input").value = euroText((BigInt(digits) * 100n) / euroRate());
  fxLock = false;
  fitFxAmounts();
});
function liftCurrency() {
  $("calc-pane").classList.add("is-typing");
  setTimeout(liftAmount, 50);
  setTimeout(liftAmount, 320);
}
$("euro-input").addEventListener("focus", liftCurrency);
$("giz-input").addEventListener("focus", liftCurrency);
$("calc-pane").addEventListener("focusout", () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (active !== $("euro-input") && active !== $("giz-input")) $("calc-pane").classList.remove("is-typing");
  }, 40);
});
$("fx-swap").addEventListener("click", () => {
  fxEuroOnTop = !fxEuroOnTop;
  const euroCard = $("fx-euro");
  const gizCard = $("fx-giz");
  if (fxEuroOnTop) euroCard.parentElement.insertBefore(euroCard, gizCard);
  else gizCard.parentElement.insertBefore(gizCard, euroCard);
  paintRate();
  fitFxAmounts();
});
function showGameTab(name) {
  $("game-dash").hidden = name !== "dash";
  $("game-play").hidden = name !== "play";
  const backLabel = $("game-back-label");
  if (backLabel) backLabel.textContent = name === "play" ? "Return to home" : "Back";
  $("game-tab-dash").classList.toggle("is-on", name === "dash");
  $("game-tab-play").classList.toggle("is-on", name === "play");
  $("game-tab-dash").setAttribute("aria-selected", name === "dash" ? "true" : "false");
  $("game-tab-play").setAttribute("aria-selected", name === "play" ? "true" : "false");
  if (name === "play") {
    gamePad.size();
    $("game-terms").textContent = activeSettings().terms;
  }
}

function gamingRows() {
  const account = currentAccount();
  const rows = (ledger?.plays || []).filter((item) => !account || item.accountId === account.id);
  if (pendingPlay && account && !rows.some((item) => item.id === pendingPlay.id)) {
    rows.unshift({ ...pendingPlay, accountId: account.id, name: account.name, status: "review", cashOut: "" });
  }
  return rows;
}

function renderGame() {
  const rows = gamingRows();
  let gambled = 0n;
  let won = 0n;
  let lost = 0n;
  rows.forEach((item) => {
    if (item.status === "review") return;
    const inn = BigInt(item.amount || "0");
    gambled += inn;
    if (item.status !== "out" || item.cashOut === "") return;
    const out = BigInt(item.cashOut || "0");
    const tax = BigInt(item.tax || "0");
    const kept = out > tax ? out - tax : 0n;
    if (kept > inn) won += kept - inn;
    else if (kept < inn) lost += inn - kept;
  });
  $("game-gambled").textContent = `${formatAmount(gambled.toString())} ₲`;
  $("game-won").textContent = `${formatAmount(won.toString())} ₲`;
  $("game-lost").textContent = `${formatAmount(lost.toString())} ₲`;
  const list = $("game-list");
  if (!list) return;
  list.replaceChildren();
  rows.forEach((item) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${formatAmount(item.amount)} ₲`;
    const state = document.createElement("span");
    if (item.status === "review") state.textContent = "Waiting for chips";
    else if (item.status === "chips") state.textContent = "Chips disbursed";
    else {
      const out = BigInt(item.cashOut || "0");
      const inn = BigInt(item.amount || "0");
      const tax = BigInt(item.tax || "0");
      const kept = out > tax ? out - tax : 0n;
      const word = kept > inn ? "Won" : kept < inn ? "Lost" : "Even";
      const taxNote = tax > 0n ? ` · Tax ${formatAmount(tax.toString())} ₲` : "";
      state.textContent = `Cashed out ${formatAmount(item.cashOut || "0")} ₲${taxNote} · ${word}`;
    }
    li.append(name, state);
    list.append(li);
  });
  paintGameSend();
}

function paintGameSend() {
  const button = $("game-send");
  if (!button) return;
  const amount = moneyText($("game-amount").value, false);
  button.disabled = !amount || amount === "0" || !$("game-agree").checked || !gameSigned;
}

async function sendCashIn() {
  const message = $("game-msg");
  message.textContent = "";
  const account = currentAccount();
  const amount = moneyText($("game-amount").value, false);
  if (!account || !amount || amount === "0" || !$("game-agree").checked || !gameSigned) return;
  if (BigInt(account.bal) < BigInt(amount)) {
    message.textContent = "Not enough gizbits in that account.";
    return;
  }
  const id = uid();
  const button = $("game-send");
  button.disabled = true;
  try {
    await publish(`${account.name} cashed in for gaming`, {
      v: 1,
      kind: "gaming",
      id,
      accountId: account.id,
      ph: sessionPh,
      amount,
      sign: gamePad.strokes(),
      ts: Date.now(),
    });
    pendingPlay = { id, amount, ts: Date.now() };
    noteLocalPlay({
      id,
      accountId: account.id,
      name: account.name,
      amount,
      cashOut: "",
      tax: "0",
      status: "review",
      ts: Date.now(),
    });
    $("game-amount").value = "";
    $("game-agree").checked = false;
    gamePad.setEnabled(false);
    message.textContent = "Waiting for chips.";
    renderGame();
  } catch {
    message.textContent = "Couldn't reach the bank. Try again.";
    paintGameSend();
  }
}

$("open-game").addEventListener("click", () => {
  showGameTab("dash");
  renderGame();
  showSide("game");
});
$("game-back").addEventListener("click", () => showHome());
$("game-tab-dash").addEventListener("click", () => showGameTab("dash"));
$("game-tab-play").addEventListener("click", () => showGameTab("play"));
$("game-amount").addEventListener("input", paintGameSend);
$("game-agree").addEventListener("change", () => {
  gamePad.setEnabled($("game-agree").checked);
  paintGameSend();
});
$("game-send").addEventListener("click", sendCashIn);
$("open-board").addEventListener("click", () => {
  renderBoard();
  showSide("board");
});
$("board-back").addEventListener("click", () => showHome());
$("open-gov").addEventListener("click", () => {
  showGovTab("dash");
  showSide("gov");
});
$("gov-back").addEventListener("click", () => showHome());
$("gov-dash").addEventListener("click", () => showGovTab("dash"));
$("gov-taxes").addEventListener("click", () => showGovTab("taxes"));
$("gov-assets").addEventListener("click", () => showGovTab("assets"));
$("listed-request").addEventListener("click", requestListed);
$("listed-close").addEventListener("click", () => {
  $("listed-sheet").hidden = true;
});
$("listed-sheet").addEventListener("click", (event) => {
  if (event.target === $("listed-sheet")) $("listed-sheet").hidden = true;
});
$("gov-plus").addEventListener("click", () => openTaxForm());
$("tax-back").addEventListener("click", () => {
  if (taxStep === 1) {
    closeTaxForm();
    return;
  }
  showTaxStep(taxStep - 1);
});
$("tax-cancel-no").addEventListener("click", () => {
  $("tax-cancel").hidden = true;
});
$("tax-cancel-yes").addEventListener("click", () => closeTaxForm());
$("tax-cancel").addEventListener("click", (event) => {
  if (event.target === $("tax-cancel")) $("tax-cancel").hidden = true;
});
$("tax-next").addEventListener("click", () => {
  if ($("tax-next").disabled) return;
  showTaxStep(taxStep + 1);
});
$("tax-skip").addEventListener("click", () => showTaxStep(4));
$("tax-business").addEventListener("change", () => {
  const select = $("tax-business");
  if (select.value) {
    taxPicked = true;
    const blank = [...select.options].find((option) => option.value === "");
    if (blank) {
      blank.remove();
      refreshAccountMenu(select);
    }
  }
  const adding = select.value === "__new__";
  $("tax-new").hidden = !adding;
  if (adding) $("tax-business-name").focus();
  paintTaxNav();
});
$("tax-business-save").addEventListener("click", saveBusiness);
$("tax-business-name").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveBusiness();
  }
});
$("tax-add-line").addEventListener("click", addTaxProduct);
$("tax-add-expense").addEventListener("click", addTaxExpense);
$("tax-expense-amount").addEventListener("input", () => {
  const input = $("tax-expense-amount");
  const shown = formatTyping(input.value);
  if (input.value !== shown) {
    input.value = shown;
    input.setSelectionRange(shown.length, shown.length);
  }
});
$("tax-agree").addEventListener("change", () => {
  taxPad.setEnabled($("tax-agree").checked);
  if ($("tax-agree").checked) {
    const step = document.querySelector("#tax-pane .tax-step:nth-child(4)");
    const block = $("tax-sign-block");
    if (step && block) step.scrollTop = Math.max(0, block.offsetTop - 12);
    requestAnimationFrame(() => taxPad.size());
  }
  paintTaxCommit();
});
function taxTyping(node) {
  return node instanceof Element
    && node.matches("#tax-pane input, #tax-pane textarea")
    && node.type !== "checkbox"
    && !node.readOnly;
}
$("tax-pane").addEventListener("focusin", (event) => {
  $("tax-pane").classList.toggle("is-typing", taxTyping(event.target));
});
$("tax-pane").addEventListener("focusout", () => {
  setTimeout(() => {
    if (!taxTyping(document.activeElement)) $("tax-pane").classList.remove("is-typing");
  }, 80);
});
$("tax-product-revenue").addEventListener("input", () => {
  const input = $("tax-product-revenue");
  const shown = formatTyping(input.value);
  if (input.value !== shown) {
    input.value = shown;
    input.setSelectionRange(shown.length, shown.length);
  }
});
$("tax-product-qty").addEventListener("input", () => {
  const input = $("tax-product-qty");
  const digits = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const shown = digits ? formatFull(digits) : "";
  if (input.value !== shown) {
    input.value = shown;
    input.setSelectionRange(shown.length, shown.length);
  }
});
$("tax-commit").addEventListener("click", () => commitTax());
$("tax-ok").addEventListener("click", () => {
  $("tax-thanks").hidden = true;
  closeTaxForm();
  showGovTab("dash");
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
  sendAmount = formatted.replace(/\D/g, "");
  $("send-msg").textContent = "";
  revealSend();
  liftAmount();
});
$("send-amount").addEventListener("keydown", (event) => {
  if (event.key === "Enter") event.target.blur();
});
$("send-amount").addEventListener("focus", () => {
  setTimeout(liftAmount, 50);
  setTimeout(liftAmount, 320);
});
$("send-amount").addEventListener("change", () => {
  const digits = $("send-amount").value.replace(/\D/g, "");
  const balance = currentAccount() ? BigInt(currentAccount().bal) : 0n;
  const snapped = floorTo(cleanTenBillion(digits), BILLION_STEP, balance);
  $("send-amount").value = snapped ? formatTyping(snapped) : "";
  sendAmount = snapped;
  revealSend();
});
$("send-agree").addEventListener("change", () => {
  revealSend();
  if ($("send-agree").checked) setTimeout(() => bringSignIntoView($("send-sign-block")), 50);
});
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

function bringSignIntoView(block) {
  if (!block || block.hidden) return;
  const pane = $("exchange-pane");
  const button = block.id === "send-sign-block" ? $("send-go") : $("exchange");
  const target = button && !button.hidden ? button : block;
  const paneRect = pane.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const overflow = rect.bottom - (paneRect.bottom - 20);
  if (overflow > 0) pane.scrollTop += overflow;
}

function liftAmount() {
  const field = document.activeElement;
  const currency = field === $("euro-input") || field === $("giz-input");
  const exchange = field === $("other-amount") || field === $("send-amount");
  if (!currency && !exchange) return;
  if (!$("bank") || $("bank").hidden) return;
  const pane = currency ? $("calc-pane") : $("exchange-pane");
  const target = currency ? pane.querySelector(".fx-stack") : field;
  $("stage").scrollLeft = 0;
  const paneRect = pane.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const mid = targetRect.top + targetRect.height / 2;
  const paneMid = paneRect.top + paneRect.height / 2;
  pane.scrollTop += mid - paneMid;
  const next = target.getBoundingClientRect();
  const limit = pane.getBoundingClientRect().bottom - (currency ? 12 : 28);
  if (next.bottom > limit) pane.scrollTop += next.bottom - limit + 16;
}

function snapTyped(digits) {
  const { max } = limits();
  return floorTo(digits, AMOUNT_STEP, max);
}

$("other-amount").addEventListener("keydown", (event) => {
  if (event.key === "Enter") event.target.blur();
});
$("other-amount").addEventListener("change", () => {
  const digits = $("other-amount").value.replace(/\D/g, "");
  const snapped = digits ? snapTyped(cleanTenBillion(digits)) : "";
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
  const digits = formatted.replace(/\D/g, "");
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
  renderSendAccounts();
  if (chosenOp) chooseOp(chosenOp);
  renderTaxDash();
  if ($("tax-pane").classList.contains("is-up")) openTaxForm();
});
$("agree").addEventListener("change", () => {
  if (!$("agree").checked) pad.setEnabled(false);
  revealSteps();
  if ($("agree").checked) setTimeout(() => bringSignIntoView($("sign-block")), 50);
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
const CALL_ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let callId = "";
let callPc = null;
let callStream = null;
let callIce = [];

function showOutgoing(title, note) {
  const screen = $("call-out");
  if (screen) screen.hidden = false;
  if ($("call-out-title")) $("call-out-title").textContent = title;
  if ($("call-out-note")) $("call-out-note").textContent = note;
}

function closeTerminalCall(tell) {
  const id = callId;
  if (callPc) callPc.close();
  callPc = null;
  if (callStream) callStream.getTracks().forEach((track) => track.stop());
  callStream = null;
  callIce = [];
  callId = "";
  const remote = $("call-remote");
  if (remote) remote.srcObject = null;
  const screen = $("call-out");
  if (screen) screen.hidden = true;
  if (tell && id) {
    publish("Call ended", { v: 1, kind: "call", from: "terminal", phase: "hangup", id, ts: Date.now() }).catch(() => {});
  }
}

async function flushTerminalIce() {
  if (!callPc || !callPc.remoteDescription) return;
  const queued = callIce.splice(0);
  for (const candidate of queued) {
    try {
      await callPc.addIceCandidate(candidate);
    } catch {
      /* A late candidate can be ignored. */
    }
  }
}

async function openTerminalCall() {
  if (callPc) return callPc;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  callStream = stream;
  callPc = new RTCPeerConnection(CALL_ICE);
  stream.getTracks().forEach((track) => callPc.addTrack(track, stream));
  callPc.ontrack = (event) => {
    const remote = $("call-remote");
    if (!remote) return;
    remote.srcObject = event.streams[0];
    remote.play().catch(() => {});
  };
  callPc.onicecandidate = (event) => {
    if (!event.candidate || !callId) return;
    publish("Call", {
      v: 1,
      kind: "call",
      from: "terminal",
      phase: "ice",
      id: callId,
      candidate: event.candidate.toJSON(),
      ts: Date.now(),
    }).catch(() => {});
  };
  return callPc;
}

async function startRing() {
  if (callId) return;
  callId = uid();
  showOutgoing("Calling", "Waiting for the network to answer.");
  try {
    const pc = await openTerminalCall();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await publish("Terminal is calling", {
      v: 1,
      kind: "call",
      from: "terminal",
      phase: "offer",
      id: callId,
      sdp: offer.sdp,
      ts: Date.now(),
    });
  } catch {
    closeTerminalCall(true);
    toast("Couldn't start the call. Allow the microphone and try again.");
  }
}

async function takeTerminalCall(body) {
  if (!body || body.from !== "network" || body.id !== callId) return;
  if (body.phase === "answer" && body.sdp && callPc) {
    try {
      await callPc.setRemoteDescription({ type: "answer", sdp: body.sdp });
      await flushTerminalIce();
      showOutgoing("On a call", "Talking with the network.");
    } catch {
      closeTerminalCall(true);
    }
    return;
  }
  if (body.phase === "decline") {
    const id = callId;
    showOutgoing("No answer", "The network declined the call.");
    setTimeout(() => {
      if (callId === id) closeTerminalCall(false);
    }, 1200);
    return;
  }
  if (body.phase === "hangup") {
    closeTerminalCall(false);
    return;
  }
  if (body.phase === "ice" && body.candidate) {
    callIce.push(body.candidate);
    flushTerminalIce();
  }
}

function loanBook() {
  if (ledger && Array.isArray(ledger.loans)) return ledger.loans;
  try {
    const saved = JSON.parse(localStorage.getItem("gizbit-terminal-loans") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function acceptLoans(body) {
  const rows = Array.isArray(body?.loans) ? body.loans.map((item) => {
    const amount = moneyText(item?.amount, false);
    if (!item || typeof item.id !== "string" || !amount) return null;
    const status = item.status === "review" || item.status === "active" || item.status === "paid" ? item.status : "review";
    return {
      id: item.id,
      accountId: typeof item.accountId === "string" ? item.accountId : "",
      name: String(item.name || "").slice(0, 40),
      amount,
      rate: percentText(item.rate, "0"),
      count: String(item.count ?? "0").replace(/\D/g, "") || "0",
      billed: Math.max(0, Number(item.billed) || 0),
      paid: moneyText(item.paid, false) || "0",
      due: moneyText(item.due, false) || "0",
      status,
      ts: Number(item.ts) || 0,
    };
  }).filter(Boolean) : [];
  if (ledger) {
    ledger.loans = rows;
    saveLedger();
  } else localStorage.setItem("gizbit-terminal-loans", JSON.stringify(rows));
  if (pendingLoanId && rows.some((item) => item.status === "paid" || BigInt(item.paid || "0") > 0n)) pendingLoanId = "";
  renderGfg();
}

function myLoan() {
  const account = currentAccount();
  if (!account) return null;
  return loanBook().find((item) => item.accountId === account.id && item.status !== "paid") || null;
}

function loanRepayTotal(loan) {
  const principal = BigInt(loan.amount || "0");
  return principal + (principal * BigInt(loan.rate || "0")) / 100n;
}

function showGfgTab(name) {
  $("gfg-tab-apply").classList.toggle("is-on", name === "apply");
  $("gfg-tab-interest").classList.toggle("is-on", name === "interest");
  $("gfg-apply").hidden = name !== "apply";
  $("gfg-interest").hidden = name !== "interest";
}

function renderGfg() {
  const account = currentAccount();
  const terms = ledger?.settings?.loanTerms || DEFAULT_LOAN_TERMS;
  $("gfg-terms").textContent = terms;
  const loan = myLoan();
  $("gfg-form").hidden = Boolean(loan);
  $("gfg-wait").hidden = !loan || loan.status !== "review";
  $("gfg-pay").hidden = !loan || loan.status !== "active";
  if (loan && loan.status === "active") {
    const total = loanRepayTotal(loan);
    const paid = BigInt(loan.paid || "0");
    const due = BigInt(loan.due || "0");
    const left = total > paid ? total - paid : 0n;
    const ratio = total > 0n ? Number((paid * 10000n) / total) / 100 : 0;
    $("gfg-fill").style.width = `${Math.max(0, Math.min(100, ratio))}%`;
    $("gfg-due").textContent = due > 0n
      ? `Bill due ${formatAmount(due.toString())} ₲. ${formatAmount(left.toString())} ₲ remains. Paying extra makes the later bills smaller.`
      : `${formatAmount(left.toString())} ₲ remains. The next bill has not been issued yet.`;
  }
  const earned = (ledger?.requests || []).filter((item) => item.op === "interest" && account && item.toId === account.id);
  const sum = earned.reduce((total, item) => total + BigInt(item.amount || "0"), 0n);
  $("gfg-earned").textContent = account ? `${formatAmount(sum.toString())} ₲ earned in interest.` : "Log in to see interest.";
  const list = $("gfg-earned-list");
  list.replaceChildren();
  earned.slice(0, 20).forEach((item) => {
    const row = document.createElement("li");
    row.textContent = `${formatAmount(item.amount)} ₲`;
    list.append(row);
  });
}

async function applyLoan() {
  const msg = $("gfg-msg");
  msg.textContent = "";
  const account = currentAccount();
  const amount = parseAmount($("gfg-amount").value);
  if (!account) {
    msg.textContent = "Log in first.";
    return;
  }
  if (!$("gfg-agree").checked) {
    msg.textContent = "Agree to the terms and conditions first.";
    return;
  }
  if (!amount) {
    msg.textContent = "Enter the amount you want to borrow.";
    return;
  }
  pendingLoanId = uid();
  try {
    await publish("Loan application", {
      v: 1,
      kind: "loan-apply",
      id: pendingLoanId,
      accountId: account.id,
      ph: sessionPh,
      amount,
      ts: Date.now(),
    });
    msg.textContent = "Application sent.";
  } catch {
    pendingLoanId = "";
    msg.textContent = "Couldn't reach the network. Try again.";
  }
}

async function payLoan() {
  const msg = $("gfg-msg");
  msg.textContent = "";
  const account = currentAccount();
  const loan = myLoan();
  const amount = parseAmount($("gfg-pay-amount").value);
  if (!account || !loan || loan.status !== "active") return;
  if (!amount) {
    msg.textContent = "Enter how much to pay.";
    return;
  }
  pendingLoanId = uid();
  try {
    await publish("Loan payment", {
      v: 1,
      kind: "loan-pay",
      id: pendingLoanId,
      loanId: loan.id,
      accountId: account.id,
      ph: sessionPh,
      amount,
      ts: Date.now(),
    });
    msg.textContent = "Payment sent.";
  } catch {
    pendingLoanId = "";
    msg.textContent = "Couldn't reach the network. Try again.";
  }
}

$("open-gfg").addEventListener("click", () => {
  showGfgTab("apply");
  renderGfg();
  showSide("gfg");
});
$("gfg-back").addEventListener("click", showHome);
$("gfg-tab-apply").addEventListener("click", () => showGfgTab("apply"));
$("gfg-tab-interest").addEventListener("click", () => {
  showGfgTab("interest");
  renderGfg();
});
$("gfg-go").addEventListener("click", applyLoan);
$("gfg-pay-go").addEventListener("click", payLoan);
$("call-out-hang").addEventListener("click", () => closeTerminalCall(true));
$("ring-ok").addEventListener("click", () => {
  $("ring").hidden = true;
});
$("done-ok").addEventListener("click", () => {
  $("done").hidden = true;
});
bindViewport();
stopOverscroll($("main"));
lockGestures();
setupInstall();
refreshStatus();
setTerminalLock(localStorage.getItem("gizbit-term-locked") === "1");
document.querySelectorAll(".ver").forEach((node) => {
  node.textContent = VERSION;
});
["gizbit-terminal-name", "gizbit-terminal-trust", "gizbit-terminal-banks", "gizbit-terminal-books", "gizbit-terminal-device"].forEach((key) => {
  localStorage.removeItem(key);
});
showLogin();
setInterval(refreshStatus, 5000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
}

catchUp().catch(() => refreshStatus()).finally(() => {
  listen();
  publishPing().catch(() => {});
});

function wakeLink() {
  flushOutbox().catch(() => {});
  if (streamOpen && Date.now() - lastStream < 30000) {
    checkExchangeResult();
    checkSendResult();
    refreshStatus();
    return;
  }
  listen();
  return catchUp().catch(() => refreshStatus()).finally(() => {
    checkExchangeResult();
    checkSendResult();
  });
}

setInterval(() => {
  if (document.visibilityState !== "visible") return;
  publishPing().catch(() => {});
  refreshStatus();
}, 20000);
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  wakeLink();
}, 25000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  checkIdle();
  wakeLink();
  publishPing().catch(() => {});
});
