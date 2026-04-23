const STORAGE_KEY = "kidzqueue-playlist";
const PLAYLISTS_KEY = "kidzqueue-playlists-by-parent";
const PIN_KEY = "kidzqueue-parent-pin";
const PARENTS_KEY = "kidzqueue-parent-profiles";
const LAST_PARENT_KEY = "kidzqueue-last-parent";
const AUTH_SCHEMA_KEY = "kidzqueue-auth-schema-version";
const AUTH_SCHEMA_VERSION = "2";
const HASH_ITERATIONS = 120000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;

const views = {
  home: document.getElementById("homeView"),
  parentSignIn: document.getElementById("parentSignInView"),
  parentSignUp: document.getElementById("parentSignUpView"),
  parentReset: document.getElementById("parentResetView"),
  parent: document.getElementById("parentView"),
  child: document.getElementById("childView"),
};

const ui = {
  openParentBtn: document.getElementById("openParentBtn"),
  openChildBtn: document.getElementById("openChildBtn"),
  signInBtn: document.getElementById("signInBtn"),
  toSignUpBtn: document.getElementById("toSignUpBtn"),
  toResetBtn: document.getElementById("toResetBtn"),
  signInParentIdInput: document.getElementById("signInParentIdInput"),
  signInPinInput: document.getElementById("signInPinInput"),
  signInMsg: document.getElementById("signInMsg"),
  newParentIdInput: document.getElementById("newParentIdInput"),
  newPinInput: document.getElementById("newPinInput"),
  confirmNewPinInput: document.getElementById("confirmNewPinInput"),
  hintQuestionInput: document.getElementById("hintQuestionInput"),
  hintAnswerInput: document.getElementById("hintAnswerInput"),
  createSubmitBtn: document.getElementById("createSubmitBtn"),
  signUpToSignInBtn: document.getElementById("signUpToSignInBtn"),
  signUpMsg: document.getElementById("signUpMsg"),
  forgotParentIdInput: document.getElementById("forgotParentIdInput"),
  forgotContinueBtn: document.getElementById("forgotContinueBtn"),
  forgotHintWrap: document.getElementById("forgotHintWrap"),
  forgotHintQuestion: document.getElementById("forgotHintQuestion"),
  forgotAnswerInput: document.getElementById("forgotAnswerInput"),
  resetPinInput: document.getElementById("resetPinInput"),
  confirmResetPinInput: document.getElementById("confirmResetPinInput"),
  resetPinBtn: document.getElementById("resetPinBtn"),
  resetToSignInBtn: document.getElementById("resetToSignInBtn"),
  resetMsg: document.getElementById("resetMsg"),
  urlInput: document.getElementById("urlInput"),
  addUrlBtn: document.getElementById("addUrlBtn"),
  urlMsg: document.getElementById("urlMsg"),
  playlistList: document.getElementById("playlistList"),
  clearPlaylistBtn: document.getElementById("clearPlaylistBtn"),
  childStatus: document.getElementById("childStatus"),
  childBackBtn: document.getElementById("childBackBtn"),
  childPlayBtn: document.getElementById("childPlayBtn"),
  childPauseBtn: document.getElementById("childPauseBtn"),
  childNextBtn: document.getElementById("childNextBtn"),
  childFullscreenBtn: document.getElementById("childFullscreenBtn"),
  playerWrap: document.querySelector("#childView .player-wrap"),
  nowPlaying: document.getElementById("nowPlaying"),
  nextRow: document.getElementById("nextRow"),
  nextPlaying: document.getElementById("nextPlaying"),
  pdfInput: document.getElementById("pdfInput"),
  pdfResults: document.getElementById("pdfResults"),
};

let playlist = [];
let player;
let ytApiReady = false;
let lastImportedUrls = [];
let isPaused = false;
let consecutiveErrors = 0;
let forgotParentId = "";
let currentParentId = "";
let kidPlaybackOrder = [];
let kidPlaybackPos = 0;
const textEncoder = new TextEncoder();

function showView(key) {
  const wasChild = document.body.dataset.view === "child";
  if (wasChild && key !== "child") {
    stopChildPlayback();
  }

  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[key].classList.remove("hidden");

  const navKey = key === "child" ? "child" : key.startsWith("parent") ? "parent" : "home";
  document.body.dataset.view = navKey;
  document.querySelectorAll(".menu-item[data-nav]").forEach((item) => {
    item.classList.toggle("active", item.dataset.nav === navKey);
  });
}

function loadLegacyPlaylist() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function loadPlaylistsByParent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

function savePlaylistsByParent(playlistsByParent) {
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlistsByParent));
}

function loadPlaylistForParent(parentId) {
  if (!parentId) return [];
  const playlistsByParent = loadPlaylistsByParent();
  const list = playlistsByParent[parentId];
  return Array.isArray(list) ? list : [];
}

function savePlaylistForParent(parentId, nextPlaylist) {
  if (!parentId) return;
  const playlistsByParent = loadPlaylistsByParent();
  playlistsByParent[parentId] = nextPlaylist;
  savePlaylistsByParent(playlistsByParent);
}

function loadParentProfiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PARENTS_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

function saveParentProfiles(profiles) {
  localStorage.setItem(PARENTS_KEY, JSON.stringify(profiles));
}

function getParentProfile(parentId) {
  const profiles = loadParentProfiles();
  const profile = profiles[parentId];
  if (!profile || typeof profile !== "object") return null;
  return profile;
}

function getCookie(name) {
  const row = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.split("=")[1]) : "";
}

function rememberParentProfile(parentId) {
  localStorage.setItem(LAST_PARENT_KEY, parentId);
  document.cookie = `kidzqueue_parent=${encodeURIComponent(parentId)}; max-age=31536000; path=/; SameSite=Lax`;
}

function savePlaylist() {
  savePlaylistForParent(currentParentId, playlist);
}

function setActiveParent(parentId) {
  currentParentId = parentId || "";
  playlist = loadPlaylistForParent(currentParentId);
  kidPlaybackOrder = [];
  kidPlaybackPos = 0;
  renderPlaylist();
  refreshChildState();
}

function migrateLegacyPlaylistIfNeeded() {
  const legacyPlaylist = loadLegacyPlaylist();
  if (!legacyPlaylist.length) return;

  const rememberedParent =
    normalizeParentId(localStorage.getItem(LAST_PARENT_KEY) || getCookie("kidzqueue_parent") || "");
  if (!rememberedParent) return;

  const existing = loadPlaylistForParent(rememberedParent);
  if (!existing.length) {
    savePlaylistForParent(rememberedParent, legacyPlaylist);
  }
  localStorage.removeItem(STORAGE_KEY);
}

function migrateAuthSchemaV2() {
  const schemaVersion = localStorage.getItem(AUTH_SCHEMA_KEY);
  if (schemaVersion === AUTH_SCHEMA_VERSION) return;
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(PARENTS_KEY);
  localStorage.removeItem(LAST_PARENT_KEY);
  document.cookie = "kidzqueue_parent=; max-age=0; path=/; SameSite=Lax";
  localStorage.setItem(AUTH_SCHEMA_KEY, AUTH_SCHEMA_VERSION);
}

function normalizeParentId(value) {
  return value.trim().toLowerCase();
}

function normalizeHintAnswer(value) {
  return value.trim().toLowerCase();
}

function isValidPin(pin) {
  return /^\d{4}$/.test(pin);
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function generateSalt() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(salt);
}

async function deriveHash(value, saltBase64) {
  if (!window.crypto?.subtle) {
    throw new Error("Secure crypto unavailable in this browser.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(saltBase64),
      iterations: HASH_ITERATIONS,
    },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

async function hashAndSalt(value) {
  const salt = generateSalt();
  const hash = await deriveHash(value, salt);
  return { salt, hash };
}

async function verifyHash(value, salt, expectedHash) {
  const derived = await deriveHash(value, salt);
  return derived === expectedHash;
}

function isLocked(profile) {
  return Number(profile?.lockUntil || 0) > Date.now();
}

function lockRemainingMs(profile) {
  return Math.max(0, Number(profile?.lockUntil || 0) - Date.now());
}

function formatRemainingTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function createParentAccount({ parentId, pin, hintQuestion, hintAnswer }) {
  const profiles = loadParentProfiles();
  if (profiles[parentId]) {
    return { ok: false, msg: "That parent profile already exists." };
  }
  const pinData = await hashAndSalt(pin);
  const hintData = await hashAndSalt(normalizeHintAnswer(hintAnswer));
  const now = new Date().toISOString();

  profiles[parentId] = {
    pinHash: pinData.hash,
    pinSalt: pinData.salt,
    hintQuestion: hintQuestion.trim(),
    hintAnswerHash: hintData.hash,
    hintSalt: hintData.salt,
    createdAt: now,
    updatedAt: now,
    failedAttempts: 0,
    lockUntil: 0,
  };
  saveParentProfiles(profiles);
  return { ok: true };
}

async function signInParent({ parentId, pin }) {
  const profiles = loadParentProfiles();
  const profile = profiles[parentId];
  if (!profile || typeof profile !== "object") {
    return { ok: false, code: "USER_NOT_FOUND", msg: "User does not exist. Please sign up." };
  }
  if (isLocked(profile)) {
    return {
      ok: false,
      code: "LOCKED",
      msg: `Too many attempts. Try again in ${formatRemainingTime(lockRemainingMs(profile))}.`,
    };
  }

  const valid = await verifyHash(pin, profile.pinSalt, profile.pinHash);
  if (!valid) {
    const failedAttempts = Number(profile.failedAttempts || 0) + 1;
    profile.failedAttempts = failedAttempts;
    profile.updatedAt = new Date().toISOString();
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      profile.failedAttempts = 0;
      profile.lockUntil = Date.now() + LOCK_DURATION_MS;
      saveParentProfiles(profiles);
      return {
        ok: false,
        code: "LOCKED",
        msg: `Too many attempts. Try again in ${formatRemainingTime(LOCK_DURATION_MS)}.`,
      };
    }
    saveParentProfiles(profiles);
    return { ok: false, code: "BAD_PIN", msg: "Incorrect PIN." };
  }

  profile.failedAttempts = 0;
  profile.lockUntil = 0;
  profile.updatedAt = new Date().toISOString();
  saveParentProfiles(profiles);
  return { ok: true, code: "OK" };
}

function beginForgotPin(parentId) {
  const profiles = loadParentProfiles();
  const profile = profiles[parentId];
  if (!profile || typeof profile !== "object") {
    return { ok: false };
  }
  return { ok: true, hintQuestion: profile.hintQuestion || "" };
}

async function verifyHintAnswerAndResetPin({ parentId, hintAnswer, newPin }) {
  const profiles = loadParentProfiles();
  const profile = profiles[parentId];
  if (!profile || typeof profile !== "object") {
    return { ok: false, msg: "Unable to reset PIN. Check your details and try again." };
  }

  const answerOk = await verifyHash(
    normalizeHintAnswer(hintAnswer),
    profile.hintSalt,
    profile.hintAnswerHash,
  );
  if (!answerOk) {
    return { ok: false, msg: "Hint answer is incorrect." };
  }

  const newPinData = await hashAndSalt(newPin);
  profile.pinSalt = newPinData.salt;
  profile.pinHash = newPinData.hash;
  profile.failedAttempts = 0;
  profile.lockUntil = 0;
  profile.updatedAt = new Date().toISOString();
  saveParentProfiles(profiles);
  return { ok: true };
}

function getVideoIdFromUrl(raw) {
  try {
    const input = raw.trim();
    const normalized = input.startsWith("www.") ? `https://${input}` : input;
    const url = new URL(normalized);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.slice(1) || null;
    }
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.split("/")[2] || null;
      }
      if (url.pathname.startsWith("/embed/")) {
        return url.pathname.split("/")[2] || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function buildVideo(rawUrl) {
  const id = getVideoIdFromUrl(rawUrl);
  if (!id) return null;
  const cleanUrl = normalizeYoutubeUrl(rawUrl);
  return {
    id,
    url: cleanUrl,
    title: `Video ${id}`,
    thumb: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
  };
}

function isFallbackTitle(title, id) {
  return title === `Video ${id}`;
}

async function fetchYoutubeTitle(url) {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(endpoint);
    if (!res.ok) return "";
    const data = await res.json();
    return typeof data.title === "string" ? data.title.trim() : "";
  } catch {
    return "";
  }
}

async function enrichVideoTitle(video) {
  if (!video?.id || !video?.url) return;
  if (video.title && !isFallbackTitle(video.title, video.id)) return;

  const resolvedTitle = await fetchYoutubeTitle(video.url);
  if (!resolvedTitle) return;

  const target = playlist.find((item) => item.id === video.id);
  if (!target) return;
  if (target.title === resolvedTitle) return;

  target.title = resolvedTitle;
  savePlaylist();
  renderPlaylist();
  refreshNowNext();
}

function normalizeYoutubeUrl(raw) {
  const input = raw.trim();
  if (input.startsWith("www.")) return `https://${input}`;
  return input;
}

function refreshAfterPlaylistChange() {
  if (document.body.dataset.view === "child") {
    syncKidPlaybackOrder();
  } else if (!playlist.length) {
    kidPlaybackOrder = [];
    kidPlaybackPos = 0;
  }
  savePlaylist();
  renderPlaylist();
  refreshChildState();
  if (lastImportedUrls.length) {
    showPdfPreview(lastImportedUrls);
  }
}

function renderPlaylist() {
  ui.playlistList.innerHTML = "";

  if (!playlist.length) {
    const li = document.createElement("li");
    li.textContent = "No videos yet. Add from URL or PDF.";
    ui.playlistList.appendChild(li);
    return;
  }

  playlist.forEach((item, idx) => {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "video-meta";

    const thumb = document.createElement("img");
    thumb.src = item.thumb;
    thumb.alt = "Video thumbnail";

    const textWrap = document.createElement("div");
    textWrap.className = "video-main";

    const title = document.createElement("strong");
    const fallbackTitle = item.id ? `Video ${item.id}` : "Video";
    title.textContent = `${idx + 1}. ${item.title || fallbackTitle}`;

    const verifyLink = document.createElement("a");
    verifyLink.className = "verify-link";
    verifyLink.target = "_blank";
    verifyLink.rel = "noopener noreferrer";
    verifyLink.textContent = "Verify";
    verifyLink.href = item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : "#");

    textWrap.appendChild(title);
    textWrap.appendChild(verifyLink);
    meta.appendChild(thumb);
    meta.appendChild(textWrap);

    const controls = document.createElement("div");
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn danger icon-btn remove-btn";
    removeBtn.innerHTML = '<span aria-hidden="true">−</span>';
    removeBtn.setAttribute("aria-label", "Remove video");
    removeBtn.title = "Remove video";
    removeBtn.addEventListener("click", () => {
      if (!hasParentContext()) {
        setMsg(ui.urlMsg, "Sign in as a parent to edit this playlist.");
        return;
      }
      playlist.splice(idx, 1);
      refreshAfterPlaylistChange();
    });

    controls.appendChild(removeBtn);
    li.appendChild(meta);
    li.appendChild(controls);
    ui.playlistList.appendChild(li);
  });
}

function setMsg(el, msg) {
  el.textContent = msg;
}

function setStatus(el, msg, tone = "") {
  el.textContent = msg;
  el.classList.remove("error", "success");
  if (tone) el.classList.add(tone);
}

function hasParentContext() {
  return Boolean(currentParentId && getParentProfile(currentParentId));
}

function resetAuthMessages() {
  setStatus(ui.signInMsg, "");
  setStatus(ui.signUpMsg, "");
  setStatus(ui.resetMsg, "");
}

function resetCreateFields() {
  ui.newParentIdInput.value = "";
  ui.newPinInput.value = "";
  ui.confirmNewPinInput.value = "";
  ui.hintQuestionInput.value = "";
  ui.hintAnswerInput.value = "";
}

function resetForgotFields() {
  forgotParentId = "";
  ui.forgotParentIdInput.value = "";
  ui.forgotHintQuestion.textContent = "";
  ui.forgotHintWrap.classList.add("hidden");
  ui.forgotAnswerInput.value = "";
  ui.resetPinInput.value = "";
  ui.confirmResetPinInput.value = "";
}

function addVideoFromInput(url) {
  if (!hasParentContext()) {
    setMsg(ui.urlMsg, "Sign in as a parent to edit this playlist.");
    return false;
  }
  const item = buildVideo(url);
  if (!item) {
    setMsg(ui.urlMsg, "Invalid YouTube URL.");
    return false;
  }

  if (playlist.some((v) => v.id === item.id)) {
    setMsg(ui.urlMsg, "This video is already in playlist.");
    return false;
  }

  playlist.push(item);
  refreshAfterPlaylistChange();
  enrichVideoTitle(item);
  setMsg(ui.urlMsg, "Video added.");
  return true;
}

function extractYoutubeUrls(text) {
  const cleanText = text.replace(/\\\//g, "/");
  const patterns = [
    /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)\]>"']+)/gi,
    /((?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)\]>"']+)/gi,
  ];
  const found = [];
  patterns.forEach((regex) => {
    const matches = cleanText.match(regex) || [];
    found.push(...matches);
  });

  const deduped = [];
  const seenIds = new Set();
  found.forEach((candidate) => {
    const video = buildVideo(candidate);
    if (!video || seenIds.has(video.id)) return;
    seenIds.add(video.id);
    deduped.push(video.url);
  });

  return deduped;
}

function extractUrlsFromPdfBytes(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  return extractYoutubeUrls(text);
}

function showPdfPreview(urls) {
  lastImportedUrls = [...urls];
  ui.pdfResults.innerHTML = "";

  if (!urls.length) {
    ui.pdfResults.innerHTML = "<p>No YouTube URLs found in this PDF.</p>";
    return;
  }

  const pendingUrls = urls.filter((url) => {
    const video = buildVideo(url);
    if (!video) return false;
    return !playlist.some((v) => v.id === video.id);
  });

  if (!pendingUrls.length) {
    ui.pdfResults.innerHTML = "<p>No YouTube URLs found in this PDF.</p>";
    return;
  }

  pendingUrls.forEach((url) => {
    const video = buildVideo(url);
    if (!video) return;

    const item = document.createElement("div");
    item.className = "preview-item";
    item.innerHTML = `
      <img src="${video.thumb}" alt="Video thumbnail">
      <div>
        <strong>${video.id}</strong><br>
        <small>${url}</small>
      </div>
    `;

    const addBtn = document.createElement("button");
    addBtn.className = "btn primary";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", () => {
      const ok = addVideoFromInput(url);
      if (ok) showPdfPreview(lastImportedUrls);
    });

    item.appendChild(addBtn);
    ui.pdfResults.appendChild(item);
  });
}

async function importPdf(file) {
  if (!file) return;
  const bytes = await file.arrayBuffer();
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) {
    const fallbackUrls = extractUrlsFromPdfBytes(bytes);
    showPdfPreview(fallbackUrls);
    if (!fallbackUrls.length) {
      ui.pdfResults.innerHTML =
        "<p>PDF parser unavailable and fallback found no links. Check internet/ad-blocker and hard refresh (Cmd+Shift+R).</p>";
    }
    return;
  }
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }

  ui.pdfResults.innerHTML = "<p>Scanning PDF for YouTube URLs...</p>";
  try {
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    let text = "";

    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pageTokens = content.items.map((it) => it.str);
      text += ` ${pageTokens.join(" ")} ${pageTokens.join("")}`;
    }

    const urls = extractYoutubeUrls(text);
    showPdfPreview(urls);
  } catch {
    const fallbackUrls = extractUrlsFromPdfBytes(bytes);
    showPdfPreview(fallbackUrls);
    if (!fallbackUrls.length) {
      ui.pdfResults.innerHTML =
        "<p>Could not parse this PDF. Try another file export or copy/paste URLs directly.</p>";
    }
  }
}

function refreshNowNext() {
  if (!playlist.length) {
    ui.nowPlaying.textContent = "-";
    ui.nextPlaying.textContent = "-";
    return;
  }

  const current = getKidCurrentVideo();
  const next = getKidNextVideo();
  ui.nowPlaying.textContent = current ? getDisplayVideoTitle(current) : "-";
  ui.nextPlaying.textContent = next ? getDisplayVideoTitle(next) : "-";
}

function refreshChildState() {
  syncKidPlaybackOrder();

  if (!playlist.length) {
    if (!currentParentId || !getParentProfile(currentParentId)) {
      setMsg(ui.childStatus, "No parent playlist selected yet. Ask a parent to sign in and add videos.");
    } else {
      setMsg(ui.childStatus, "No videos available yet. Ask parent to add videos.");
    }
    ui.childPlayBtn.classList.remove("hidden");
    ui.childPlayBtn.disabled = true;
    ui.childPauseBtn.disabled = true;
    ui.childPauseBtn.textContent = "Pause";
    ui.childNextBtn.disabled = true;
    refreshNowNext();
    return;
  }
  ui.childPlayBtn.disabled = false;
  ui.childPlayBtn.classList.remove("hidden");
  ui.childPauseBtn.disabled = false;
  ui.childPauseBtn.textContent = isPaused ? "Resume" : "Pause";
  ui.childNextBtn.disabled = false;
  setMsg(ui.childStatus, `${playlist.length} approved video(s). Tap Start Playlist to begin.`);
  refreshNowNext();
}

function playCurrentVideo() {
  if (!player || !playlist.length) return;
  syncKidPlaybackOrder();
  isPaused = false;
  consecutiveErrors = 0;
  ui.childPauseBtn.textContent = "Pause";
  const current = getKidCurrentVideo();
  const id = current?.id;
  if (!id) return;
  player.loadVideoById(id);
  player.playVideo();
  ui.childPlayBtn.classList.add("hidden");
  ui.childPauseBtn.disabled = false;
  ui.childNextBtn.disabled = false;
  refreshNowNext();
}

function goToNextVideo() {
  if (!playlist.length) return;
  syncKidPlaybackOrder();
  if (kidPlaybackOrder.length) {
    kidPlaybackPos = (kidPlaybackPos + 1) % kidPlaybackOrder.length;
  }
  playCurrentVideo();
  setMsg(ui.childStatus, "Playing approved video.");
}

function shuffleIndices(length) {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function syncKidPlaybackOrder({ forceRebuild = false } = {}) {
  if (!playlist.length) {
    kidPlaybackOrder = [];
    kidPlaybackPos = 0;
    return;
  }

  const hasInvalidLength = kidPlaybackOrder.length !== playlist.length;
  const hasInvalidIndex = kidPlaybackOrder.some((index) => index < 0 || index >= playlist.length);

  if (forceRebuild || hasInvalidLength || hasInvalidIndex) {
    kidPlaybackOrder = shuffleIndices(playlist.length);
    kidPlaybackPos = 0;
    return;
  }

  if (kidPlaybackPos < 0 || kidPlaybackPos >= kidPlaybackOrder.length) {
    kidPlaybackPos = 0;
  }
}

function getKidCurrentVideo() {
  syncKidPlaybackOrder();
  if (!kidPlaybackOrder.length) return null;
  const playlistIndex = kidPlaybackOrder[kidPlaybackPos];
  return playlist[playlistIndex] || null;
}

function getKidNextVideo() {
  syncKidPlaybackOrder();
  if (!kidPlaybackOrder.length) return null;
  const nextPos = (kidPlaybackPos + 1) % kidPlaybackOrder.length;
  const playlistIndex = kidPlaybackOrder[nextPos];
  return playlist[playlistIndex] || null;
}

function getDisplayVideoTitle(video) {
  if (!video) return "-";
  const fallbackTitle = video.id ? `Video ${video.id}` : "Video";
  return video.title || fallbackTitle;
}

function togglePause() {
  if (!player || !playlist.length) return;
  if (isPaused) {
    player.playVideo();
    isPaused = false;
    ui.childPauseBtn.textContent = "Pause";
  } else {
    player.pauseVideo();
    isPaused = true;
    ui.childPauseBtn.textContent = "Resume";
  }
}

function stopChildPlayback() {
  if (player) {
    try {
      player.pauseVideo();
    } catch {
      // Ignore player timing errors when iframe is not fully ready.
    }
  }
  isPaused = true;
  ui.childPauseBtn.textContent = "Resume";
  ui.childPlayBtn.classList.remove("hidden");
}

function toggleFullscreen() {
  const target = ui.playerWrap;
  if (!target) return;

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }

  if (typeof target.requestFullscreen === "function") {
    target.requestFullscreen().catch(() => {});
  }
}

function initPlayerIfReady() {
  if (!ytApiReady || player || !document.getElementById("ytPlayer")) return;

  const playerVars = {
    autoplay: 0,
    controls: 0,
    disablekb: 1,
    fs: 0,
    modestbranding: 1,
    rel: 0,
    iv_load_policy: 3,
    playsinline: 1,
  };
  if (window.location.protocol.startsWith("http")) {
    playerVars.origin = window.location.origin;
  }

  player = new YT.Player("ytPlayer", {
    videoId: playlist[0]?.id || "",
    playerVars,
    events: {
      onReady: () => {},
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.PLAYING) {
          consecutiveErrors = 0;
        }
        if (event.data === YT.PlayerState.ENDED && playlist.length) {
          setMsg(ui.childStatus, "Video finished. Tap Next Video.");
          ui.childPauseBtn.textContent = "Pause";
          isPaused = false;
        }
      },
      onError: () => {
        consecutiveErrors += 1;
        if (playlist.length > 1 && consecutiveErrors < playlist.length) {
          setMsg(ui.childStatus, "Video unavailable. Loading next approved video...");
          goToNextVideo();
          return;
        }
        setMsg(ui.childStatus, "This video is unavailable. Tap Next Video.");
      },
    },
  });
}

window.onYouTubeIframeAPIReady = () => {
  ytApiReady = true;
  initPlayerIfReady();
};

function openChildMode() {
  const rememberedParent =
    normalizeParentId(localStorage.getItem(LAST_PARENT_KEY) || getCookie("kidzqueue_parent") || "");
  if (rememberedParent && getParentProfile(rememberedParent)) {
    setActiveParent(rememberedParent);
  } else {
    setActiveParent("");
  }
  syncKidPlaybackOrder({ forceRebuild: true });
  showView("child");
  initPlayerIfReady();
  refreshChildState();
}

function openParentGate() {
  const rememberedParent =
    localStorage.getItem(LAST_PARENT_KEY) || getCookie("kidzqueue_parent") || "";
  ui.signInParentIdInput.value = rememberedParent;
  ui.signInPinInput.value = "";
  resetCreateFields();
  resetForgotFields();
  ui.forgotParentIdInput.value = rememberedParent;
  ui.newParentIdInput.value = rememberedParent;
  resetAuthMessages();
  showView("parentSignIn");
}

async function submitParentPin() {
  const parentId = normalizeParentId(ui.signInParentIdInput.value);
  const pin = ui.signInPinInput.value.trim();
  if (!parentId) {
    setStatus(ui.signInMsg, "Enter parent name or email.", "error");
    return;
  }
  if (!isValidPin(pin)) {
    setStatus(ui.signInMsg, "PIN must be 4 digits.", "error");
    return;
  }

  try {
    const result = await signInParent({ parentId, pin });
    if (!result.ok) {
      setStatus(ui.signInMsg, result.msg, "error");
      return;
    }
    rememberParentProfile(parentId);
    setActiveParent(parentId);
    setStatus(ui.signInMsg, "Parent unlocked.", "success");
    showView("parent");
  } catch (err) {
    setStatus(ui.signInMsg, `Sign in failed: ${err.message}`, "error");
  }
}

async function submitCreateAccount() {
  const parentId = normalizeParentId(ui.newParentIdInput.value);
  const pin = ui.newPinInput.value.trim();
  const confirmPin = ui.confirmNewPinInput.value.trim();
  const hintQuestion = ui.hintQuestionInput.value.trim();
  const hintAnswer = ui.hintAnswerInput.value.trim();

  if (!parentId) {
    setStatus(ui.signUpMsg, "Enter parent name or email.", "error");
    return;
  }
  if (!isValidPin(pin)) {
    setStatus(ui.signUpMsg, "PIN must be 4 digits.", "error");
    return;
  }
  if (pin !== confirmPin) {
    setStatus(ui.signUpMsg, "PIN and confirm PIN must match.", "error");
    return;
  }
  if (hintQuestion.length < 6) {
    setStatus(ui.signUpMsg, "Hint question must be at least 6 characters.", "error");
    return;
  }
  if (hintAnswer.length < 2) {
    setStatus(ui.signUpMsg, "Hint answer must be at least 2 characters.", "error");
    return;
  }

  try {
    const result = await createParentAccount({ parentId, pin, hintQuestion, hintAnswer });
    if (!result.ok) {
      setStatus(ui.signUpMsg, result.msg, "error");
      return;
    }
    rememberParentProfile(parentId);
    setActiveParent(parentId);
    setStatus(ui.signUpMsg, "Account created. Parent unlocked.", "success");
    showView("parent");
  } catch (err) {
    setStatus(ui.signUpMsg, `Create account failed: ${err.message}`, "error");
  }
}

function startForgotPinFlow() {
  const parentId = normalizeParentId(ui.forgotParentIdInput.value);
  if (!parentId) {
    setStatus(ui.resetMsg, "Enter parent name or email.", "error");
    return;
  }
  const result = beginForgotPin(parentId);
  if (!result.ok) {
    setStatus(ui.resetMsg, "User does not exist. Please sign up.", "error");
    ui.forgotHintWrap.classList.add("hidden");
    forgotParentId = "";
    return;
  }
  forgotParentId = parentId;
  ui.forgotHintQuestion.textContent = result.hintQuestion || "(No hint question saved.)";
  ui.forgotHintWrap.classList.remove("hidden");
  setStatus(ui.resetMsg, "Hint loaded. Provide answer and set new PIN.", "success");
}

async function submitForgotReset() {
  const hintAnswer = ui.forgotAnswerInput.value.trim();
  const newPin = ui.resetPinInput.value.trim();
  const confirmPin = ui.confirmResetPinInput.value.trim();

  if (!forgotParentId) {
    setStatus(ui.resetMsg, "Start by entering your profile and loading the hint.", "error");
    return;
  }
  if (hintAnswer.length < 2) {
    setStatus(ui.resetMsg, "Enter your hint answer.", "error");
    return;
  }
  if (!isValidPin(newPin)) {
    setStatus(ui.resetMsg, "New PIN must be 4 digits.", "error");
    return;
  }
  if (newPin !== confirmPin) {
    setStatus(ui.resetMsg, "New PIN and confirm PIN must match.", "error");
    return;
  }

  try {
    const result = await verifyHintAnswerAndResetPin({
      parentId: forgotParentId,
      hintAnswer,
      newPin,
    });
    if (!result.ok) {
      setStatus(ui.resetMsg, result.msg, "error");
      return;
    }
    showView("parentSignIn");
    ui.signInParentIdInput.value = forgotParentId;
    ui.signInPinInput.value = "";
    setStatus(ui.signInMsg, "PIN reset. Sign in with your new PIN.", "success");
    resetForgotFields();
  } catch (err) {
    setStatus(ui.resetMsg, `Reset failed: ${err.message}`, "error");
  }
}

ui.openParentBtn.addEventListener("click", () => {
  openParentGate();
});

ui.openChildBtn.addEventListener("click", () => {
  openChildMode();
});
ui.childPlayBtn.addEventListener("click", () => {
  playCurrentVideo();
});
ui.childPauseBtn.addEventListener("click", () => {
  togglePause();
});
ui.childNextBtn.addEventListener("click", () => {
  goToNextVideo();
});
ui.childFullscreenBtn.addEventListener("click", () => {
  toggleFullscreen();
});
ui.childBackBtn.addEventListener("click", () => {
  showView("home");
});

ui.signInBtn.addEventListener("click", () => {
  submitParentPin();
});
ui.toSignUpBtn.addEventListener("click", () => {
  resetAuthMessages();
  resetCreateFields();
  ui.newParentIdInput.value = normalizeParentId(ui.signInParentIdInput.value);
  showView("parentSignUp");
});
ui.toResetBtn.addEventListener("click", () => {
  resetAuthMessages();
  resetForgotFields();
  ui.forgotParentIdInput.value = normalizeParentId(ui.signInParentIdInput.value);
  showView("parentReset");
});
ui.signUpToSignInBtn.addEventListener("click", () => {
  resetAuthMessages();
  resetCreateFields();
  ui.signInParentIdInput.value = normalizeParentId(ui.newParentIdInput.value);
  showView("parentSignIn");
});
ui.createSubmitBtn.addEventListener("click", () => {
  submitCreateAccount();
});
ui.resetToSignInBtn.addEventListener("click", () => {
  resetAuthMessages();
  resetForgotFields();
  ui.signInParentIdInput.value = normalizeParentId(ui.forgotParentIdInput.value);
  showView("parentSignIn");
});
ui.forgotContinueBtn.addEventListener("click", () => {
  startForgotPinFlow();
});
ui.resetPinBtn.addEventListener("click", () => {
  submitForgotReset();
});
ui.signInPinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitParentPin();
});
ui.signInParentIdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitParentPin();
});
ui.confirmNewPinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitCreateAccount();
});
ui.hintAnswerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitCreateAccount();
});
ui.forgotParentIdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startForgotPinFlow();
});
ui.confirmResetPinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitForgotReset();
});
ui.forgotAnswerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitForgotReset();
});

ui.addUrlBtn.addEventListener("click", () => {
  const url = ui.urlInput.value;
  if (addVideoFromInput(url)) {
    ui.urlInput.value = "";
  }
});

ui.clearPlaylistBtn.addEventListener("click", () => {
  if (!hasParentContext()) {
    setMsg(ui.urlMsg, "Sign in as a parent to edit this playlist.");
    return;
  }
  playlist = [];
  refreshAfterPlaylistChange();
});

ui.pdfInput.addEventListener("change", (e) => {
  importPdf(e.target.files?.[0]).catch((err) => {
    ui.pdfResults.innerHTML = `<p>PDF import failed: ${err.message}</p>`;
  });
});

document.querySelectorAll("[data-back-home]").forEach((btn) => {
  btn.addEventListener("click", () => showView("home"));
});

document.querySelectorAll(".menu-item[data-nav]").forEach((item) => {
  item.addEventListener("click", () => {
    const nav = item.dataset.nav;
    if (nav === "parent") {
      openParentGate();
      return;
    }
    if (nav === "child") {
      openChildMode();
      return;
    }
    showView("home");
  });
});

migrateAuthSchemaV2();
migrateLegacyPlaylistIfNeeded();
setActiveParent("");
showView("home");
