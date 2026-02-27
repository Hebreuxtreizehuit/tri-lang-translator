"use strict";

// Helpers
const $ = (id) => document.getElementById(id);

// LocalStorage keys
const LS_GOOGLE = "tri_google_key";
const LS_LIBRE = "tri_libre_endpoint";

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

  // ---------------- Elements ----------------
  const wordModeBtn = document.getElementById('wordMode');
  const phraseModeBtn = document.getElementById('phraseMode');
  const wordModeContent = document.getElementById('wordModeContent');
  const phraseModeContent = document.getElementById('phraseModeContent');
  const translateBtn = document.getElementById('translateBtn');
  const translatePhraseBtn = document.getElementById('translatePhraseBtn');
  const translationOut = document.getElementById('translationOut');

  let selectedMode = 'word'; // Default is word mode

  // Toggle between word mode and phrase mode
  wordModeBtn.addEventListener('click', () => {
    selectedMode = 'word';
    wordModeBtn.classList.add('active');
    phraseModeBtn.classList.remove('active');
    wordModeContent.style.display = 'block';
    phraseModeContent.style.display = 'none';
  });

  phraseModeBtn.addEventListener('click', () => {
    selectedMode = 'phrase';
    phraseModeBtn.classList.add('active');
    wordModeBtn.classList.remove('active');
    wordModeContent.style.display = 'none';
    phraseModeContent.style.display = 'block';
  });

  // ---------- Translation functions ----------
  async function translateWord(word) {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=AIzaSyAAFVh4KpaTDi07QqejbtnV945lYNnUIF8`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: word,
        target: 'en'
      })
    });
    const data = await response.json();
    return data.data.translations[0].translatedText;
  }

  async function translatePhrase(phrase) {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=AIzaSyAAFVh4KpaTDi07QqejbtnV945lYNnUIF8`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: phrase,
        target: 'en'
      })
    });
    const data = await response.json();
    return data.data.translations[0].translatedText;
  }

  // Handle translation button click
  translateBtn.addEventListener('click', async () => {
    const word = document.getElementById('wordInput').value;
    if (word.trim()) {
      const translation = await translateWord(word);
      translationOut.textContent = translation;
    }
  });

  // Handle phrase translation button click
  translatePhraseBtn.addEventListener('click', async () => {
    const phrase = document.getElementById('phraseInput').value;
    if (phrase.trim()) {
      const translation = await translatePhrase(phrase);
      translationOut.textContent = translation;
    }
  });
});