// Main bank. Keep TOPIC, encode, and decode identical in terminal/app.js.
const TOPIC = "gizbit-net-m3p8k2w7q9n4";
const NTFY = "https://ntfy.envs.net";
const STORAGE = "gizbit-accounts";
const ACTIVITY = "gizbit-activity";
const REQUESTS = "gizbit-requests";
const PASSNOTES = "gizbit-pass-notes";
const TAXES = "gizbit-taxes";
const USUAL = "gizbit-usual";
const SESSIONS = "gizbit-sessions";
const SESSION = "gizbit-session";
const INTEREST = "gizbit-interest";
const INTEREST_MS = 5 * 60 * 60 * 1000;
const LISTED = "gizbit-assets";
const ASSET_BUYS = "gizbit-asset-buys";
const PLAYS = "gizbit-gaming";
const LOANS = "gizbit-loans";
const CONTRACTS = "gizbit-contracts";
const SEEN = "gizbit-seen";
const CURSOR = "gizbit-cursor";
const MAX = 10n ** 18n;
const DEFAULT_PRESETS = ["100000000000", "250000000000", "500000000000", "750000000000", "1000000000000", "2000000000000"];
const DEFAULT_MIN = "50000000000";
const DEFAULT_EURO = "5000000000";
const DEFAULT_VAT = "20";
const DEFAULT_GAMING_TAX = "20";
const DEFAULT_PROFIT_LOW = "25";
const DEFAULT_PROFIT_HIGH = "40";
const DEFAULT_PROFIT_THRESHOLD = "8000000000000";
const DEFAULT_TERMS = "An exchange is recorded on the main phone. You confirm the amount is correct and that the gizbits will be handed over as agreed.";
const DEFAULT_TAX_TERMS = "This tax return is filed with the National Gizbit Government centre. The amounts are correct and the VAT and profit tax are accepted.";
const DEFAULT_BANK_LIMIT = "30000000000000000";
// Versions start at 1.00.000. A small fix adds 0.00.001, a feature adds 0.01.000, and a large change adds 1.00.000.
const VERSION = "2.37.001";
const DEFAULT_LOAN_TERMS = "A loan is approved by the Gizbit Financial Group. You agree to the interest rate and the payments for the amount that is approved.";
const DEFAULT_LOAN_BANDS = [
  { min: "5000000000000", max: "10000000000000", rate: "16", count: "20" },
  { min: "10000000000000", max: "15000000000000", rate: "12", count: "40" },
  { min: "15000000000000", max: "20000000000000", rate: "10", count: "60" },
];
const TERM_LOCK = "gizbit-term-lock";

const state = loadState();
const activity = loadList(ACTIVITY);
const requests = loadList(REQUESTS);
const passNotes = loadList(PASSNOTES);
const taxes = loadList(TAXES);
const assets = loadList(LISTED);
const assetBuys = loadList(ASSET_BUYS);
const plays = loadList(PLAYS);
const loans = loadList(LOANS);
const contracts = loadList(CONTRACTS);
const sessions = loadList(SESSIONS);
let sessionLive = loadSession();
let attendMarks = new Map();
let attendReasons = new Map();
let viewingSession = "";
let terminalLocked = localStorage.getItem(TERM_LOCK) === "1";
let taxPane = "income";
let taxSheetId = "";
let taxEditing = false;
let taxReviewStep = 0;
let reviewInk = [];
let reviewBackup = null;
let gamingBin = false;
let playOpenId = "";
let attendEdit = false;
let interest = loadInterest();
const seen = new Set(loadList(SEEN));
let source = null;
let streamOpen = false;
let lastStream = 0;
let lastAnnounce = 0;
let announced = false;
let lastSend = 0;
let lastHear = 0;
let linkBroken = false;
let connectedSince = 0;
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
    gamingTax: DEFAULT_GAMING_TAX,
    casinoCut: "0",
    casinoCutAccountId: "",
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
  const presets = Array.isArray(value?.presets) ? value.presets.map((item) => moneyText(item)).filter(Boolean) : [];
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
    gamingTax: percentText(value?.gamingTax, DEFAULT_GAMING_TAX),
    casinoCut: percentText(value?.casinoCut, "0"),
    casinoCutAccountId: typeof value?.casinoCutAccountId === "string" && /^[\w-]{8,}$/.test(value.casinoCutAccountId) ? value.casinoCutAccountId : "",
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

function cleanReasons(value) {
  const reasons = {};
  if (!value || typeof value !== "object") return reasons;
  Object.keys(value).forEach((id) => {
    if (!/^[\w-]{8,}$/.test(id)) return;
    const text = String(value[id] || "").trim().slice(0, 80);
    if (text) reasons[id] = text;
  });
  return reasons;
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
  const clean = { id: account.id, name: name.slice(0, 40), type: type.slice(0, 24), bal, ph: account.ph };
  if (typeof account.pw === "string" && account.pw) clean.pw = account.pw.slice(0, 100);
  return clean;
}

function saveAccounts() {
  state.rev += 1;
  localStorage.setItem(STORAGE, JSON.stringify({ rev: state.rev, accounts: state.accounts, settings: state.settings }));
}

function saveActivity() {
  localStorage.setItem(ACTIVITY, JSON.stringify(activity.slice(0, 40)));
}

function saveRequests() {
  localStorage.setItem(REQUESTS, JSON.stringify(requests.slice(0, 40)));
}

function savePassNotes() {
  localStorage.setItem(PASSNOTES, JSON.stringify(passNotes.slice(0, 20)));
}

function saveTaxes() {
  localStorage.setItem(TAXES, JSON.stringify(taxes.slice(0, 80)));
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

const BILLION = 1000000000n;

function floorBillion(value) {
  const amount = BigInt(value || "0");
  if (amount <= 0n) return 0n;
  return amount - (amount % BILLION);
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

function formatBillions(value) {
  let amount = 0n;
  try {
    amount = BigInt(value || "0");
  } catch {
    amount = 0n;
  }
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const whole = abs / BILLION;
  const frac = abs % BILLION;
  let text = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (frac !== 0n) {
    const milli = (frac * 1000n) / BILLION;
    text += `.${milli.toString().padStart(3, "0").replace(/0+$/, "")}`;
  }
  return `${neg && abs !== 0n ? "-" : ""}${text}*`;
}

function billionsInputValue(value) {
  return formatBillions(value).replace(/\*$/, "");
}

function rawFromBillions(text) {
  const clean = String(text || "").replace(/[*\s,]/g, "");
  if (!/^\d+(\.\d{0,9})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  const padded = (frac + "000000000").slice(0, 9);
  try {
    return (BigInt(whole || "0") * BILLION + BigInt(padded)).toString();
  } catch {
    return null;
  }
}

function formatLoose(value) {
  let amount = 0n;
  try {
    amount = BigInt(value || "0");
  } catch {
    amount = 0n;
  }
  if (amount < 0n) amount = -amount;
  const scales = [[10n ** 12n, "Trillion"], [10n ** 9n, "Billion"]];
  for (const [unit, label] of scales) {
    if (amount < unit) continue;
    const scaled = (amount * 1000n) / unit;
    const whole = scaled / 1000n;
    const frac = scaled % 1000n;
    const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (frac === 0n) return `${wholeText} ${label}`;
    const decimals = frac.toString().padStart(3, "0").replace(/0+$/, "");
    return `${wholeText}.${decimals} ${label}`;
  }
  return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function groupDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function placeGroupedCaret(input) {
  const caret = input.selectionStart == null ? input.value.length : input.selectionStart;
  const digitsBefore = input.value.slice(0, caret).replace(/\D/g, "").length;
  const stripped = input.value.replace(/\D/g, "");
  const lead = stripped.length - stripped.replace(/^0+(?=\d)/, "").length;
  const keep = Math.max(0, digitsBefore - lead);
  const shown = groupDigits(input.value);
  input.value = shown;
  let pos = 0;
  let seen = 0;
  while (pos < shown.length && seen < keep) {
    if (/\d/.test(shown[pos])) seen += 1;
    pos += 1;
  }
  input.setSelectionRange(pos, pos);
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

function publish(sentence, payload) {
  const job = postChain.then(async () => {
    const attempt = async () => {
      const res = await fetch(`${NTFY}/${TOPIC}`, {
        method: "POST",
        body: encode(sentence, payload),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
    };
    try {
      await attempt();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 700));
      try {
        await attempt();
      } catch (err) {
        linkBroken = true;
        paintLink();
        throw err;
      }
    }
    linkBroken = false;
    lastSend = Date.now();
    paintLink();
  });
  postChain = job.catch(() => {});
  return job;
}

function publishLedger(applied, answered) {
  const payload = {
    v: 1,
    kind: "ledger",
    rev: state.rev,
    applied: applied || [],
    answered: typeof answered === "string" ? answered : "",
    accounts: state.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      bal: account.bal,
      ph: account.ph,
    })),
    settings: state.settings,
    locked: terminalLocked,
    sessionNo: currentSessionLabel(),
    ts: Date.now(),
  };
  const requestRows = requests.filter((item) => item.op === "interest").slice(0, 12)
    .concat(requests.filter((item) => item.op !== "interest").slice(0, 8))
    .map((item) => {
    const row = {
      id: item.id,
      accountId: item.accountId,
      name: item.name,
      op: item.op,
      amount: item.amount,
      status: item.status,
      applied: item.applied || "",
      ts: item.ts,
    };
    if (item.toId) row.toId = item.toId;
    if (item.toName) row.toName = item.toName;
    if (item.note) row.note = String(item.note).slice(0, 40);
    if (item.memo) row.memo = String(item.memo).slice(0, 40);
    return row;
  });
  const playRows = plays.slice(0, 6).map((item) => ({
    id: item.id,
    accountId: item.accountId,
    name: item.name,
    amount: item.amount,
    cashOut: item.cashOut || "",
    tax: item.tax || "0",
    status: item.status,
    ts: item.ts,
  }));
  const books = lastSessionBooks();
  const fits = (body) => encode("Balances updated", body).length <= 3900;
  const pack = (key, rows) => {
    const kept = [];
    rows.forEach((row) => {
      const trial = { ...payload, [key]: kept.concat([row]) };
      if (fits(trial)) kept.push(row);
    });
    if (kept.length) payload[key] = kept;
  };
  pack("requests", requestRows);
  pack("plays", playRows);
  if (books.length && fits({ ...payload, lastBooks: books })) payload.lastBooks = books;
  return publish("Balances updated", payload);
}

function publishActivity() {
  const requestRows = requests.filter((item) => item.op !== "interest").slice(0, 16).map((item) => {
    const row = {
      id: item.id,
      accountId: item.accountId,
      name: item.name,
      op: item.op,
      amount: item.amount,
      status: item.status,
      applied: item.applied || "",
      ts: item.ts,
    };
    if (item.toId) row.toId = item.toId;
    if (item.toName) row.toName = item.toName;
    if (item.memo) row.memo = String(item.memo).slice(0, 40);
    return row;
  });
  const playRows = plays.slice(0, 16).map((item) => ({
    id: item.id,
    accountId: item.accountId,
    name: item.name,
    amount: item.amount,
    cashOut: item.cashOut || "",
    tax: item.tax || "0",
    status: item.status,
    ts: item.ts,
  }));
  const interestRows = requests.filter((item) => item.op === "interest").slice(0, 12).map((item) => ({
    id: item.id,
    accountId: item.accountId,
    name: item.name,
    op: "interest",
    amount: item.amount,
    status: "done",
    applied: item.applied || item.amount,
    toId: item.toId || "",
    toName: item.toName || "",
    ts: item.ts,
  }));
  const body = { v: 1, kind: "activity", requests: requestRows, plays: playRows, interest: interestRows, ts: Date.now() };
  while (encode("Activity", body).length > 3900 && (body.requests.length || body.plays.length || body.interest.length)) {
    const longest = body.requests.length >= body.plays.length && body.requests.length >= body.interest.length
      ? body.requests
      : body.plays.length >= body.interest.length ? body.plays : body.interest;
    longest.pop();
  }
  if (!body.requests.length && !body.plays.length && !body.interest.length) return;
  publish("Activity", body).catch(() => {});
}

function publishPlay(play) {
  return publish(play.status === "chips" ? "Chips disbursed" : "Cash out saved", {
    v: 1,
    kind: "play",
    id: play.id,
    accountId: play.accountId,
    name: play.name,
    amount: play.amount,
    cashOut: play.cashOut || "",
    tax: play.tax || "0",
    status: play.status,
    ts: Date.now(),
  }).catch(() => {});
}

function publishReject(id, reason) {
  return publish("Request refused", { v: 1, kind: "reject", id, reason, ts: Date.now() }).catch(() => {});
}

function setStatus(text) {
  const node = $("link-status");
  if (node) node.textContent = text;
}

function linkStamp(ts) {
  if (!ts) return "—";
  return `${sessionDateLong(ts)}, ${sessionClockTime(ts)}`;
}

function paintLink() {
  const now = Date.now();
  const on = streamOpen && !linkBroken && lastSend > 0 && now - lastSend < 50000 && lastHear > 0 && now - lastHear < 50000;
  if (on && !connectedSince) connectedSince = now;
  if (!on) connectedSince = 0;
  const mark = $("link-mark");
  if (mark) {
    mark.classList.toggle("is-on", on);
    mark.setAttribute("aria-label", on ? "Connected" : "Not connected");
  }
  const words = $("link-words");
  if (words) words.textContent = on ? "Connected" : "Not connected";
  const ledger = $("link-ledger");
  if (ledger) ledger.textContent = `Ledger sent: ${linkStamp(lastAnnounce)}`;
  const held = $("link-for");
  if (held) held.textContent = on && connectedSince ? `Connected for: ${sessionSpanText(now - connectedSince)}` : "Connected for: —";
  const heard = $("link-heard");
  if (heard) heard.textContent = `Last message: ${linkStamp(lastHear)}`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const balances = $("balances");
  if (document.body.classList.contains("gov-theme")) meta.content = "#3a3a3a";
  else if (balances && balances.classList.contains("is-over") && balances.classList.contains("is-active")) meta.content = "#c0392b";
  else meta.content = "#1f4d76";
}

function publishPong(id) {
  return publish("Still here", { v: 1, kind: "pong", id: id || uid(), ts: Date.now() }).catch(() => {});
}

let pingCtx = null;
let bannerTimer = 0;

function playPing() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const dot = $("ping-dot");
  if (dot) {
    dot.classList.remove("is-on");
    void dot.offsetWidth;
    dot.classList.add("is-on");
  }
  if (!Ctx) return;
  if (!pingCtx) pingCtx = new Ctx();
  const ctx = pingCtx;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

function toast() {
  playPing();
}

function showBanner(text, dest) {
  const node = $("incoming");
  node.textContent = text;
  node.dataset.goto = dest || "";
  node.setAttribute("aria-hidden", "false");
  node.classList.add("is-down");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    node.classList.remove("is-down");
    node.setAttribute("aria-hidden", "true");
  }, 1000);
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

function trashMarkup() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function eyeMarkup() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function penMarkup() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 20l4.5-1.2L19 8.3 15.7 5 5.2 15.5 4 20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.8 6.8l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
}

function signMarkup() {
  return `<img class="sign-mark" src="sign-pen.png" alt="" />`;
}

function cleanSign(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((stroke) => {
    if (!Array.isArray(stroke)) return [];
    return stroke.slice(0, 80).map((point) => Math.max(0, Math.min(9999, Math.round(Number(point)) || 0)));
  }).filter((stroke) => stroke.length >= 2);
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

function loadUsual() {
  try {
    const data = JSON.parse(localStorage.getItem(USUAL) || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return data;
  } catch {
    return {};
  }
}

let usual = loadUsual();

function saveUsual() {
  localStorage.setItem(USUAL, JSON.stringify(usual));
}

function strokePoints(stroke) {
  const points = [];
  for (let i = 0; i + 1 < stroke.length; i += 2) points.push([stroke[i], stroke[i + 1]]);
  return points;
}

function resamplePoints(points, count) {
  if (!points.length) return [];
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = lengths[lengths.length - 1];
  if (total === 0) return Array.from({ length: count }, () => [points[0][0], points[0][1]]);
  const out = [];
  let seg = 1;
  for (let i = 0; i < count; i += 1) {
    const dist = (total * i) / (count - 1);
    while (seg < lengths.length - 1 && lengths[seg] < dist) seg += 1;
    const span = lengths[seg] - lengths[seg - 1] || 1;
    const t = (dist - lengths[seg - 1]) / span;
    const a = points[seg - 1];
    const b = points[seg];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function normalizeSign(strokes) {
  const clean = cleanSign(strokes).map(strokePoints).filter((points) => points.length >= 2);
  if (!clean.length) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  clean.forEach((points) => points.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }));
  const span = Math.max(1, maxX - minX, maxY - minY);
  const scale = 8000 / span;
  const offsetX = (9999 - (maxX - minX) * scale) / 2;
  const offsetY = (9999 - (maxY - minY) * scale) / 2;
  return clean.slice(0, 8).map((points) => resamplePoints(points, 16).map(([x, y]) => [
    Math.max(0, Math.min(9999, Math.round((x - minX) * scale + offsetX))),
    Math.max(0, Math.min(9999, Math.round((y - minY) * scale + offsetY))),
  ]).flat());
}

function averageSign(samples) {
  if (!samples.length) return [];
  const tally = new Map();
  samples.forEach((sample) => tally.set(sample.length, (tally.get(sample.length) || 0) + 1));
  let mode = samples[0].length;
  let best = 0;
  tally.forEach((count, size) => {
    if (count > best) {
      best = count;
      mode = size;
    }
  });
  const pool = samples.filter((sample) => sample.length === mode);
  const out = [];
  for (let i = 0; i < mode; i += 1) {
    const strokes = pool.map((sample) => resamplePoints(strokePoints(sample[i] || []), 16));
    const avg = [];
    for (let p = 0; p < 16; p += 1) {
      let x = 0;
      let y = 0;
      let n = 0;
      strokes.forEach((points) => {
        if (!points[p]) return;
        x += points[p][0];
        y += points[p][1];
        n += 1;
      });
      if (!n) continue;
      avg.push(Math.round(x / n), Math.round(y / n));
    }
    if (avg.length >= 4) out.push(avg);
  }
  return out;
}

function noteSign(accountId, id, sign, quiet) {
  const strokes = normalizeSign(sign);
  if (!accountId || !id || !strokes.length) return false;
  if (!usual[accountId] || typeof usual[accountId] !== "object") usual[accountId] = { ids: [], samples: [] };
  const bag = usual[accountId];
  if (!Array.isArray(bag.ids)) bag.ids = [];
  if (!Array.isArray(bag.samples)) bag.samples = [];
  if (bag.ids.includes(id)) return false;
  bag.ids.push(id);
  bag.samples.push(strokes);
  if (bag.samples.length > 24) bag.samples.splice(0, bag.samples.length - 24);
  if (bag.ids.length > 80) bag.ids.splice(0, bag.ids.length - 80);
  if (!quiet) saveUsual();
  return true;
}

function absorbStoredSigns() {
  let changed = false;
  requests.forEach((item) => {
    if (noteSign(item.accountId, item.id, item.sign, true)) changed = true;
  });
  taxes.forEach((item) => {
    if (noteSign(item.accountId, item.id, item.sign, true)) changed = true;
  });
  if (changed) saveUsual();
}

function usualSign(accountId) {
  const bag = usual[accountId];
  if (!bag || !Array.isArray(bag.samples) || !bag.samples.length) return [];
  return averageSign(bag.samples);
}

function isTransfer(item) {
  return item.op === "send" || item.op === "transfer";
}

function exchangeMemo(item) {
  const saved = String(item.memo || "").trim();
  if (saved === "Chips") return "Casino cash in";
  if (saved === "Cash out") return "Casino cash out";
  if (saved) return saved.slice(0, 40);
  if (item.op === "interest") return "Interest payment";
  if (String(item.id || "").endsWith("-pay")) return "Income tax invoice";
  if (item.note) return "Asset purchase";
  if (item.op === "withdraw") return "Withdrawal";
  if (item.op === "deposit") return "Deposit";
  if (isTransfer(item)) return "Transfer";
  return "Exchange";
}

const closedDays = new Set();
const interestSplit = new Set();

function dayKey(ts) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(ts) {
  const date = new Date(ts);
  const now = new Date();
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return "Today";
  const day = date.getDate();
  const teen = day % 100;
  const suffix = teen >= 11 && teen <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] || "th";
  const month = date.toLocaleString(undefined, { month: "short" });
  return `${day}${suffix} ${month}`;
}

function exchangeCard(item) {
  const swipe = document.createElement("li");
  swipe.className = item.op === "interest" ? "swipe log-swipe is-interest" : "swipe log-swipe";
  const actions = document.createElement("div");
  actions.className = "swipe-actions one";
  const trash = document.createElement("button");
  trash.type = "button";
  trash.className = "swipe-trash";
  trash.setAttribute("aria-label", "Delete log");
  trash.innerHTML = trashMarkup();
  trash.addEventListener("click", () => deleteLog(item.id));
  actions.append(trash);
  const signBtn = document.createElement("button");
  signBtn.type = "button";
  signBtn.className = "swipe-sign";
  signBtn.innerHTML = signMarkup();
  if (cleanSign(item.sign).length) {
    signBtn.setAttribute("aria-label", "Show signature");
    signBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      showSignature(item);
    });
  } else {
    signBtn.classList.add("is-empty");
    signBtn.disabled = true;
    signBtn.setAttribute("aria-label", "No signature");
  }
  const row = document.createElement("div");
  row.className = "log-row";
  const time = document.createElement("time");
  time.dateTime = new Date(item.ts).toISOString();
  time.textContent = formatWhen(item.ts);
  const line = document.createElement("span");
  const alleged = formatAmount(item.amount);
  const actual = item.applied ? formatAmount(item.applied) : "";
  if (item.op === "interest") {
    line.textContent = `${item.name} paid ${alleged} ₲ interest to ${item.toName || "an account"}`;
  } else if (item.note) {
    line.textContent = `${item.name} bought ${item.note} for ${alleged} ₲`;
  } else if (isTransfer(item)) {
    line.textContent = `${item.name} transferred ${alleged} ₲ to ${item.toName || "another account"}`;
  } else {
    const verb = item.op === "withdraw" ? "Withdrawal" : "Deposit";
    line.textContent = actual && actual !== alleged
      ? `${item.name} · ${verb} · ${alleged} ₲ · received ${actual} ₲`
      : `${item.name} · ${verb} · ${alleged} ₲`;
  }
  const memo = document.createElement("span");
  memo.className = "log-memo";
  memo.textContent = exchangeMemo(item);
  row.append(time, line, memo);
  if (item.status === "denied") {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "Denied";
    row.append(tag);
  }
  if (showExchangeTrash) row.classList.add("is-trash");
  const signed = cleanSign(item.sign).length > 0;
  if (signed) swipe.append(actions, signBtn, row);
  else swipe.append(actions, row);
  if (signed) bindReveal(row, 0, 56);
  return swipe;
}

function bindStackHold(stack, key) {
  let timer = 0;
  let x = 0;
  let y = 0;
  stack.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    x = event.clientX;
    y = event.clientY;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      if (interestSplit.has(key)) interestSplit.delete(key);
      else interestSplit.add(key);
      renderActivity();
    }, 450);
  });
  stack.addEventListener("pointermove", (event) => {
    if (!timer) return;
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    if (dx * dx + dy * dy > 144) {
      clearTimeout(timer);
      timer = 0;
    }
  });
  const stop = () => {
    clearTimeout(timer);
    timer = 0;
  };
  stack.addEventListener("pointerup", stop);
  stack.addEventListener("pointercancel", stop);
}

function interestStack(items) {
  const stack = document.createElement("li");
  stack.className = "interest-stack";
  const key = items.map((item) => item.id).join(":");
  if (interestSplit.has(key)) stack.classList.add("is-split");
  const shown = interestSplit.has(key) ? items : items.slice(0, 3);
  shown.forEach((item) => stack.append(exchangeCard(item)));
  bindStackHold(stack, key);
  return stack;
}

function appendDayItems(body, items) {
  let burst = [];
  const flush = () => {
    if (!burst.length) return;
    if (burst.length === 1) body.append(exchangeCard(burst[0]));
    else body.append(interestStack(burst));
    burst = [];
  };
  items.forEach((item) => {
    if (item.op === "interest") {
      const prev = burst[burst.length - 1];
      if (prev && Math.abs(Number(prev.ts) - Number(item.ts)) > 15000) flush();
      burst.push(item);
    } else {
      flush();
      body.append(exchangeCard(item));
    }
  });
  flush();
}

const exchangeFilter = { time: "all", type: "all", account: "", min: "", max: "" };

function passesExchangeFilter(item) {
  if (exchangeFilter.time !== "all") {
    const age = Date.now() - Number(item.ts || 0);
    const day = 24 * 60 * 60 * 1000;
    if (exchangeFilter.time === "today" && dayKey(item.ts) !== dayKey(Date.now())) return false;
    if (exchangeFilter.time === "week" && age > 7 * day) return false;
    if (exchangeFilter.time === "month" && age > 30 * day) return false;
  }
  if (exchangeFilter.type === "interest" && item.op !== "interest") return false;
  if (exchangeFilter.type === "transfer" && !isTransfer(item)) return false;
  if (exchangeFilter.type === "deposit" && item.op !== "deposit") return false;
  if (exchangeFilter.type === "withdraw" && item.op !== "withdraw") return false;
  if (exchangeFilter.account && item.accountId !== exchangeFilter.account && item.toId !== exchangeFilter.account) return false;
  const amount = BigInt(item.applied || item.amount || "0");
  if (exchangeFilter.min && amount < BigInt(exchangeFilter.min)) return false;
  if (exchangeFilter.max && amount > BigInt(exchangeFilter.max)) return false;
  return true;
}

function renderActivity() {
  const list = $("activity");
  list.replaceChildren();
  const done = requests.filter((item) => item.status && item.status !== "pending" && passesExchangeFilter(item));
  const groups = [];
  done.forEach((item) => {
    const key = dayKey(item.ts);
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      group = { key, ts: item.ts, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  });
  groups.forEach((group) => {
    const body = document.createElement("ul");
    body.className = "day-body";
    appendDayItems(body, group.items);
    const fold = document.createElement("div");
    fold.className = "day-fold";
    fold.append(body);
    const block = document.createElement("li");
    block.className = "day-group";
    if (closedDays.has(group.key)) block.classList.add("is-shut");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "day-head";
    const label = document.createElement("span");
    label.textContent = dayLabel(group.ts);
    toggle.append(label);
    toggle.insertAdjacentHTML("beforeend", `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    toggle.addEventListener("click", () => {
      block.classList.toggle("is-shut");
      if (block.classList.contains("is-shut")) closedDays.add(group.key);
      else closedDays.delete(group.key);
    });
    block.append(toggle, fold);
    list.append(block);
  });
  const empty = $("activity-empty");
  empty.textContent = "Reviewed exchanges and transfers show up here.";
  empty.hidden = done.length > 0;
}

function bindReveal(row, openRight, openLeft) {
  const right = openRight || 0;
  const left = openLeft || 0;
  let startX = 0;
  let startY = 0;
  let active = false;
  let origin = 0;
  const place = () => {
    if (row.classList.contains("is-open")) return right;
    if (row.classList.contains("is-sign")) return -left;
    return 0;
  };
  row.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest("button, input")) return;
    startX = event.clientX;
    startY = event.clientY;
    origin = place();
    active = true;
  });
  row.addEventListener("pointermove", (event) => {
    if (!active) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
    const next = Math.max(-left, Math.min(right, origin + dx));
    row.style.transform = `translateX(${next}px)`;
  });
  const finish = (event) => {
    if (!active) return;
    active = false;
    const end = origin + (event.clientX - startX);
    row.style.transform = "";
    if (origin > 0) {
      row.classList.toggle("is-open", end > right * 0.45);
      row.classList.remove("is-sign");
      return;
    }
    if (origin < 0) {
      row.classList.toggle("is-sign", end < -left * 0.45);
      row.classList.remove("is-open");
      return;
    }
    row.classList.toggle("is-open", right > 0 && end > right * 0.45);
    row.classList.toggle("is-sign", left > 0 && end < -left * 0.45);
  };
  row.addEventListener("pointerup", finish);
  row.addEventListener("pointercancel", () => {
    active = false;
    row.style.transform = "";
  });
}

let balanceEdit = false;
let showAccountTrash = false;
let showExchangeTrash = false;

function setBalanceHead() {
  const head = $("bal-head");
  if (!head) return;
  head.textContent = balanceEdit ? "Editing balance" : "Current Balance (₲)";
}

function writeQuietBalance(account, input) {
  const amount = moneyText(input.value, false);
  if (amount == null) {
    input.value = formatFull(account.bal);
    return;
  }
  account.bal = amount;
  input.value = formatFull(amount);
  saveAccounts();
  publishLedger([]).catch(() => {});
  const full = input.parentElement && input.parentElement.querySelector(".bal-full");
  if (full) full.textContent = `${formatFull(amount)} GZBT`;
  paintBankTotal();
}

function paintBankTotal() {
  const sum = $("bank-sum");
  const total = state.accounts.reduce((running, account) => running + BigInt(account.bal || "0"), 0n);
  if (sum) sum.textContent = `${formatLoose(total)} ₲`;
  const limit = BigInt(state.settings.bankLimit || DEFAULT_BANK_LIMIT);
  const page = $("balances");
  if (page) page.classList.toggle("is-over", total > limit);
}

function renderRows() {
  if (balanceEdit && document.activeElement && document.activeElement.classList.contains("bal-edit")) return;
  const body = $("rows");
  body.replaceChildren();
  const ranked = state.accounts.slice().sort((a, b) => {
    const left = BigInt(b.bal);
    const right = BigInt(a.bal);
    if (left > right) return 1;
    if (left < right) return -1;
    return a.name.localeCompare(b.name);
  });
  ranked.forEach((account) => {
    const line = document.createElement("div");
    line.className = "acct-line";
    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "acct-trash";
    trash.hidden = !showAccountTrash;
    trash.setAttribute("aria-label", `Delete ${account.name}`);
    trash.innerHTML = trashMarkup();
    let taps = 0;
    let tapTimer = 0;
    trash.addEventListener("click", (event) => {
      event.stopPropagation();
      taps += 1;
      clearTimeout(tapTimer);
      if (taps >= 2) {
        taps = 0;
        deleteAccount(account.id);
        return;
      }
      tapTimer = window.setTimeout(() => {
        taps = 0;
      }, 450);
    });
    const row = document.createElement("div");
    row.className = "acct";
    const name = document.createElement("span");
    name.className = "acct-name";
    name.textContent = account.name;
    const type = document.createElement("span");
    type.className = "acct-type";
    type.textContent = account.type;
    const short = document.createElement(balanceEdit ? "input" : "span");
    short.className = balanceEdit ? "bal-short bal-edit" : "bal-short";
    short.dataset.pw = account.pw || "";
    if (balanceEdit) {
      short.inputMode = "numeric";
      short.autocomplete = "off";
      short.setAttribute("aria-label", `Balance for ${account.name}`);
      short.value = formatFull(account.bal);
      short.addEventListener("input", () => placeGroupedCaret(short));
      short.addEventListener("change", () => writeQuietBalance(account, short));
    } else short.textContent = `${formatAmount(account.bal)} ₲`;
    const full = document.createElement("span");
    full.className = "bal-full";
    full.textContent = `${formatFull(account.bal)} GZBT`;
    row.append(name, type, short, full);
    bindNameHold(name);
    bindPasswordHold(row);
    line.append(trash, row);
    body.append(line);
  });
  $("empty").hidden = state.accounts.length > 0;
  paintBankTotal();
}

function showBalancePasswords() {
  if (balanceEdit) return;
  document.body.classList.add("show-passwords");
  const head = $("bal-head");
  if (head) head.textContent = "Password";
  document.querySelectorAll(".acct").forEach((row) => {
    const short = row.querySelector(".bal-short");
    const full = row.querySelector(".bal-full");
    if (!short || !full) return;
    if (!short.dataset.bal) short.dataset.bal = short.textContent;
    short.textContent = short.dataset.pw || "Not saved";
    full.hidden = true;
  });
}

function hideBalancePasswords() {
  document.body.classList.remove("show-passwords");
  if (balanceEdit) {
    setBalanceHead();
    return;
  }
  const head = $("bal-head");
  if (head) head.textContent = "Current Balance (₲)";
  document.querySelectorAll(".acct").forEach((row) => {
    const short = row.querySelector(".bal-short");
    const full = row.querySelector(".bal-full");
    if (!short || !full) return;
    if (short.dataset.bal) short.textContent = short.dataset.bal;
    full.hidden = false;
  });
}

function bindPasswordHold(row) {
  let timer = 0;
  let startX = 0;
  let startY = 0;
  const stop = () => {
    clearTimeout(timer);
    timer = 0;
    hideBalancePasswords();
  };
  row.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".acct-name, .acct-trash")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      showBalancePasswords();
    }, 400);
  });
  row.addEventListener("pointermove", (event) => {
    if (!timer) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (dx * dx + dy * dy > 100) {
      clearTimeout(timer);
      timer = 0;
    }
  });
  row.addEventListener("pointerup", stop);
  row.addEventListener("pointercancel", stop);
  row.addEventListener("contextmenu", (event) => event.preventDefault());
}

function bindNameHold(name) {
  let timer = 0;
  const stop = () => {
    clearTimeout(timer);
    timer = 0;
  };
  name.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    stop();
    timer = window.setTimeout(() => {
      timer = 0;
      showAccountTrash = true;
      renderRows();
    }, 450);
  });
  name.addEventListener("pointermove", stop);
  name.addEventListener("pointerup", stop);
  name.addEventListener("pointercancel", stop);
  name.addEventListener("contextmenu", (event) => event.preventDefault());
}

function renderAccounts() {
  const select = $("move-account");
  if (!select) return;
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

function loadSession() {
  try {
    const data = JSON.parse(localStorage.getItem(SESSION) || "null");
    if (!data || !Number.isFinite(data.started) || !Array.isArray(data.opening)) return null;
    return {
      id: String(data.id || uid()),
      started: data.started,
      opening: data.opening,
      present: cleanIdList(data.present, 40),
      absent: cleanIdList(data.absent, 40),
      reasons: cleanReasons(data.reasons),
    };
  } catch {
    return null;
  }
}

function loadInterest() {
  try {
    const data = JSON.parse(localStorage.getItem(INTEREST) || "");
    return interestRecord(data);
  } catch {
    return freshInterest();
  }
}

function freshInterest() {
  return { joined: false, left: INTEREST_MS, mark: 0 };
}

function interestRecord(data) {
  const left = Number(data?.left);
  return {
    joined: Boolean(data?.joined),
    left: Number.isFinite(left) && left > 0 ? Math.min(left, INTEREST_MS) : INTEREST_MS,
    mark: Number(data?.mark) || 0,
  };
}

function saveSessions() {
  localStorage.setItem(SESSIONS, JSON.stringify(sessions.slice(0, 40)));
}

function saveSession() {
  if (!sessionLive) localStorage.removeItem(SESSION);
  else localStorage.setItem(SESSION, JSON.stringify(sessionLive));
}

function saveInterest() {
  localStorage.setItem(INTEREST, JSON.stringify(interest));
}

function snapshotBooks() {
  return state.accounts.map((account) => ({ id: account.id, name: account.name, bal: account.bal }));
}

function formatMinutes(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatHours(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function interestGain(bal) {
  const amount = BigInt(bal || "0");
  let gain = floorBillion(amount * 5n / 10000n);
  if (gain <= 0n) return "0";
  const room = MAX - amount;
  if (room <= 0n) return "0";
  if (gain > room) gain = floorBillion(room);
  return gain > 0n ? gain.toString() : "0";
}

let interestWarn = 0;

function applyInterest() {
  const source = state.accounts.find((account) => account.id === state.settings.interestAccountId);
  if (!source) return "missing";
  const skip = new Set(state.settings.skipInterest || []);
  const payouts = [];
  state.accounts.forEach((account) => {
    if (account.id === source.id || skip.has(account.id)) return;
    const gain = interestGain(account.bal);
    if (gain === "0") return;
    payouts.push({ account, give: BigInt(gain) });
  });
  if (!payouts.length) return "none";
  const total = payouts.reduce((sum, row) => sum + row.give, 0n);
  if (BigInt(source.bal) < total) return "short";
  source.bal = (BigInt(source.bal) - total).toString();
  const stamp = Date.now();
  payouts.forEach((row, index) => {
    row.account.bal = (BigInt(row.account.bal) + row.give).toString();
    requests.unshift({
      id: uid(),
      accountId: source.id,
      name: source.name,
      op: "interest",
      amount: row.give.toString(),
      status: "done",
      applied: row.give.toString(),
      toId: row.account.id,
      toName: row.account.name,
      ts: stamp - index,
    });
  });
  requests.splice(80);
  return "paid";
}

function settleInterest() {
  const result = applyInterest();
  if (result === "paid") {
    saveAccounts();
    saveRequests();
    render();
    publishLedger([]).catch(() => setStatus("Interest saved on this phone. The terminal will catch up when the connection is back."));
    publishActivity();
  }
  return result;
}

function catchInterest() {
  return;
  if (!interest.joined || !sessionLive) {
    if (interest.mark) {
      interest.mark = 0;
      saveInterest();
    }
    return;
  }
  const now = Date.now();
  if (!interest.mark) {
    interest.mark = now;
    saveInterest();
    return;
  }
  let spent = now - interest.mark;
  if (spent < 0) spent = 0;
  interest.mark = now;
  let hold = false;
  while (spent >= interest.left) {
    const result = settleInterest();
    if (result !== "paid" && result !== "none") {
      hold = true;
      interest.left = 60000;
      if (Date.now() - interestWarn > 20000) {
        interestWarn = Date.now();
        toast(result === "missing"
          ? "Choose the account that pays interest in Settings."
          : "The interest account does not have enough gizbits.");
      }
      break;
    }
    spent -= interest.left;
    interest.left = INTEREST_MS;
    billLoans();
  }
  if (!hold && spent < interest.left) interest.left -= spent;
  saveInterest();
}

function paintSessionClock() {
  const clock = $("session-clock");
  if (clock) clock.hidden = true;
  if (!sessionLive) return;
  const text = sessionDurationText({ ...sessionLive, live: true });
  document.querySelectorAll("[data-live-dur]").forEach((node) => {
    node.textContent = text;
  });
  if (viewingSession === sessionLive.id && $("session-view").classList.contains("is-open")) {
    const node = $("session-duration");
    if (node) node.textContent = text;
  }
}

function sessionById(id) {
  if (sessionLive && sessionLive.id === id) return { ...sessionLive, live: true };
  const item = sessions.find((row) => row.id === id);
  return item ? { ...item, live: false } : null;
}

function sessionWhen(item) {
  if (item.live || !item.ended) return `${formatWhen(item.started)} · Active`;
  return `${formatWhen(item.started)} – ${formatWhen(item.ended)}`;
}

function personName(id, record) {
  const account = state.accounts.find((item) => item.id === id);
  if (account) return account.name;
  const books = [...(record.opening || []), ...(record.closing || [])];
  const book = books.find((row) => row && row.id === id);
  return book ? book.name : "";
}

function looseBig(value) {
  const text = String(value ?? "0").replace(/[,\s]/g, "");
  if (!/^\d+$/.test(text)) return 0n;
  return BigInt(text);
}

function bookRows(record) {
  const opening = record.opening || [];
  const closing = record.live ? snapshotBooks() : (record.closing || []);
  const seen = new Set();
  const rows = [];
  [...opening, ...closing].forEach((row) => {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    const open = opening.find((book) => book.id === row.id);
    const close = closing.find((book) => book.id === row.id);
    const before = looseBig(open ? open.bal : "0");
    const after = looseBig(close ? close.bal : "0");
    rows.push({ name: (close || open).name, before, after, diff: after - before });
  });
  rows.sort((a, b) => {
    if (a.after > b.after) return -1;
    if (a.after < b.after) return 1;
    return String(a.name).localeCompare(String(b.name));
  });
  return rows;
}

function sessionExchanges(record) {
  const end = record.live ? Date.now() : Number(record.ended) || record.started;
  return requests.filter((item) => item.status && item.status !== "pending" && item.ts >= record.started && item.ts <= end);
}

function setSide(id, on) {
  const node = $(id);
  if (!node) return;
  node.classList.toggle("is-open", on);
  node.setAttribute("aria-hidden", on ? "false" : "true");
}

function closeArchives() {
  ["tax-archive", "tax-split", "earnings", "assets-archive", "gaming-archive", "loans-page", "contracts-page"].forEach((id) => setSide(id, false));
}

function closeSessionSides() {
  viewingSession = "";
  attendEdit = false;
  ["session-attend", "session-view", "session-books", "session-roster"].forEach((id) => setSide(id, false));
}

function sessionChrono() {
  const past = sessions.slice().reverse();
  return sessionLive ? [...past, { ...sessionLive, live: true }] : past;
}

function sessionNumber(id) {
  const index = sessionChrono().findIndex((item) => item.id === id);
  return index < 0 ? 1 : index + 1;
}

function currentSessionLabel() {
  const all = sessionChrono();
  if (!all.length) return "1";
  return String(sessionNumber(all[all.length - 1].id));
}

function sessionDate(ts) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(ts);
}

function sessionDateLong(ts) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(ts);
}

function sessionClockTime(ts) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(ts);
}

function sessionStartedLine(ts) {
  return `${sessionDate(ts)}, ${sessionClockTime(ts)}`;
}

function sessionSpanText(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return minutes === 1 ? "1 min" : `${minutes} mins`;
  if (mins === 0) return hours === 1 ? "1 h" : `${hours} h`;
  return `${hours} h ${mins} min`;
}

function sessionDurationText(record) {
  const end = record.live ? Date.now() : Number(record.ended) || record.started;
  return sessionSpanText(end - record.started);
}

function lastSessionBooks() {
  const record = sessions[0];
  if (!record || !Array.isArray(record.closing)) return [];
  return record.closing.slice(0, 40).map((row) => ({
    id: row.id,
    bal: String(row.bal || "0"),
  }));
}

function pieMarkup() {
  return `<span class="pie-box" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#e7eef5"/><path d="M32 32 L32 8 A24 24 0 0 1 52.8 44 Z" fill="#1f4d76"/><circle cx="32" cy="32" r="24" fill="none" stroke="#1f4d76" stroke-width="3"/></svg></span>`;
}

function squareButton(kind, pressed, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `sq ${kind}`;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
  button.addEventListener("click", onClick);
  return button;
}

function skippedAttendance(id) {
  return (state.settings.skipAttend || []).includes(id);
}

function moneyOf(id, record) {
  const account = state.accounts.find((item) => item.id === id);
  if (account) return BigInt(account.bal || "0");
  const books = (record && (record.closing || record.opening)) || [];
  const row = books.find((item) => item.id === id);
  return BigInt((row && row.bal) || "0");
}

function richestIds(ids, record) {
  return ids.slice().sort((a, b) => {
    const left = moneyOf(b, record);
    const right = moneyOf(a, record);
    if (left > right) return 1;
    if (left < right) return -1;
    return personName(a, record).localeCompare(personName(b, record));
  });
}

function sessionLength(record) {
  const end = record.live ? Date.now() : Number(record.ended) || record.started;
  return `Length ${formatMinutes(end - record.started)}`;
}

function clockMarkup(live) {
  if (live) return `<img class="session-clock-icon session-live-clock" src="session-live.png" alt="" />`;
  return `<svg class="session-clock-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}

let menuSessionId = "";

function sessionListing(item) {
  const card = document.createElement("li");
  card.className = "session-card";
  const main = document.createElement("button");
  main.type = "button";
  main.className = "session-main";
  main.insertAdjacentHTML("beforeend", `<span class="session-icon">${clockMarkup(item.live)}</span>`);
  const copy = document.createElement("span");
  copy.className = "session-copy";
  const name = document.createElement("strong");
  name.textContent = `Session ${sessionNumber(item.id)}`;
  const when = document.createElement("span");
  when.className = "session-when-line";
  when.textContent = sessionStartedLine(item.started);
  const dur = document.createElement("span");
  dur.className = "session-dur";
  const length = document.createElement("span");
  length.textContent = sessionDurationText(item);
  if (item.live) length.dataset.liveDur = "1";
  dur.append(length);
  copy.append(name, when, dur);
  main.append(copy);
  main.addEventListener("click", () => openSessionView(item.id));
  const more = document.createElement("button");
  more.type = "button";
  more.className = "session-more";
  more.setAttribute("aria-label", `Options for Session ${sessionNumber(item.id)}`);
  more.textContent = "•••";
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    openSessionMenu(item.id);
  });
  card.append(main, more);
  return card;
}

function openSessionMenu(id) {
  menuSessionId = id;
  const card = $("session-menu-card");
  if (card) card.style.transform = "";
  const edit = $("session-menu-edit");
  if (edit) edit.hidden = !(sessionLive && sessionLive.id === id);
  $("session-menu").hidden = false;
}

function closeSessionMenu() {
  const sheet = $("session-menu");
  if (sheet) sheet.hidden = true;
  const card = $("session-menu-card");
  if (card) card.style.transform = "";
}

function paintSessions() {
  const idle = $("session-idle");
  if (idle) idle.hidden = Boolean(sessionLive);
  const list = $("session-list");
  if (!list) return;
  list.replaceChildren();
  if (sessionLive) list.append(sessionListing({ ...sessionLive, live: true }));
  sessions.forEach((item) => list.append(sessionListing(item)));
  const total = $("session-total");
  const count = $("session-count");
  const all = sessionChrono();
  if (total) {
    const ms = all.reduce((sum, item) => {
      const end = item.live ? Date.now() : Number(item.ended) || item.started;
      return sum + Math.max(0, end - item.started);
    }, 0);
    total.textContent = all.length ? sessionSpanText(ms) : "";
  }
  if (count) count.textContent = all.length ? String(all.length) : "";
  paintSessionClock();
  paintOpenSession();
  if ($("session-attend").classList.contains("is-open")) renderAttendance();
}

function reasonField(value, onInput) {
  const reason = document.createElement("label");
  reason.className = "reason-line";
  const cap = document.createElement("span");
  cap.textContent = "Reason";
  const input = document.createElement("input");
  input.placeholder = "Optional";
  input.maxLength = 80;
  input.value = value || "";
  input.addEventListener("input", () => onInput(input.value.trim().slice(0, 80)));
  reason.append(cap, input);
  return reason;
}

function renderAttendance() {
  const box = $("attend-rows");
  const empty = $("attend-empty");
  const start = $("attend-start");
  if (!box) return;
  box.replaceChildren();
  const ranked = state.accounts.slice().sort((a, b) => {
    const left = BigInt(b.bal || "0");
    const right = BigInt(a.bal || "0");
    if (left > right) return 1;
    if (left < right) return -1;
    return a.name.localeCompare(b.name);
  });
  const asked = ranked.filter((account) => !skippedAttendance(account.id));
  asked.forEach((account) => {
    const row = document.createElement("div");
    row.className = "attend-row";
    const name = document.createElement("span");
    name.textContent = account.name;
    const absentOn = attendMarks.get(account.id) === "absent";
    const present = squareButton("present", !absentOn, `Present, ${account.name}`, () => setAttend(account.id, "present"));
    const absent = squareButton("absent", absentOn, `Absent, ${account.name}`, () => setAttend(account.id, "absent"));
    row.append(name, present, absent);
    if (absentOn) row.append(reasonField(attendReasons.get(account.id) || "", (text) => {
      if (text) attendReasons.set(account.id, text);
      else attendReasons.delete(account.id);
    }));
    box.append(row);
  });
  if (empty) {
    empty.hidden = asked.length > 0;
    empty.textContent = state.accounts.length
      ? "No accounts are asked to attend."
      : "No accounts yet. Add one before starting a session.";
  }
  if (start) start.disabled = asked.length === 0;
}

function setAttend(id, kind) {
  attendMarks.set(id, kind);
  renderAttendance();
}

function openAttendance() {
  if (sessionLive) {
    openSessionView(sessionLive.id);
    return;
  }
  attendMarks = new Map();
  attendReasons = new Map();
  state.accounts.forEach((account) => {
    if (skippedAttendance(account.id)) return;
    attendMarks.set(account.id, "present");
  });
  closeArchives();
  renderAttendance();
  setSide("session-books", false);
  setSide("session-view", false);
  setSide("session-attend", true);
}

function sessionSource(id) {
  if (sessionLive && sessionLive.id === id) return sessionLive;
  return sessions.find((row) => row.id === id) || null;
}

function attendanceIds(record) {
  const ids = [];
  const push = (id) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  (record.present || []).forEach(push);
  (record.absent || []).forEach(push);
  (record.opening || []).forEach((row) => push(row.id));
  (record.closing || []).forEach((row) => push(row.id));
  state.accounts.forEach((account) => push(account.id));
  return ids;
}

function setSessionMark(sessionId, accountId, kind) {
  if (!sessionLive || sessionLive.id !== sessionId) return;
  const record = sessionSource(sessionId);
  if (!record) return;
  if (!Array.isArray(record.present)) record.present = [];
  if (!Array.isArray(record.absent)) record.absent = [];
  record.present = record.present.filter((id) => id !== accountId);
  record.absent = record.absent.filter((id) => id !== accountId);
  if (kind === "present") record.present.push(accountId);
  if (kind === "absent") record.absent.push(accountId);
  if (kind !== "absent" && record.reasons) delete record.reasons[accountId];
  if (sessionLive && sessionLive.id === sessionId) saveSession();
  else saveSessions();
  const fresh = sessionById(sessionId);
  if (fresh) {
    fillSessionFacts(fresh);
    if ($("session-roster") && $("session-roster").classList.contains("is-open")) fillRoster(fresh, $("roster-title") && $("roster-title").textContent === "Accounts absent" ? "absent" : "present");
  }
}

function fillSessionFacts(record) {
  const date = $("session-date");
  if (!date) return;
  date.textContent = sessionDateLong(record.started);
  const number = $("session-no");
  if (number) number.textContent = String(sessionNumber(record.id));
  $("session-started").textContent = sessionClockTime(record.started);
  $("session-ended").textContent = record.live || !record.ended ? "-" : sessionClockTime(record.ended);
  $("session-duration").textContent = sessionDurationText(record);
  $("attended-count").textContent = String((record.present || []).length);
  $("absent-count").textContent = String((record.absent || []).length);
  fillExtremes(record);
  const pen = $("session-edit");
  if (!record.live) attendEdit = false;
  if (pen) {
    pen.hidden = !record.live;
    pen.classList.toggle("is-on", attendEdit);
  }
  const box = $("session-edit-box");
  if (box) box.hidden = !attendEdit;
  if (attendEdit) fillSessionEdit(record);
}

function fillSessionEdit(record) {
  const list = $("session-edit-rows");
  if (!list) return;
  list.replaceChildren();
  richestIds(attendanceIds(record), record).forEach((id) => {
    const name = personName(id, record);
    if (!name) return;
    const row = document.createElement("div");
    row.className = "attend-row";
    const label = document.createElement("span");
    label.textContent = name;
    const absentOn = (record.absent || []).includes(id);
    const present = squareButton("present", (record.present || []).includes(id), `Present, ${name}`, () => setSessionMark(record.id, id, "present"));
    const absent = squareButton("absent", absentOn, `Absent, ${name}`, () => setSessionMark(record.id, id, "absent"));
    row.append(label, present, absent);
    if (absentOn) {
      row.append(reasonField((record.reasons && record.reasons[id]) || "", (text) => {
        if (!record.reasons) record.reasons = {};
        if (text) record.reasons[id] = text;
        else delete record.reasons[id];
        if (sessionLive && sessionLive.id === record.id) saveSession();
        else saveSessions();
      }));
    }
    list.append(row);
  });
}

function rosterLine(id, record, kind) {
  const name = personName(id, record);
  if (!name) return null;
  const li = document.createElement("li");
  const mark = document.createElement("span");
  mark.className = `sq ${kind}`;
  mark.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "roster-text";
  const who = document.createElement("span");
  who.textContent = name;
  text.append(who);
  if (kind === "absent") {
    const reason = String((record.reasons && record.reasons[id]) || "").trim();
    if (reason) {
      const note = document.createElement("span");
      note.className = "roster-reason";
      note.textContent = reason;
      text.append(note);
    }
  }
  li.append(mark, text);
  return li;
}

function fillExtremes(record) {
  const node = $("session-extremes");
  if (!node) return;
  const rows = bookRows(record);
  const gainers = rows.filter((row) => row.diff > 0n);
  const losers = rows.filter((row) => row.diff < 0n);
  const lines = [];
  if (gainers.length) {
    const best = gainers.reduce((top, row) => row.diff > top.diff ? row : top);
    lines.push(`Biggest gainer ${best.name} · ${formatLoose(best.diff)} ₲`);
  }
  if (losers.length) {
    const worst = losers.reduce((top, row) => row.diff < top.diff ? row : top);
    lines.push(`Biggest loser ${worst.name} · ${formatLoose(-worst.diff)} ₲`);
  }
  node.textContent = lines.join("\n");
}

function fillRoster(record, kind) {
  const list = $("see-roster");
  const empty = $("see-roster-empty");
  const title = $("roster-title");
  if (!list || !empty) return;
  const present = kind !== "absent";
  if (title) title.textContent = present ? "Accounts present" : "Accounts absent";
  list.replaceChildren();
  const ids = richestIds(present ? (record.present || []) : (record.absent || []), record);
  ids.forEach((id) => {
    const line = rosterLine(id, record, present ? "present" : "absent");
    if (line) list.append(line);
  });
  empty.hidden = list.childElementCount > 0;
  empty.textContent = present ? "Nobody was marked present." : "Nobody was marked absent.";
}

function fillSessionBooks(id) {
  const record = sessionById(id);
  const box = $("session-book-rows");
  if (!record || !box) return;
  box.replaceChildren();
  const rows = bookRows(record);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No balances were recorded.";
    box.append(empty);
    return;
  }
  rows.forEach((row) => {
    const line = document.createElement("div");
    line.className = "acct";
    if (row.diff > 0n) line.classList.add("is-gain");
    else if (row.diff < 0n) line.classList.add("is-loss");
    const name = document.createElement("span");
    name.textContent = row.name;
    const type = document.createElement("span");
    type.className = "acct-type";
    const account = state.accounts.find((item) => item.name === row.name);
    type.textContent = account ? account.type : "";
    const short = document.createElement("span");
    short.className = "bal-short";
    if (row.diff === 0n) {
      short.textContent = "–";
      line.append(name, type, short);
    } else {
      const shown = row.diff > 0n ? row.diff : -row.diff;
      short.textContent = `${formatAmount(shown.toString())} ₲`;
      const full = document.createElement("span");
      full.className = "bal-full";
      full.textContent = `${formatFull(shown.toString())} GZBT`;
      line.append(name, type, short, full);
    }
    box.append(line);
  });
}

function fillSessionView(id) {
  const record = sessionById(id);
  if (!record) {
    closeSessionSides();
    return;
  }
  if (viewingSession !== id) attendEdit = false;
  viewingSession = id;
  $("session-view-title").textContent = `Session ${sessionNumber(id)}`;
  $("end-session").hidden = !record.live;
  fillSessionFacts(record);
  const list = $("session-exchanges");
  const empty = $("session-exchange-empty");
  const matches = sessionExchanges(record);
  list.replaceChildren();
  matches.forEach((item) => list.append(exchangeCard(item)));
  if (empty) empty.hidden = matches.length > 0;
  paintSessionClock();
}

function paintOpenSession() {
  const page = $("session-view");
  if (!page || !page.classList.contains("is-open") || !viewingSession) return;
  fillSessionView(viewingSession);
  if ($("session-books").classList.contains("is-open")) fillSessionBooks(viewingSession);
}

function openSessionView(id) {
  if (!sessionById(id)) return;
  closeArchives();
  setSide("session-attend", false);
  setSide("session-books", false);
  fillSessionView(id);
  setSide("session-view", true);
}

function openSessionBooks() {
  if (!viewingSession) return;
  fillSessionBooks(viewingSession);
  setSide("session-books", true);
}

function deleteSession(id) {
  if (sessionLive && sessionLive.id === id) {
    sessionLive = null;
    interest.mark = 0;
    saveSession();
    saveInterest();
    paintInterest();
  }
  const index = sessions.findIndex((item) => item.id === id);
  if (index >= 0) sessions.splice(index, 1);
  saveSessions();
  if (viewingSession === id) closeSessionSides();
  paintSessions();
}

function startSession() {
  const asked = state.accounts.filter((account) => !skippedAttendance(account.id));
  if (sessionLive || !asked.length) return;
  const present = [];
  const absent = [];
  asked.forEach((account) => {
    if (attendMarks.get(account.id) === "absent") absent.push(account.id);
    else present.push(account.id);
  });
  const reasons = {};
  attendReasons.forEach((text, id) => {
    if (absent.includes(id) && text) reasons[id] = text;
  });
  sessionLive = { id: uid(), started: Date.now(), opening: snapshotBooks(), present, absent, reasons };
  saveSession();
  if (interest.joined) {
    interest.mark = Date.now();
    saveInterest();
  }
  setSide("session-attend", false);
  paintSessions();
  paintInterest();
}

function endSession() {
  if (!sessionLive) return;
  const id = sessionLive.id;
  catchInterest();
  sessions.unshift({
    id,
    started: sessionLive.started,
    ended: Date.now(),
    opening: sessionLive.opening,
    closing: snapshotBooks(),
    present: sessionLive.present || [],
    absent: sessionLive.absent || [],
    reasons: cleanReasons(sessionLive.reasons),
  });
  sessions.splice(40);
  sessionLive = null;
  interest.mark = 0;
  saveSessions();
  saveSession();
  saveInterest();
  paintSessions();
  paintInterest();
  publishLedger([]).catch(() => {});
  if (viewingSession === id) openSessionView(id);
}

function paintInterest() {
  const fill = $("interest-fill");
  const clock = $("interest-clock");
  const note = $("interest-state");
  if (!fill || !clock || !note) return;
  const left = Math.max(0, interest.left);
  fill.style.width = `${(left / INTEREST_MS) * 100}%`;
  clock.textContent = formatHours(left);
  note.textContent = interest.joined && sessionLive ? "Counting down" : "Paused until a session is on";
}

function renderInterestRows() {
  const rows = $("interest-rows");
  if (!rows) return;
  const skip = new Set(state.settings.skipInterest || []);
  rows.replaceChildren();
  state.accounts.forEach((account) => {
    const row = document.createElement("div");
    row.className = "interest-row";
    const name = document.createElement("span");
    name.textContent = account.name;
    const due = document.createElement("span");
    if (skip.has(account.id)) due.textContent = "Skipped";
    else if (account.id === state.settings.interestAccountId) due.textContent = "Pays interest";
    else due.textContent = `${formatAmount(interestGain(account.bal))} ₲`;
    row.append(name, due);
    rows.append(row);
  });
  paintInterest();
}

function openInterest() {
  if (!interest.joined) {
    interest.joined = true;
    interest.left = INTEREST_MS;
    interest.mark = sessionLive ? Date.now() : 0;
    saveInterest();
  }
  const page = $("interest");
  page.classList.add("is-open");
  page.setAttribute("aria-hidden", "false");
  renderInterestRows();
}

function closeInterest() {
  const page = $("interest");
  page.classList.remove("is-open");
  page.setAttribute("aria-hidden", "true");
}

function payInterestNow() {
  const result = settleInterest();
  if (result === "paid" || result === "none") {
    interest.left = INTEREST_MS;
    interest.mark = sessionLive ? Date.now() : 0;
    saveInterest();
    renderInterestRows();
  }
  const notes = {
    paid: "Interest paid",
    none: "No interest was due",
    missing: "Choose the account that pays interest in Settings.",
    short: "The interest account does not have enough gizbits.",
  };
  toast(notes[result] || "Interest was not paid");
}

function saveAssets() {
  localStorage.setItem(LISTED, JSON.stringify(assets.slice(0, 40)));
}

function saveAssetBuys() {
  localStorage.setItem(ASSET_BUYS, JSON.stringify(assetBuys.slice(0, 40)));
}

function publishAssets() {
  return publish("Assets listed", {
    v: 1,
    kind: "assets",
    items: assets.map((item) => ({
      id: item.id,
      name: item.name,
      note: item.note,
      price: item.claimed ? (item.paid || item.price) : item.price,
      claimed: Boolean(item.claimed),
      owner: item.owner || "",
      paid: item.paid || "",
    })),
    ts: Date.now(),
  }).catch(() => {});
}

function readBillion(value) {
  const amount = parseAmount(value);
  if (amount == null) return "";
  const floored = floorBillion(amount);
  return floored > 0n ? floored.toString() : "";
}

function renderAssetList() {
  const list = $("asset-list");
  if (!list) return;
  list.replaceChildren();
  const empty = $("asset-empty");
  if (empty) empty.hidden = assets.length > 0;
  assets.forEach((item) => {
    const card = document.createElement("article");
    card.className = "asset-card";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const note = document.createElement("p");
    note.textContent = item.note || "";
    const price = document.createElement("p");
    if (item.claimed) {
      price.textContent = `Owned by ${item.owner || "someone"} · ${formatAmount(item.paid || item.price)} ₲`;
    } else {
      price.textContent = `${formatAmount(item.price)} ₲`;
    }
    card.append(name, note, price);
    list.append(card);
  });
}

function listAsset(event) {
  event.preventDefault();
  const error = $("asset-error");
  error.textContent = "";
  const name = $("asset-name").value.trim().slice(0, 40);
  const note = $("asset-note").value.trim().slice(0, 200);
  const price = readBillion($("asset-price").value);
  if (!name) {
    error.textContent = "Enter the asset name.";
    return;
  }
  if (!price) {
    error.textContent = "Enter at least 1 billion gizbits.";
    return;
  }
  assets.unshift({ id: uid(), name, note, price, ts: Date.now() });
  assets.splice(40);
  saveAssets();
  renderAssetList();
  publishAssets();
  $("asset-sheet").hidden = true;
  $("asset-form").reset();
  toast("Asset listed");
}

function takeAssetBuy(body) {
  if (!body || typeof body.id !== "string" || !remember(body.id)) return;
  const account = state.accounts.find((item) => item.id === body.accountId);
  const asset = assets.find((item) => item.id === body.assetId);
  if (!account || body.ph !== account.ph || !asset || asset.claimed) {
    publishReject(body.id, !account ? "That account was removed." : !asset ? "That asset is no longer listed." : asset && asset.claimed ? "That asset is already claimed." : "The password did not match.");
    return;
  }
  assetBuys.unshift({
    id: body.id,
    assetId: asset.id,
    assetName: asset.name,
    assetNote: asset.note,
    amount: asset.price,
    accountId: account.id,
    name: account.name,
    status: "pending",
    ts: Date.now(),
  });
  assetBuys.splice(40);
  saveAssetBuys();
  renderRequests();
  showIncoming(`${account.name} wants to own ${asset.name}. Tap to open it.`);
  if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(`Asset request from ${account.name}`, {
        body: asset.name,
        tag: body.id,
        renotify: true,
        data: { id: body.id },
      });
    }).catch(() => {});
  }
}

let assetBuyId = "";

function openAssetBuy(id) {
  const buy = assetBuys.find((item) => item.id === id && item.status === "pending");
  if (!buy) return;
  assetBuyId = id;
  $("asset-buy-title").textContent = buy.assetName;
  $("asset-buy-note").textContent = buy.assetNote || "";
  $("asset-buy-who").textContent = `${buy.name} wants to own this.`;
  $("asset-buy-amount").value = formatFull(buy.amount);
  $("asset-buy-error").textContent = "";
  $("asset-buy").hidden = false;
}

function closeAssetBuy() {
  assetBuyId = "";
  $("asset-buy").hidden = true;
}

function confirmAssetBuy() {
  const buy = assetBuys.find((item) => item.id === assetBuyId && item.status === "pending");
  const error = $("asset-buy-error");
  if (!buy) return;
  error.textContent = "";
  const amount = readBillion($("asset-buy-amount").value);
  if (!amount) {
    error.textContent = "Enter at least 1 billion gizbits.";
    return;
  }
  const buyer = state.accounts.find((item) => item.id === buy.accountId);
  const sink = state.accounts.find((item) => item.id === state.settings.taxAccountId);
  const asset = assets.find((item) => item.id === buy.assetId);
  if (!buyer) {
    error.textContent = "That account is no longer on this phone.";
    return;
  }
  if (!asset) {
    error.textContent = "That asset is no longer listed.";
    return;
  }
  if (!sink) {
    error.textContent = "Set the account that receives tax payments in Settings.";
    return;
  }
  if (sink.id === buyer.id) {
    error.textContent = "Choose a different account for tax payments.";
    return;
  }
  if (BigInt(buyer.bal) < BigInt(amount)) {
    error.textContent = "Not enough gizbits in that account.";
    return;
  }
  const nextSink = BigInt(sink.bal) + BigInt(amount);
  if (nextSink > MAX) {
    error.textContent = "That tax account cannot hold that much.";
    return;
  }
  buyer.bal = (BigInt(buyer.bal) - BigInt(amount)).toString();
  sink.bal = nextSink.toString();
  asset.claimed = true;
  asset.owner = buyer.name;
  asset.ownerId = buyer.id;
  asset.paid = amount;
  buy.status = "done";
  saveAccounts();
  saveAssets();
  saveAssetBuys();
  requests.unshift({
    id: buy.id,
    accountId: buyer.id,
    name: buyer.name,
    op: "transfer",
    amount,
    status: "done",
    applied: amount,
    toId: sink.id,
    toName: sink.name,
    note: asset.name,
    ts: Date.now(),
  });
  requests.splice(80);
  saveRequests();
  render();
  closeAssetBuy();
  clearNotification(buy.id);
  publishLedger([buy.id]).catch(() => setStatus("Saved on this phone. The terminal will catch up when the connection is back."));
  publishAssets();
  toast("Asset sold");
}

function denyAssetBuy() {
  const buy = assetBuys.find((item) => item.id === assetBuyId && item.status === "pending");
  if (!buy) return;
  buy.status = "denied";
  saveAssetBuys();
  publishReject(buy.id, "The asset request was refused.");
  closeAssetBuy();
  clearNotification(buy.id);
  toast("Asset refused");
}

function saveLoans() {
  localStorage.setItem(LOANS, JSON.stringify(loans.slice(0, 40)));
}

function fillLoanAccount() {
  fillRole("loan-account", state.settings.loanAccountId, "loanAccountId");
}

function cleanLoan(item) {
  if (!item || typeof item.id !== "string") return null;
  const amount = moneyText(item.amount, false);
  if (!amount) return null;
  const status = item.status === "review" || item.status === "active" || item.status === "paid"
    ? item.status
    : item.repaid ? "paid" : "active";
  const count = String(item.count ?? "").replace(/\D/g, "");
  return {
    id: item.id,
    accountId: typeof item.accountId === "string" ? item.accountId : "",
    name: String(item.name || "Account").slice(0, 40),
    amount,
    rate: percentText(item.rate, "0"),
    count: count || (status === "active" ? "1" : "0"),
    billed: Math.max(0, Number(item.billed) || 0),
    paid: moneyText(item.paid, false) || "0",
    due: moneyText(item.due, false) || "0",
    status,
    ts: Number(item.ts) || 0,
  };
}

function loanTotal(loan) {
  const principal = BigInt(loan.amount || "0");
  const rate = BigInt(loan.rate || "0");
  return principal + (principal * rate) / 100n;
}

function loanBand(amount) {
  const value = BigInt(amount);
  return (state.settings.loanBands || []).find((band) => value >= BigInt(band.min) && value <= BigInt(band.max)) || null;
}

function publishLoans() {
  const rows = loans.slice(0, 20).map((loan) => ({
    id: loan.id,
    accountId: loan.accountId,
    name: loan.name,
    amount: loan.amount,
    rate: loan.rate,
    count: loan.count,
    billed: loan.billed,
    paid: loan.paid,
    due: loan.due,
    status: loan.status,
    ts: loan.ts,
  }));
  publish("Loans", { v: 1, kind: "loans", loans: rows, ts: Date.now() }).catch(() => {});
}

function billLoans() {
  let changed = false;
  loans.forEach((loan) => {
    if (loan.status !== "active") return;
    const count = Number(loan.count) || 0;
    if (loan.billed >= count) return;
    const total = loanTotal(loan);
    const paid = BigInt(loan.paid || "0");
    const due = BigInt(loan.due || "0");
    const outstanding = total > paid ? total - paid : 0n;
    const unbilled = outstanding > due ? outstanding - due : 0n;
    if (unbilled <= 0n) return;
    const left = count - loan.billed;
    const installment = left <= 1 ? unbilled : unbilled / BigInt(left);
    if (installment <= 0n) return;
    loan.due = (due + installment).toString();
    loan.billed += 1;
    changed = true;
  });
  if (!changed) return;
  saveLoans();
  renderLoans();
  publishLoans();
}

function renderLoans() {
  if (loans.some((item) => !item || !item.status)) {
    const cleaned = loans.map(cleanLoan).filter(Boolean);
    loans.splice(0, loans.length, ...cleaned);
    saveLoans();
  }
  const list = $("loan-list");
  const note = $("loan-out");
  if (!list) return;
  const open = loans.filter((item) => item.status === "active");
  const owed = open.reduce((sum, item) => {
    const left = loanTotal(item) - BigInt(item.paid || "0");
    return sum + (left > 0n ? left : 0n);
  }, 0n);
  if (note) note.textContent = owed > 0n ? `${formatAmount(owed.toString())} ₲ is still to be paid back.` : "Nothing is out on loan.";
  list.replaceChildren();
  loans.forEach((item) => {
    const card = document.createElement("article");
    card.className = "loan-card";
    const title = document.createElement("p");
    title.className = "loan-title";
    if (item.status === "review") title.textContent = `${item.name} asked for ${formatAmount(item.amount)} ₲`;
    else if (item.status === "paid") title.textContent = `${item.name} paid off ${formatAmount(item.amount)} ₲`;
    else title.textContent = `${item.name} owes ${formatAmount((loanTotal(item) - BigInt(item.paid || "0")).toString())} ₲`;
    card.append(title);
    if (item.status === "review") {
      const field = document.createElement("label");
      field.className = "field";
      const span = document.createElement("span");
      span.textContent = "Amount to approve (₲)";
      const input = document.createElement("input");
      input.inputMode = "numeric";
      input.autocomplete = "off";
      input.value = groupDigits(item.amount);
      input.addEventListener("input", () => placeGroupedCaret(input));
      field.append(span, input);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn slim";
      button.textContent = "Approve";
      button.addEventListener("click", () => approveLoan(item.id, input.value));
      card.append(field, button);
    } else if (item.status === "active") {
      const total = loanTotal(item);
      const paid = BigInt(item.paid || "0");
      const ratio = total > 0n ? Number((paid * 10000n) / total) / 100 : 0;
      const bar = document.createElement("div");
      bar.className = "loan-bar";
      const fill = document.createElement("span");
      fill.style.width = `${Math.max(0, Math.min(100, ratio))}%`;
      bar.append(fill);
      const meta = document.createElement("p");
      meta.className = "quiet";
      meta.textContent = `${formatAmount(paid.toString())} ₲ paid of ${formatAmount(total.toString())} ₲ · ${item.rate}% · bill ${formatAmount(item.due)} ₲ · ${item.billed} of ${item.count}`;
      card.append(bar, meta);
    }
    list.append(card);
  });
}

function fillLoanFormula() {
  const box = $("loan-bands");
  if (!box || box.querySelector("input:focus")) return;
  box.replaceChildren();
  state.settings.loanBands.forEach((band) => {
    const row = document.createElement("div");
    row.className = "loan-band";
    ["min", "max", "rate", "count"].forEach((key) => {
      const input = document.createElement("input");
      input.dataset.band = key;
      input.inputMode = "numeric";
      input.autocomplete = "off";
      input.value = key === "rate" || key === "count" ? band[key] : groupDigits(band[key]);
      if (key === "min" || key === "max") input.addEventListener("input", () => placeGroupedCaret(input));
      row.append(input);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn slim";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => row.remove());
    row.append(remove);
    box.append(row);
  });
}

function saveLoanFormula() {
  const error = $("loan-error");
  const rows = [...document.querySelectorAll("#loan-bands .loan-band")].map((row) => ({
    min: parseAmount(row.querySelector("[data-band=min]").value),
    max: parseAmount(row.querySelector("[data-band=max]").value),
    rate: row.querySelector("[data-band=rate]").value,
    count: row.querySelector("[data-band=count]").value,
  }));
  const bands = normalizeLoanBands(rows);
  const valid = rows.length && rows.every((row) => row.min && row.max) && bands.length === rows.length;
  if (!valid) {
    if (error) error.textContent = "Each range needs a minimum, a maximum, a rate, and a payment count.";
    return;
  }
  state.settings = { ...state.settings, loanBands: bands };
  saveAccounts();
  if (error) error.textContent = "";
  publishLedger([]).catch(() => {});
  toast("Loan formula saved");
}

function approveLoan(id, raw) {
  const error = $("loan-error");
  if (error) error.textContent = "";
  const loan = loans.find((item) => item.id === id && item.status === "review");
  const lender = state.accounts.find((item) => item.id === state.settings.loanAccountId);
  const borrower = loan && state.accounts.find((item) => item.id === loan.accountId);
  const amount = readBillion(raw);
  if (!loan || !borrower) {
    if (error) error.textContent = "That application is no longer here.";
    return;
  }
  if (!lender) {
    if (error) error.textContent = "Choose the account that pays loans in Settings.";
    return;
  }
  if (!amount) {
    if (error) error.textContent = "Enter the amount to approve.";
    return;
  }
  const band = loanBand(amount);
  if (!band) {
    if (error) error.textContent = "That amount is outside the loan ranges.";
    return;
  }
  if (BigInt(lender.bal) < BigInt(amount)) {
    if (error) error.textContent = "The loan account does not have enough gizbits.";
    return;
  }
  const next = BigInt(borrower.bal) + BigInt(amount);
  if (next > MAX) {
    if (error) error.textContent = "That account cannot hold that much.";
    return;
  }
  lender.bal = (BigInt(lender.bal) - BigInt(amount)).toString();
  borrower.bal = next.toString();
  loan.amount = amount;
  loan.rate = band.rate;
  loan.count = band.count;
  loan.billed = 0;
  loan.paid = "0";
  loan.due = "0";
  loan.status = "active";
  requests.unshift({
    id: `${loan.id}-loan`,
    accountId: lender.id,
    name: lender.name,
    op: "transfer",
    amount,
    status: "done",
    applied: amount,
    toId: borrower.id,
    toName: borrower.name,
    memo: "Loan",
    ts: Date.now(),
  });
  requests.splice(80);
  saveAccounts();
  saveRequests();
  saveLoans();
  render();
  publishLedger([]).catch(() => {});
  publishLoans();
  showBanner(`${borrower.name} was approved for a loan`, "");
}

function takeLoanApply(body) {
  if (!body || !body.id || !remember(body.id)) return;
  publishReject(body.id, "Loans are no longer available.");
  return;
  const account = state.accounts.find((item) => item.id === body.accountId);
  const amount = moneyText(body.amount, false);
  if (!account || body.ph !== account.ph || !amount) {
    publishReject(body.id, "The loan application was not accepted.");
    return;
  }
  if (loans.some((item) => item.accountId === account.id && item.status !== "paid")) {
    publishReject(body.id, "That account already has a loan.");
    return;
  }
  loans.unshift(cleanLoan({
    id: body.id,
    accountId: account.id,
    name: account.name,
    amount: floorBillion(BigInt(amount)).toString(),
    status: "review",
    ts: Date.now(),
  }));
  loans.splice(40);
  saveLoans();
  renderLoans();
  publishLoans();
  showBanner(`${account.name} applied for a loan`, "");
}

function takeLoanPay(body) {
  if (!body || !body.id || !remember(body.id)) return;
  publishReject(body.id, "Loans are no longer available.");
  return;
  const loan = loans.find((item) => item.id === body.loanId && item.status === "active");
  const borrower = loan && state.accounts.find((item) => item.id === loan.accountId);
  const lender = state.accounts.find((item) => item.id === state.settings.loanAccountId);
  const amount = moneyText(body.amount, false);
  if (!loan || !borrower || !lender || body.ph !== borrower.ph || body.accountId !== borrower.id || !amount) {
    publishReject(body.id, "The loan payment was not accepted.");
    return;
  }
  const pay = floorBillion(BigInt(amount));
  const total = loanTotal(loan);
  const paid = BigInt(loan.paid || "0");
  const due = BigInt(loan.due || "0");
  const outstanding = total > paid ? total - paid : 0n;
  if (pay <= 0n || pay > outstanding || (due > 0n && pay < due)) {
    publishReject(body.id, due > 0n ? "Pay at least the bill that is due." : "That payment does not match the loan.");
    return;
  }
  if (BigInt(borrower.bal) < pay) {
    publishReject(body.id, "That account does not have enough gizbits.");
    return;
  }
  const next = BigInt(lender.bal) + pay;
  if (next > MAX) {
    publishReject(body.id, "The loan account cannot hold that much.");
    return;
  }
  borrower.bal = (BigInt(borrower.bal) - pay).toString();
  lender.bal = next.toString();
  loan.paid = (paid + pay).toString();
  loan.due = "0";
  if (BigInt(loan.paid) >= total) loan.status = "paid";
  requests.unshift({
    id: body.id,
    accountId: borrower.id,
    name: borrower.name,
    op: "transfer",
    amount: pay.toString(),
    status: "done",
    applied: pay.toString(),
    toId: lender.id,
    toName: lender.name,
    memo: "Loan repayment",
    ts: Date.now(),
  });
  requests.splice(80);
  saveAccounts();
  saveRequests();
  saveLoans();
  render();
  publishLedger([body.id]).catch(() => {});
  publishLoans();
}

function saveContracts() {
  localStorage.setItem(CONTRACTS, JSON.stringify(contracts.slice(0, 40)));
}

function contractChoices() {
  return [{ value: "", label: "Choose an account" }].concat(
    state.accounts.map((account) => ({ value: account.id, label: account.name })),
  );
}

function renderContracts() {
  const from = $("contract-from");
  const to = $("contract-to");
  if (from) mountPicker(from, contractChoices(), from.dataset.value || "");
  if (to) mountPicker(to, contractChoices(), to.dataset.value || "");
  const list = $("contract-list");
  const note = $("contract-note");
  if (!list) return;
  const open = contracts.filter((item) => !item.paid);
  if (note) note.textContent = open.length ? `${open.length} still open.` : "No contracts between accounts yet.";
  list.replaceChildren();
  contracts.forEach((item) => {
    const card = document.createElement("article");
    card.className = "loan-card";
    const title = document.createElement("p");
    title.textContent = item.paid
      ? `${item.title}: ${item.fromName} paid ${item.toName} ${formatAmount(item.amount)} ₲`
      : `${item.title}: ${item.fromName} owes ${item.toName} ${formatAmount(item.amount)} ₲`;
    card.append(title);
    if (!item.paid) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn slim";
      button.textContent = "Settle";
      button.addEventListener("click", () => settleContract(item.id));
      card.append(button);
    }
    list.append(card);
  });
}

function makeContract() {
  const error = $("contract-error");
  if (error) error.textContent = "";
  const from = state.accounts.find((item) => item.id === ($("contract-from").dataset.value || ""));
  const to = state.accounts.find((item) => item.id === ($("contract-to").dataset.value || ""));
  const amount = readBillion($("contract-amount").value);
  const title = $("contract-title").value.trim().slice(0, 40);
  if (!from || !to || from.id === to.id) {
    if (error) error.textContent = "Choose two different accounts.";
    return;
  }
  if (!amount) {
    if (error) error.textContent = "Enter at least 1 billion gizbits.";
    return;
  }
  if (!title) {
    if (error) error.textContent = "Name the contract.";
    return;
  }
  contracts.unshift({
    id: uid(),
    fromId: from.id,
    toId: to.id,
    fromName: from.name,
    toName: to.name,
    amount,
    title,
    paid: false,
    ts: Date.now(),
  });
  contracts.splice(40);
  saveContracts();
  $("contract-amount").value = "";
  $("contract-title").value = "";
  renderContracts();
  toast("Contract made");
}

function settleContract(id) {
  const item = contracts.find((row) => row.id === id && !row.paid);
  const error = $("contract-error");
  if (!item) return;
  const from = state.accounts.find((account) => account.id === item.fromId);
  const to = state.accounts.find((account) => account.id === item.toId);
  if (!from || !to) {
    if (error) error.textContent = "That account is no longer on this phone.";
    return;
  }
  if (BigInt(from.bal) < BigInt(item.amount)) {
    if (error) error.textContent = `${from.name} does not have enough gizbits.`;
    return;
  }
  const next = BigInt(to.bal) + BigInt(item.amount);
  if (next > MAX) {
    if (error) error.textContent = "That account cannot hold that much.";
    return;
  }
  from.bal = (BigInt(from.bal) - BigInt(item.amount)).toString();
  to.bal = next.toString();
  item.paid = true;
  item.fromName = from.name;
  item.toName = to.name;
  requests.unshift({
    id: `${item.id}-contract`,
    accountId: from.id,
    name: from.name,
    op: "transfer",
    amount: item.amount,
    status: "done",
    applied: item.amount,
    toId: to.id,
    toName: to.name,
    memo: "Contract",
    ts: Date.now(),
  });
  requests.splice(80);
  saveAccounts();
  saveRequests();
  saveContracts();
  if (error) error.textContent = "";
  render();
  renderContracts();
  publishLedger([]).catch(() => {});
  toast("Contract settled");
}

function render() {
  renderRows();
  renderAccounts();
  renderActivity();
  renderRequests();
  renderGovernment();
  fillTaxAccount();
  fillGamingAccount();
  fillInterestAccount();
  fillMarkRows(false);
  paintSessions();
  renderInterestRows();
  renderAssetList();
  renderGaming();
  renderLoans();
  fillLoanAccount();
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
  document.body.classList.toggle("gov-theme", name === "government");
  paintLink();
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

async function handleMessage(data, bucket) {
  noteCursor(data);
  if (data.event && data.event !== "message") return;
  const body = decode(await messageText(data));
  if (!body || body.v !== 1) return;
  if (["ping", "request", "gaming", "transfer", "tax", "tax-delete", "tax-clear", "password", "asset-buy", "call", "loan-apply", "loan-pay", "tx"].includes(body.kind)) {
    lastHear = Date.now();
    paintLink();
  }
  if (body.kind === "ping") {
    if (!state.accounts.length) return;
    if (!body.id || !body.ts || Date.now() - body.ts > 120000) return;
    if (!remember(`ping:${body.id}`)) return;
    bucket.ping = body.id;
    if (body.sync) bucket.sync = true;
    return;
  }
  if (body.kind === "request") {
    if (takeRequest(body)) bucket.requests = true;
    return;
  }
  if (body.kind === "gaming") {
    if (takeGaming(body)) bucket.requests = true;
    return;
  }
  if (body.kind === "transfer") {
    if (takeTransfer(body)) bucket.requests = true;
    return;
  }
  if (body.kind === "tax") {
    takeTax(body);
    return;
  }
  if (body.kind === "tax-delete") {
    takeTaxDelete(body);
    return;
  }
  if (body.kind === "tax-clear") {
    takeTaxClear(body);
    return;
  }
  if (body.kind === "password") {
    takePassword(body);
    return;
  }
  if (body.kind === "asset-buy") {
    takeAssetBuy(body);
    return;
  }
  if (body.kind === "call") {
    takeCall(body);
    return;
  }
  if (body.kind === "loan-apply") {
    takeLoanApply(body);
    return;
  }
  if (body.kind === "loan-pay") {
    takeLoanPay(body);
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

function sanitizeExpenses(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => {
    const name = String(item?.name || "").trim().slice(0, 40);
    const note = String(item?.note || "").trim().slice(0, 120);
    const amount = moneyText(item?.amount, false);
    if (!name || !note || amount == null) return null;
    const floored = floorBillion(amount);
    if (floored <= 0n) return null;
    return { name, note, amount: floored.toString() };
  }).filter(Boolean);
}

function taxMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) value = Math.trunc(value).toString();
  return moneyText(value, false);
}

function sanitizeTaxLines(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((line) => {
    const name = String(line?.name || "").trim().slice(0, 40);
    const qty = taxMoney(line?.qty);
    const revenue = taxMoney(line?.revenue);
    if (!name || !qty || qty === "0" || revenue == null) return null;
    return { name, qty, revenue };
  }).filter(Boolean);
}

function takeTax(body) {
  if (!body || typeof body.id !== "string") return false;
  if (taxes.some((item) => item.id === body.id)) return false;
  let account = state.accounts.find((item) => item.id === body.accountId);
  const ph = String(body.ph || "").toLowerCase();
  if (!account && ph) {
    const same = state.accounts.filter((item) => String(item.ph || "").toLowerCase() === ph);
    if (same.length === 1) account = same[0];
  }
  if (!account || ph !== String(account.ph || "").toLowerCase()) {
    if (remember(`tax-bad:${body.id}`)) {
      logActivity("A tax return was not filed. The password did not match.");
      publishReject(body.id, "The password did not match.");
    }
    return false;
  }
  const business = String(body.business || "").trim().slice(0, 60);
  let sheet = String(body.sheet || "").replace(/\D/g, "").replace(/^0+/, "");
  const lines = sanitizeTaxLines(body.lines);
  const expenses = sanitizeExpenses(body.expenses);
  if (!business || !lines.length) {
    logActivity("A tax return was not filed. It had no business or no products.");
    publishReject(body.id, "That tax return had no business or no products.");
    return false;
  }
  if (!sheet) sheet = String(taxes.length + 1);
  if (!remember(body.id)) return false;
  const rates = {
    vat: percentText(body.vatRate, state.settings.vatRate),
    low: percentText(body.lowRate, state.settings.profitLow),
    high: percentText(body.highRate, state.settings.profitHigh),
    threshold: moneyText(body.threshold, false) || state.settings.profitThreshold,
  };
  const totals = taxTotals(lines, rates, expenses);
  taxes.unshift({
    id: body.id,
    accountId: account.id,
    owner: account.name,
    business,
    session: String(body.session || "").replace(/\D/g, "").replace(/^0+/, "") || currentSessionLabel(),
    sheet,
    vatRate: rates.vat,
    lowRate: rates.low,
    highRate: rates.high,
    threshold: rates.threshold,
    lines,
    expenses,
    totals,
    status: "review",
    sign: cleanSign(body.sign),
    ts: Number(body.ts) || Date.now(),
  });
  saveTaxes();
  noteSign(account.id, body.id, body.sign);
  renderGovernment();
  toast(`${business} filed a tax return`);
  publish("Tax return received", { v: 1, kind: "tax-ack", id: body.id, ts: Date.now() }).catch(() => {});
  return true;
}

function payTax(item, totals) {
  const account = state.accounts.find((entry) => entry.id === item.accountId);
  const nextInvoice = BigInt(totals.invoice || "0");
  const prevInvoice = item.status === "paid" ? BigInt(item.totals?.invoice || "0") : 0n;
  const delta = nextInvoice - prevInvoice;
  const sink = state.accounts.find((entry) => entry.id === state.settings.taxAccountId);
  if (delta !== 0n) {
    if (!account) return "That account is no longer on this phone.";
    if (!sink) return "Set the account that receives tax payments in Settings.";
    if (sink.id === account.id) return "Choose a different account for tax payments.";
    if (delta > 0n) {
      if (BigInt(account.bal) < delta) return "Not enough gizbits to pay that tax.";
      if (BigInt(sink.bal) + delta > MAX) return "That tax account cannot hold that much.";
      account.bal = (BigInt(account.bal) - delta).toString();
      sink.bal = (BigInt(sink.bal) + delta).toString();
    } else {
      const back = -delta;
      if (BigInt(sink.bal) < back) return "The tax account does not have enough gizbits to change this.";
      if (BigInt(account.bal) + back > MAX) return "That account cannot hold that much.";
      sink.bal = (BigInt(sink.bal) - back).toString();
      account.bal = (BigInt(account.bal) + back).toString();
    }
    saveAccounts();
    const moved = delta > 0n ? delta : -delta;
    const refund = delta < 0n;
    requests.unshift({
      id: `${item.id}-pay-${Date.now()}`,
      accountId: refund ? sink.id : account.id,
      name: refund ? sink.name : account.name,
      op: "transfer",
      amount: moved.toString(),
      status: "done",
      applied: moved.toString(),
      toId: refund ? account.id : sink.id,
      toName: refund ? account.name : sink.name,
      memo: refund ? "Income tax refund" : "Income tax invoice",
      ts: Date.now(),
    });
    saveRequests();
    renderActivity();
  }
  item.totals = totals;
  item.status = "paid";
  saveTaxes();
  renderGovernment();
  publishLedger([item.id]).catch(() => {});
  toast(prevInvoice === 0n ? "Tax payment sent" : "Tax return updated");
  return "";
}

function takeTaxDelete(body) {
  if (!body || typeof body.id !== "string" || !remember(`tax-delete:${body.id}`)) return;
  const index = taxes.findIndex((item) => item.id === body.id);
  if (index < 0) return;
  taxes.splice(index, 1);
  saveTaxes();
  renderGovernment();
}

function takeTaxClear(body) {
  const stamp = Number(body?.ts) || 0;
  if (!stamp || !remember(`tax-clear:${stamp}`)) return;
  taxes.splice(0, taxes.length);
  saveTaxes();
  renderGovernment();
}

function deleteAllReturns() {
  taxes.splice(0, taxes.length);
  saveTaxes();
  renderGovernment();
  const ts = Date.now();
  remember(`tax-clear:${ts}`);
  publish("Tax returns removed", { v: 1, kind: "tax-clear", ts }).catch(() => {});
  toast("Tax returns deleted");
}

function deleteTax(id) {
  const index = taxes.findIndex((item) => item.id === id);
  if (index < 0) return;
  taxes.splice(index, 1);
  saveTaxes();
  renderGovernment();
  remember(`tax-delete:${id}`);
  publish("Tax return removed", { v: 1, kind: "tax-delete", id, ts: Date.now() }).catch(() => {});
}

function amountParts(value) {
  const text = formatAmount(value);
  const split = text.match(/^(.*)\s(Billion|Trillion)$/);
  if (!split) return { num: text, unit: "" };
  return { num: split[1], unit: split[2] };
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
  const parts = amountParts(value);
  const cell = document.createElement("span");
  cell.className = "money-stack";
  const num = document.createElement("b");
  num.textContent = parts.num;
  cell.append(num);
  if (parts.unit) {
    const unit = document.createElement("small");
    unit.textContent = parts.unit;
    cell.append(unit);
  }
  return cell;
}

function sumRow(label, amount, big) {
  const row = document.createElement("p");
  if (big) row.className = "is-invoice";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("strong");
  value.textContent = `${formatAmount(amount)} ₲`;
  row.append(name, value);
  return row;
}

let reviewId = "";

function openTaxReview(id) {
  const item = taxes.find((entry) => entry.id === id);
  if (!item) return;
  reviewId = id;
  const totals = item.totals || {};
  const write = (field, amount) => {
    $(field).value = formatFull(amount || "0");
  };
  write("review-revenue", totals.revenue);
  write("review-profit", totals.profit);
  write("review-expenses", totals.expenses);
  write("review-vat", totals.vat);
  write("review-tax", totals.tax);
  write("review-invoice", totals.invoice);
  $("review-title").textContent = item.business || "Tax return";
  $("review-error").textContent = "";
  const lines = $("review-lines");
  lines.replaceChildren();
  (item.lines || []).forEach((line) => {
    const parts = splitVat(line.revenue, item.vatRate);
    const row = document.createElement("p");
    row.textContent = `${line.name} · ${formatAmount(parts.revenue)} ₲`;
    lines.append(row);
  });
  $("tax-review").hidden = false;
}

function readReviewAmount(id) {
  const digits = $(id).value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits || digits === "0") return "0";
  const floored = floorBillion(digits);
  if (floored <= 0n) return null;
  return floored.toString();
}

function confirmTaxReview() {
  const item = taxes.find((entry) => entry.id === reviewId);
  const error = $("review-error");
  error.textContent = "";
  if (!item || item.status !== "review") {
    $("tax-review").hidden = true;
    return;
  }
  const fields = ["review-revenue", "review-profit", "review-expenses", "review-vat", "review-tax", "review-invoice"];
  const amounts = fields.map(readReviewAmount);
  if (amounts.some((amount) => amount == null)) {
    error.textContent = "Each amount is rounded down to 1 billion gizbits.";
    return;
  }
  const totals = {
    revenue: amounts[0],
    profit: amounts[1],
    expenses: amounts[2],
    vat: amounts[3],
    tax: amounts[4],
    invoice: amounts[5],
  };
  const problem = payTax(item, totals);
  if (problem) {
    error.textContent = problem;
    return;
  }
  reviewId = "";
  $("tax-review").hidden = true;
}

function paidTaxes() {
  return taxes.filter((item) => item.status === "paid");
}

function taxBuckets() {
  const income = paidTaxes().reduce((sum, item) => sum + BigInt(item.totals?.tax || "0"), 0n);
  const vat = paidTaxes().reduce((sum, item) => sum + BigInt(item.totals?.vat || "0"), 0n);
  const gaming = plays.reduce((sum, item) => item.status === "out" ? sum + BigInt(item.tax || "0") : sum, 0n);
  return { income, vat, gaming, total: income + vat + gaming };
}

function taxCollected() {
  return taxBuckets().total;
}

const TAX_COLORS = ["#8ec5ff", "#f08a8a", "#f2c14e", "#7dcea0", "#c39bd3", "#f5b041", "#85c1e9", "#e6b0aa"];

function addPayer(map, id, name, amount) {
  if (amount <= 0n) return;
  const key = id || name || "Account";
  const row = map.get(key) || { name: name || "Account", amount: 0n };
  row.amount += amount;
  if (name) row.name = name;
  map.set(key, row);
}

function taxSlices(kind) {
  const map = new Map();
  if (kind === "income" || kind === "vat" || kind === "total") {
    paidTaxes().forEach((item) => {
      const tax = BigInt(item.totals?.tax || "0");
      const vat = BigInt(item.totals?.vat || "0");
      const amount = kind === "income" ? tax : kind === "vat" ? vat : tax + vat;
      addPayer(map, item.accountId, item.owner || item.business, amount);
    });
  }
  if (kind === "gaming" || kind === "total") {
    plays.forEach((item) => {
      if (item.status !== "out") return;
      addPayer(map, item.accountId, item.name, BigInt(item.tax || "0"));
    });
  }
  return [...map.values()].sort((a, b) => (a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0));
}

function sharePercents(amounts) {
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);
  if (total <= 0n) return amounts.map(() => 0);
  const scaled = amounts.map((amount) => (amount * 10000n) / total);
  const floors = scaled.map((value) => Number(value / 100n));
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = scaled.map((value, index) => ({ index, rem: value % 100n }))
    .sort((a, b) => (a.rem === b.rem ? 0 : a.rem > b.rem ? -1 : 1));
  for (let step = 0; step < left; step += 1) floors[order[step % order.length].index] += 1;
  return floors;
}

function openTaxSplit(kind) {
  const titles = {
    income: "Income tax",
    vat: "VAT",
    gaming: "Tax on gaming profits",
    total: "Tax collected",
  };
  const title = $("tax-split-title");
  if (title) title.textContent = titles[kind] || "Tax collected";
  const slices = taxSlices(kind);
  const pie = $("tax-pie");
  const key = $("tax-pie-key");
  const empty = $("tax-pie-empty");
  if (!pie || !key || !empty) return;
  key.replaceChildren();
  if (!slices.length) {
    pie.hidden = true;
    empty.hidden = false;
    setSide("tax-split", true);
    return;
  }
  empty.hidden = true;
  pie.hidden = false;
  const percents = sharePercents(slices.map((slice) => slice.amount));
  let cursor = 0;
  const stops = [];
  slices.forEach((slice, index) => {
    const color = TAX_COLORS[index % TAX_COLORS.length];
    const next = cursor + percents[index];
    stops.push(`${color} ${cursor}% ${next}%`);
    cursor = next;
    const row = document.createElement("p");
    const swatch = document.createElement("i");
    swatch.style.background = color;
    const label = document.createElement("span");
    label.textContent = withColon(slice.name);
    const share = document.createElement("strong");
    share.textContent = `${percents[index]}%`;
    row.append(swatch, label, share);
    key.append(row);
  });
  pie.style.background = `conic-gradient(${stops.join(", ")})`;
  setSide("tax-split", true);
}

function renderEarnings() {
  const body = $("earnings-body");
  if (!body) return;
  const income = taxes.reduce((sum, item) => item.status === "review" ? sum : sum + BigInt(item.totals?.tax || "0"), 0n);
  const vat = taxes.reduce((sum, item) => item.status === "review" ? sum : sum + BigInt(item.totals?.vat || "0"), 0n);
  const gaming = plays.reduce((sum, item) => item.status === "out" ? sum + BigInt(item.tax || "0") : sum, 0n);
  const sales = assetBuys.reduce((sum, item) => item.status === "done" ? sum + BigInt(item.amount || "0") : sum, 0n);
  const rows = [
    ["Income tax", income],
    ["VAT", vat],
    ["Tax on gaming profits", gaming],
    ["Asset sales", sales],
    ["Total", income + vat + gaming + sales],
  ];
  body.replaceChildren();
  rows.forEach(([label, amount]) => {
    const row = document.createElement("div");
    row.className = "earn-row";
    const name = document.createElement("span");
    name.textContent = withColon(label);
    const money = document.createElement("strong");
    money.textContent = `${formatAmount(amount.toString())} ₲`;
    row.append(name, money);
    body.append(row);
  });
}

function renderTaxBar() {
  const bar = $("tax-bar");
  const key = $("tax-bar-key");
  if (!bar || !key) return;
  const buckets = taxBuckets();
  const parts = [
    ["Income tax", buckets.income, "#8ec5ff", "income"],
    ["VAT", buckets.vat, "#f2c14e", "vat"],
    ["Tax on gaming profits", buckets.gaming, "#f08a8a", "gaming"],
  ].filter(([, amount]) => amount > 0n).sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  const total = parts.reduce((sum, [, amount]) => sum + amount, 0n);
  bar.replaceChildren();
  key.replaceChildren();
  if (!parts.length || total <= 0n) {
    bar.hidden = true;
    key.hidden = true;
    return;
  }
  bar.hidden = false;
  key.hidden = false;
  const table = document.createElement("table");
  table.className = "tax-key";
  parts.forEach(([label, amount, color, kind]) => {
    const seg = document.createElement("button");
    seg.type = "button";
    const share = Number((amount * 10000n) / total) / 100;
    seg.style.width = `${Math.max(share, 4)}%`;
    seg.style.background = color;
    seg.setAttribute("aria-label", label);
    seg.addEventListener("click", () => openTaxSplit(kind));
    bar.append(seg);
    const row = document.createElement("tr");
    const name = document.createElement("td");
    const swatch = document.createElement("i");
    swatch.style.background = color;
    name.append(swatch, document.createTextNode(withColon(label)));
    const money = document.createElement("td");
    money.textContent = `${formatAmount(amount.toString())} ₲`;
    row.append(name, money);
    row.addEventListener("click", () => openTaxSplit(kind));
    table.append(row);
  });
  key.append(table);
}

function sheetTable(headers, widths) {
  const table = document.createElement("table");
  table.className = "tax-sheet-table";
  const cols = document.createElement("colgroup");
  widths.forEach((width) => {
    const col = document.createElement("col");
    col.style.width = width;
    cols.append(col);
  });
  const head = document.createElement("thead");
  const row = document.createElement("tr");
  headers.forEach((label, index) => {
    const cell = document.createElement("th");
    cell.textContent = label;
    if (index > 0) cell.className = "num";
    row.append(cell);
  });
  head.append(row);
  table.append(cols, head);
  const body = document.createElement("tbody");
  table.append(body);
  return { table, body };
}

function withColon(label) {
  const text = String(label ?? "");
  if (!text || text.endsWith(":")) return text;
  return `${text}:`;
}

function sheetRow(cells, total) {
  const row = document.createElement("tr");
  if (total) row.className = "is-total";
  cells.forEach((value, index) => {
    const cell = document.createElement("td");
    cell.textContent = index === 0 ? withColon(value) : value;
    if (index > 0) cell.className = "num";
    row.append(cell);
  });
  return row;
}

function taxRatesOf(item) {
  return {
    vat: item.vatRate || state.settings.vatRate || "0",
    low: item.lowRate || state.settings.profitLow || "0",
    high: item.highRate || state.settings.profitHigh || "0",
    threshold: item.threshold || state.settings.profitThreshold || "0",
  };
}

function editField(value, field, numeric) {
  const input = document.createElement("input");
  input.className = "tax-edit";
  input.dataset.field = field;
  input.value = value;
  input.inputMode = numeric ? "decimal" : "text";
  input.addEventListener("input", refreshTaxEdit);
  return input;
}

function linesFromSheet(item) {
  const rows = [...$("tax-sheet-goods").querySelectorAll("tr[data-line]")];
  if (!rows.length) return item.lines || [];
  return rows.map((row, index) => {
    const previous = (item.lines || [])[index] || {};
    const name = row.querySelector("[data-field='name']").value.trim().slice(0, 60);
    const qty = row.querySelector("[data-field='qty']").value.replace(/\D/g, "") || previous.qty || "0";
    const revenue = rawFromBillions(row.querySelector("[data-field='revenue']").value);
    return {
      name: name || previous.name || "Item",
      qty,
      revenue: revenue || previous.revenue || "0",
    };
  });
}

function expensesFromSheet(item) {
  const rows = [...$("tax-sheet-expenses").querySelectorAll("tr[data-expense]")];
  if (!rows.length) return item.expenses || [];
  return rows.map((row, index) => {
    const previous = (item.expenses || [])[index] || {};
    const name = row.querySelector("[data-field='name']").value.trim().slice(0, 60);
    const amount = rawFromBillions(row.querySelector("[data-field='amount']").value);
    return {
      name: name || previous.name || "Expense",
      note: previous.note || "",
      amount: amount || previous.amount || "0",
    };
  });
}

function paintFigures(totals) {
  const figures = $("tax-sheet-figures");
  figures.replaceChildren();
  const table = sheetTable(["Name", "Amount"], ["62%", "38%"]);
  [
    ["Total revenue", totals.revenue],
    ["Expenses", totals.expenses || "0"],
    ["Profits", totals.profit],
  ].forEach(([label, amount]) => table.body.append(sheetRow([label, formatBillions(amount)])));
  figures.append(table.table);
}

function paintLevy(item, totals) {
  const levy = $("tax-sheet-levy");
  levy.replaceChildren();
  const levyTable = sheetTable(["Name", "Total", "Tax Rate (%)", "Gross Tax"], ["40%", "22%", "16%", "22%"]);
  const taxable = BigInt(totals.profit || "0");
  const threshold = BigInt(item.threshold || state.settings.profitThreshold || "0");
  const under = taxable < threshold ? taxable : threshold;
  const over = taxable > threshold ? taxable - threshold : 0n;
  const low = BigInt(item.lowRate || state.settings.profitLow || "0");
  const high = BigInt(item.highRate || state.settings.profitHigh || "0");
  const officialTax = BigInt(totals.tax || "0");
  let underTax = floorBillion((under * low) / 100n);
  let overTax = floorBillion((over * high) / 100n);
  const drift = officialTax - (underTax + overTax);
  if (over > 0n) overTax += drift;
  else underTax += drift;
  levyTable.body.append(sheetRow([
    `Profits under ${formatBillions(threshold)} threshold`,
    formatBillions(under),
    `${low}%`,
    formatBillions(underTax),
  ]));
  if (over > 0n) {
    levyTable.body.append(sheetRow([
      "Profits over threshold",
      formatBillions(over),
      `${high}%`,
      formatBillions(overTax),
    ]));
  }
  levyTable.body.append(sheetRow([
    "VAT",
    formatBillions(totals.revenue),
    `${item.vatRate || state.settings.vatRate || 0}%`,
    formatBillions(totals.vat),
  ]));
  levyTable.body.append(sheetRow(["Total", "", "", formatBillions(officialTax + BigInt(totals.vat || "0"))], true));
  levy.append(levyTable.table);
  $("tax-sheet-invoice").textContent = `${formatAmount(totals.invoice)} ₲`;
}

function refreshTaxEdit() {
  const item = taxes.find((entry) => entry.id === taxSheetId);
  if (!item || !taxEditing) return;
  const lines = linesFromSheet(item);
  const expenses = expensesFromSheet(item);
  const totals = taxTotals(lines, taxRatesOf(item), expenses);
  const rate = item.vatRate || state.settings.vatRate || "0";
  let gross = 0n;
  let vat = 0n;
  let profit = 0n;
  $("tax-sheet-goods").querySelectorAll("tr[data-line]").forEach((row, index) => {
    const parts = splitVat(lines[index].revenue, rate);
    gross += parts.revenue;
    vat += parts.vat;
    profit += parts.profit;
    row.querySelector("[data-calc='vat']").textContent = formatBillions(parts.vat);
    row.querySelector("[data-calc='profit']").textContent = formatBillions(parts.profit);
  });
  const total = $("tax-sheet-goods").querySelector("tr.is-total");
  if (total) {
    const cells = total.querySelectorAll("td");
    cells[2].textContent = formatBillions(gross);
    cells[3].textContent = formatBillions(vat);
    cells[4].textContent = formatBillions(profit);
  }
  paintFigures(totals);
  paintLevy(item, totals);
}

function commitTaxEdit() {
  const item = taxes.find((entry) => entry.id === taxSheetId);
  if (!item) return false;
  const lines = linesFromSheet(item);
  const expenses = expensesFromSheet(item);
  const totals = taxTotals(lines, taxRatesOf(item), expenses);
  const previousLines = item.lines;
  const previousExpenses = item.expenses;
  const changed = JSON.stringify(lines) !== JSON.stringify(previousLines) || JSON.stringify(expenses) !== JSON.stringify(previousExpenses);
  if (!changed) return true;
  item.lines = lines;
  item.expenses = expenses;
  const problem = payTax(item, totals);
  const msg = $("tax-sheet-msg");
  if (problem) {
    item.lines = previousLines;
    item.expenses = previousExpenses;
    if (msg) msg.textContent = problem;
    return false;
  }
  if (msg) msg.textContent = "";
  return true;
}

function identityTable(item, editable) {
  const table = document.createElement("table");
  table.className = "tax-sheet-table";
  const body = document.createElement("tbody");
  [
    ["business", "Business name", item.business || ""],
    ["owner", "Full name", item.owner || ""],
    ["session", "Session number", item.session || ""],
    ["sheet", "Invoice number", item.sheet || ""],
  ].forEach(([key, label, value]) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = withColon(label);
    const cell = document.createElement("td");
    if (editable) {
      const input = document.createElement("input");
      input.className = "tax-edit";
      input.dataset.ident = key;
      input.value = value;
      cell.append(input);
    } else {
      cell.textContent = value;
    }
    row.append(name, cell);
    body.append(row);
  });
  table.append(body);
  return table;
}

function paintIdentity(item) {
  const box = $("tax-sheet-meta");
  if (!box) return;
  box.replaceChildren(identityTable(item, taxReviewStep === 1));
}

function paintReviewDots() {
  const box = $("tax-review-dots");
  if (!box) return;
  box.hidden = taxReviewStep < 1;
  box.replaceChildren();
  for (let step = 1; step <= 5; step += 1) {
    const dot = document.createElement("span");
    if (step === taxReviewStep) dot.className = "is-on";
    else if (step < taxReviewStep) dot.className = "is-done";
    box.append(dot);
  }
}

function paintReviewExpenses() {
  const item = taxes.find((entry) => entry.id === taxSheetId);
  const exp = $("tax-sheet-expenses");
  if (!item || !exp) return;
  exp.replaceChildren();
  if (!(item.expenses || []).length) {
    const note = document.createElement("p");
    note.className = "quiet";
    note.textContent = "No expenses on this return.";
    exp.append(note);
    return;
  }
  item.expenses.forEach((entry, index) => {
    const card = document.createElement("article");
    card.className = "review-expense";
    if (entry.editing) {
      const name = document.createElement("input");
      name.className = "tax-edit";
      name.value = entry.name;
      name.addEventListener("input", () => {
        entry.name = name.value.trim().slice(0, 40);
      });
      const amount = document.createElement("input");
      amount.className = "tax-edit";
      amount.inputMode = "decimal";
      amount.value = billionsInputValue(entry.amount);
      amount.addEventListener("change", () => {
        const raw = rawFromBillions(amount.value);
        const floored = floorBillion(raw || "0");
        if (floored > 0n) entry.amount = floored.toString();
      });
      card.append(name, amount);
    } else {
      const line = document.createElement("p");
      const label = document.createElement("span");
      label.textContent = entry.name;
      const money = document.createElement("strong");
      money.textContent = `${formatAmount(entry.amount)} ₲`;
      line.append(label, money);
      card.append(line);
    }
    const actions = document.createElement("div");
    actions.className = "review-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn";
    approve.textContent = entry.decision === "yes" ? "Approved" : "Approve";
    approve.addEventListener("click", () => {
      entry.decision = "yes";
      entry.editing = false;
      item.totals = taxTotals(item.lines || [], taxRatesOf(item), item.expenses || []);
      saveTaxes();
      paintReviewExpenses();
    });
    const deny = document.createElement("button");
    deny.type = "button";
    deny.className = "btn ghost";
    deny.textContent = "Deny";
    deny.addEventListener("click", () => {
      item.expenses.splice(index, 1);
      item.totals = taxTotals(item.lines || [], taxRatesOf(item), item.expenses || []);
      saveTaxes();
      paintReviewExpenses();
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn ghost";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      entry.editing = true;
      entry.decision = "";
      paintReviewExpenses();
    });
    actions.append(approve, deny, edit);
    card.append(actions);
    exp.append(card);
  });
}

function paintFilerSign() {
  const item = taxes.find((entry) => entry.id === taxSheetId);
  const canvas = $("tax-review-view");
  const empty = $("tax-review-sign-empty");
  if (!item || !canvas) return;
  const strokes = item.sign || [];
  if (empty) empty.hidden = strokes.length > 0;
  canvas.hidden = !strokes.length;
  if (strokes.length) drawSignature(canvas, strokes);
}

function bindReviewPad() {
  const canvas = $("tax-review-pad");
  if (!canvas || canvas.dataset.bound) return;
  canvas.dataset.bound = "1";
  let drawing = false;
  let stroke = [];
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 999);
    const y = Math.round(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 999);
    return [Math.max(0, Math.min(999, x)), Math.max(0, Math.min(999, y))];
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    const [x, y] = point(event);
    stroke = [x, y, x, y];
    reviewInk.push(stroke);
    drawSignature(canvas, reviewInk);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const [x, y] = point(event);
    stroke.push(x, y);
    drawSignature(canvas, reviewInk);
  });
  const stop = () => {
    drawing = false;
    stroke = [];
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
}

function paintReviewChrome() {
  const reviewing = taxReviewStep > 0;
  paintReviewDots();
  const star = document.querySelector("#tax-sheet .tax-star-note");
  if (star) star.hidden = reviewing && taxReviewStep !== 2;
  const goods = $("tax-sheet-goods");
  if (goods) goods.hidden = reviewing && taxReviewStep !== 2;
  const figures = $("tax-sheet-figures");
  if (figures) figures.hidden = reviewing;
  const expenses = $("tax-sheet-expenses");
  if (expenses) expenses.hidden = reviewing && taxReviewStep !== 3;
  const levy = $("tax-sheet-levy");
  if (levy) levy.hidden = reviewing;
  const invoice = document.querySelector("#tax-sheet .tax-invoice");
  if (invoice) invoice.hidden = reviewing;
  const actions = document.querySelector("#tax-sheet .tax-sheet-actions");
  if (actions) actions.hidden = reviewing;
  const nav = $("tax-review-nav");
  if (nav) nav.hidden = taxReviewStep < 1 || taxReviewStep > 3;
  const filed = $("tax-review-sign");
  if (filed) filed.hidden = taxReviewStep !== 4;
  const own = $("tax-review-own");
  if (own) own.hidden = taxReviewStep !== 5;
  if (taxReviewStep === 4) paintFilerSign();
  if (taxReviewStep === 5) {
    bindReviewPad();
    const pad = $("tax-review-pad");
    if (pad) drawSignature(pad, reviewInk);
  }
}

function readIdentity(item) {
  document.querySelectorAll("#tax-sheet-meta [data-ident]").forEach((input) => {
    const key = input.dataset.ident;
    const limit = key === "session" || key === "sheet" ? 6 : 40;
    item[key] = input.value.trim().slice(0, limit);
  });
  saveTaxes();
}

function startTaxReview(id) {
  const item = taxes.find((entry) => entry.id === id);
  reviewBackup = item ? JSON.parse(JSON.stringify(item)) : null;
  taxSheetId = id;
  taxReviewStep = 1;
  taxEditing = false;
  reviewInk = [];
  const msg = $("tax-sheet-msg");
  if (msg) msg.textContent = "";
  fillTaxSheet();
  setSide("tax-sheet", true);
}

function taxReviewNext() {
  const item = taxes.find((entry) => entry.id === taxSheetId);
  const msg = $("tax-sheet-msg");
  if (!item) return;
  if (msg) msg.textContent = "";
  if (taxReviewStep === 1) {
    readIdentity(item);
    taxReviewStep = 2;
    taxEditing = true;
  } else if (taxReviewStep === 2) {
    item.lines = linesFromSheet(item);
    item.totals = taxTotals(item.lines, taxRatesOf(item), item.expenses || []);
    saveTaxes();
    taxEditing = false;
    taxReviewStep = 3;
  } else if (taxReviewStep === 3) {
    if ((item.expenses || []).some((entry) => entry.decision !== "yes")) {
      if (msg) msg.textContent = "Approve or deny each expense.";
      return;
    }
    item.totals = taxTotals(item.lines || [], taxRatesOf(item), item.expenses || []);
    saveTaxes();
    taxReviewStep = 4;
  }
  fillTaxSheet();
}

function finishReview() {
  const item = taxes.find((entry) => entry.id === taxSheetId);
  const msg = $("tax-sheet-msg");
  if (!item) return;
  if (!reviewInk.length) {
    if (msg) msg.textContent = "Sign to finish the review.";
    return;
  }
  item.reviewSign = cleanSign(reviewInk);
  const totals = taxTotals(item.lines || [], taxRatesOf(item), item.expenses || []);
  const problem = payTax(item, totals);
  if (problem) {
    if (msg) msg.textContent = problem;
    return;
  }
  reviewBackup = null;
  taxReviewStep = 0;
  taxEditing = false;
  taxSheetId = "";
  setSide("tax-sheet", false);
  renderGovernment();
  toast("Review finished");
}

function openTaxSheet(id) {
  const opening = taxes.find((entry) => entry.id === id);
  if (opening && opening.status === "review") {
    startTaxReview(id);
    return;
  }
  taxReviewStep = 0;
  if (taxSheetId !== id) taxEditing = false;
  taxSheetId = id;
  const button = $("tax-sheet-edit");
  if (button) {
    button.classList.remove("is-on");
    button.setAttribute("aria-pressed", "false");
  }
  fillTaxSheet();
  setSide("tax-sheet", true);
}

function fillTaxSheet() {
  const item = taxes.find((entry) => entry.id === taxSheetId);
  if (!item || !$("tax-sheet")) {
    taxSheetId = "";
    setSide("tax-sheet", false);
    return;
  }
  const totals = taxEditing
    ? taxTotals(item.lines || [], taxRatesOf(item), item.expenses || [])
    : (item.totals || { revenue: "0", vat: "0", profit: "0", expenses: "0", tax: "0", invoice: "0" });
  $("tax-sheet-name").textContent = taxReviewStep ? "Review tax return" : `${item.business || "Tax return"} tax return`;
  $("tax-sheet-date").textContent = sessionDateLong(item.ts || Date.now());
  paintIdentity(item);
  const goods = $("tax-sheet-goods");
  goods.replaceChildren();
  const goodsTable = sheetTable(
    ["Goods Description", "Quantity sold", "Gross Amount", "VAT", "Net profit"],
    ["30%", "14%", "20%", "16%", "20%"],
  );
  let gross = 0n;
  let vat = 0n;
  let profit = 0n;
  (item.lines || []).forEach((line, index) => {
    const parts = splitVat(line.revenue, item.vatRate);
    gross += parts.revenue;
    vat += parts.vat;
    profit += parts.profit;
    if (!taxEditing) {
      goodsTable.body.append(sheetRow([
        line.name,
        formatFull(line.qty),
        formatBillions(parts.revenue),
        formatBillions(parts.vat),
        formatBillions(parts.profit),
      ]));
      return;
    }
    const row = document.createElement("tr");
    row.dataset.line = String(index);
    const name = document.createElement("td");
    name.append(editField(line.name, "name", false));
    const qty = document.createElement("td");
    qty.className = "num";
    qty.append(editField(formatFull(line.qty), "qty", true));
    const revenue = document.createElement("td");
    revenue.className = "num";
    revenue.append(editField(billionsInputValue(parts.revenue), "revenue", true));
    const vatCell = document.createElement("td");
    vatCell.className = "num";
    vatCell.dataset.calc = "vat";
    vatCell.textContent = formatBillions(parts.vat);
    const profitCell = document.createElement("td");
    profitCell.className = "num";
    profitCell.dataset.calc = "profit";
    profitCell.textContent = formatBillions(parts.profit);
    row.append(name, qty, revenue, vatCell, profitCell);
    goodsTable.body.append(row);
  });
  goodsTable.body.append(sheetRow(["Total", "", formatBillions(gross), formatBillions(vat), formatBillions(profit)], true));
  goods.append(goodsTable.table);
  paintFigures(totals);
  const exp = $("tax-sheet-expenses");
  exp.replaceChildren();
  if (taxReviewStep === 3) {
    paintReviewExpenses();
  } else if ((item.expenses || []).length) {
    const expenseTable = sheetTable(["Expense", "Amount"], ["70%", "30%"]);
    item.expenses.forEach((entry, index) => {
      if (!taxEditing) {
        expenseTable.body.append(sheetRow([entry.name, formatBillions(entry.amount)]));
        return;
      }
      const row = document.createElement("tr");
      row.dataset.expense = String(index);
      const name = document.createElement("td");
      name.append(editField(entry.name, "name", false));
      const amount = document.createElement("td");
      amount.className = "num";
      amount.append(editField(billionsInputValue(entry.amount), "amount", true));
      row.append(name, amount);
      expenseTable.body.append(row);
    });
    exp.append(expenseTable.table);
  }
  paintLevy(item, totals);
  paintReviewChrome();
}

function renderGovernment() {
  const collected = $("tax-collected");
  if (collected) collected.textContent = `${formatAmount(taxCollected().toString())} ₲`;
  renderTaxBar();
  renderEarnings();
  const list = $("gov-list");
  const empty = $("gov-empty");
  const gamingList = $("gaming-tax-list");
  const gamingEmpty = $("gaming-tax-empty");
  const switcher = $("tax-switch");
  if (switcher) switcher.classList.toggle("is-gaming", taxPane === "gaming");
  const incomeTab = $("tax-tab-income");
  const gamingTab = $("tax-tab-gaming");
  if (incomeTab) incomeTab.setAttribute("aria-selected", taxPane === "income" ? "true" : "false");
  if (gamingTab) gamingTab.setAttribute("aria-selected", taxPane === "gaming" ? "true" : "false");
  if (list) list.hidden = taxPane !== "income";
  if (empty) empty.hidden = taxPane !== "income" || taxes.length > 0;
  if (gamingList) gamingList.hidden = taxPane !== "gaming";
  if (gamingEmpty) gamingEmpty.hidden = taxPane !== "gaming" || plays.some((item) => item.status === "out" && BigInt(item.tax || "0") > 0n);
  if (!list || !empty) return;
  list.replaceChildren();
  taxes.forEach((item) => {
    const totals = item.totals || { revenue: "0", vat: "0", profit: "0", expenses: "0", tax: "0", invoice: "0" };
    const card = document.createElement("article");
    card.className = "tax-file tax-fold";
    const bar = document.createElement("div");
    bar.className = "tax-fold-bar";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "tax-fold-main";
    const grid = document.createElement("span");
    grid.className = "tax-card";
    const business = document.createElement("strong");
    business.className = "biz";
    business.textContent = item.business || "Tax return";
    if (item.status === "review") {
      const lock = document.createElement("span");
      lock.className = "tax-lock";
      lock.setAttribute("aria-label", "Needs approval");
      lock.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      business.append(lock);
    }
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = sessionDateLong(item.ts || Date.now());
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = item.owner;
    const money = document.createElement("span");
    money.className = "sum";
    money.textContent = `${formatAmount(totals.invoice)} ₲`;
    grid.append(business, when, who, money);
    main.append(grid);
    main.addEventListener("click", () => openTaxSheet(item.id));
    bar.append(main);
    card.append(bar);
    list.append(card);
  });
  if (taxSheetId && !taxEditing && !taxReviewStep) fillTaxSheet();
  if (!gamingList) return;
  gamingList.replaceChildren();
  const casino = state.accounts.find((account) => account.id === state.settings.gamingAccountId);
  plays.filter((item) => item.status === "out" && BigInt(item.tax || "0") > 0n).forEach((item) => {
    const card = document.createElement("article");
    card.className = "tax-file";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "game-open";
    const grid = document.createElement("span");
    grid.className = "tax-card";
    const business = document.createElement("strong");
    business.className = "biz";
    business.textContent = `${casino ? casino.name : "Casino"} (${item.name})`;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = sessionDateLong(item.ts || Date.now());
    const money = document.createElement("span");
    money.className = "sum";
    money.textContent = `${formatAmount(item.tax)} ₲`;
    const spacer = document.createElement("span");
    grid.append(business, when, spacer, money);
    main.append(grid);
    main.addEventListener("click", () => openPlayDetail(item.id));
    card.append(main);
    gamingList.append(card);
  });
}

async function catchUp() {
  const res = await fetch(`${NTFY}/${TOPIC}/json?poll=1&since=${encodeURIComponent(sinceQuery())}`, { cache: "no-store" });
  if (res.status !== 404 && !res.ok) throw new Error(String(res.status));
  const bucket = { ping: false, applied: [] };
  const text = res.status === 404 ? "" : await res.text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      await handleMessage(JSON.parse(trimmed), bucket);
    } catch {
      /* Skip a line that is not a message. */
    }
  }
  const asked = Boolean(bucket.ping || bucket.applied.length || bucket.requests);
  if (!asked && announced) return;
  if (!state.accounts.length && !bucket.applied.length && !bucket.requests) return;
  if (bucket.ping) await publishPong(bucket.ping);
  if (bucket.sync) showSyncing();
  try {
    await publishLedger(bucket.applied, bucket.ping || "");
  } finally {
    if (bucket.sync) hideSyncing();
  }
  announced = true;
  lastAnnounce = Date.now();
  if (streamOpen) setStatus("Listening for the other phone");
}

function listen() {
  if (source) source.close();
  source = new EventSource(`${NTFY}/${TOPIC}/sse?since=${encodeURIComponent(sinceQuery())}`);
  source.onopen = () => {
    streamOpen = true;
    lastStream = Date.now();
    paintLink();
  };
  source.onerror = () => {
    streamOpen = false;
    setTimeout(paintLink, 4000);
  };
  let inbound = Promise.resolve();
  source.onmessage = (event) => {
    lastStream = Date.now();
    inbound = inbound.then(async () => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const bucket = { ping: false, applied: [] };
      await handleMessage(data, bucket);
      if (!state.accounts.length) return;
      if (bucket.ping) publishPong(bucket.ping);
      const work = Boolean(bucket.sync || bucket.applied.length || bucket.requests);
      if (!work && (!bucket.ping || Date.now() - lastAnnounce < 40000)) return;
      if (bucket.sync) showSyncing();
      try {
        await publishLedger(bucket.applied, bucket.ping || "");
        lastAnnounce = Date.now();
        if (streamOpen) setStatus("Listening for the other phone");
      } catch {
        setStatus("Saved on this phone. The other phone will catch up when the connection is back.");
      } finally {
        if (bucket.sync) hideSyncing();
      }
    }).catch(() => {});
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

function deleteAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  state.accounts = state.accounts.filter((item) => item.id !== account.id);
  saveAccounts();
  logActivity(`Removed ${account.name}.`);
  render();
  publishLedger([]).catch(() => {});
}

function deleteLog(id) {
  const index = requests.findIndex((item) => item.id === id);
  if (index < 0) return;
  requests.splice(index, 1);
  saveRequests();
  render();
  publishLedger([]).catch(() => {});
}

let passEditId = "";

function openPassword(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  passEditId = id;
  $("pass-title").textContent = account.name;
  $("pass-edit").hidden = false;
  $("pass-view").value = account.pw || "";
  $("pass-view").placeholder = account.pw ? "" : "Not saved on this phone";
  $("pass-view").readOnly = true;
  $("pass-save").hidden = true;
  $("pass-error").textContent = "";
  $("pass-sheet").hidden = false;
}

function showSignature(item) {
  const strokes = cleanSign(item.sign);
  $("sign-title").textContent = "Signature";
  $("sign-empty").textContent = "No signature was saved for this exchange.";
  $("sign-empty").hidden = strokes.length > 0;
  $("sign-sheet").hidden = false;
  requestAnimationFrame(() => drawSignature($("sign-view"), strokes));
}

function showUsual(account) {
  const strokes = usualSign(account.id);
  $("sign-title").textContent = `Usual signature for ${account.name}`;
  $("sign-empty").textContent = "No signature yet for this account.";
  $("sign-empty").hidden = strokes.length > 0;
  $("sign-sheet").hidden = false;
  requestAnimationFrame(() => drawSignature($("sign-view"), strokes));
}

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
  delete usual[account.id];
  saveUsual();
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

function playSuccess() {
  const audio = $("success-sound");
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function takeTransfer(body) {
  if (!body || !body.id || !remember(body.id)) return false;
  const from = state.accounts.find((item) => item.id === body.fromId);
  const to = state.accounts.find((item) => item.id === body.toId);
  const amount = parseAmount(body.amount);
  if (!from || !to || from.id === to.id || amount == null || body.ph !== from.ph) {
    publishReject(body.id, from ? "The password did not match." : "That account was removed.");
    return false;
  }
  const value = BigInt(amount);
  if (value <= 0n || value % 1000000000n !== 0n) {
    publishReject(body.id, "Transfer a whole number of billions.");
    return false;
  }
  if (value > BigInt(from.bal)) {
    publishReject(body.id, "Not enough gizbits.");
    return false;
  }
  const nextTo = BigInt(to.bal) + value;
  if (nextTo > MAX) {
    publishReject(body.id, "That balance would be too large.");
    return false;
  }
  from.bal = (BigInt(from.bal) - value).toString();
  to.bal = nextTo.toString();
  saveAccounts();
  requests.unshift({
    id: body.id,
    accountId: from.id,
    name: from.name,
    op: "transfer",
    amount,
    status: "sent",
    applied: amount,
    toId: to.id,
    toName: to.name,
    ts: Date.now(),
    sign: cleanSign(body.sign),
  });
  requests.splice(40);
  saveRequests();
  noteSign(from.id, body.id, body.sign);
  logActivity(`${from.name} transferred ${formatAmount(amount)} ₲ to ${to.name}.`);
  render();
  return true;
}

function takeRequest(req) {
  if (!req || !req.id || !remember(req.id)) return false;
  const account = state.accounts.find((item) => item.id === req.accountId);
  const amount = parseAmount(req.amount);
  const op = req.op === "deposit" || req.op === "withdraw" ? req.op : "";
  if (!account || !op || amount == null || req.ph !== account.ph) {
    publishReject(req.id, account ? "The password did not match." : "That account was removed.");
    return false;
  }
  requests.unshift({
    id: req.id,
    accountId: account.id,
    name: account.name,
    op,
    amount,
    status: "pending",
    applied: "",
    ts: Date.now(),
    sign: cleanSign(req.sign),
  });
  requests.splice(40);
  saveRequests();
  noteSign(account.id, req.id, req.sign);
  renderRequests();
  notifyPending(requests[0]);
  return true;
}

function savePlays() {
  localStorage.setItem(PLAYS, JSON.stringify(plays.slice(0, 40)));
}

function takeGaming(body) {
  if (!body || typeof body.id !== "string" || !remember(body.id)) return false;
  const account = state.accounts.find((item) => item.id === body.accountId);
  const amount = parseAmount(body.amount);
  if (!account || amount == null || body.ph !== account.ph) {
    publishReject(body.id, account ? "The password did not match." : "That account was removed.");
    return false;
  }
  if (BigInt(account.bal) < BigInt(amount)) {
    publishReject(body.id, "Not enough gizbits.");
    return false;
  }
  plays.unshift({
    id: body.id,
    accountId: account.id,
    name: account.name,
    amount,
    cashOut: "",
    status: "review",
    sign: cleanSign(body.sign),
    session: currentSessionLabel(),
    ts: Date.now(),
  });
  plays.splice(40);
  savePlays();
  renderGaming();
  showIncoming(`${account.name} cashed in ${formatAmount(amount)} ₲. Tap to open it.`, "gaming");
  if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(`Cash in from ${account.name}`, {
        body: `${formatAmount(amount)} ₲`,
        tag: body.id,
        renotify: true,
        data: { id: body.id },
      });
    }).catch(() => {});
  }
  return true;
}

function disburseChips(id) {
  const play = plays.find((item) => item.id === id && item.status === "review");
  if (!play) return;
  const player = state.accounts.find((item) => item.id === play.accountId);
  const sink = state.accounts.find((item) => item.id === state.settings.gamingAccountId);
  const card = document.querySelector(`[data-play="${id}"] .game-error`);
  const fail = (text) => {
    if (card) card.textContent = text;
    else toast(text);
  };
  if (!player) {
    fail("That account is no longer on this phone.");
    return;
  }
  if (!sink) {
    fail("Choose the gaming account in Settings.");
    return;
  }
  if (sink.id === player.id) {
    fail("Choose a different account for gaming cash.");
    return;
  }
  if (BigInt(player.bal) < BigInt(play.amount)) {
    fail("Not enough gizbits in that account.");
    return;
  }
  const nextSink = BigInt(sink.bal) + BigInt(play.amount);
  if (nextSink > MAX) {
    fail("That gaming account cannot hold that much.");
    return;
  }
  player.bal = (BigInt(player.bal) - BigInt(play.amount)).toString();
  sink.bal = nextSink.toString();
  play.status = "chips";
  requests.unshift({
    id: play.id,
    accountId: player.id,
    name: player.name,
    op: "transfer",
    amount: play.amount,
    status: "done",
    applied: play.amount,
    toId: sink.id,
    toName: sink.name,
    memo: "Casino cash in",
    ts: Date.now(),
    sign: play.sign || [],
  });
  requests.splice(80);
  saveAccounts();
  saveRequests();
  savePlays();
  render();
  if ($("play-sheet") && $("play-sheet").classList.contains("is-open")) fillPlaySheet(id);
  clearNotification(play.id);
  publishLedger([play.id]).catch(() => setStatus("Saved on this phone. The terminal will catch up when the connection is back."));
  publishPlay(play);
  toast("Chips disbursed");
}

function cashOutPlay(id) {
  const play = plays.find((item) => item.id === id && item.status === "chips");
  const input = document.querySelector(`[data-play="${id}"] input`);
  const card = document.querySelector(`[data-play="${id}"] .game-error`);
  const fail = (text) => {
    if (card) card.textContent = text;
  };
  if (!play || !input) return;
  if (card) card.textContent = "";
  const amount = moneyText(input.value, false);
  if (amount == null) {
    fail("Enter how much they are cashing out.");
    return;
  }
  const player = state.accounts.find((item) => item.id === play.accountId);
  const sink = state.accounts.find((item) => item.id === state.settings.gamingAccountId);
  if (!player || !sink) {
    fail("That account is no longer on this phone.");
    return;
  }
  const gross = BigInt(amount);
  const stake = BigInt(play.amount || "0");
  const profit = gross > stake ? gross - stake : 0n;
  const tax = floorBillion(profit * BigInt(state.settings.gamingTax || DEFAULT_GAMING_TAX) / 100n);
  const net = gross - tax;
  if (BigInt(sink.bal) < gross) {
    fail("The gaming account does not have enough gizbits.");
    return;
  }
  const taxAccount = tax > 0n ? state.accounts.find((item) => item.id === state.settings.taxAccountId) : null;
  if (tax > 0n && !taxAccount) {
    fail("Choose the account that receives tax payments.");
    return;
  }
  if (taxAccount && (taxAccount.id === sink.id || taxAccount.id === player.id)) {
    fail("Choose a different account for tax payments.");
    return;
  }
  const nextPlayer = BigInt(player.bal) + net;
  const nextTax = taxAccount ? BigInt(taxAccount.bal) + tax : 0n;
  if (nextPlayer > MAX || nextTax > MAX) {
    fail("That account cannot hold that much.");
    return;
  }
  sink.bal = (BigInt(sink.bal) - gross).toString();
  player.bal = nextPlayer.toString();
  if (taxAccount) taxAccount.bal = nextTax.toString();
  play.status = "out";
  play.cashOut = amount;
  play.tax = tax.toString();
  if (net > 0n) {
    requests.unshift({
      id: `${play.id}-out`,
      accountId: sink.id,
      name: sink.name,
      op: "transfer",
      amount: net.toString(),
      status: "done",
      applied: net.toString(),
      toId: player.id,
      toName: player.name,
      memo: "Casino cash out",
      ts: Date.now(),
    });
  }
  if (tax > 0n && taxAccount) {
    requests.unshift({
      id: `${play.id}-tax`,
      accountId: sink.id,
      name: sink.name,
      op: "transfer",
      amount: tax.toString(),
      status: "done",
      applied: tax.toString(),
      toId: taxAccount.id,
      toName: taxAccount.name,
      memo: "Tax on gaming profits",
      ts: Date.now(),
    });
  }
  const house = stake > gross ? stake - gross : 0n;
  const cutRate = BigInt(state.settings.casinoCut || "0");
  const cutAccount = state.accounts.find((item) => item.id === state.settings.casinoCutAccountId);
  let cut = 0n;
  if (house > 0n && cutRate > 0n && cutAccount && cutAccount.id !== sink.id && cutAccount.id !== player.id) {
    cut = floorBillion(house * cutRate / 100n);
    if (cut > 0n && BigInt(sink.bal) >= cut && BigInt(cutAccount.bal) + cut <= MAX) {
      sink.bal = (BigInt(sink.bal) - cut).toString();
      cutAccount.bal = (BigInt(cutAccount.bal) + cut).toString();
      play.cut = cut.toString();
      play.cutName = cutAccount.name;
      requests.unshift({
        id: `${play.id}-cut`,
        accountId: sink.id,
        name: sink.name,
        op: "transfer",
        amount: cut.toString(),
        status: "done",
        applied: cut.toString(),
        toId: cutAccount.id,
        toName: cutAccount.name,
        memo: "Casino profit share",
        ts: Date.now(),
      });
    }
  }
  if (net > 0n || tax > 0n || cut > 0n) {
    requests.splice(80);
    saveRequests();
  }
  saveAccounts();
  savePlays();
  render();
  publishLedger([]).catch(() => setStatus("Saved on this phone. The terminal will catch up when the connection is back."));
  publishPlay(play);
  if ($("play-sheet") && $("play-sheet").classList.contains("is-open")) fillPlaySheet(id);
  toast("Cash out saved");
}

function deletePlay(id) {
  const index = plays.findIndex((item) => item.id === id);
  if (index < 0) return;
  plays.splice(index, 1);
  savePlays();
  if (playOpenId === id) {
    playOpenId = "";
    setSide("play-sheet", false);
  }
  renderGaming();
  renderGovernment();
  publish("Play removed", { v: 1, kind: "play-delete", id, ts: Date.now() }).catch(() => {});
}

function moneyRow(label, value) {
  return sheetRow([label, `${formatAmount(value)} ₲`]);
}

function fillPlaySheet(id) {
  const play = plays.find((item) => item.id === id);
  const body = $("play-body");
  if (!play || !body) {
    playOpenId = "";
    setSide("play-sheet", false);
    return;
  }
  playOpenId = id;
  const casino = state.accounts.find((account) => account.id === state.settings.gamingAccountId);
  $("play-title").textContent = play.name || "Gaming";
  body.dataset.play = play.id;
  body.replaceChildren();
  const who = document.createElement("table");
  who.className = "tax-sheet-table";
  const whoBody = document.createElement("tbody");
  [
    ["Name", play.name || ""],
    ["Time", sessionClockTime(play.ts || Date.now())],
    ["Date", sessionDateLong(play.ts || Date.now())],
    ["Session number", play.session || ""],
    ["Account", casino ? casino.name : ""],
  ].forEach(([label, value]) => whoBody.append(sheetRow([label, value])));
  who.append(whoBody);
  body.append(who);
  const inn = BigInt(play.amount || "0");
  const out = BigInt(play.cashOut || "0");
  const tax = BigInt(play.tax || "0");
  const profit = out > inn ? out - inn : 0n;
  const figures = document.createElement("table");
  figures.className = "tax-sheet-table";
  const figBody = document.createElement("tbody");
  figBody.append(moneyRow("Cashed in", inn.toString()));
  if (play.status === "out") {
    figBody.append(moneyRow("Cashed out", out.toString()));
    figBody.append(moneyRow("Profit", profit.toString()));
    figBody.append(sheetRow(["Tax", `${formatAmount(tax.toString())} ₲`], true));
    if (BigInt(play.cut || "0") > 0n) {
      figBody.append(moneyRow("Profit share", play.cut));
      if (play.cutName) figBody.append(sheetRow(["Share paid to", play.cutName]));
    }
  }
  figures.append(figBody);
  body.append(figures);
  if (play.status === "review") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = "Casino cash in";
    button.addEventListener("click", () => disburseChips(play.id));
    body.append(button);
  } else if (play.status === "chips") {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = "Cashing out";
    const input = document.createElement("input");
    input.id = "play-cash";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.placeholder = "Amount";
    label.append(span, input);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn";
    save.textContent = "Save cash out";
    save.addEventListener("click", () => cashOutPlay(play.id));
    body.append(label, save);
  }
  const error = document.createElement("p");
  error.className = "game-error error";
  body.append(error);
  if (play.sign && play.sign.length) {
    const sign = document.createElement("button");
    sign.type = "button";
    sign.className = "btn ghost";
    sign.textContent = "Signature";
    sign.addEventListener("click", () => showSignature(play));
    body.append(sign);
  }
}

function openPlayDetail(id) {
  fillPlaySheet(id);
  setSide("play-sheet", true);
}

function renderGaming() {
  const list = $("gaming-list");
  const empty = $("gaming-empty");
  if (!list || !empty) return;
  list.classList.toggle("is-bin", gamingBin);
  list.replaceChildren();
  empty.hidden = plays.length > 0;
  plays.forEach((play) => {
    const swipe = document.createElement("div");
    swipe.className = "game-swipe";
    const bin = document.createElement("button");
    bin.type = "button";
    bin.className = "game-bin";
    bin.setAttribute("aria-label", `Delete ${play.name}`);
    bin.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    bin.addEventListener("click", () => deletePlay(play.id));
    const card = document.createElement("article");
    card.className = "game-card";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "game-open";
    const grid = document.createElement("span");
    grid.className = "tax-card";
    const person = document.createElement("strong");
    person.className = "biz";
    person.textContent = play.name;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = sessionDateLong(play.ts || Date.now());
    const money = document.createElement("span");
    money.className = "sum";
    money.textContent = `${formatAmount(play.amount)} ₲`;
    const spacer = document.createElement("span");
    grid.append(person, when, spacer, money);
    open.append(grid);
    open.addEventListener("click", () => {
      if (gamingBin) return;
      openPlayDetail(play.id);
    });
    card.append(open);
    swipe.append(bin, card);
    list.append(swipe);
  });
}

function showIncoming(text, dest) {
  showBanner(text, dest);
}

function notifyPending(item) {
  const verb = item.op === "withdraw" ? "withdrawal" : "deposit";
  showIncoming(`${item.name} sent a ${verb}. Tap to open it.`);
  if (!("Notification" in window) || Notification.permission !== "granted" || !navigator.serviceWorker) return;
  const title = `Exchange pending from ${item.name}`;
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(title, {
      body: `${item.op === "withdraw" ? "Withdrawal" : "Deposit"} of ${formatAmount(item.amount)} ₲`,
      tag: item.id,
      renotify: true,
      data: { id: item.id },
    });
  }).catch(() => {});
}

function clearNotification(id) {
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.getNotifications({ tag: id }))
    .then((notes) => notes.forEach((note) => note.close()))
    .catch(() => {});
}

function takePassword(body) {
  if (!body || !body.id || !remember(body.id)) return false;
  const account = state.accounts.find((item) => item.id === body.accountId);
  const next = String(body.next || "");
  const pw = String(body.pw || "").slice(0, 100);
  if (!account || body.ph !== account.ph || !/^[0-9a-f]{64}$/.test(next) || !pw) {
    publishReject(body.id, account ? "The password did not match." : "That account was removed.");
    return false;
  }
  account.ph = next;
  account.pw = pw;
  saveAccounts();
  passNotes.unshift({ id: body.id, accountId: account.id, name: account.name, pw, ts: Date.now() });
  passNotes.splice(20);
  savePassNotes();
  render();
  publishLedger([]).catch(() => {});
  notifyPass(passNotes[0]);
  return true;
}

function notifyPass(note) {
  if (!note) return;
  showIncoming(`${note.name} changed their password. Tap to open it.`);
  if (!("Notification" in window) || Notification.permission !== "granted" || !navigator.serviceWorker) return;
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(`Password change from ${note.name}`, {
      body: "Open the dashboard to see the new password.",
      tag: note.id,
      renotify: true,
    });
  }).catch(() => {});
}

function showPassNote(id) {
  const index = passNotes.findIndex((item) => item.id === id);
  if (index < 0) return;
  const note = passNotes[index];
  passNotes.splice(index, 1);
  savePassNotes();
  renderRequests();
  clearNotification(id);
  passEditId = "";
  $("pass-title").textContent = note.name;
  $("pass-view").value = note.pw;
  $("pass-view").readOnly = true;
  $("pass-edit").hidden = true;
  $("pass-save").hidden = true;
  $("pass-error").textContent = "";
  $("pass-sheet").hidden = false;
}

function renderRequests() {
  const list = $("request-list");
  list.replaceChildren();
  assetBuys.filter((item) => item.status === "pending").forEach((item) => {
    const li = document.createElement("li");
    li.className = "request is-pending";
    const time = document.createElement("time");
    time.dateTime = new Date(item.ts).toISOString();
    time.textContent = formatWhen(item.ts);
    const line = document.createElement("span");
    line.textContent = `${item.name} wants to own ${item.assetName}`;
    li.append(time, line);
    li.addEventListener("click", () => openAssetBuy(item.id));
    list.append(li);
  });
  requests.filter((item) => item.status === "pending").forEach((item) => {
    const li = document.createElement("li");
    li.className = `request is-${item.status}`;
    const time = document.createElement("time");
    time.dateTime = new Date(item.ts).toISOString();
    time.textContent = formatWhen(item.ts);
    const verb = item.op === "withdraw" ? "Withdrawal" : "Deposit";
    const line = document.createElement("span");
    line.textContent = `${item.name} · ${verb} · ${formatAmount(item.amount)} ₲`;
    li.append(time, line);
    if (item.status === "denied") {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "Denied";
      li.append(tag);
    } else if (item.status === "part") {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = `Received ${formatAmount(item.applied)} ₲`;
      li.append(tag);
    }
    if (item.status === "pending") {
      li.addEventListener("click", () => openDecision(item.id));
    }
    list.append(li);
  });
  passNotes.forEach((note) => {
    const li = document.createElement("li");
    li.className = "request is-password";
    const time = document.createElement("time");
    time.dateTime = new Date(note.ts).toISOString();
    time.textContent = formatWhen(note.ts);
    const line = document.createElement("span");
    line.textContent = `${note.name} changed their password`;
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "request-eye";
    eye.setAttribute("aria-label", `Show the new password for ${note.name}`);
    eye.innerHTML = eyeMarkup();
    eye.addEventListener("click", (event) => {
      event.stopPropagation();
      showPassNote(note.id);
    });
    li.append(time, line, eye);
    list.append(li);
  });
  const notify = $("notify-go");
  if (!("Notification" in window) || Notification.permission === "granted") {
    notify.hidden = true;
  } else {
    notify.hidden = false;
    notify.textContent = Notification.permission === "denied" ? "Notifications are blocked in iPhone Settings" : "Turn on notifications";
  }
}

let decisionId = "";

function openDecision(id) {
  const item = requests.find((entry) => entry.id === id && entry.status === "pending");
  if (!item) return;
  decisionId = id;
  const verb = item.op === "withdraw" ? "Withdrawal" : "Deposit";
  $("decision-text").textContent = `${item.name} wants to ${item.op} ${formatAmount(item.amount)} ₲ (${formatFull(item.amount)}).`;
  $("decision-title").textContent = verb;
  $("decision-error").textContent = "";
  $("part-amount").value = "";
  $("part-wrap").hidden = true;
  $("part-go").hidden = true;
  const actions = $("decision-actions");
  actions.replaceChildren();
  const add = (label, className, status) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn ${className}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      if (status === "part") {
        $("part-wrap").hidden = false;
        $("part-go").hidden = false;
        $("part-amount").focus();
        return;
      }
      decide(status, item.amount);
    });
    actions.append(button);
  };
  if (item.op === "withdraw") add("Money disbursed", "green", "disbursed");
  else {
    add("Received money in whole", "green", "whole");
    add("Did not receive money", "red", "denied");
    add("Received money in part", "yellow", "part");
  }
  $("decision").hidden = false;
}

function closeDecision() {
  decisionId = "";
  $("decision").hidden = true;
}

function decide(status, appliedAmount) {
  const item = requests.find((entry) => entry.id === decisionId && entry.status === "pending");
  if (!item) return;
  const error = $("decision-error");
  error.textContent = "";
  if (status === "denied") {
    item.status = "denied";
    item.applied = "";
    saveRequests();
    renderRequests();
    clearNotification(item.id);
    const done = item;
    closeDecision();
    publishDecision(done);
    publishLedger([]).catch(() => setStatus("Saved on this phone. The other phone will catch up when the connection is back."));
    return;
  }
  const account = state.accounts.find((entry) => entry.id === item.accountId);
  const amount = parseAmount(appliedAmount);
  if (!account || amount == null) {
    error.textContent = "Enter how much you received.";
    return;
  }
  if (status === "part" && BigInt(amount) > BigInt(item.amount)) {
    error.textContent = "That is more than the exchange amount.";
    return;
  }
  const next = item.op === "deposit" ? BigInt(account.bal) + BigInt(amount) : BigInt(account.bal) - BigInt(amount);
  if (next < 0n) {
    error.textContent = "Not enough gizbits in that account.";
    return;
  }
  if (next > MAX) {
    error.textContent = "That would make the balance too large.";
    return;
  }
  account.bal = next.toString();
  item.status = status;
  item.applied = amount;
  saveAccounts();
  saveRequests();
  render();
  clearNotification(item.id);
  if (status === "whole" || status === "disbursed") playSuccess();
  const done = item;
  closeDecision();
  publishDecision(done);
  publishLedger([]).catch(() => setStatus("Saved on this phone. The other phone will catch up when the connection is back."));
}

function publishDecision(item) {
  const sentence = item.status === "denied"
    ? `Exchange denied for ${item.name}`
    : `Exchange confirmed for ${item.name}`;
  return publish(sentence, {
    v: 1,
    kind: "decision",
    id: item.id,
    status: item.status,
    applied: item.applied || "",
    accountId: item.accountId,
    ts: Date.now(),
  }).catch(() => {});
}

function maybeOpenLinked() {
  const params = new URLSearchParams(location.search);
  if (params.get("tab") !== "requests") return;
  showTab("home");
  const id = params.get("request");
  if (id) openDecision(id);
}

function readPercent(id) {
  const raw = $(id).value.replace(/[,\s%]/g, "");
  if (!/^\d{1,3}$/.test(raw)) return "";
  const rate = BigInt(raw);
  if (rate > 100n) return "";
  return rate.toString();
}

function mountPicker(root, options, value, onPick) {
  if (!root) return;
  const open = root.querySelector(".picker-menu");
  if (open && !open.hidden) return;
  const current = options.find((item) => item.value === value) || options[0];
  root.dataset.value = current ? current.value : "";
  root.replaceChildren();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "picker-btn";
  button.textContent = current ? current.label : "Choose";
  const menu = document.createElement("div");
  menu.className = "picker-menu";
  menu.hidden = true;
  options.forEach((item) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.textContent = item.label;
    choice.addEventListener("click", (event) => {
      event.stopPropagation();
      root.dataset.value = item.value;
      button.textContent = item.label;
      menu.hidden = true;
      if (onPick) onPick(item.value);
    });
    menu.append(choice);
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".picker-menu").forEach((node) => {
      if (node !== menu) node.hidden = true;
    });
    menu.hidden = !menu.hidden;
  });
  root.append(button, menu);
}

function accountChoices() {
  const options = [{ value: "", label: "Choose an account" }];
  state.accounts.forEach((account) => options.push({ value: account.id, label: account.name }));
  return options;
}

function fillRole(id, saved, key) {
  const root = $(id);
  if (!root) return;
  const value = root.dataset.ready ? (root.dataset.value || "") : (saved || "");
  root.dataset.ready = "1";
  mountPicker(root, accountChoices(), value, (picked) => {
    state.settings[key] = picked;
    saveAccounts();
    publishLedger([]).catch(() => {});
  });
}

function fillTaxAccount() { fillRole("tax-account", state.settings.taxAccountId, "taxAccountId"); }
function fillGamingAccount() { fillRole("gaming-account", state.settings.gamingAccountId, "gamingAccountId"); }
function fillInterestAccount() { fillRole("interest-account", state.settings.interestAccountId, "interestAccountId"); }

function fillMarkRows(fromSaved) {
  const box = $("mark-rows");
  if (!box) return;
  const skip = new Set(fromSaved || !box.childElementCount
    ? (state.settings.skipInterest || [])
    : [...box.querySelectorAll("[data-skip]:checked")].map((input) => input.value));
  const board = new Set(fromSaved || !box.childElementCount
    ? (state.settings.boardSkip || [])
    : [...box.querySelectorAll("[data-board]:checked")].map((input) => input.value));
  const attend = new Set(fromSaved || !box.childElementCount
    ? (state.settings.skipAttend || [])
    : [...box.querySelectorAll("[data-attend]:checked")].map((input) => input.value));
  const ranked = state.accounts.slice().sort((a, b) => {
    const left = BigInt(b.bal || "0");
    const right = BigInt(a.bal || "0");
    if (left > right) return 1;
    if (left < right) return -1;
    return a.name.localeCompare(b.name);
  });
  box.replaceChildren();
  ranked.forEach((account) => {
    const row = document.createElement("div");
    row.className = "mark-row";
    const name = document.createElement("span");
    name.textContent = account.name;
    const boardBox = document.createElement("input");
    boardBox.type = "checkbox";
    boardBox.dataset.board = "1";
    boardBox.value = account.id;
    boardBox.checked = board.has(account.id);
    const attendBox = document.createElement("input");
    attendBox.type = "checkbox";
    attendBox.dataset.attend = "1";
    attendBox.value = account.id;
    attendBox.checked = attend.has(account.id);
    boardBox.addEventListener("change", commitSettings);
    attendBox.addEventListener("change", commitSettings);
    row.append(name, boardBox, attendBox);
    box.append(row);
  });
}

function presetRow(value) {
  const label = document.createElement("label");
  label.className = "field";
  const input = document.createElement("input");
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.dataset.preset = "1";
  input.value = groupDigits(String(value || ""));
  input.addEventListener("input", () => {
    placeGroupedCaret(input);
    queueSettings();
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn slim";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    if (document.querySelectorAll("[data-preset]").length < 2) return;
    label.remove();
    queueSettings();
  });
  label.append(input, remove);
  return label;
}

function fillPresetFields() {
  const box = $("preset-fields");
  if (!box || document.activeElement && box.contains(document.activeElement)) return;
  box.replaceChildren();
  state.settings.presets.forEach((value) => box.append(presetRow(value)));
}

function setGrouped(id, value) {
  const node = $(id);
  if (!node || document.activeElement === node) return;
  node.value = value ? groupDigits(String(value)) : "";
}

let settingsTimer = 0;

function queueSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(commitSettings, 500);
}

function commitSettings() {
  const presetError = $("preset-error");
  const taxError = $("tax-error");
  const bankError = $("bank-error");
  if (presetError) presetError.textContent = "";
  if (taxError) taxError.textContent = "";
  if (bankError) bankError.textContent = "";
  const next = { ...state.settings, maxAmount: "" };
  if ($("preset-fields") && $("preset-fields").querySelector("[data-preset]")) {
    const presets = [...document.querySelectorAll("[data-preset]")].map((input) => parseAmount(input.value));
    if (!presets.length || presets.some((value) => value == null)) {
      if (presetError) presetError.textContent = "Each preset needs a whole number of gizbits.";
      return;
    }
    next.presets = presets;
  }
  if ($("min-amount")) {
    const minAmount = parseAmount($("min-amount").value);
    if (minAmount == null) {
      if (presetError) presetError.textContent = "Enter a minimum amount.";
      return;
    }
    next.minAmount = minAmount;
  }
  if ($("vat-rate") || $("profit-low") || $("profit-high") || $("gaming-tax")) {
    const vatRate = $("vat-rate") ? readPercent("vat-rate") : next.vatRate;
    const profitLow = $("profit-low") ? readPercent("profit-low") : next.profitLow;
    const profitHigh = $("profit-high") ? readPercent("profit-high") : next.profitHigh;
    const gamingTax = $("gaming-tax") ? readPercent("gaming-tax") : next.gamingTax;
    if (!vatRate || !profitLow || !profitHigh || !gamingTax) {
      if (taxError) taxError.textContent = "Enter each tax rate as a whole number from 0 to 100.";
      return;
    }
    next.vatRate = vatRate;
    next.profitLow = profitLow;
    next.profitHigh = profitHigh;
    next.gamingTax = gamingTax;
  }
  if ($("casino-cut")) {
    next.casinoCut = readPercent("casino-cut") || "0";
  }
  if ($("profit-threshold")) {
    const profitThreshold = parseAmount($("profit-threshold").value);
    if (!profitThreshold) {
      if (taxError) taxError.textContent = "Enter the profit tax threshold.";
      return;
    }
    next.profitThreshold = profitThreshold;
  }
  if ($("euro-rate")) {
    const euroRate = parseAmount($("euro-rate").value);
    if (euroRate == null || BigInt(euroRate) <= 0n) {
      if (taxError) taxError.textContent = "Enter how many gizbits one euro is worth.";
      return;
    }
    next.euroRate = euroRate;
  }
  if ($("terms-text")) next.terms = $("terms-text").value.trim().slice(0, 800) || DEFAULT_TERMS;
  if ($("tax-terms")) next.taxTerms = $("tax-terms").value.trim().slice(0, 400) || DEFAULT_TAX_TERMS;
  if ($("loan-terms")) next.loanTerms = $("loan-terms").value.trim().slice(0, 400) || DEFAULT_LOAN_TERMS;
  if ($("bank-limit")) {
    const bankLimit = parseAmount($("bank-limit").value);
    if (bankLimit == null || BigInt(bankLimit) <= 0n) {
      if (bankError) bankError.textContent = "Enter the bank capacity limit.";
      return;
    }
    next.bankLimit = bankLimit;
  }
  if ($("mark-rows") && $("mark-rows").childElementCount) {
    if (document.querySelector("[data-skip]")) {
      next.skipInterest = [...document.querySelectorAll("[data-skip]:checked")].map((input) => input.value);
    }
    next.boardSkip = [...document.querySelectorAll("[data-board]:checked")].map((input) => input.value);
    next.skipAttend = [...document.querySelectorAll("[data-attend]:checked")].map((input) => input.value);
  }
  if (JSON.stringify(next) === JSON.stringify(state.settings)) return;
  state.settings = next;
  saveAccounts();
  paintBankTotal();
  publishLedger([]).catch(() => {});
}

function fillSettings() {
  fillPresetFields();
  setGrouped("min-amount", state.settings.minAmount);
  setGrouped("euro-rate", state.settings.euroRate);
  setGrouped("vat-rate", state.settings.vatRate);
  setGrouped("gaming-tax", state.settings.gamingTax);
  setGrouped("casino-cut", state.settings.casinoCut || "0");
  setGrouped("profit-low", state.settings.profitLow);
  setGrouped("profit-high", state.settings.profitHigh);
  setGrouped("profit-threshold", state.settings.profitThreshold);
  setGrouped("bank-limit", state.settings.bankLimit);
  const terms = $("terms-text");
  if (terms && document.activeElement !== terms) terms.value = state.settings.terms;
  const taxTerms = $("tax-terms");
  if (taxTerms && document.activeElement !== taxTerms) taxTerms.value = state.settings.taxTerms;
  const loanTerms = $("loan-terms");
  if (loanTerms && document.activeElement !== loanTerms) loanTerms.value = state.settings.loanTerms;
  fillTaxAccount();
  fillGamingAccount();
  fillRole("casino-cut-account", state.settings.casinoCutAccountId, "casinoCutAccountId");
  fillInterestAccount();
  fillLoanAccount();
  fillMarkRows(true);
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
  document.addEventListener("contextmenu", (event) => {
    if (event.target.closest("input, textarea")) return;
    event.preventDefault();
  });
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
$("pass-edit").addEventListener("click", () => {
  $("pass-view").readOnly = false;
  $("pass-view").placeholder = "New password";
  $("pass-save").hidden = false;
  $("pass-view").focus();
});
$("pass-save").addEventListener("click", async () => {
  const account = state.accounts.find((item) => item.id === passEditId);
  const error = $("pass-error");
  error.textContent = "";
  const next = $("pass-view").value.trim();
  if (!account || !next) {
    error.textContent = "Enter a password.";
    return;
  }
  try {
    account.pw = next.slice(0, 100);
    account.ph = await sha256(next);
    saveAccounts();
    $("pass-view").readOnly = true;
    $("pass-save").hidden = true;
    toast("Password saved");
    publishLedger([]).catch(() => setStatus("Saved on this phone. The other phone will catch up when the connection is back."));
  } catch {
    error.textContent = "This page needs a secure connection before it can save a password.";
  }
});
$("pass-close").addEventListener("click", () => {
  $("pass-sheet").hidden = true;
  $("pass-edit").hidden = false;
});
$("pass-sheet").addEventListener("click", (event) => {
  if (event.target === $("pass-sheet")) $("pass-sheet").hidden = true;
});
$("sign-close").addEventListener("click", () => {
  $("sign-sheet").hidden = true;
});
$("sign-sheet").addEventListener("click", (event) => {
  if (event.target === $("sign-sheet")) $("sign-sheet").hidden = true;
});
["review-revenue", "review-profit", "review-expenses", "review-vat", "review-tax", "review-invoice"].forEach((id) => {
  $(id).addEventListener("input", () => {
    const input = $(id);
    const shown = formatFull(input.value.replace(/\D/g, ""));
    if (input.value !== shown) {
      input.value = shown === "0" ? "" : shown;
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
});
$("review-confirm").addEventListener("click", confirmTaxReview);
$("review-close").addEventListener("click", () => {
  reviewId = "";
  $("tax-review").hidden = true;
});
$("tax-review").addEventListener("click", (event) => {
  if (event.target === $("tax-review")) {
    reviewId = "";
    $("tax-review").hidden = true;
  }
});
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
  const password = $("acc-pass").value.trim();
  if (!name || !password) {
    error.textContent = "Enter a name and password.";
    return;
  }
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    state.accounts.push({ id: uid(), name: name.slice(0, 40), type: "Free", bal: "0", ph: await sha256(password), pw: password });
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
$("confirm-no").addEventListener("click", closeConfirm);
$("confirm-yes").addEventListener("click", confirmDelete);
$("confirm").addEventListener("click", (event) => {
  if (event.target === $("confirm")) closeConfirm();
});
$("decision-close").addEventListener("click", closeDecision);
$("decision").addEventListener("click", (event) => {
  if (event.target === $("decision")) closeDecision();
});
$("part-go").addEventListener("click", () => decide("part", $("part-amount").value));
$("notify-go").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    toast("This phone cannot show notifications.");
    return;
  }
  const result = await Notification.requestPermission();
  if (result !== "granted") toast("Turn on notifications for Gizbit Network in iPhone Settings, then open the app again.");
  renderRequests();
});
$("incoming").addEventListener("click", () => {
  const dest = $("incoming").dataset.goto || "";
  $("incoming").classList.remove("is-down");
  $("incoming").dataset.goto = "";
  if (dest === "gaming") {
    showTab("government");
    renderGaming();
    openArchive("gaming-archive");
    return;
  }
  showTab("home");
});
$("review-no").addEventListener("click", closeReview);
$("review-yes").addEventListener("click", markReviewed);
$("review").addEventListener("click", (event) => {
  if (event.target === $("review")) closeReview();
});
function deleteEverything() {
  state.accounts.splice(0, state.accounts.length);
  state.settings = defaultSettings();
  requests.splice(0, requests.length);
  activity.splice(0, activity.length);
  taxes.splice(0, taxes.length);
  usual = {};
  passNotes.splice(0, passNotes.length);
  localStorage.removeItem(PASSNOTES);
  localStorage.removeItem(TAXES);
  localStorage.removeItem(USUAL);
  sessions.splice(0, sessions.length);
  sessionLive = null;
  interest = freshInterest();
  localStorage.removeItem(SESSIONS);
  localStorage.removeItem(SESSION);
  localStorage.removeItem(INTEREST);
  assets.splice(0, assets.length);
  assetBuys.splice(0, assetBuys.length);
  plays.splice(0, plays.length);
  loans.splice(0, loans.length);
  contracts.splice(0, contracts.length);
  localStorage.removeItem(LOANS);
  localStorage.removeItem(CONTRACTS);
  terminalLocked = false;
  localStorage.setItem(TERM_LOCK, "0");
  paintLock();
  localStorage.removeItem(LISTED);
  localStorage.removeItem(ASSET_BUYS);
  localStorage.removeItem(PLAYS);
  ["gizbit-network-name", "gizbit-network-pair", "gizbit-phones", "gizbit-network-device"].forEach((key) => localStorage.removeItem(key));
  saveAccounts();
  saveRequests();
  saveActivity();
  render();
  fillSettings();
  $("delete-confirm").hidden = true;
  $("delete-all").hidden = false;
  toast("Everything on this phone was deleted");
  publish("Balances cleared", { v: 1, kind: "reset", ts: Date.now() })
    .catch(() => setStatus("Deleted on this phone. The terminal clears when the connection is back."));
}
$("delete-returns").addEventListener("click", () => {
  $("delete-returns").hidden = true;
  $("returns-confirm").hidden = false;
});
$("returns-no").addEventListener("click", () => {
  $("returns-confirm").hidden = true;
  $("delete-returns").hidden = false;
});
$("returns-yes").addEventListener("click", () => {
  $("returns-confirm").hidden = true;
  $("delete-returns").hidden = false;
  deleteAllReturns();
});
$("delete-all").addEventListener("click", () => {
  $("delete-all").hidden = true;
  $("delete-confirm").hidden = false;
});
$("delete-no").addEventListener("click", () => {
  $("delete-confirm").hidden = true;
  $("delete-all").hidden = false;
});
$("delete-yes").addEventListener("click", () => deleteEverything());
$("sync-go").addEventListener("click", async () => {
  const button = $("sync-go");
  button.disabled = true;
  try {
    await publishLedger([]);
    announced = true;
    lastAnnounce = Date.now();
    toast("Synced with the terminal");
    if (streamOpen) setStatus("Listening for the other phone");
  } catch {
    toast("Couldn't reach the terminal. Try again.");
    setStatus("Saved on this phone. The other phone will catch up when the connection is back.");
  } finally {
    button.disabled = false;
  }
});
function openSetting(id) {
  ["set-presets", "set-taxes", "set-terms", "set-roles", "set-marks", "set-bank"].forEach((name) => setSide(name, name === id));
  fillSettings();
}
$("open-presets").addEventListener("click", () => openSetting("set-presets"));
$("open-taxes").addEventListener("click", () => openSetting("set-taxes"));
$("open-terms").addEventListener("click", () => openSetting("set-terms"));
$("open-roles").addEventListener("click", () => openSetting("set-roles"));
$("open-marks").addEventListener("click", () => openSetting("set-marks"));
$("open-bank").addEventListener("click", () => openSetting("set-bank"));
[
  ["presets-back", "set-presets"],
  ["taxes-back", "set-taxes"],
  ["terms-back", "set-terms"],
  ["roles-back", "set-roles"],
  ["marks-back", "set-marks"],
  ["bank-back", "set-bank"],
].forEach(([id, page]) => {
  $(id).addEventListener("click", () => {
    commitSettings();
    setSide(page, false);
  });
});
$("preset-add").addEventListener("click", () => {
  $("preset-fields").append(presetRow(state.settings.minAmount || DEFAULT_MIN));
  queueSettings();
});
["min-amount", "euro-rate", "vat-rate", "profit-low", "profit-high", "profit-threshold", "gaming-tax", "casino-cut", "bank-limit"].forEach((id) => {
  const node = $(id);
  if (!node) return;
  node.addEventListener("input", () => {
    placeGroupedCaret(node);
    queueSettings();
  });
  node.addEventListener("change", commitSettings);
});
["terms-text", "tax-terms"].forEach((id) => {
  const node = $(id);
  if (!node) return;
  node.addEventListener("input", queueSettings);
  node.addEventListener("change", commitSettings);
});
document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().then(() => renderRequests());
    ["tax-archive", "tax-split", "earnings", "assets-archive", "gaming-archive", "loans-page", "contracts-page", "set-presets", "set-taxes", "set-terms", "set-roles", "set-marks", "set-bank"].forEach((id) => {
      const node = $(id);
      if (!node) return;
      node.classList.remove("is-open");
      node.setAttribute("aria-hidden", "true");
    });
    closeSessionSides();
    showTab(button.dataset.tab);
  });
});
function openArchive(id) {
  closeSessionSides();
  taxSheetId = "";
  taxReviewStep = 0;
  playOpenId = "";
  setSide("tax-sheet", false);
  setSide("play-sheet", false);
  ["tax-archive", "earnings", "assets-archive", "gaming-archive"].forEach((name) => {
    const node = $(name);
    const on = name === id;
    node.classList.toggle("is-open", on);
    node.setAttribute("aria-hidden", on ? "false" : "true");
  });
}
$("view-taxes").addEventListener("click", () => {
  renderGovernment();
  openArchive("tax-archive");
});
$("view-earnings").addEventListener("click", () => openArchive("earnings"));
$("view-assets").addEventListener("click", () => {
  renderAssetList();
  openArchive("assets-archive");
});
$("tax-archive-back").addEventListener("click", () => openArchive(""));
$("tax-sheet-back").addEventListener("click", () => {
  if (taxReviewStep) {
    if (reviewBackup) {
      const index = taxes.findIndex((entry) => entry.id === reviewBackup.id);
      if (index >= 0) taxes[index] = reviewBackup;
      saveTaxes();
    }
    reviewBackup = null;
    taxReviewStep = 0;
    taxEditing = false;
    taxSheetId = "";
    setSide("tax-sheet", false);
    renderGovernment();
    return;
  }
  if (taxEditing && !commitTaxEdit()) return;
  taxEditing = false;
  taxSheetId = "";
  setSide("tax-sheet", false);
});
$("tax-sheet-edit").addEventListener("click", () => {
  if (!taxSheetId) return;
  if (taxEditing) {
    if (!commitTaxEdit()) return;
    taxEditing = false;
  } else {
    taxEditing = true;
  }
  const button = $("tax-sheet-edit");
  button.classList.toggle("is-on", taxEditing);
  button.setAttribute("aria-pressed", taxEditing ? "true" : "false");
  const msg = $("tax-sheet-msg");
  if (msg && taxEditing) msg.textContent = "";
  fillTaxSheet();
});
$("tax-sheet-sign").addEventListener("click", () => {
  const item = taxes.find((entry) => entry.id === taxSheetId);
  if (item) showSignature(item);
});
$("earnings-back").addEventListener("click", () => openArchive(""));
$("assets-back").addEventListener("click", () => openArchive(""));
$("view-gaming").addEventListener("click", () => {
  renderGaming();
  openArchive("gaming-archive");
});
$("gaming-back").addEventListener("click", () => openArchive(""));
$("gaming-bin").addEventListener("click", () => {
  gamingBin = !gamingBin;
  $("gaming-bin").classList.toggle("is-on", gamingBin);
  renderGaming();
});
$("play-back").addEventListener("click", () => {
  playOpenId = "";
  setSide("play-sheet", false);
});
$("tax-review-next").addEventListener("click", taxReviewNext);
$("tax-review-approve-sign").addEventListener("click", () => {
  taxReviewStep = 5;
  fillTaxSheet();
});
$("tax-review-done").addEventListener("click", finishReview);
$("tax-review-clear").addEventListener("click", () => {
  reviewInk = [];
  const pad = $("tax-review-pad");
  if (pad) drawSignature(pad, reviewInk);
});
bindReviewPad();
$("list-asset").addEventListener("click", () => {
  $("asset-error").textContent = "";
  $("asset-sheet").hidden = false;
  $("asset-name").focus();
});
$("asset-cancel").addEventListener("click", () => {
  $("asset-sheet").hidden = true;
});
$("asset-sheet").addEventListener("click", (event) => {
  if (event.target === $("asset-sheet")) $("asset-sheet").hidden = true;
});
$("asset-form").addEventListener("submit", listAsset);
$("asset-buy-close").addEventListener("click", closeAssetBuy);
$("asset-buy-confirm").addEventListener("click", confirmAssetBuy);
$("asset-buy-deny").addEventListener("click", denyAssetBuy);
$("asset-buy").addEventListener("click", (event) => {
  if (event.target === $("asset-buy")) closeAssetBuy();
});
$("start-session").addEventListener("click", openAttendance);
$("attend-back").addEventListener("click", () => setSide("session-attend", false));
$("attend-start").addEventListener("click", startSession);
$("session-back").addEventListener("click", closeSessionSides);
$("session-books-go").addEventListener("click", openSessionBooks);
$("books-back").addEventListener("click", () => setSide("session-books", false));
$("end-session").addEventListener("click", endSession);
$("session-edit").addEventListener("click", () => {
  if (!sessionLive || sessionLive.id !== viewingSession) return;
  attendEdit = !attendEdit;
  const record = viewingSession ? sessionById(viewingSession) : null;
  if (record) fillSessionFacts(record);
});
function openRoster(kind) {
  const record = viewingSession ? sessionById(viewingSession) : null;
  if (!record) return;
  fillRoster(record, kind);
  setSide("session-roster", true);
}
$("show-present").addEventListener("click", () => openRoster("present"));
$("show-absent").addEventListener("click", () => openRoster("absent"));
$("roster-back").addEventListener("click", () => setSide("session-roster", false));
$("session-menu").addEventListener("click", (event) => {
  if (event.target === $("session-menu")) closeSessionMenu();
});
$("session-menu-edit").addEventListener("click", () => {
  const id = menuSessionId;
  closeSessionMenu();
  openSessionView(id);
  attendEdit = true;
  const record = sessionById(id);
  if (record) fillSessionFacts(record);
});
$("session-menu-delete").addEventListener("click", () => {
  const id = menuSessionId;
  closeSessionMenu();
  deleteSession(id);
});
bindSessionMenu();
$("contracts-back").addEventListener("click", () => setSide("contracts-page", false));
$("contract-make").addEventListener("click", makeContract);
$("contract-amount").addEventListener("input", () => placeGroupedCaret($("contract-amount")));
function paintLock() {
  const button = $("lock-go");
  if (!button) return;
  button.classList.toggle("is-locked", terminalLocked);
  const label = terminalLocked ? "Unlock terminal" : "Lock terminal";
  button.setAttribute("aria-label", label);
  const text = $("lock-label");
  if (text) text.textContent = label;
}

const CALL_ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let callId = "";
let callPc = null;
let callStream = null;
let callOffer = "";
let callIce = [];

function stopRingtone() {
  const audio = $("ringtone");
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

function playRingtone() {
  const audio = $("ringtone");
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function showCall(which) {
  const incoming = $("call-incoming");
  const live = $("call-live");
  if (incoming) incoming.hidden = which !== "incoming";
  if (live) live.hidden = which !== "live";
}

function closeCallMedia() {
  if (callPc) callPc.close();
  callPc = null;
  if (callStream) callStream.getTracks().forEach((track) => track.stop());
  callStream = null;
  callIce = [];
  const remote = $("call-remote");
  if (remote) remote.srcObject = null;
}

function endNetworkCall(tell) {
  const id = callId;
  stopRingtone();
  closeCallMedia();
  showCall("");
  callId = "";
  callOffer = "";
  if (tell && id) {
    publish("Call ended", { v: 1, kind: "call", from: "network", phase: "hangup", id, ts: Date.now() }).catch(() => {});
  }
}

async function flushCallIce() {
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

async function openCallMedia() {
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
      from: "network",
      phase: "ice",
      id: callId,
      candidate: event.candidate.toJSON(),
      ts: Date.now(),
    }).catch(() => {});
  };
  return callPc;
}

async function answerCall() {
  if (!callId || !callOffer) return;
  stopRingtone();
  try {
    const pc = await openCallMedia();
    await pc.setRemoteDescription({ type: "offer", sdp: callOffer });
    await flushCallIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await publish("Call answered", {
      v: 1,
      kind: "call",
      from: "network",
      phase: "answer",
      id: callId,
      sdp: answer.sdp,
      ts: Date.now(),
    });
    showCall("live");
  } catch {
    endNetworkCall(true);
    toast("Couldn't answer the call.");
  }
}

function takeCall(body) {
  if (!body || body.from !== "terminal" || typeof body.id !== "string") return;
  if (body.phase === "offer") {
    if (!body.sdp || !remember(`call-offer:${body.id}`)) return;
    if (callId && callId !== body.id) {
      publish("Call declined", { v: 1, kind: "call", from: "network", phase: "decline", id: body.id, ts: Date.now() }).catch(() => {});
      return;
    }
    callId = body.id;
    callOffer = body.sdp;
    showCall("incoming");
    playRingtone();
    return;
  }
  if (body.id !== callId) return;
  if (body.phase === "hangup") {
    endNetworkCall(false);
    return;
  }
  if (body.phase === "ice" && body.candidate) {
    callIce.push(body.candidate);
    flushCallIce();
  }
}

$("call-answer").addEventListener("click", answerCall);
$("call-decline").addEventListener("click", () => {
  const id = callId;
  endNetworkCall(false);
  if (id) publish("Call declined", { v: 1, kind: "call", from: "network", phase: "decline", id, ts: Date.now() }).catch(() => {});
});
$("call-hangup").addEventListener("click", () => endNetworkCall(true));
document.addEventListener("pointerdown", () => {
  const audio = $("ringtone");
  if (!audio) return;
  audio.muted = true;
  audio.play().then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
  }).catch(() => {});
}, { once: true });
$("lock-go").addEventListener("click", async () => {
  const button = $("lock-go");
  button.disabled = true;
  const next = !terminalLocked;
  try {
    await publish(next ? "Terminal locked" : "Terminal unlocked", {
      v: 1,
      kind: "lock",
      locked: next,
      ts: Date.now(),
    });
    terminalLocked = next;
    localStorage.setItem(TERM_LOCK, next ? "1" : "0");
    paintLock();
    toast(next ? "Terminal locked" : "Terminal unlocked");
  } catch {
    toast("Couldn't reach the terminal. Try again.");
  } finally {
    button.disabled = false;
  }
});
$("tax-collected").addEventListener("click", () => openTaxSplit("total"));
$("tax-split-back").addEventListener("click", () => setSide("tax-split", false));
$("tax-tab-income").addEventListener("click", () => {
  taxPane = "income";
  renderGovernment();
});
$("tax-tab-gaming").addEventListener("click", () => {
  taxPane = "gaming";
  renderGovernment();
});
$("ring-go").addEventListener("click", async () => {
  const button = $("ring-go");
  button.disabled = true;
  try {
    await publish("Ringing", { v: 1, kind: "ring", id: uid(), ts: Date.now() });
    toast("Ringing the terminal");
  } catch {
    toast("Couldn't reach the terminal. Try again.");
  } finally {
    button.disabled = false;
  }
});
if ($("loan-formula")) $("loan-formula").addEventListener("click", saveLoanFormula);
if ($("loan-add")) $("loan-add").addEventListener("click", () => {
  const box = $("loan-bands");
  const row = document.createElement("div");
  row.className = "loan-band";
  ["min", "max", "rate", "count"].forEach((key) => {
    const input = document.createElement("input");
    input.dataset.band = key;
    input.inputMode = "numeric";
    input.autocomplete = "off";
    if (key === "min" || key === "max") input.addEventListener("input", () => placeGroupedCaret(input));
    row.append(input);
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn slim";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => row.remove());
  row.append(remove);
  box.append(row);
});
$("asset-price").addEventListener("input", () => placeGroupedCaret($("asset-price")));
$("filter-min").addEventListener("input", () => placeGroupedCaret($("filter-min")));
$("filter-max").addEventListener("input", () => placeGroupedCaret($("filter-max")));
function paintExchangeTrash() {
  const button = $("exchange-trash");
  if (!button) return;
  button.classList.toggle("is-on", showExchangeTrash);
  button.setAttribute("aria-pressed", showExchangeTrash ? "true" : "false");
  document.body.classList.toggle("show-exchange-trash", showExchangeTrash);
}

$("exchange-trash").addEventListener("click", () => {
  showExchangeTrash = !showExchangeTrash;
  paintExchangeTrash();
  renderActivity();
  if (viewingSession && $("session-view").classList.contains("is-open")) fillSessionView(viewingSession);
});
$("exchange-filter").addEventListener("click", () => {
  mountPicker($("filter-time"), [
    { value: "all", label: "Any time" },
    { value: "today", label: "Today" },
    { value: "week", label: "Last 7 days" },
    { value: "month", label: "Last 30 days" },
  ], exchangeFilter.time, (value) => { exchangeFilter.time = value; });
  mountPicker($("filter-type"), [
    { value: "all", label: "All types" },
    { value: "deposit", label: "Deposit" },
    { value: "withdraw", label: "Withdrawal" },
    { value: "transfer", label: "Transfer" },
  ], exchangeFilter.type, (value) => { exchangeFilter.type = value; });
  const accounts = [{ value: "", label: "Any account" }];
  state.accounts.forEach((account) => accounts.push({ value: account.id, label: account.name }));
  mountPicker($("filter-account"), accounts, exchangeFilter.account, (value) => { exchangeFilter.account = value; });
  $("filter-min").value = exchangeFilter.min ? groupDigits(exchangeFilter.min) : "";
  $("filter-max").value = exchangeFilter.max ? groupDigits(exchangeFilter.max) : "";
  $("filter-sheet").hidden = false;
});
$("filter-sheet").addEventListener("click", (event) => {
  if (event.target === $("filter-sheet")) $("filter-sheet").hidden = true;
});
$("filter-apply").addEventListener("click", () => {
  exchangeFilter.time = $("filter-time").dataset.value || "all";
  exchangeFilter.type = $("filter-type").dataset.value || "all";
  exchangeFilter.account = $("filter-account").dataset.value || "";
  exchangeFilter.min = readBillion($("filter-min").value);
  exchangeFilter.max = readBillion($("filter-max").value);
  $("filter-sheet").hidden = true;
  renderActivity();
});
$("filter-clear").addEventListener("click", () => {
  exchangeFilter.time = "all";
  exchangeFilter.type = "all";
  exchangeFilter.account = "";
  exchangeFilter.min = "";
  exchangeFilter.max = "";
  $("filter-sheet").hidden = true;
  renderActivity();
});
setInterval(() => {
  paintSessionClock();
}, 1000);

bindViewport();
stopOverscroll($("main"));
stopOverscroll(document.querySelector(".sheet-card"));
lockGestures();
setupInstall();
fillSettings();
const boot = $("boot");
if (boot) boot.hidden = true;
document.addEventListener("pointerdown", (event) => {
  if (showAccountTrash && !event.target.closest(".acct-trash, .acct-name")) {
    showAccountTrash = false;
    renderRows();
  }
  if (!event.target.closest(".picker")) {
    document.querySelectorAll(".picker-menu").forEach((node) => {
      node.hidden = true;
    });
  }
});
bindBalanceColumn();
["gizbit-network-name", "gizbit-network-pair", "gizbit-phones", "gizbit-network-device"].forEach((key) => localStorage.removeItem(key));
$("app-version").textContent = VERSION;
paintLock();
absorbStoredSigns();
render();
showTab("home");
maybeOpenLinked();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "open-request") return;
    showTab("home");
    if (assetBuys.some((item) => item.id === event.data.id && item.status === "pending")) openAssetBuy(event.data.id);
    else openDecision(event.data.id);
  });
}

catchUp()
  .catch(() => setStatus("Saved on this phone. The other phone connects when this one is online."))
  .finally(() => {
    maybeOpenLinked();
    listen();
  });

let syncDepth = 0;

function showSyncing() {
  syncDepth += 1;
  const sheet = $("syncing");
  if (sheet) sheet.hidden = false;
}

function hideSyncing() {
  syncDepth = Math.max(0, syncDepth - 1);
  if (syncDepth) return;
  const sheet = $("syncing");
  if (sheet) sheet.hidden = true;
}

function bindSessionMenu() {
  const card = $("session-menu-card");
  if (!card) return;
  let startY = 0;
  let dragging = false;
  card.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    dragging = true;
    startY = event.clientY;
    card.setPointerCapture(event.pointerId);
  });
  card.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dy = Math.max(0, event.clientY - startY);
    card.style.transform = `translateY(${dy}px)`;
  });
  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    const dy = event.clientY - startY;
    if (dy > 70) closeSessionMenu();
    else card.style.transform = "";
  };
  card.addEventListener("pointerup", finish);
  card.addEventListener("pointercancel", finish);
}

function bindBalanceColumn() {
  const head = $("bal-head");
  if (!head) return;
  let timer = 0;
  let startX = 0;
  let startY = 0;
  head.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      balanceEdit = !balanceEdit;
      renderRows();
      setBalanceHead();
    }, 400);
  });
  head.addEventListener("pointermove", (event) => {
    if (!timer) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (dx * dx + dy * dy > 100) {
      clearTimeout(timer);
      timer = 0;
    }
  });
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
  };
  head.addEventListener("pointerup", cancel);
  head.addEventListener("pointercancel", cancel);
  head.addEventListener("contextmenu", (event) => event.preventDefault());
}

function wakeLink() {
  if (streamOpen && Date.now() - lastStream < 30000) return;
  listen();
  return catchUp().catch(() => setStatus("Reconnecting…"));
}

setInterval(() => {
  if (document.visibilityState !== "visible") return;
  wakeLink();
  paintLink();
}, 25000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  wakeLink();
});
