// Client: WebRTC peer connection + signaling over Socket.io
(() => {
  const socket = io();

  // UI refs
  const landing = document.getElementById("landing");
  const room = document.getElementById("room");
  const startVideoBtn = document.getElementById("startVideo");
  const startTextBtn = document.getElementById("startText");
  const interestsInput = document.getElementById("interests");
  const onlineEl = document.getElementById("online");

  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
  const statusEl = document.getElementById("status");
  const messagesEl = document.getElementById("messages");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const typingEl = document.getElementById("typing");
  const nextBtn = document.getElementById("nextBtn");
  const stopBtn = document.getElementById("stopBtn");
  const reportBtn = document.getElementById("reportBtn");

  // State
  let pc = null;
  let localStream = null;
  let videoMode = true;
  let paired = false;
  let typingTimeout = null;

  // STUN servers (free Google STUN). Add a TURN server for production reliability.
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  // --- Helpers ------------------------------------------------------------
  function setStatus(text) {
    if (!text) {
      statusEl.classList.add("hidden");
    } else {
      statusEl.textContent = text;
      statusEl.classList.remove("hidden");
    }
  }

  function addMessage(text, who = "them") {
    const div = document.createElement("div");
    div.className = `msg ${who}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function clearMessages() {
    messagesEl.innerHTML = "";
  }

  function parseInterests() {
    return interestsInput.value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
  }

  async function getMedia() {
    if (localStream || !videoMode) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      localVideo.srcObject = localStream;
    } catch (err) {
      console.error("getUserMedia failed", err);
      alert(
        "Camera/mic access denied. You can still use text-only mode. " +
          "Check your browser permissions if you want video."
      );
      videoMode = false;
    }
    return localStream;
  }

  // --- WebRTC -------------------------------------------------------------
  function createPeer(initiator) {
    pc = new RTCPeerConnection(rtcConfig);

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit("signal", { type: "candidate", candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
      setStatus("");
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc?.connectionState)) {
        // Let the server/next handle recovery
      }
    };

    if (initiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => socket.emit("signal", { type: "offer", sdp: pc.localDescription }))
        .catch((e) => console.error("createOffer error", e));
    }
  }

  function closePeer() {
    if (pc) {
      try { pc.ontrack = null; pc.onicecandidate = null; pc.close(); } catch {}
      pc = null;
    }
    remoteVideo.srcObject = null;
  }

  async function handleSignal(data) {
    if (!pc) return;
    try {
      if (data.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { type: "answer", sdp: pc.localDescription });
      } else if (data.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === "candidate") {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch (e) {
      console.error("signal handling error", e);
    }
  }

  // --- Flow ---------------------------------------------------------------
  async function start(withVideo) {
    videoMode = withVideo;
    landing.classList.add("hidden");
    room.classList.remove("hidden");
    clearMessages();
    setStatus("Looking for someone…");

    if (videoMode) await getMedia();
    socket.emit("find", { interests: parseInterests() });
  }

  function goNext() {
    closePeer();
    clearMessages();
    paired = false;
    setStatus("Looking for someone…");
    socket.emit("next");
  }

  function goStop() {
    closePeer();
    paired = false;
    socket.emit("stop");
    // Stop local media
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
      localVideo.srcObject = null;
    }
    clearMessages();
    room.classList.add("hidden");
    landing.classList.remove("hidden");
  }

  // --- Socket events ------------------------------------------------------
  socket.on("stats", ({ online }) => { onlineEl.textContent = online; });

  socket.on("banned", ({ reason, expires_at }) => {
    const params = new URLSearchParams();
    if (reason) params.set("reason", reason);
    if (expires_at) params.set("until", String(expires_at));
    window.location.href = "/legal/banned.html?" + params.toString();
  });

  socket.on("waiting", () => {
    setStatus("Looking for someone…");
  });

  socket.on("paired", ({ initiator }) => {
    paired = true;
    addMessage("You're connected. Say hi!", "sys");
    setStatus(videoMode ? "Connecting video…" : "");
    if (videoMode) {
      createPeer(initiator);
    } else {
      // Text-only: no peer connection, just messaging
      setStatus("");
    }
  });

  socket.on("signal", handleSignal);

  socket.on("message", (text) => addMessage(text, "them"));

  socket.on("typing", (isTyping) => {
    typingEl.classList.toggle("hidden", !isTyping);
  });

  socket.on("partner-left", () => {
    addMessage("Stranger disconnected.", "sys");
    closePeer();
    paired = false;
    setStatus("Looking for someone…");
    // Auto re-queue for a smoother experience
    socket.emit("find", { interests: parseInterests() });
  });

  // --- UI bindings --------------------------------------------------------
  startVideoBtn.addEventListener("click", () => start(true));
  startTextBtn.addEventListener("click", () => start(false));
  nextBtn.addEventListener("click", goNext);
  stopBtn.addEventListener("click", goStop);

  reportBtn.addEventListener("click", () => {
    const reason = prompt("Report reason (nudity, harassment, minor, spam, other):", "");
    if (reason) {
      socket.emit("report", reason);
      addMessage("Thanks — report submitted. Moving on.", "sys");
      goNext();
    }
  });

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !paired) return;
    socket.emit("message", text);
    addMessage(text, "me");
    chatInput.value = "";
    socket.emit("typing", false);
  });

  chatInput.addEventListener("input", () => {
    if (!paired) return;
    socket.emit("typing", true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("typing", false), 1500);
  });

  // Keyboard: Esc to skip
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !room.classList.contains("hidden")) goNext();
  });
})();
