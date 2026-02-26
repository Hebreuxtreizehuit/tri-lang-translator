"use strict";

// Helpers
const $ = (id) => document.getElementById(id);

// LocalStorage keys
const LS_WORKER = "tri_worker_url";
const LS_LIBRE = "tri_libre_endpoint"; // optional (not required now)

document.addEventListener("DOMContentLoaded", () => {
  // ---------------- PWA: service worker ----------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch (e) {
        console.warn("SW register failed:", e);
      }
    });
  }

  // ---------------- PWA: Install button ----------------
  let deferredPrompt = null;
  const installBtn = $("installBtn");

  if (installBtn) {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      installBtn.classList.remove("hidden");
    });

    installBtn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.classList.add("hidden");
    });
  }

  // ---------------- Online status ----------------
  const netStatus = $("netStatus");
  const updateOnlineStatus = () => {
    if (!netStatus) return;
    const online = navigator.onLine;
    netStatus.textContent = online ? "Online" : "Offline";
    netStatus.classList.toggle("online", online);
  };
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();

  // ---------------- Elements ----------------
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

  // Settings modal
  const settingsBtn = $("settingsBtn");
  const settingsModal = $("settingsModal");
  const closeSettingsBtn = $("closeSettingsBtn");
  const saveSettingsBtn = $("saveSettingsBtn");

  // In your current UI this is labeled "LibreTranslate endpoint" —
  // we will repurpose it to store your WORKER URL if you want,
  // OR you can add a new input later. For now:
  const libreEndpoint = $("libreEndpoint"); // we’ll store Worker URL here to avoid editing HTML

  // (Optional) if googleKey input still exists in HTML, we disable/ignore it safely
  const googleKey = $("googleKey");
  if (googleKey) {
    googleKey.value = "";
    googleKey.placeholder = "Not used (API key is stored in Cloudflare Worker)";
    googleKey.disabled = true;
  }

  // ---------------- UI helpers ----------------
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
    if (translationOut) translationOut.textContent = text || "—";
    if (sourceOut) sourceOut.textContent = `Source: ${source || "—"}`;
    if (copyBtn) copyBtn.disabled = !text || text === "—";
  }

  // ---------------- Swap/Clear ----------------
  if (swapBtn && fromLang && toLang) {
    swapBtn.addEventListener("click", () => {
      const a = fromLang.value;
      fromLang.value = toLang.value;
      toLang.value = a;
    });
  }

  if (clearBtn && wordInput) {
    clearBtn.addEventListener("click", () => {
      wordInput.value = "";
      setResult("", "");
      clearError();
      wordInput.focus();
    });
  }

  // ---------------- Settings storage ----------------
  const DEFAULT_WORKER_URL = "https://super-shadow-407b.davidbulambo.workers.dev";

  function loadSettings() {
    const worker = localStorage.getItem(LS_WORKER) || DEFAULT_WORKER_URL;
    const libre = localStorage.getItem(LS_LIBRE) || "https://libretranslate.de";

    // We reuse libreEndpoint input for Worker URL (so you don’t need to change HTML)
    if (libreEndpoint) libreEndpoint.value = worker;

    // Keep storing libre in case you want it later
    localStorage.setItem(LS_LIBRE, libre);
  }

  function saveSettings() {
    const worker = (libreEndpoint?.value || "").trim() || DEFAULT_WORKER_URL;
    localStorage.setItem(LS_WORKER, worker);
  }

  function openModal() {
    if (!settingsModal) return;
    loadSettings();
    settingsModal.classList.remove("hidden");
    document.body.classList.add("no-scroll");
    setTimeout(() => libreEndpoint?.focus(), 0);
  }

  function closeModal() {
    if (!settingsModal) return;
    settingsModal.classList.add("hidden");
    document.body.classList.remove("no-scroll");
    setTimeout(() => wordInput?.focus(), 0);
  }

  if (settingsBtn) settingsBtn.addEventListener("click", openModal);
  if (closeSettingsBtn) settingsBtn && closeSettingsBtn.addEventListener("click", closeModal);

  if (settingsModal) {
    // click outside closes
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) closeModal();
    });
  }

  // ESC closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsModal && !settingsModal.classList.contains("hidden")) {
      closeModal();
    }
  });

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      saveSettings();
      closeModal();
    });
  }

  // ---------------- Translation via Worker ----------------
  async function translateViaWorker(word, from, to) {
    const base = (localStorage.getItem(LS_WORKER) || DEFAULT_WORKER_URL).trim().replace(/\/+$/, "");
    const url = `${base}/translate`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: word, source: from, target: to, format: "text" }),
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `Worker failed (${res.status})`);
    }
    const translated = data?.translatedText;
    if (!translated) throw new Error("Worker returned no text.");
    return { translated, source: data?.source || "Worker" };
  }

  // ---------------- Translate ----------------
  if (translateBtn && wordInput && fromLang && toLang) {
    translateBtn.addEventListener("click", async () => {
      clearError();

      const word = (wordInput.value || "").trim().split(/\s+/)[0] || "";
      if (!word) return showError("Please enter a word.");

      const from = fromLang.value;
      const to = toLang.value;
      if (from === to) return showError("Choose two different languages.");

      setResult("…", "Working");

      try {
        const r = await translateViaWorker(word, from, to);
        setResult(r.translated, r.source);
      } catch (e) {
        setResult("", "");
        showError(e?.message || "Translation failed.");
      }
    });
  }

  // Enter key triggers translate
  if (wordInput && translateBtn) {
    wordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") translateBtn.click();
    });
  }

  // ---------------- Copy ----------------
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const t = translationOut?.textContent || "";
      if (!t || t === "—") return;
      try {
        await navigator.clipboard.writeText(t);
      } catch {
        // ignore
      }
    });
  }

  // On load, set default source display
  setResult("", "");
});