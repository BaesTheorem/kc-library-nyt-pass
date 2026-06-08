const cardEl = document.getElementById("card");
const pinEl = document.getElementById("pin");
const statusEl = document.getElementById("status");

chrome.storage.local.get(["libraryCard", "libraryPin"]).then(
  ({ libraryCard, libraryPin }) => {
    if (libraryCard) cardEl.value = libraryCard;
    if (libraryPin) pinEl.value = libraryPin;
  },
);

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    libraryCard: cardEl.value.trim(),
    libraryPin: pinEl.value.trim(),
  });
  // Re-entering credentials re-enables auto-login (it disables itself for the
  // session after a failed attempt) so the corrected card/PIN get a fresh try.
  chrome.runtime.sendMessage({ type: "creds-updated" });
  statusEl.textContent = "Saved.";
  setTimeout(() => (statusEl.textContent = ""), 2000);
});
