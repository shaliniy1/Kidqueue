const STORAGE_KEY = "kidzqueue-playlist";
const PIN_KEY = "kidzqueue-parent-pin";
const PARENTS_KEY = "kidzqueue-parent-profiles";
const LAST_PARENT_KEY = "kidzqueue-last-parent";

const views = {
  home: document.getElementById("homeView"),
  parentGate: document.getElementById("parentGateView"),
  parent: document.getElementById("parentView"),
  child: document.getElementById("childView"),
};

const ui = {
  openParentBtn: document.getElementById("openParentBtn"),
  openChildBtn: document.getElementById("openChildBtn"),
  submitPinBtn: document.getElementById("submitPinBtn"),
  parentIdInput: document.getElementById("parentIdInput"),
  pinInput: document.getElementById("pinInput"),
  pinMsg: document.getElementById("pinMsg"),
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
  nowPlaying: document.getElementById("nowPlaying"),
  nextRow: document.getElementById("nextRow"),
  nextPlaying: document.getElementById("nextPlaying"),
  pdfInput: document.getElementById("pdfInput"),
  pdfResults: document.getElementById("pdfResults"),
};

let playlist = loadPlaylist();
let player;
let currentIndex = 0;
let ytApiReady = false;
let lastImportedUrls = [];
let isPaused = false;
let consecutiveErrors = 0;

function showView(key) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[key].classList.remove("hidden");
}

function loadPlaylist() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function loadParentProfiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PARENTS_KEY) || "{}");
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

function saveParentProfiles(profiles) {
  localStorage.setItem(PARENTS_KEY, JSON.stringify(profiles));
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlist));
}

function migrateLegacyPinIfNeeded() {
  const legacyPin = localStorage.getItem(PIN_KEY);
  if (!legacyPin) return;
  const profiles = loadParentProfiles();
  if (!Object.keys(profiles).length) {
    profiles.default = legacyPin;
    saveParentProfiles(profiles);
  }
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

function normalizeYoutubeUrl(raw) {
  const input = raw.trim();
  if (input.startsWith("www.")) return `https://${input}`;
  return input;
}

function refreshAfterPlaylistChange() {
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
    meta.innerHTML = `
      <img src="${item.thumb}" alt="Video thumbnail">
      <div>
        <strong>${idx + 1}. ${item.title}</strong><br><small>${item.url}</small>
      </div>
    `;

    const controls = document.createElement("div");
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
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

function addVideoFromInput(url) {
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

  const current = playlist[currentIndex];
  const next = playlist[(currentIndex + 1) % playlist.length];
  ui.nowPlaying.innerHTML = current
    ? `<a href="${current.url}" target="_blank" rel="noopener noreferrer">${current.title}</a>`
    : "-";
  ui.nextPlaying.innerHTML = next
    ? `<a href="${next.url}" target="_blank" rel="noopener noreferrer">${next.title}</a>`
    : "-";
}

function refreshChildState() {
  if (!playlist.length) {
    setMsg(ui.childStatus, "No videos available yet. Ask parent to add videos.");
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
  ui.childPauseBtn.textContent = "Pause";
  ui.childNextBtn.disabled = false;
  setMsg(ui.childStatus, `${playlist.length} approved video(s). Tap Start Playlist to begin.`);
  refreshNowNext();
}

function playCurrentVideo() {
  if (!player || !playlist.length) return;
  isPaused = false;
  consecutiveErrors = 0;
  ui.childPauseBtn.textContent = "Pause";
  const id = playlist[currentIndex]?.id;
  player.loadVideoById(id);
  player.playVideo();
  ui.childPlayBtn.classList.add("hidden");
  ui.childPauseBtn.disabled = false;
  ui.childNextBtn.disabled = false;
  refreshNowNext();
}

function goToNextVideo() {
  if (!playlist.length) return;
  currentIndex = (currentIndex + 1) % playlist.length;
  playCurrentVideo();
  setMsg(ui.childStatus, "Playing approved video.");
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

function initPlayerIfReady() {
  if (!ytApiReady || player || !document.getElementById("ytPlayer")) return;

  const playerVars = {
    autoplay: 1,
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
      onReady: () => {
        if (playlist.length) playCurrentVideo();
      },
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
  showView("child");
  currentIndex = 0;
  initPlayerIfReady();
  refreshChildState();
}

function submitParentPin() {
  const parentId = ui.parentIdInput.value.trim().toLowerCase();
  const pin = ui.pinInput.value.trim();
  if (!parentId) {
    setMsg(ui.pinMsg, "Enter parent name or email.");
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    setMsg(ui.pinMsg, "PIN must be 4 digits.");
    return;
  }

  const profiles = loadParentProfiles();
  const existing = profiles[parentId];
  if (!existing) {
    profiles[parentId] = pin;
    saveParentProfiles(profiles);
    rememberParentProfile(parentId);
    setMsg(ui.pinMsg, "PIN set. Parent unlocked.");
    showView("parent");
    renderPlaylist();
    return;
  }

  if (existing !== pin) {
    setMsg(ui.pinMsg, "Incorrect PIN.");
    return;
  }

  rememberParentProfile(parentId);
  setMsg(ui.pinMsg, "Parent unlocked.");
  showView("parent");
  renderPlaylist();
}

ui.openParentBtn.addEventListener("click", () => {
  const rememberedParent =
    localStorage.getItem(LAST_PARENT_KEY) || getCookie("kidzqueue_parent") || "";
  ui.parentIdInput.value = rememberedParent;
  ui.pinInput.value = "";
  setMsg(ui.pinMsg, "");
  showView("parentGate");
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
ui.childBackBtn.addEventListener("click", () => {
  showView("home");
});

ui.submitPinBtn.addEventListener("click", submitParentPin);
ui.pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitParentPin();
});
ui.parentIdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitParentPin();
});

ui.addUrlBtn.addEventListener("click", () => {
  const url = ui.urlInput.value;
  if (addVideoFromInput(url)) {
    ui.urlInput.value = "";
  }
});

ui.clearPlaylistBtn.addEventListener("click", () => {
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

migrateLegacyPinIfNeeded();
renderPlaylist();
refreshChildState();
showView("home");
