/* =========================================================
   Tri-Lang Translator — app.js (FULL, CLEAN)
   ========================================================= */

/* ---------- Small helpers ---------- */
const $ = (id) => document.getElementById(id);

function safeSetText(el, text) {
  if (el) el.textContent = text;
}
function safeToggle(el, cls, on) {
  if (el) el.classList.toggle(cls, !!on);
}
function show(el) {
  if (el) el.classList.remove("hidden");
}
function hide(el) {
  if (el) el.classList.add("hidden");
}

/* ---------- Storage keys ---------- */
const LS_GOOGLE = "tri_google_key";
const LS_LIBRE = "tri_libre_endpoint";

/* =========================================================
   PWA: Service worker
   ========================================================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      console.warn("SW register failed:", e);
    }
  });
}

/* =========================================================
   Run after DOM is ready
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  /* ---------- PWA: Install button ---------- */
  let deferredPrompt = null;
  const installBtn = $("installBtn");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.classList.remove("hidden");
  });

  installBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {
      // ignore
    }
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  });

  /* ---------- Online status pill ---------- */
  const netStatus = $("netStatus");
  function updateOnlineStatus() {
    const online = navigator.onLine;
    safeSetText(netStatus, online ? "Online" : "Offline");
    safeToggle(netStatus, "online", online);
  }
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();

  /* ---------- Main elements ---------- */
  const fromLang = $("fromLang");
  const toLang = $("toLang");
  const swapBtn = $("swapBtn");
  const wordInput = $("wordInput");

  const translateBtn = $("translateBtn");
  const clearBtn = $("clearBtn");
  const translationOut = $("translationOut");
  const sourceOut = $("sourceOut");
  const errorOut = $("errorOut");
  const copyBtn = $("copyBtn");

  /* ---------- Error/result helpers ---------- */
  function showError(msg) {
    if (!errorOut) return;
    errorOut.textContent = msg;
    errorOut.classList.remove("hidden");
  }
  function clearError() {
    if (!errorOut) return;
    errorOut.textContent = "";
    errorOut.classList.add("hidden");
  }
  function setResult(text, source) {
    safeSetText(translationOut, text || "—");
    safeSetText(sourceOut, `Source: ${source || "—"}`);
    if (copyBtn) copyBtn.disabled = !text;
  }

  /* ---------- Swap/Clear ---------- */
  swapBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!fromLang || !toLang) return;
    const a = fromLang.value;
    fromLang.value = toLang.value;
    toLang.value = a;
  });

  clearBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (wordInput) wordInput.value = "";
    setResult("", "");
    clearError();
  });

  /* =========================================================
     Settings modal (FIXED)
     ========================================================= */
  const settingsBtn = $("settingsBtn");
  const settingsModal = $("settingsModal");
  const closeSettingsBtn = $("closeSettingsBtn");
  const saveSettingsBtn = $("saveSettingsBtn");
  const googleKey = $("googleKey");
  const libreEndpoint = $("libreEndpoint");

  function loadSettings() {
    if (!googleKey || !libreEndpoint) return;
    googleKey.value = localStorage.getItem(LS_GOOGLE) || "";
    libreEndpoint.value =
      localStorage.getItem(LS_LIBRE) || "https://libretranslate.de";
  }

  function saveSettings() {
    if (!googleKey || !libreEndpoint) return;
    localStorage.setItem(LS_GOOGLE, googleKey.value.trim());
    localStorage.setItem(
      LS_LIBRE,
      libreEndpoint.value.trim() || "https://libretranslate.de"
    );
  }

  function openSettings() {
    if (!settingsModal) return;
    loadSettings();
    show(settingsModal);
  }

  function closeSettings() {
    if (!settingsModal) return;
    hide(settingsModal);
  }

  settingsBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    openSettings();
  });

  closeSettingsBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    closeSettings();
  });

  saveSettingsBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    saveSettings();
    closeSettings();
  });

  // Click outside modalCard closes
  settingsModal?.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  // ESC closes
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsModal && !settingsModal.classList.contains("hidden")) {
      closeSettings();
    }
  });

  /* =========================================================
     Translation functions
     ========================================================= */
  async function googleTranslate(word, from, to, apiKey) {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(
      apiKey
    )}`;

    const body = { q: word, source: from, target: to, format: "text" };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `Google Translate failed (${res.status})`);
    }

    const translated = data?.data?.translations?.[0]?.translatedText;
    if (!translated) throw new Error("Google Translate returned no text.");
    return translated.trim();
  }

  async function libreTranslate(word, from, to, endpoint) {
    const clean = (endpoint || "").replace(/\/+$/, "");
    const url = `${clean}/translate`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: word, source: from, target: to, format: "text" }),
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `LibreTranslate failed (${res.status})`);
    }

    const translated = data?.translatedText;
    if (!translated) throw new Error("LibreTranslate returned no text.");
    return String(translated).trim();
  }

  /* ---------- Translate ---------- */
  translateBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    clearError();

    const word = (wordInput?.value || "").trim().split(/\s+/)[0] || "";
    if (!word) return showError("Please enter a word.");

    const from = fromLang?.value || "";
    const to = toLang?.value || "";
    if (!from || !to) return showError("Please choose languages.");
    if (from === to) return showError("Choose two different languages.");

    setResult("…", "Working");

    const apiKey = (localStorage.getItem(LS_GOOGLE) || "").trim();
    const endpoint = (localStorage.getItem(LS_LIBRE) || "https://libretranslate.de").trim();

    try {
      let translated, source;
      if (apiKey) {
        translated = await googleTranslate(word, from, to, apiKey);
        source = "Google Translate API";
      } else {
        translated = await libreTranslate(word, from, to, endpoint);
        source = `LibreTranslate (${endpoint})`;
      }
      setResult(translated, source);
    } catch (err) {
      setResult("", "");
      showError(err?.message || "Translation failed.");
    }
  });

  /* ---------- Copy ---------- */
  copyBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const t = (translationOut?.textContent || "").trim();
    if (!t || t === "—") return;

    try {
      await navigator.clipboard.writeText(t);
    } catch {
      // ignore
    }
  });

  /* ---------- Initial state ---------- */
  setResult("", "");
});