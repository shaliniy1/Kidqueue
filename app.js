const STORAGE_KEY = "kidzqueue-playlist";
const PIN_KEY = "kidzqueue-parent-pin";

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
  pinInput: document.getElementById("pinInput"),
  pinMsg: document.getElementById("pinMsg"),
  urlInput: document.getElementById("urlInput"),
  addUrlBtn: document.getElementById("addUrlBtn"),
  urlMsg: document.getElementById("urlMsg"),
  playlistList: document.getElementById("playlistList"),
  clearPlaylistBtn: document.getElementById("clearPlaylistBtn"),
  childStatus: document.getElementById("childStatus"),
  childPlayBtn: document.getElementById("childPlayBtn"),
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
let pendingNextIndex = null;

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

function savePlaylist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlist));
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

  urls.forEach((url) => {
    const video = buildVideo(url);
    if (!video) return;
    const exists = playlist.some((v) => v.id === video.id);

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
    addBtn.textContent = exists ? "Added" : "Add";
    addBtn.disabled = exists;
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
    ui.nextRow.classList.add("hidden");
    return;
  }

  const current = playlist[currentIndex];
  ui.nowPlaying.innerHTML = current
    ? `<a href="${current.url}" target="_blank" rel="noopener noreferrer">${current.title}</a>`
    : "-";
  if (pendingNextIndex === null) {
    ui.nextPlaying.textContent = "-";
    ui.nextRow.classList.add("hidden");
    return;
  }

  const next = playlist[pendingNextIndex];
  ui.nextPlaying.innerHTML = next
    ? `<a href="${next.url}" target="_blank" rel="noopener noreferrer">${next.title}</a>`
    : "-";
  ui.nextRow.classList.remove("hidden");
}

function refreshChildState() {
  if (!playlist.length) {
    setMsg(ui.childStatus, "No videos available yet. Ask parent to add videos.");
    ui.childPlayBtn.classList.remove("hidden");
    ui.childPlayBtn.disabled = true;
    ui.childNextBtn.classList.add("hidden");
    ui.childNextBtn.disabled = true;
    pendingNextIndex = null;
    refreshNowNext();
    return;
  }
  ui.childPlayBtn.disabled = false;
  ui.childPlayBtn.classList.remove("hidden");
  ui.childNextBtn.classList.add("hidden");
  ui.childNextBtn.disabled = true;
  pendingNextIndex = null;
  setMsg(ui.childStatus, `${playlist.length} approved video(s). Tap Start Playlist to begin.`);
  refreshNowNext();
}

function playCurrentVideo() {
  if (!player || !playlist.length) return;
  pendingNextIndex = null;
  ui.childNextBtn.classList.add("hidden");
  ui.childNextBtn.disabled = true;
  const id = playlist[currentIndex]?.id;
  player.loadVideoById(id);
  player.playVideo();
  ui.childPlayBtn.classList.add("hidden");
  refreshNowNext();
}

function armNextVideo(reason = "ended") {
  if (!playlist.length) return;
  pendingNextIndex = (currentIndex + 1) % playlist.length;
  ui.childNextBtn.disabled = false;
  ui.childNextBtn.classList.remove("hidden");
  if (reason === "error") {
    setMsg(ui.childStatus, "This video is unavailable. Tap Next Video.");
  } else {
    setMsg(ui.childStatus, "Video finished. Tap Next Video.");
  }
  refreshNowNext();
}

function playPendingNextVideo() {
  if (pendingNextIndex === null) return;
  currentIndex = pendingNextIndex;
  playCurrentVideo();
  setMsg(ui.childStatus, "Playing approved video.");
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
        if (event.data === YT.PlayerState.ENDED && playlist.length) {
          armNextVideo("ended");
        }
        if (event.data === YT.PlayerState.PAUSED) {
          player.playVideo();
        }
      },
      onError: () => {
        armNextVideo("error");
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
  const pin = ui.pinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    setMsg(ui.pinMsg, "PIN must be 4 digits.");
    return;
  }

  const existing = localStorage.getItem(PIN_KEY);
  if (!existing) {
    localStorage.setItem(PIN_KEY, pin);
    setMsg(ui.pinMsg, "PIN set. Parent unlocked.");
    showView("parent");
    renderPlaylist();
    return;
  }

  if (existing !== pin) {
    setMsg(ui.pinMsg, "Incorrect PIN.");
    return;
  }

  setMsg(ui.pinMsg, "Parent unlocked.");
  showView("parent");
  renderPlaylist();
}

ui.openParentBtn.addEventListener("click", () => {
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
ui.childNextBtn.addEventListener("click", () => {
  playPendingNextVideo();
});

ui.submitPinBtn.addEventListener("click", submitParentPin);
ui.pinInput.addEventListener("keydown", (e) => {
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

renderPlaylist();
refreshChildState();
showView("home");
