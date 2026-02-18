/* global inkjs */
const $ = (sel) => document.querySelector(sel);

/** ---------------------------------------
 *  REQUIRED ELEMENTS (from your index.html)
 *  --------------------------------------*/
const menuEl = $("#menu");
const playerEl = $("#player");
const episodeListEl = $("#episodeList");
const menuErrorEl = $("#menuError");

const bgEl = $("#bg");
const slotLeft = $("#slot-left");
const slotCenter = $("#slot-center");
const slotRight = $("#slot-right");

const speakerEl = $("#speaker");
const textEl = $("#text");
const choicesEl = $("#choices");
const hintEl = $("#hint");

const btnMenu = $("#btnMenu");
const btnLog = $("#btnLog");
const btnRestart = $("#btnRestart");
const logModal = $("#logModal");
const btnCloseLog = $("#btnCloseLog");
const logBody = $("#logBody");

const stageEl = $("#stage");
const btnBackHome = $("#btnBackHome");

// Overlays
const panelOverlayEl = $("#panelOverlay");
const panelImgEl = $("#panelImg");

const itemOverlayEl = $("#itemOverlay");
const itemImgEl = $("#itemImg");

const talkHeadEl = $("#talkHead");
const talkHeadImgEl = $("#talkHeadImg");
const dialogueBoxEl = $("#dialogueBox");
const flashbackOverlayEl = $("#flashbackOverlay");

// SMS overlay elements
const smsOverlayEl = $("#smsOverlay");
const smsBodyEl = $("#smsBody");
const smsRepliesEl = $("#smsReplies");
const smsNameEl = $("#smsName");
const smsIconImgEl = $("#smsIconImg");
const smsTypingEl = $("#smsTyping");
const smsSubEl = $("#smsSub");

/** ---------------------------------------
 *  AUDIO (BGM + AMB + SFX)
 *  --------------------------------------*/
const bgmEl = $("#bgm");
const ambEl = $("#amb");
const sfxEls = Array.from(document.querySelectorAll("#sfxPool .sfx"));

console.log("bgmEl exists?", !!bgmEl, bgmEl);

let audioUnlocked = false;

// if BGM/AMB gets blocked before user gesture, we queue it
let pendingBGM = null; // { src, opts }
let pendingAMB = null; // { src, opts }

let bgmTargetVol = 0.8;
let ambTargetVol = 0.55;
let sfxDefaultVol = 0.9;

// Basic error logging
bgmEl?.addEventListener("error", () => {
  console.error("BGM ERROR:", bgmEl.error, "src =", bgmEl.currentSrc || bgmEl.src);
});
ambEl?.addEventListener("error", () => {
  console.error("AMB ERROR:", ambEl.error, "src =", ambEl.currentSrc || ambEl.src);
});

// Optional: deeper debug (leave on while debugging)
function wireAudioDebug(el, label){
  if (!el) return;
  ["loadstart","loadeddata","canplay","canplaythrough","playing","pause","ended","stalled","waiting"].forEach(ev=>{
    el.addEventListener(ev, ()=> {
      console.log(`[${label}] ${ev}`, {
        src: el.currentSrc || el.src,
        readyState: el.readyState,
        networkState: el.networkState,
        time: el.currentTime,
        vol: el.volume,
        muted: el.muted,
        paused: el.paused,
      });
    });
  });
  el.addEventListener("error", ()=> {
    console.error(`[${label}] ERROR`, el.error, "src =", el.currentSrc || el.src);
  });
}
wireAudioDebug(bgmEl, "BGM");
wireAudioDebug(ambEl, "AMB");

/** ---------------------------------------
 *  STATE
 *  --------------------------------------*/
let story = null;
let currentEpisode = null;   // {id,title,chapters...}
let currentChapterId = null; // "ch01"
let backlog = [];

/** SMS contact memory */
const smsContacts = {}; // { id: { name, icon } }
let smsCurrentContactId = "default";

/** ---------------------------------------
 *  PATHS
 *  --------------------------------------*/
const RELEASES_ROOT = "releases";
const manifestPath = () => `${RELEASES_ROOT}/manifest.json`;
const storyPath = (epId, chId) => `${RELEASES_ROOT}/${epId}/chapters/${chId}/story.json`;

const bgPath = (epId, bgName) => `${RELEASES_ROOT}/${epId}/assets/bg/${bgName}`;

function setBG(urlBaseOrEmpty) {
  if (!bgEl) return;

  if (!urlBaseOrEmpty) {
    bgEl.style.backgroundImage = "none";
    return;
  }

  if (/\.(png|jpg|jpeg|webp)$/i.test(urlBaseOrEmpty)) {
    bgEl.style.backgroundImage = `url("${urlBaseOrEmpty}")`;
    return;
  }

  const jpg = `${urlBaseOrEmpty}.jpg`;
  const png = `${urlBaseOrEmpty}.png`;

  bgEl.style.backgroundImage = `url("${jpg}")`;

  const probe = new Image();
  probe.onload = () => { bgEl.style.backgroundImage = `url("${jpg}")`; };
  probe.onerror = () => { bgEl.style.backgroundImage = `url("${png}")`; };
  probe.src = jpg;
}

const spritePath = (epId, charName, poseName) =>
  `${RELEASES_ROOT}/${epId}/assets/sprites/${charName}_${poseName}.png`;

const panelPath = (epId, panelName) =>
  `${RELEASES_ROOT}/${epId}/assets/panels/${panelName}.png`;

const itemPath = (epId, itemName) =>
  `${RELEASES_ROOT}/${epId}/assets/items/${itemName}.png`;

// TALKHEAD PATHS + STATE (Yara)
const talkHeadPath = (epId, outfit, expr) =>
  `${RELEASES_ROOT}/${epId}/assets/ui/talkhead/yara_${outfit}_${expr}.png`;

let yaraHeadOutfit = "base";
let yaraHeadExpr = "neutral";

function getYaraTalkHeadSrc() {
  const epId = currentEpisode?.id || "ep00";
  return talkHeadPath(epId, yaraHeadOutfit, yaraHeadExpr);
}

function setYaraHead(outfit, expr) {
  if (outfit) yaraHeadOutfit = String(outfit).trim().toLowerCase();
  if (expr) yaraHeadExpr = String(expr).trim().toLowerCase();

  if (talkHeadEl && !talkHeadEl.classList.contains("hidden")) {
    talkHeadImgEl.src = getYaraTalkHeadSrc();
    talkHeadImgEl.alt = "Yara";
  }
}

/** ---------------------------------------
 *  AUDIO HELPERS (FIXED)
 *  --------------------------------------*/
// Encode ONLY the filename so spaces/# etc don’t break URLs on GitHub Pages.
const audioPath = (epId, folder, filename) => {
  const safeFile = encodeURIComponent(filename);
  return `${RELEASES_ROOT}/${epId}/assets/audio/${folder}/${safeFile}`;
};

function resolveAudioSrc(epId, folder, nameOrFile) {
  const raw = String(nameOrFile || "").trim();
  if (!raw) return "";

  const file = (/\.(mp3|ogg|wav|m4a)$/i.test(raw)) ? raw : `${raw}.mp3`;
  return audioPath(epId, folder, file);
}

// ✅ Robust unlock: queues play requests until user gesture, then replays them.
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  try {
    if (bgmEl) bgmEl.muted = false;
    if (ambEl) ambEl.muted = false;
    sfxEls.forEach(a => { a.muted = false; });
  } catch {}

  if (pendingBGM) {
    const { src, opts } = pendingBGM;
    pendingBGM = null;
    playBGM(src, opts);
  }
  if (pendingAMB) {
    const { src, opts } = pendingAMB;
    pendingAMB = null;
    playAMB(src, opts);
  }

  // Hard retry if src exists but paused
  try {
    if (bgmEl && (bgmEl.currentSrc || bgmEl.src) && bgmEl.paused) {
      const p = bgmEl.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  } catch {}

  try {
    if (ambEl && (ambEl.currentSrc || ambEl.src) && ambEl.paused) {
      const p = ambEl.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  } catch {}
}

function clamp01(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function fadeTo(audioEl, toVol, ms = 400) {
  if (!audioEl) return;
  const from = audioEl.volume ?? 0;
  const start = performance.now();
  const dur = Math.max(0, Number(ms) || 0);

  function step(now) {
    const t = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
    audioEl.volume = from + (toVol - from) * t;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function playLoop(audioEl, src, opts = {}) {
  if (!audioEl || !src) return;

  const vol = clamp01(opts.volume ?? 0.6);
  const fadeMs = Number(opts.fadeMs ?? 500);
  const loop = opts.loop !== undefined ? !!opts.loop : true;

  // ✅ If we’re not unlocked yet, don’t even try to play.
  // Queue it deterministically.
  if (!audioUnlocked && (audioEl === bgmEl || audioEl === ambEl)) {
    if (audioEl === bgmEl) pendingBGM = { src, opts: { volume: vol, fadeMs, loop } };
    if (audioEl === ambEl) pendingAMB = { src, opts: { volume: vol, fadeMs, loop } };
    return;
  }

  audioEl.loop = loop;

  const attemptPlay = () => {
    const p = audioEl.play();
    if (p && typeof p.catch === "function") {
      p.catch((err) => {
        console.warn("Audio play blocked:", err?.name || err, src);
        if (audioEl === bgmEl) pendingBGM = { src, opts: { volume: vol, fadeMs, loop } };
        if (audioEl === ambEl) pendingAMB = { src, opts: { volume: vol, fadeMs, loop } };
      });
    }
  };

  // Compare against absolute currentSrc/src because audioEl.src becomes absolute
  const current = audioEl.currentSrc || audioEl.src || "";
  const sameTrack = current && (current.endsWith(src) || current.includes(src));

  if (sameTrack) {
    if (audioEl.paused) attemptPlay();
    fadeTo(audioEl, vol, fadeMs);
    return;
  }

  audioEl.pause();
  audioEl.src = src;
  audioEl.load();

  audioEl.volume = 0;
  attemptPlay();
  fadeTo(audioEl, vol, fadeMs);
}

function stopLoop(audioEl, ms = 250) {
  if (!audioEl) return;
  const end = () => {
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.load();
  };

  if (ms > 0) {
    fadeTo(audioEl, 0, ms);
    window.setTimeout(end, ms + 20);
  } else end();
}

function playBGM(src, opts = {}) {
  const vol = clamp01(opts.volume ?? bgmTargetVol);
  const fadeMs = Number(opts.fadeMs ?? 500);
  const loop = opts.loop !== undefined ? !!opts.loop : true;
  bgmTargetVol = vol;
  playLoop(bgmEl, src, { volume: vol, fadeMs, loop });
}

function stopBGM(ms = 250) { stopLoop(bgmEl, ms); }

function playAMB(src, opts = {}) {
  const vol = clamp01(opts.volume ?? ambTargetVol);
  const fadeMs = Number(opts.fadeMs ?? 500);
  const loop = opts.loop !== undefined ? !!opts.loop : true;
  ambTargetVol = vol;
  playLoop(ambEl, src, { volume: vol, fadeMs, loop });
}

function stopAMB(ms = 250) { stopLoop(ambEl, ms); }

function pickFreeSfxIndex() {
  for (let i = 0; i < sfxEls.length; i++) {
    if (sfxEls[i].paused || sfxEls[i].ended) return i;
  }
  return 0;
}

function playSFX(src, opts = {}) {
  if (!src || !sfxEls.length) return;

  const vol = clamp01(opts.volume ?? sfxDefaultVol);
  const a = sfxEls[pickFreeSfxIndex()];

  try {
    a.pause();
    a.currentTime = 0;
    a.src = src;
    a.load();
    a.volume = vol;

    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {}
}

function preloadAudio(src) {
  if (!src) return;
  const a = new Audio();
  a.preload = "auto";
  a.src = src;
}

function stopAllAudio() {
  pendingBGM = null;
  pendingAMB = null;

  stopBGM(250);
  stopAMB(250);

  if (Array.isArray(sfxEls)) {
    sfxEls.forEach(a => {
      try { a.pause(); a.currentTime = 0; } catch {}
    });
  }
}

/** ---------------------------------------
 *  OVERLAY ANIMATIONS (CSS-driven)
 *  --------------------------------------*/
function showOverlay(el, on, opts = {}) {
  if (!el) return;

  const style = (opts.style || "fade").toLowerCase();
  const styleClass =
    style === "slide" ? "overlaySlideUp" :
    style === "zoom"  ? "overlayZoomIn"  :
    "overlayFadeIn";

  el.classList.remove("overlayFadeIn", "overlaySlideUp", "overlayZoomIn");
  el.classList.add(styleClass);

  if (on) {
    el.classList.remove("hidden");
    el.classList.remove("isOff");
    void el.offsetWidth;
    el.classList.add("isOn");
    return;
  }

  el.classList.remove("isOn");
  el.classList.add("isOff");

  const ms = Number(opts.durationMs) || 240;
  window.setTimeout(() => {
    el.classList.add("hidden");
    el.classList.remove("isOff");
  }, ms);
}

/** ---------------------------------------
 *  TALK HEAD (Yara)
 *  --------------------------------------*/
function setTalkHead(visible) {
  if (!talkHeadEl || !talkHeadImgEl || !dialogueBoxEl) return;

  if (visible) {
    talkHeadImgEl.src = getYaraTalkHeadSrc();
    talkHeadImgEl.alt = "Yara";
    talkHeadEl.classList.remove("hidden");
    dialogueBoxEl.classList.add("shiftForHead");
  } else {
    talkHeadEl.classList.add("hidden");
    talkHeadImgEl.removeAttribute("src");
    talkHeadImgEl.alt = "";
    dialogueBoxEl.classList.remove("shiftForHead");
  }
}

/** ---------------------------------------
 *  COMIC PANEL (full takeover)
 *  --------------------------------------*/
function setComicPanel(srcOrEmpty, opts = {}) {
  if (!panelOverlayEl || !panelImgEl || !stageEl) return;

  const has = !!srcOrEmpty;
  stageEl.classList.toggle("comicMode", has);

  if (has) {
    panelImgEl.src = srcOrEmpty;
    panelImgEl.alt = "Comic panel";
    showOverlay(panelOverlayEl, true, { style: opts.style || "fade" });
  } else {
    showOverlay(panelOverlayEl, false, { style: opts.style || "fade", durationMs: 240 });
    window.setTimeout(() => {
      panelImgEl.removeAttribute("src");
      panelImgEl.alt = "";
    }, 240);
  }
}

/** ---------------------------------------
 *  ITEM OVERLAY (non-blocking)
 *  --------------------------------------*/
function setItemOverlay(srcOrEmpty, opts = {}) {
  if (!itemOverlayEl || !itemImgEl) return;

  const has = !!srcOrEmpty;

  if (has) {
    itemImgEl.src = srcOrEmpty;
    itemImgEl.alt = "Item";
    showOverlay(itemOverlayEl, true, { style: opts.style || "zoom" });
  } else {
    showOverlay(itemOverlayEl, false, { style: opts.style || "zoom", durationMs: 240 });
    window.setTimeout(() => {
      itemImgEl.removeAttribute("src");
      itemImgEl.alt = "";
    }, 240);
  }
}

/** ---------------------------------------
 *  SMS OVERLAY
 *  --------------------------------------*/
function setSMSContact(id, opts = {}) {
  smsCurrentContactId = id || "default";
  smsContacts[smsCurrentContactId] =
    smsContacts[smsCurrentContactId] || { name: "Contact", icon: "" };

  const c = smsContacts[smsCurrentContactId];
  if (opts.name) c.name = opts.name;
  if (opts.icon !== undefined) c.icon = opts.icon;

  if (smsNameEl) smsNameEl.textContent = c.name || "Contact";

  if (smsIconImgEl) {
    if (c.icon) {
      smsIconImgEl.src = c.icon;
      smsIconImgEl.alt = c.name || "Contact";
    } else {
      smsIconImgEl.removeAttribute("src");
      smsIconImgEl.alt = "";
    }
  }
}

function smsSetTyping(on) {
  if (!smsTypingEl) return;
  smsTypingEl.classList.toggle("hidden", !on);
}

function setSMSMode(on, opts = {}) {
  if (!stageEl || !smsOverlayEl) return;

  stageEl.classList.toggle("smsMode", !!on);

  if (on) {
    showOverlay(smsOverlayEl, true, { style: "slide" });

    if (opts.contact) setSMSContact(opts.contact, { name: opts.name, icon: opts.icon });
    else if (opts.name || opts.icon) setSMSContact(smsCurrentContactId, { name: opts.name, icon: opts.icon });
    else setSMSContact(smsCurrentContactId);

    if (smsSubEl && opts.sub) smsSubEl.textContent = opts.sub;
    if (smsSubEl && !opts.sub && !smsSubEl.textContent) smsSubEl.textContent = "Messages";
  } else {
    showOverlay(smsOverlayEl, false, { style: "slide", durationMs: 240 });
    smsSetTyping(false);
    if (smsRepliesEl) {
      smsRepliesEl.innerHTML = "";
      smsRepliesEl.classList.add("hidden");
    }
  }
}

function smsClear() {
  if (!smsBodyEl) return;
  smsBodyEl.innerHTML = "";
}

function smsAppend(kind, text) {
  if (!smsBodyEl) return;

  const bubble = document.createElement("div");
  bubble.className = `smsBubble ${kind === "out" ? "smsOut" : "smsIn"}`;
  bubble.textContent = text;

  smsBodyEl.appendChild(bubble);
  smsBodyEl.scrollTop = smsBodyEl.scrollHeight;
}

function renderSMSChoices() {
  if (!smsRepliesEl) return;

  smsRepliesEl.innerHTML = "";
  smsRepliesEl.classList.remove("hidden");

  story.currentChoices.forEach((c, idx) => {
    const btn = document.createElement("button");
    btn.className = "smsReplyBtn";
    btn.textContent = c.text;

    btn.addEventListener("mouseenter", () => { choiceIndex = idx; updateChoiceHighlight(); });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      pushChoiceToLog(c.text);

      story.ChooseChoiceIndex(idx);

      smsRepliesEl.innerHTML = "";
      smsRepliesEl.classList.add("hidden");

      renderNextLine();
    });

    smsRepliesEl.appendChild(btn);
  });

  resetChoiceNav();
}

/** ---------------------------------------
 *  KEYBOARD CHOICE NAV (VN + SMS)
 *  --------------------------------------*/
let choiceIndex = 0;

function getActiveChoiceButtons() {
  const smsVisible = smsRepliesEl && !smsRepliesEl.classList.contains("hidden") && smsRepliesEl.children.length;
  if (smsVisible) return Array.from(smsRepliesEl.querySelectorAll("button.smsReplyBtn"));

  const vnVisible = choicesEl && !choicesEl.classList.contains("hidden") && choicesEl.children.length;
  if (vnVisible) return Array.from(choicesEl.querySelectorAll("button.choiceBtn"));

  return [];
}

function clampIndex(i, n) {
  if (n <= 0) return 0;
  return (i % n + n) % n;
}

function updateChoiceHighlight() {
  const btns = getActiveChoiceButtons();
  if (!btns.length) return;

  choiceIndex = clampIndex(choiceIndex, btns.length);
  btns.forEach((b, i) => b.classList.toggle("isSelected", i === choiceIndex));
  btns[choiceIndex].scrollIntoView({ block: "nearest", inline: "nearest" });
}

function resetChoiceNav() {
  choiceIndex = 0;
  updateChoiceHighlight();
}

function selectHighlightedChoice() {
  const btns = getActiveChoiceButtons();
  if (!btns.length) return false;

  const btn = btns[choiceIndex];
  if (!btn || btn.disabled) return false;

  btn.click();
  return true;
}

function setFlashback(on) {
  if (!stageEl || !flashbackOverlayEl) return;

  stageEl.classList.toggle("flashbackMode", !!on);
  flashbackOverlayEl.classList.toggle("hidden", !on);
}

/** ---------------------------------------
 *  OPTIONAL: CHAPTER SCREEN (create if missing)
 *  --------------------------------------*/
let chaptersEl = $("#chapters");
let chapterListEl = $("#chapterList");
let chapterTitleEl = $("#chapterTitle");
let chapterBackBtn = $("#btnBackEpisodes");

if (!chaptersEl) {
  chaptersEl = document.createElement("section");
  chaptersEl.id = "chapters";
  chaptersEl.className = "screen hidden";
  chaptersEl.innerHTML = `
  <div class="menuWrap">
    <img class="siteLogo" src="assets/wt_logo.png" alt="Whispering Tides" />

    <h1 id="chapterTitle">Chapters</h1>
    <p class="muted chapterPrompt">Select a chapter.</p>

    <div id="chapterList" class="episodeList"></div>

    <div class="backRow">
      <button id="btnBackEpisodes" class="btn" type="button">Back</button>
    </div>

    <p id="chapterError" class="error hidden"></p>
  </div>
`;

  $("#app")?.appendChild(chaptersEl) || document.body.appendChild(chaptersEl);

  chapterListEl = $("#chapterList");
  chapterTitleEl = $("#chapterTitle");
  chapterBackBtn = $("#btnBackEpisodes");
}

const chapterErrorEl = $("#chapterError");

/** ---------------------------------------
 *  VIEW HELPERS
 *  --------------------------------------*/
function showOnly(which) {
  menuEl?.classList.add("hidden");
  chaptersEl?.classList.add("hidden");
  playerEl?.classList.add("hidden");

  if (which === "menu") menuEl?.classList.remove("hidden");
  if (which === "chapters") chaptersEl?.classList.remove("hidden");
  if (which === "player") playerEl?.classList.remove("hidden");
}

function goBackToChaptersOrMenu() {
  stopAllAudio();

  story = null;
  backlog = [];
  setTalkHead(false);
  setComicPanel("");
  setItemOverlay("");
  setSMSMode(false);
  setFlashback(false);

  if (currentEpisode) bootChapters(currentEpisode);
  else bootEpisodes();
}

const FX_CLASSES = ["fx-shake","fx-shakeHard","fx-bob","fx-glitch","fx-pulse","fx-wobble"];

function clearFX(el){
  if (!el) return;
  FX_CLASSES.forEach(c => el.classList.remove(c));
}

function applyFX(el, fxName, durationMs = 0){
  if (!el) return;
  clearFX(el);

  const fx = String(fxName || "").trim().toLowerCase();
  const map = {
    shake: "fx-shake",
    shakehard: "fx-shakeHard",
    bob: "fx-bob",
    glitch: "fx-glitch",
    pulse: "fx-pulse",
    wobble: "fx-wobble",
  };

  const cls = map[fx];
  if (!cls) return;

  el.classList.add(cls);

  const dur = Number(durationMs) || 0;
  if (dur > 0) {
    window.setTimeout(() => {
      el.classList.remove(cls);
    }, dur);
  }
}

function spriteElFor(slot){
  return slotToEl(slot);
}

/** ---------------------------------------
 *  BOOT: EPISODE LIST
 *  --------------------------------------*/
async function bootEpisodes() {
  showOnly("menu");
  menuErrorEl?.classList.add("hidden");
  episodeListEl.innerHTML = "";

  try {
    const manifest = await fetchJSON(manifestPath());
    const eps = manifest.episodes || [];

    eps.forEach((ep) => {
      const card = document.createElement("div");
      card.className = "episodeCard";
      card.innerHTML = `
        <h3>${escapeHtml(ep.title)}</h3>
        <p>${escapeHtml(ep.description || "")}</p>
        <button class="btn" ${ep.released ? "" : "disabled"}>
          ${ep.released ? "Go" : "Locked"}
        </button>
      `;

      card.querySelector("button").addEventListener("click", () => {
        if (!ep.released) return;
        currentEpisode = ep;
        bootChapters(ep);
      });

      episodeListEl.appendChild(card);
    });
  } catch (err) {
    if (menuErrorEl) {
      menuErrorEl.textContent = `Could not load ${manifestPath()} — ${err.message}`;
      menuErrorEl.classList.remove("hidden");
    }
  }
}

/** ---------------------------------------
 *  CHAPTER LIST
 *  --------------------------------------*/
function bootChapters(ep) {
  showOnly("chapters");
  chapterErrorEl?.classList.add("hidden");
  chapterListEl.innerHTML = "";
  chapterTitleEl.textContent = ep.title || "Chapters";

  const chapters = ep.chapters || [];
  if (!chapters.length) {
    chapterErrorEl.textContent = "No chapters listed for this episode in releases/manifest.json";
    chapterErrorEl.classList.remove("hidden");
    return;
  }

  chapters.forEach((ch) => {
    const row = document.createElement("div");
    row.className = "episodeCard";
    row.innerHTML = `
      <h3>${escapeHtml(ch.title)}</h3>
      <button class="btn">Read</button>
    `;
    row.querySelector("button").addEventListener("click", () => startChapter(ep.id, ch.id));
    chapterListEl.appendChild(row);
  });
}

chapterBackBtn?.addEventListener("click", () => {
  currentEpisode = null;
  bootEpisodes();
});

btnBackHome?.addEventListener("click", () => {
  window.location.href = "../index.html";
});

/** ---------------------------------------
 *  LOAD + PLAY CHAPTER
 *  --------------------------------------*/
async function startChapter(epId, chId) {
  stopAllAudio();

  currentChapterId = chId;
  backlog = [];
  story = null;

  showOnly("player");
  clearUI();

  try {
    const data = await fetchJSON(storyPath(epId, chId));
    story = new inkjs.Story(data);
    renderNextLine();
  } catch (err) {
    setSpeakerUI("");
    textEl.textContent = `Could not load ${storyPath(epId, chId)}.\n\nError: ${err.message}`;
    hintEl.textContent = "Go back and compile your .ink into story.json.";
    hintEl.classList.remove("hidden");
  }
}

/** ---------------------------------------
 *  SPEAKER UI
 *  --------------------------------------*/
function setSpeakerUI(speakerName) {
  const name = (speakerName || "").trim();
  speakerEl.textContent = name;

  const spk = name.toLowerCase();
  setTalkHead(spk === "yara" || spk === "mayari");
}

/** ---------------------------------------
 *  DIALOGUE FORMATTER (tokens -> HTML)
 *  --------------------------------------*/
function formatDialogueToHTML(rawText) {
  const safe = escapeHtml(String(rawText ?? ""));

  return safe
    .replace(/\/\/(.+?)\/\//g, "<em>$1</em>")
    .replace(/&lt;&lt;(.+?)&gt;&gt;/g, '<span class="whisper">$1</span>')
    .replace(/~~(.+?)~~/g, '<span class="loud">$1</span>')
    .replace(/\[\[(.+?)\]\]/g, (m, inner) => {
      const txt = inner;
      return `<span class="glitch" data-text="${txt}">${txt}</span>`;
    });
}

function setDialogueText(text) {
  if (!textEl) return;
  textEl.innerHTML = formatDialogueToHTML(text);
}

/** ---------------------------------------
 *  RENDERING (ONE LINE PER CLICK)
 *  --------------------------------------*/
function clearUI() {
  setSpeakerUI("");
  setDialogueText("");
  choicesEl.innerHTML = "";
  setChoicesVisible(false);

  setComicPanel("");
  setItemOverlay("");
  setFlashback(false);
  setSMSMode(false);
  smsClear();
  smsSetTyping(false);

  yaraHeadOutfit = "base";
  yaraHeadExpr = "neutral";

  hintEl.classList.remove("hidden");
  hintEl.textContent = "";

  setBG("");
  hideSprite("left");
  hideSprite("center");
  hideSprite("right");
  setTalkHead(false);
}

function renderNextLine() {
  if (!story) return;

  clearFX(slotLeft); clearFX(slotCenter); clearFX(slotRight);
  clearFX(talkHeadImgEl);

  if (story.currentChoices && story.currentChoices.length) {
    if (stageEl?.classList.contains("smsMode")) renderSMSChoices();
    else renderChoices();
    return;
  }

  if (story.canContinue) {
    let line = "";

    while (story.canContinue) {
      line = story.Continue();

      const tags = story.currentTags || [];
      if (tags.length) applyTags(tags);

      if (!line || !line.trim()) continue;
      break;
    }

    if (stageEl?.classList.contains("comicMode")) {
      hintEl.textContent = "";
      hintEl.classList.add("hidden");
      setChoicesVisible(false);
      return;
    }

    if (stageEl?.classList.contains("smsMode")) {
      hintEl.textContent = "";
      hintEl.classList.add("hidden");
      setChoicesVisible(false);

      if (story.currentChoices && story.currentChoices.length) {
        renderSMSChoices();
      }
      return;
    }

    const cleaned = (line || "").trimEnd();
    if (cleaned.length) {
      const { speaker, text } = splitSpeaker(cleaned);
      setSpeakerUI(speaker || "");
      setDialogueText(text || cleaned);
      pushBacklogLine(speakerEl.textContent, (text || cleaned));
    }

    if (story.currentChoices && story.currentChoices.length) {
      renderChoices();
      return;
    }

    hintEl.textContent = "";
    hintEl.classList.remove("hidden");
    setChoicesVisible(false);
    return;
  }

  showEndOfChapterBack();
}

function showEndOfChapterBack() {
  stopAllAudio();

  choicesEl.innerHTML = "";
  setChoicesVisible(true);
  hintEl.classList.add("hidden");

  const backBtn = document.createElement("button");
  backBtn.className = "choiceBtn";
  backBtn.textContent = "Finish Chapter";
  backBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    goBackToChaptersOrMenu();
  });

  choicesEl.appendChild(backBtn);
}

function renderChoices() {
  choicesEl.innerHTML = "";
  setChoicesVisible(true);
  hintEl.classList.add("hidden");

  story.currentChoices.forEach((c, idx) => {
    const btn = document.createElement("button");
    btn.className = "choiceBtn";
    btn.textContent = c.text;

    btn.addEventListener("mouseenter", () => { choiceIndex = idx; updateChoiceHighlight(); });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      pushChoiceToLog(c.text);
      story.ChooseChoiceIndex(idx);

      choicesEl.innerHTML = "";
      setChoicesVisible(false);

      renderNextLine();
    });

    choicesEl.appendChild(btn);
  });

  resetChoiceNav();
}

/** Stage click to continue (only when no choices/replies visible) */
stageEl?.addEventListener("click", () => {
  unlockAudio();

  if (!story) return;

  if (choicesEl && !choicesEl.classList.contains("hidden") && choicesEl.children.length) return;
  if (smsRepliesEl && !smsRepliesEl.classList.contains("hidden") && smsRepliesEl.children.length) return;

  if (story.currentChoices && story.currentChoices.length) return;
  renderNextLine();
});

/** Keyboard */
document.addEventListener("keydown", (e) => {
  unlockAudio();

  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;

  const btns = getActiveChoiceButtons();
  const hasChoicesUI = btns.length > 0;

  if (hasChoicesUI) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      choiceIndex = clampIndex(choiceIndex + 1, btns.length);
      updateChoiceHighlight();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      choiceIndex = clampIndex(choiceIndex - 1, btns.length);
      updateChoiceHighlight();
      return;
    }
    if (e.key === "Enter" || e.code === "Space" || e.key === " ") {
      e.preventDefault();
      selectHighlightedChoice();
      return;
    }
    return;
  }

  const isSpace = (e.code === "Space" || e.key === " ");
  const isEnter = (e.key === "Enter");
  if (!isSpace && !isEnter) return;

  e.preventDefault();

  if (!story) return;
  if (story.currentChoices && story.currentChoices.length) return;

  renderNextLine();
});

/** ---------------------------------------
 *  TAGS → VISUALS + AUDIO
 *  --------------------------------------*/
function applyTags(tags) {
  const epId = currentEpisode?.id || "ep00";

  for (const raw of tags) {
    const t = String(raw).trim();

    if (t.startsWith("bg:")) { setBG(bgPath(epId, t.slice(3).trim())); continue; }

    if (t.startsWith("show:")) {
      const parts = t.slice(5).trim().split(/\s+/);
      const [charName, poseName, slot] = parts;
      if (!charName || !poseName || !slot) continue;
      showSprite(slot, spritePath(epId, charName, poseName));
      continue;
    }

    if (t.startsWith("hide:")) { hideSprite(t.slice(5).trim()); continue; }
    if (t.startsWith("speaker:")) { setSpeakerUI(t.slice(8).trim()); continue; }

    if (t.startsWith("fx:")) {
      const rest = t.slice(3).trim();
      const parts = rest.split(/\s+/);
      const fxName = (parts[0] || "").toLowerCase();
      const slot = (parts[1] || "").toLowerCase();
      const dur = parts[2] || 0;

      const el = spriteElFor(slot);
      if (!el) continue;

      if (fxName === "clear" || fxName === "off" || fxName === "none") clearFX(el);
      else applyFX(el, fxName, dur);

      continue;
    }

    if (t.startsWith("headfx:")) {
      const rest = t.slice(7).trim();
      const parts = rest.split(/\s+/);
      const fxName = (parts[0] || "").toLowerCase();
      const dur = parts[1] || 0;

      if (!talkHeadImgEl) continue;

      if (fxName === "clear" || fxName === "off" || fxName === "none") clearFX(talkHeadImgEl);
      else applyFX(talkHeadImgEl, fxName, dur);

      continue;
    }

    if (t === "flashback:on" || t === "memory:on") { setFlashback(true); continue; }
    if (t === "flashback:off" || t === "memory:off") { setFlashback(false); continue; }

    if (t.startsWith("head:")) {
      const payload = t.slice(5).trim();

      if (payload.includes(":")) {
        const [o, e] = payload.split(":").map(s => s.trim()).filter(Boolean);
        setYaraHead(o, e);
        continue;
      }

      const parts = payload.split("_").map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const outfit = parts[0];
        const expr = parts.slice(1).join("_");
        setYaraHead(outfit, expr);
      } else if (parts.length === 1) {
        setYaraHead(null, parts[0]);
      }
      continue;
    }

    if (t.startsWith("panel:")) {
      const rest = t.slice(6).trim();
      const parts = rest.split(/\s+/);
      const first = (parts[0] || "").toLowerCase();

      if (first === "off" || first === "clear" || first === "hide") {
        setComicPanel("", { style: "fade" });
        continue;
      }

      let style = "fade";
      let name = rest;

      if (["fade", "slide", "zoom"].includes(first)) {
        style = first;
        name = parts.slice(1).join(" ").trim();
      }

      if (!name) continue;
      setComicPanel(panelPath(epId, name), { style });
      continue;
    }

    if (t.startsWith("item:")) {
      const rest = t.slice(5).trim();
      const parts = rest.split(/\s+/);
      const first = (parts[0] || "").toLowerCase();

      if (first === "hide" || first === "off" || first === "clear") {
        setItemOverlay("");
        continue;
      }

      let style = "zoom";
      let name = rest;

      if (["fade", "slide", "zoom"].includes(first)) {
        style = first;
        name = parts.slice(1).join(" ").trim();
      }

      if (!name) continue;
      setItemOverlay(itemPath(epId, name.toLowerCase()), { style });
      continue;
    }

    // SMS
    if (t.startsWith("sms:on")) {
      const rest = t.slice("sms:on".length).trim();
      const contact = rest || smsCurrentContactId || "default";
      setSMSMode(true, { contact });
      continue;
    }

    if (t === "sms:off") { setSMSMode(false); continue; }
    if (t === "sms:clear") { smsClear(); continue; }

    if (t.startsWith("sms:contact")) {
      const rest = t.slice("sms:contact".length).trim();
      const parts = rest.split(/\s+/);
      const id = parts.shift() || "default";
      const name = parts.join(" ").trim() || "Contact";
      setSMSContact(id, { name });
      continue;
    }

    if (t.startsWith("sms:icon")) {
      const path = t.slice("sms:icon".length).trim();
      setSMSContact(smsCurrentContactId, { icon: path || "" });
      continue;
    }

    if (t.startsWith("sms:sub")) {
      const sub = t.slice("sms:sub".length).trim();
      if (smsSubEl) smsSubEl.textContent = sub || "Messages";
      continue;
    }

    if (t.startsWith("sms:typing")) {
      const v = t.slice("sms:typing".length).trim().toLowerCase();
      smsSetTyping(v === "on" || v === "true" || v === "1");
      continue;
    }

    if (t.startsWith("sms:in")) {
      const msg = t.slice("sms:in".length).trim();
      if (msg) smsAppend("in", msg);
      continue;
    }

    if (t.startsWith("sms:out")) {
      const msg = t.slice("sms:out".length).trim();
      if (msg) smsAppend("out", msg);
      continue;
    }

    // AUDIO
    if (t.startsWith("bgm:")) {
      const rest = t.slice(4).trim();
      const parts = rest.split(/\s+/);
      const cmd = (parts[0] || "").toLowerCase();

      if (cmd === "stop" || cmd === "off" || cmd === "clear") {
        const ms = Number(parts[1] || 250);
        stopBGM(ms);
        continue;
      }

      if (cmd === "vol") {
        const v = Number(parts[1]);
        if (!Number.isNaN(v)) {
          bgmTargetVol = clamp01(v);
          if (bgmEl && !bgmEl.paused) bgmEl.volume = bgmTargetVol;
        }
        continue;
      }

      if (cmd === "loop") {
        const v = (parts[1] || "on").toLowerCase();
        if (bgmEl) bgmEl.loop = (v === "on" || v === "true" || v === "1");
        continue;
      }

      if (cmd === "fade") {
        const name = parts[1];
        const ms = Number(parts[2] || 600);
        const src = resolveAudioSrc(epId, "bgm", name);
        console.log("BGM TAG:", name, "=>", src);
        playBGM(src, { fadeMs: ms, volume: bgmTargetVol });
        continue;
      }

      const name = parts[0];
      const maybeVol = Number(parts[1]);
      const vol = Number.isNaN(maybeVol) ? bgmTargetVol : clamp01(maybeVol);

      const src = resolveAudioSrc(epId, "bgm", name);
      console.log("BGM TAG:", name, "=>", src);
      playBGM(src, { fadeMs: 500, volume: vol });
      continue;
    }

    if (t.startsWith("amb:")) {
      const rest = t.slice(4).trim();
      const parts = rest.split(/\s+/);
      const cmd = (parts[0] || "").toLowerCase();

      if (cmd === "stop" || cmd === "off" || cmd === "clear") {
        const ms = Number(parts[1] || 250);
        stopAMB(ms);
        continue;
      }

      if (cmd === "vol") {
        const v = Number(parts[1]);
        if (!Number.isNaN(v)) {
          ambTargetVol = clamp01(v);
          if (ambEl && !ambEl.paused) ambEl.volume = ambTargetVol;
        }
        continue;
      }

      if (cmd === "loop") {
        const v = (parts[1] || "on").toLowerCase();
        if (ambEl) ambEl.loop = (v === "on" || v === "true" || v === "1");
        continue;
      }

      if (cmd === "fade") {
        const name = parts[1];
        const ms = Number(parts[2] || 600);
        const src = resolveAudioSrc(epId, "amb", name);
        playAMB(src, { fadeMs: ms, volume: ambTargetVol });
        continue;
      }

      const name = parts[0];
      const maybeVol = Number(parts[1]);
      const vol = Number.isNaN(maybeVol) ? ambTargetVol : clamp01(maybeVol);

      const src = resolveAudioSrc(epId, "amb", name);
      playAMB(src, { fadeMs: 500, volume: vol });
      continue;
    }

    if (t.startsWith("sfx:")) {
      unlockAudio();

      const rest = t.slice(4).trim();
      const parts = rest.split(/\s+/);
      const name = parts[0];
      const maybeVol = Number(parts[1]);
      const vol = Number.isNaN(maybeVol) ? sfxDefaultVol : clamp01(maybeVol);

      const src = resolveAudioSrc(epId, "sfx", name);
      if (parts.includes("preload")) preloadAudio(src);
      playSFX(src, { volume: vol });
      continue;
    }
  }
}

/** ---------------------------------------
 *  BG + SPRITES
 *  --------------------------------------*/
function showSprite(slot, url) {
  const img = slotToEl(slot);
  if (!img) return;
  img.src = url;
  img.classList.remove("hidden");
}

function hideSprite(slot) {
  const img = slotToEl(slot);
  if (!img) return;
  img.src = "";
  img.classList.add("hidden");
}

function slotToEl(slot) {
  const s = String(slot).toLowerCase();
  if (s === "left") return slotLeft;
  if (s === "center") return slotCenter;
  if (s === "right") return slotRight;
  return null;
}

/** ---------------------------------------
 *  LOG
 *  --------------------------------------*/
function pushBacklogLine(speaker, text) {
  const line = speaker ? `${speaker}: ${text}` : text;
  backlog.push({ type: "line", text: line });
  if (backlog.length > 300) backlog.shift();
}

function pushChoiceToLog(choiceText) {
  backlog.push({ type: "choice", text: `▶ ${choiceText}` });
  if (backlog.length > 300) backlog.shift();
}

function renderLog() {
  logBody.innerHTML = "";
  backlog.forEach((item) => {
    const p = document.createElement("p");
    p.className = item.type === "choice" ? "logLine choice" : "logLine";
    p.textContent = item.text;
    logBody.appendChild(p);
  });
}

/** Buttons */
btnMenu?.addEventListener("click", () => goBackToChaptersOrMenu());

btnRestart?.addEventListener("click", () => {
  if (!currentEpisode || !currentChapterId) return;
  stopAllAudio();
  startChapter(currentEpisode.id, currentChapterId);
});

btnLog?.addEventListener("click", () => {
  renderLog();
  logModal.classList.remove("hidden");
});

btnCloseLog?.addEventListener("click", () => logModal.classList.add("hidden"));

/** ---------------------------------------
 *  HELPERS
 *  --------------------------------------*/
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function splitSpeaker(line) {
  const idx = line.indexOf(":");
  if (idx > 0 && idx < 28) {
    const possibleName = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trimStart();
    if (/^[A-Za-z0-9'’\-\s]+$/.test(possibleName) && rest.length) {
      return { speaker: possibleName, text: rest };
    }
  }
  return { speaker: "", text: line };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c])
  );
}

function setChoicesVisible(visible) {
  choicesEl.classList.toggle("hidden", !visible);
}

/** Start */
bootEpisodes();
