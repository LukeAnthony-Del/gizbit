// Main bank. Keep TOPIC, encode, and decode identical in terminal/app.js.
const TOPIC = "gizbit-net-m3p8k2w7q9n4";
const NTFY = "https://ntfy.envs.net";
const STORAGE = "gizbit-accounts";
const ACTIVITY = "gizbit-activity";
const REQUESTS = "gizbit-requests";
const TAXES = "gizbit-taxes";
const USUAL = "gizbit-usual";
const SEEN = "gizbit-seen";
const CURSOR = "gizbit-cursor";
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
// Versions start at 1.00.000. A small fix adds 0.00.001, a feature adds 0.01.000, and a large change adds 1.00.000.
const VERSION = "2.10.000";

const state = loadState();
const activity = loadList(ACTIVITY);
const requests = loadList(REQUESTS);
const taxes = loadList(TAXES);
const seen = new Set(loadList(SEEN));
let source = null;
let streamOpen = false;
let lastAnnounce = 0;
let announced = false;
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
  const presets = Array.isArray(value?.presets) ? value.presets.map((item) => moneyText(item)).filter(Boolean) : [];
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
    const res = await fetch(`${NTFY}/${TOPIC}`, {
      method: "POST",
      body: encode(sentence, payload),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
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
    requests: requests.slice(0, 30).map((item) => {
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
      return row;
    }),
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
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M14.6 3.6l5.8 5.8-1.15 1.15-5.8-5.8L14.6 3.6z" fill="currentColor"/><path d="M12.9 6.4l4.7 4.7-6.55 6.55-.55.15-2.35.62a.7.7 0 0 1-.85-.85l.62-2.35.15-.55L12.9 6.4z" fill="currentColor"/><path d="M3.2 18.2c1.5-2.15 2.55-3.05 3.85-1.75 1.15 1.15 1.7 2.35 3.05.85 1.2-1.35 2.05-3.55 3.45-2.35" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M16.2 5.2l2.6 2.6" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></svg>`;
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

function renderActivity() {
  const list = $("activity");
  list.replaceChildren();
  const done = requests.filter((item) => item.status && item.status !== "pending");
  done.forEach((item) => {
    const swipe = document.createElement("li");
    swipe.className = "swipe log-swipe";
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
    signBtn.setAttribute("aria-label", "Show signature");
    signBtn.innerHTML = signMarkup();
    signBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      showSignature(item);
    });
    const row = document.createElement("div");
    row.className = "log-row";
    const time = document.createElement("time");
    time.dateTime = new Date(item.ts).toISOString();
    time.textContent = formatWhen(item.ts);
    const line = document.createElement("span");
    const alleged = formatAmount(item.amount);
    const actual = item.applied ? formatAmount(item.applied) : "";
    if (isTransfer(item)) {
      line.textContent = `${item.name} transferred ${alleged} ₲ to ${item.toName || "another account"}`;
    } else {
      const verb = item.op === "withdraw" ? "Withdrawal" : "Deposit";
      line.textContent = actual && actual !== alleged
        ? `${item.name} · ${verb} · ${alleged} ₲ · received ${actual} ₲`
        : `${item.name} · ${verb} · ${alleged} ₲`;
    }
    row.append(time, line);
    if (item.status === "denied") {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "Denied";
      row.append(tag);
    }
    swipe.append(actions, signBtn, row);
    bindReveal(row, 56, 56);
    list.append(swipe);
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
    if (event.target.closest("button")) return;
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
    const open = right > 0 && end > right * 0.45;
    const sign = left > 0 && end < -left * 0.45;
    row.style.transform = "";
    row.classList.toggle("is-open", open && !sign);
    row.classList.toggle("is-sign", sign && !open);
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
  const ranked = state.accounts.slice().sort((a, b) => {
    const left = BigInt(b.bal);
    const right = BigInt(a.bal);
    if (left > right) return 1;
    if (left < right) return -1;
    return a.name.localeCompare(b.name);
  });
  ranked.forEach((account) => {
    const swipe = document.createElement("div");
    swipe.className = "swipe";
    const actions = document.createElement("div");
    actions.className = "swipe-actions";
    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "swipe-trash";
    trash.setAttribute("aria-label", `Delete ${account.name}`);
    trash.innerHTML = trashMarkup();
    trash.addEventListener("click", () => deleteAccount(account.id));
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "swipe-eye";
    eye.setAttribute("aria-label", `Show password for ${account.name}`);
    eye.innerHTML = eyeMarkup();
    eye.addEventListener("click", () => openPassword(account.id));
    actions.append(trash, eye);
    const usualBtn = document.createElement("button");
    usualBtn.type = "button";
    usualBtn.className = "swipe-usual";
    usualBtn.setAttribute("aria-label", `Usual signature for ${account.name}`);
    usualBtn.innerHTML = `<img src="sign-hand.png" alt="" />`;
    usualBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      showUsual(account);
    });
    const row = document.createElement("div");
    row.className = "acct";
    const name = document.createElement("span");
    name.textContent = account.name;
    const type = document.createElement("span");
    type.className = "acct-type";
    type.textContent = account.type;
    const short = document.createElement("span");
    short.className = "bal-short";
    short.textContent = `${formatAmount(account.bal)} ₲`;
    const full = document.createElement("span");
    full.className = "bal-full";
    full.textContent = formatFull(account.bal);
    row.append(name, type, short, full);
    swipe.append(actions, usualBtn, row);
    bindReveal(row, 112, 56);
    body.append(swipe);
  });
  $("empty").hidden = state.accounts.length > 0;
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

function render() {
  renderRows();
  renderAccounts();
  renderActivity();
  renderRequests();
  renderGovernment();
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
    if (!state.accounts.length) return;
    if (!body.id || !body.ts || Date.now() - body.ts > 120000) return;
    if (!remember(`ping:${body.id}`)) return;
    bucket.ping = body.id;
    return;
  }
  if (body.kind === "request") {
    if (takeRequest(body)) bucket.requests = true;
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

function sanitizeTaxLines(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((line) => {
    const name = String(line?.name || "").trim().slice(0, 40);
    const qty = moneyText(line?.qty, false);
    const revenue = moneyText(line?.revenue, false);
    if (!name || !qty || qty === "0" || revenue == null) return null;
    return { name, qty, revenue };
  }).filter(Boolean);
}

function takeTax(body) {
  if (!body || typeof body.id !== "string" || !remember(body.id)) return false;
  const account = state.accounts.find((item) => item.id === body.accountId);
  if (!account || body.ph !== account.ph) {
    publishReject(body.id, "The password did not match.");
    return false;
  }
  const business = String(body.business || "").trim().slice(0, 60);
  const owner = String(body.owner || "").trim().slice(0, 40);
  const sheet = String(body.sheet || "").replace(/\D/g, "").replace(/^0+/, "");
  const lines = sanitizeTaxLines(body.lines);
  if (!business || owner !== account.name || !sheet || !lines.length) {
    publishReject(body.id, "That tax return could not be filed.");
    return false;
  }
  const rates = {
    vat: percentText(body.vatRate, state.settings.vatRate),
    low: percentText(body.lowRate, state.settings.profitLow),
    high: percentText(body.highRate, state.settings.profitHigh),
    threshold: moneyText(body.threshold, false) || state.settings.profitThreshold,
  };
  const totals = taxTotals(lines, rates);
  taxes.unshift({
    id: body.id,
    accountId: account.id,
    owner: account.name,
    business,
    session: "1",
    sheet,
    vatRate: rates.vat,
    lowRate: rates.low,
    highRate: rates.high,
    threshold: rates.threshold,
    lines,
    totals,
    sign: cleanSign(body.sign),
    ts: Number(body.ts) || Date.now(),
  });
  saveTaxes();
  noteSign(account.id, body.id, body.sign);
  renderGovernment();
  toast(`${business} filed a tax return`);
  return true;
}

function renderGovernment() {
  const list = $("gov-list");
  const empty = $("gov-empty");
  if (!list || !empty) return;
  list.replaceChildren();
  empty.hidden = taxes.length > 0;
  taxes.forEach((item) => {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = item.business;
    const meta = document.createElement("p");
    meta.className = "quiet";
    meta.textContent = `${item.owner} · Sheet ${item.sheet} · Session ${item.session}`;
    const rows = document.createElement("ul");
    rows.className = "gov-lines";
    (item.lines || []).forEach((line) => {
      const row = document.createElement("li");
      const due = (BigInt(line.revenue) * BigInt(item.vatRate)) / 100n;
      const net = BigInt(line.revenue) - due;
      row.textContent = `${line.name} · ${formatFull(line.qty)} sold · ${formatAmount(line.revenue)} ₲ · VAT ${formatAmount(due)} ₲ · Net ${formatAmount(net)} ₲`;
      rows.append(row);
    });
    const totals = document.createElement("p");
    const totalsRow = item.totals || {};
    totals.textContent = `Gross revenue ${formatAmount(totalsRow.revenue)} ₲. Gross VAT ${formatAmount(totalsRow.vat)} ₲. Gross profit ${formatAmount(totalsRow.profit)} ₲. Profit tax ${formatAmount(totalsRow.tax)} ₲. Total invoice ${formatAmount(totalsRow.invoice)} ₲.`;
    li.append(title, meta, rows, totals);
    if (item.sign && item.sign.length) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn slim";
      button.textContent = "Signature";
      button.addEventListener("click", () => showSignature(item));
      li.append(button);
    }
    list.append(li);
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
      handleMessage(JSON.parse(trimmed), bucket);
    } catch {
      /* Skip a line that is not a message. */
    }
  }
  const asked = Boolean(bucket.ping || bucket.applied.length || bucket.requests);
  if (!asked && announced) return;
  if (!state.accounts.length && !bucket.applied.length && !bucket.requests) return;
  await publishLedger(bucket.applied, bucket.ping || "");
  announced = true;
  lastAnnounce = Date.now();
  if (streamOpen) setStatus("Listening for the other phone");
}

function listen() {
  if (source) source.close();
  source = new EventSource(`${NTFY}/${TOPIC}/sse?since=${encodeURIComponent(sinceQuery())}`);
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
    if (!state.accounts.length) return;
    if (!bucket.ping && !bucket.applied.length && !bucket.requests) return;
    publishLedger(bucket.applied, bucket.ping || "")
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

function notifyPending(item) {
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

function renderRequests() {
  const list = $("request-list");
  list.replaceChildren();
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
  $("requests-empty").hidden = requests.some((item) => item.status === "pending");
  const notify = $("notify-go");
  notify.hidden = !("Notification" in window) || Notification.permission === "granted";
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
  showTab("requests");
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
  $("min-amount").value = state.settings.minAmount;
  $("max-amount").value = state.settings.maxAmount;
  $("euro-rate").value = state.settings.euroRate;
  $("vat-rate").value = state.settings.vatRate;
  $("profit-low").value = state.settings.profitLow;
  $("profit-high").value = state.settings.profitHigh;
  $("profit-threshold").value = state.settings.profitThreshold;
  $("tax-terms").value = state.settings.taxTerms;
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
  if (!("Notification" in window)) return;
  await Notification.requestPermission();
  renderRequests();
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
  localStorage.removeItem(TAXES);
  localStorage.removeItem(USUAL);
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
$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const error = $("settings-error");
  error.textContent = "";
  const presets = [...document.querySelectorAll("[data-preset]")].map((input) => parseAmount(input.value));
  if (presets.some((value) => value == null)) {
    error.textContent = "Each preset needs a whole number of gizbits.";
    return;
  }
  const minAmount = parseAmount($("min-amount").value);
  const maxText = $("max-amount").value.trim();
  const maxAmount = maxText ? parseAmount(maxText) : "";
  if (minAmount == null) {
    error.textContent = "Enter a minimum amount.";
    return;
  }
  if (maxText && maxAmount == null) {
    error.textContent = "Enter a maximum amount, or leave it empty.";
    return;
  }
  if (maxAmount && BigInt(maxAmount) < BigInt(minAmount)) {
    error.textContent = "The maximum must be at least the minimum.";
    return;
  }
  const euroRate = parseAmount($("euro-rate").value);
  if (euroRate == null || BigInt(euroRate) <= 0n) {
    error.textContent = "Enter how many gizbits one euro is worth.";
    return;
  }
  const vatRate = readPercent("vat-rate");
  const profitLow = readPercent("profit-low");
  const profitHigh = readPercent("profit-high");
  if (!vatRate || !profitLow || !profitHigh) {
    error.textContent = "Enter each tax rate as a whole number from 0 to 100.";
    return;
  }
  const profitThreshold = parseAmount($("profit-threshold").value);
  if (!profitThreshold) {
    error.textContent = "Enter the profit tax threshold.";
    return;
  }
  state.settings = {
    presets,
    terms: $("terms-text").value.trim().slice(0, 800) || DEFAULT_TERMS,
    minAmount,
    maxAmount: maxAmount || "",
    euroRate,
    vatRate,
    profitLow,
    profitHigh,
    profitThreshold,
    taxTerms: $("tax-terms").value.trim().slice(0, 400) || DEFAULT_TAX_TERMS,
  };
  saveAccounts();
  fillSettings();
  toast("Settings saved");
  publishLedger([]).catch(() => setStatus("Saved on this phone. The other phone will catch up when the connection is back."));
});
document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().then(() => renderRequests());
    showTab(button.dataset.tab);
  });
});

bindViewport();
stopOverscroll($("main"));
stopOverscroll(document.querySelector(".sheet-card"));
lockGestures();
setupInstall();
fillSettings();
["gizbit-network-name", "gizbit-network-pair", "gizbit-phones", "gizbit-network-device"].forEach((key) => localStorage.removeItem(key));
$("app-version").textContent = VERSION;
absorbStoredSigns();
render();
showTab("balances");
maybeOpenLinked();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "open-request") return;
    showTab("requests");
    openDecision(event.data.id);
  });
}

catchUp()
  .catch(() => setStatus("Saved on this phone. The other phone connects when this one is online."))
  .finally(() => {
    maybeOpenLinked();
    listen();
  });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  catchUp()
    .catch(() => setStatus("Reconnecting…"))
    .finally(() => {
      if (state.accounts.length) publishLedger([]).catch(() => setStatus("Saved on this phone. The other phone will catch up when the connection is back."));
    });
});
