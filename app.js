/* Hybrid Translator (Online-only PWA)
   Primary: Google Translate API (strict source/target)
   Fallback: LibreTranslate
   Optional verification: detect language of output and auto-fallback if wrong
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const netStatus = $("#netStatus");
const installBtn = $("#installBtn");
const settingsBtn = $("#settingsBtn");
const settingsModal = $("#settingsModal");
const closeSettingsBtn = $("#closeSettingsBtn");
const saveSettingsBtn = $("#saveSettingsBtn");
const clearKeyBtn = $("#clearKeyBtn");

const googleKeyInput = $("#googleKey");
const libreEndpointInput = $("#libreEndpoint");

const sourceLang = $("#sourceLang");
const targetLang = $("#targetLang");
const wordInput  = $("#wordInput");

const translateBtn = $("#translateBtn");
const clearBtn = $("#clearBtn");
const swapBtn = $("#swapBtn");

const errorBox = $("#errorBox");
const translationOut = $("#translationOut");
const copyBtn = $("#copyBtn");
const detailsBtn = $("#detailsBtn");
const sourceNote = $("#sourceNote");

const detailsCard = $("#detailsCard");
const detailsTitle = $("#detailsTitle");
const loadingDetails = $("#loadingDetails");

let deferredPrompt = null;
let lastResult = null; // { word, from, to, translation }

/* ---------------------------
   Settings (localStorage)
---------------------------- */
const SETTINGS_KEY = "luga_settings_v1";

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return {
      googleKey: (s.googleKey || "").trim(),
      libreEndpoint: (s.libreEndpoint || "https://libretranslate.de").trim().replace(/\/+$/,"")
    };
  } catch {
    return { googleKey: "", libreEndpoint: "https://libretranslate.de" };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function openSettings() {
  const s = loadSettings();
  googleKeyInput.value = s.googleKey;
  libreEndpointInput.value = s.libreEndpoint;
  settingsModal.classList.remove("hidden");
}

function closeSettings() {
  settingsModal.classList.add("hidden");
}

settingsBtn?.addEventListener("click", openSettings);
closeSettingsBtn?.addEventListener("click", closeSettings);
settingsModal?.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings(); // click outside card
});

saveSettingsBtn?.addEventListener("click", () => {
  const s = {
    googleKey: (googleKeyInput.value || "").trim(),
    libreEndpoint: (libreEndpointInput.value || "https://libretranslate.de").trim().replace(/\/+$/,"")
  };
  saveSettings(s);
  closeSettings();
});

clearKeyBtn?.addEventListener("click", () => {
  const s = loadSettings();
  s.googleKey = "";
  saveSettings(s);
  googleKeyInput.value = "";
});

/* ---------------------------
   Helpers
---------------------------- */
function normalizeWord(raw) {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0]; // one word only
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function setOnlineUI() {
  const online = navigator.onLine;
  netStatus.textContent = online ? "Online" : "Offline";
  netStatus.style.color = online ? "var(--ok)" : "var(--danger)";

  translateBtn.disabled = !online;
  detailsBtn.disabled = !online || !lastResult;
}

window.addEventListener("online", setOnlineUI);
window.addEventListener("offline", setOnlineUI);

/* ---------------------------
   PWA install handling
---------------------------- */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove("hidden");
});

installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  try { await deferredPrompt.userChoice; } catch {}
  deferredPrompt = null;
  installBtn.classList.add("hidden");
});

/* ---------------------------
   Engines
---------------------------- */

// 1) Google Translate API (v2)
// POST or GET both work; we'll use POST JSON.
async function googleTranslate(word, from, to, apiKey) {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
  const body = {
    q: word,
    source: from,
    target: to,
    format: "text"
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google Translate failed (${res.status}). ${txt.slice(0,160)}`);
  }

  const data = await res.json();
  const translated = data?.data?.translations?.[0]?.translatedText;
  if (!translated) throw new Error("Google Translate returned no text.");

  return {
    translated: translated.trim(),
    meta: { provider: "Google Translate" }
  };
}

// 2) LibreTranslate fallback
async function libreTranslate(word, from, to, endpoint) {
  const url = `${endpoint.replace(/\/+$/,"")}/translate`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      q: word,
      source: from,
      target: to,
      format: "text"
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`LibreTranslate failed (${res.status}). ${txt.slice(0,160)}`);
  }

  const data = await res.json();
  const translated = data?.translatedText;
  if (!translated) throw new Error("LibreTranslate returned no text.");

  return {
    translated: translated.trim(),
    meta: { provider: "LibreTranslate" }
  };
}

// Optional verification using LibreTranslate /detect
async function libreDetect(text, endpoint) {
  const url = `${endpoint.replace(/\/+$/,"")}/detect`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ q: text })
  });
  if (!res.ok) return null;
  const data = await res.json();

  // Typical shape: [{language:"en",confidence:0.9}, ...]
  const best = Array.isArray(data) ? data.sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0] : null;
  return best?.language || null;
}

async function hybridTranslate(word, from, to) {
  const s = loadSettings();

  // Try Google first if key exists
  if (s.googleKey) {
    const g = await googleTranslate(word, from, to, s.googleKey);

    // Verify target language (best-effort) using Libre detect:
    // If detect available and doesn't match target, fallback to Libre translation.
    const detected = await libreDetect(g.translated, s.libreEndpoint).catch(() => null);
    if (detected && detected !== to) {
      // fallback
      const l = await libreTranslate(word, from, to, s.libreEndpoint);
      return {
        translated: l.translated,
        meta: {
          provider: `Hybrid: Google→Libre (verification mismatch: ${detected}≠${to})`
        }
      };
    }

    return { translated: g.translated, meta: g.meta };
  }

  // No Google key → go straight to Libre
  const l = await libreTranslate(word, from, to, s.libreEndpoint);
  return { translated: l.translated, meta: l.meta };
}

/* ---------------------------
   Wiktionary linguistic details (unchanged)
---------------------------- */
const WIKTIONARY_HOSTS = {
  en: "https://en.wiktionary.org",
  fr: "https://fr.wiktionary.org",
  sw: "https://sw.wiktionary.org"
};

function langName(code){
  return code === "en" ? "English" : code === "fr" ? "French" : code === "sw" ? "Kiswahili" : code;
}

async function wtDefinition(word, wikLang) {
  const base = WIKTIONARY_HOSTS[wikLang] || WIKTIONARY_HOSTS.en;
  const url = `${base}/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function wtRelated(word, wikLang) {
  const base = WIKTIONARY_HOSTS[wikLang] || WIKTIONARY_HOSTS.en;
  const url = `${base}/api/rest_v1/page/related/${encodeURIComponent(word)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function wtHTML(word, wikLang) {
  const base = WIKTIONARY_HOSTS[wikLang] || WIKTIONARY_HOSTS.en;
  const url = `${base}/api/rest_v1/page/html/${encodeURIComponent(word)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.text();
}

function pickLanguageBlocks(defJson, languageLabel) {
  if (!defJson || typeof defJson !== "object") return [];
  const key = Object.keys(defJson).find(k => k.toLowerCase() === languageLabel.toLowerCase());
  if (!key) return [];
  return Array.isArray(defJson[key]) ? defJson[key] : [];
}

function safeText(s) {
  return (s ?? "").toString().replace(/\s+/g, " ").trim();
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function extractFromWiktionaryHTML(htmlText, wikLang) {
  if (!htmlText) return { etymology: "", rhymes: [], quotes: [] };

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");

  const etyHeadings = {
    en: ["Etymology"],
    fr: ["Étymologie", "Etymologie"],
    sw: ["Etimolojia", "Etymology", "Etimologia"]
  }[wikLang] || ["Etymology", "Étymologie", "Etimolojia"];

  function findSectionTextByHeading(headingTexts) {
    const headings = Array.from(doc.querySelectorAll("h2, h3, h4"));
    for (const h of headings) {
      const t = safeText(h.textContent);
      if (headingTexts.some(x => t.toLowerCase().includes(x.toLowerCase()))) {
        let out = [];
        let n = h.nextElementSibling;
        while (n && !/^H[2-4]$/i.test(n.tagName)) {
          const txt = safeText(n.textContent);
          if (txt) out.push(txt);
          n = n.nextElementSibling;
          if (out.join(" ").length > 900) break;
        }
        return out.join("\n\n");
      }
    }
    return "";
  }

  const etymology = findSectionTextByHeading(etyHeadings);

  const rhymeHeadings = {
    en: ["Rhymes"],
    fr: ["Rimes"],
    sw: ["Mashairi", "Rhymes", "Rimes"]
  }[wikLang] || ["Rhymes", "Rimes"];

  const rhymesText = findSectionTextByHeading(rhymeHeadings);
  const rhymes = uniq(
    rhymesText.split(/[,;\n]/).map(x => safeText(x)).filter(x => x && x.length <= 40)
  ).slice(0, 30);

  const quoteHeadings = {
    en: ["Quotations", "Examples", "Usage"],
    fr: ["Citations", "Exemples", "Usage"],
    sw: ["Mifano", "Nukuu", "Examples", "Quotations"]
  }[wikLang] || ["Quotations", "Examples", "Citations", "Exemples"];

  const quotesBlock = findSectionTextByHeading(quoteHeadings);
  const quotes = uniq(
    quotesBlock.split(/\n+/).map(x => safeText(x)).filter(x => x.length >= 18)
  ).slice(0, 12);

  return { etymology, rhymes, quotes };
}

function mapRelatedToFields(relatedJson) {
  const out = {
    synonyms: [],
    antonyms: [],
    derived: [],
    related: [],
    hypernyms: [],
    hyponyms: [],
    holonyms: [],
    meronyms: []
  };
  if (!relatedJson || typeof relatedJson !== "object") return out;

  const pages = relatedJson.pages || [];
  const items = pages[0]?.items || [];

  for (const item of items) {
    const type = (item.type || "").toLowerCase();
    const entries = (item.entries || []).map(e => e?.word).filter(Boolean);

    if (type.includes("synonym")) out.synonyms.push(...entries);
    else if (type.includes("antonym")) out.antonyms.push(...entries);
    else if (type.includes("derived")) out.derived.push(...entries);
    else if (type.includes("related")) out.related.push(...entries);
    else if (type.includes("hypernym")) out.hypernyms.push(...entries);
    else if (type.includes("hyponym")) out.hyponyms.push(...entries);
    else if (type.includes("holonym")) out.holonyms.push(...entries);
    else if (type.includes("meronym")) out.meronyms.push(...entries);
    else out.related.push(...entries);
  }

  for (const k of Object.keys(out)) out[k] = uniq(out[k]).slice(0, 40);
  return out;
}

function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderBadges(list) {
  if (!list || !list.length) return `<div class="loading">—</div>`;
  return list.map(x => `<span class="badge">${escapeHTML(x)}</span>`).join("");
}

function renderDefinitions(defBlocks) {
  if (!defBlocks.length) return `<div class="loading">No definitions found.</div>`;

  const parts = defBlocks.slice(0, 6).map(block => {
    const pos = escapeHTML(block.partOfSpeech || "—");
    const defs = (block.definitions || []).slice(0, 8).map(d => {
      const gloss = escapeHTML(d.definition || "");
      const ex = d.examples?.[0]?.text ? `<div class="hint">Example: ${escapeHTML(d.examples[0].text)}</div>` : "";
      return `<li><div>${gloss}</div>${ex}</li>`;
    }).join("");
    return `<h3>${pos}</h3><ul class="list">${defs || "<li>—</li>"}</ul>`;
  }).join("");

  return parts;
}

function renderExamples(quotes) {
  if (!quotes || !quotes.length) return `<div class="loading">No quotations/examples found.</div>`;
  return `<ul class="list">${quotes.map(q => `<li>${escapeHTML(q)}</li>`).join("")}</ul>`;
}

function setActiveTab(tabName) {
  $$(".tab").forEach(btn => {
    const on = btn.dataset.tab === tabName;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  $$(".tabPanel").forEach(p => {
    p.classList.toggle("hidden", p.dataset.panel !== tabName);
  });
}

$$(".tab").forEach(btn => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

/* ---------------------------
   UI actions
---------------------------- */
swapBtn.addEventListener("click", () => {
  const a = sourceLang.value;
  sourceLang.value = targetLang.value;
  targetLang.value = a;
});

clearBtn.addEventListener("click", () => {
  wordInput.value = "";
  translationOut.textContent = "—";
  sourceNote.textContent = "Source: —";
  copyBtn.disabled = true;
  detailsBtn.disabled = true;
  detailsCard.classList.add("hidden");
  lastResult = null;
  clearError();
});

copyBtn.addEventListener("click", async () => {
  if (!lastResult?.translation) return;
  try {
    await navigator.clipboard.writeText(lastResult.translation);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = lastResult.translation;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
});

translateBtn.addEventListener("click", async () => {
  clearError();
  detailsCard.classList.add("hidden");

  if (!navigator.onLine) {
    showError("This app works online only. Please connect to internet/data.");
    return;
  }

  const from = sourceLang.value;
  const to = targetLang.value;
  if (from === to) {
    showError("Please choose two different languages.");
    return;
  }

  const word = normalizeWord(wordInput.value);
  if (!word) {
    showError("Please enter one word.");
    return;
  }

  translationOut.textContent = "Translating…";
  copyBtn.disabled = true;
  detailsBtn.disabled = true;

  try {
    const r = await hybridTranslate(word, from, to);
    translationOut.textContent = r.translated;

    lastResult = { word, from, to, translation: r.translated };

    sourceNote.textContent = `Source: ${r.meta.provider}`;
    copyBtn.disabled = false;
    detailsBtn.disabled = false;

  } catch (err) {
    translationOut.textContent = "—";
    showError(err?.message || "Translation failed.");
  }
});

/* Linguistic details button remains same as your earlier version */
detailsBtn.addEventListener("click", async () => {
  clearError();
  if (!navigator.onLine) {
    showError("Connect to internet/data to fetch linguistic details.");
    return;
  }
  if (!lastResult) return;

  const word = lastResult.word;
  const wikLang = lastResult.from;

  detailsTitle.textContent = `${word} • ${langName(wikLang)} (Wiktionary)`;
  detailsCard.classList.remove("hidden");
  setActiveTab("overview");

  const overview = $('[data-panel="overview"]');
  const defs = $('[data-panel="definitions"]');
  const syn = $('[data-panel="synonyms"]');
  const ant = $('[data-panel="antonyms"]');
  const ex  = $('[data-panel="examples"]');
  const fam = $('[data-panel="family"]');
  const sem = $('[data-panel="semantic"]');
  const rhy = $('[data-panel="rhymes"]');
  const his = $('[data-panel="history"]');

  overview.innerHTML = `<div class="loading">Loading…</div>`;
  defs.innerHTML = syn.innerHTML = ant.innerHTML = ex.innerHTML = fam.innerHTML = sem.innerHTML = rhy.innerHTML = his.innerHTML = "";

  loadingDetails.classList.remove("hidden");

  try {
    const [defJson, relJson, htmlText] = await Promise.all([
      wtDefinition(word, wikLang),
      wtRelated(word, wikLang),
      wtHTML(word, wikLang)
    ]);

    const languageLabel =
      wikLang === "en" ? "English" :
      wikLang === "fr" ? "French" :
      "Swahili";

    const defBlocks = defJson ? pickLanguageBlocks(defJson, languageLabel) : [];
    const rel = mapRelatedToFields(relJson);
    const htmlExtract = extractFromWiktionaryHTML(htmlText, wikLang);

    const semanticField = uniq([...rel.hypernyms, ...rel.hyponyms, ...rel.related]).slice(0, 40);
    const wordFamily = uniq([...rel.derived]).slice(0, 40);

    overview.innerHTML = `
      <div class="kv">
        <div class="k">Word</div><div class="v">${escapeHTML(word)}</div>
        <div class="k">Definition entries</div><div class="v">${escapeHTML(String(defBlocks.length))}</div>
        <div class="k">Synonyms</div><div class="v">${escapeHTML(String(rel.synonyms.length))}</div>
        <div class="k">Antonyms</div><div class="v">${escapeHTML(String(rel.antonyms.length))}</div>
        <div class="k">Derived / family</div><div class="v">${escapeHTML(String(wordFamily.length))}</div>
      </div>
      <div class="hint">Wiktionary coverage varies by language and word.</div>
    `;

    defs.innerHTML = renderDefinitions(defBlocks);

    syn.innerHTML = `
      <h3>Synonyms</h3>
      <div>${renderBadges(rel.synonyms)}</div>
      <h3>Common combinations (co-occurrences)</h3>
      <div class="hint">If collocations are missing, related/derived terms are shown when available.</div>
      <div>${renderBadges(rel.related)}</div>
    `;

    ant.innerHTML = `
      <h3>Antonyms</h3>
      <div>${renderBadges(rel.antonyms)}</div>
    `;

    ex.innerHTML = `
      <h3>Example quotations / usage</h3>
      ${renderExamples(htmlExtract.quotes)}
    `;

    fam.innerHTML = `
      <h3>Word family (derived terms)</h3>
      <div>${renderBadges(wordFamily)}</div>
    `;

    sem.innerHTML = `
      <h3>Semantic field (hypernyms / hyponyms / related)</h3>
      <div>${renderBadges(semanticField)}</div>
    `;

    rhy.innerHTML = `
      <h3>Rhymes</h3>
      <div class="hint">Rhymes are not consistently available for all entries.</div>
      <div>${renderBadges(htmlExtract.rhymes)}</div>
    `;

    his.innerHTML = `
      <h3>Etymology / word history</h3>
      <div class="hint">Brief extract when available.</div>
      <div style="white-space:pre-wrap">${escapeHTML(htmlExtract.etymology || "No etymology section found.")}</div>
    `;

  } catch (err) {
    showError(err?.message || "Failed to load linguistic details.");
  } finally {
    loadingDetails.classList.add("hidden");
    detailsBtn.disabled = !navigator.onLine || !lastResult;
  }
});

/* Startup + Service Worker */
setOnlineUI();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

wordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") translateBtn.click();
});