// Make sure that the phrase mode button correctly displays the phrase content
phraseModeBtn.addEventListener("click", () => {
   selectedMode = 'phrase';
   phraseModeBtn.classList.add('active');
   wordModeBtn.classList.remove('active');
   wordModeContent.style.display = 'none';
   phraseModeContent.style.display = 'block';
});

translatePhraseBtn.addEventListener("click", async () => {
   const phrase = phraseInput.value.trim();  // Ensure phraseInput is correctly selected
   if (phrase) {
       const translated = await translatePhrase(phrase); // Make sure translatePhrase is defined
       translationOut.textContent = translated;
   } else {
       translationOut.textContent = "Please enter a valid phrase.";
   }
});