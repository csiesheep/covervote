// site/speech.js — 唸給你聽（#15）。只用瀏覽器內建的 speechSynthesis，選 lang 為 zh-TW 的聲音；
// 不產生音檔、不上傳、不載入任何第三方語音服務（唸的字留在這支手機）。
// 沒有 speechSynthesis、或沒有 zh-TW 聲音 → hasVoice() 為 false，畫面上的唸讀鈕保持 hidden，其餘照常。
const synth = () => {
  try { return typeof window.SpeechSynthesisUtterance === 'function' && window.speechSynthesis ? window.speechSynthesis : null; } catch { return null; }
};
const isTW = v => /^(zh|cmn)[-_](Hant[-_])?TW$/i.test(String((v && v.lang) || ''));
function findVoice(){
  const s = synth(); if (!s) return null;
  try { return (s.getVoices() || []).find(isTW) || null; } catch { return null; }
}
export const hasVoice = () => !!findVoice();

let wired = false, speakingBtn = null;
// 把畫面上所有 [data-speak] 鈕的 hidden 對齊「現在有沒有 zh-TW 聲音」。聲音常常晚一點才載入（voiceschanged）。
export function syncSpeak(root = document){
  const ok = hasVoice();
  root.querySelectorAll('[data-speak]').forEach(b => { b.hidden = !ok; });
  const s = synth();
  if (s && !wired){
    wired = true;
    try { s.addEventListener('voiceschanged', () => syncSpeak(document)); } catch {}
  }
}
function reset(btn){
  if (!btn) return;
  btn.setAttribute('aria-pressed', 'false');
  if (btn.dataset.labelIdle) btn.textContent = btn.dataset.labelIdle;
}
export function stopSpeaking(){
  const s = synth();
  try { if (s) s.cancel(); } catch {}
  reset(speakingBtn); speakingBtn = null;
}
// 唸 text；再按同一顆 = 停。唸完不做任何事（不自動跳下一段）。
export function toggleSpeak(btn, text){
  const s = synth(), v = findVoice();
  if (!s || !v) return;
  if (speakingBtn === btn){ stopSpeaking(); return; }
  stopSpeaking();
  const u = new window.SpeechSynthesisUtterance(text);
  u.voice = v; u.lang = 'zh-TW'; u.rate = 0.85;
  const done = () => { if (speakingBtn === btn){ reset(btn); speakingBtn = null; } };
  u.onend = done; u.onerror = done;
  speakingBtn = btn;
  btn.setAttribute('aria-pressed', 'true');
  if (btn.dataset.labelStop) btn.textContent = btn.dataset.labelStop;
  try { s.speak(u); } catch { done(); }
}
