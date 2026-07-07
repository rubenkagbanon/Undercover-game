// ============================================================
// Mode à distance (PeerJS / WebRTC, sans compte ni serveur).
// L'hôte fait autorité sur l'état de la partie et l'envoie aux
// invités connectés directement en pair-à-pair. Chaque joueur ne
// reçoit son propre mot que par un message privé qui lui est adressé.
//
// Réutilise depuis script.js (chargé avant ce fichier, même portée
// globale) : shuffle, normalize, clamp, showScreen, showModal,
// hideModal, ROLE_LABELS, WINNER_TEXT, POINTS.
// ============================================================

let peer = null;
let conns = {}; // hôte uniquement : peerId -> DataConnection
let hostConn = null; // invité uniquement : DataConnection vers l'hôte

const remoteState = {
  isHost: false,
  myId: "",
  myName: "",
  roomCode: "",
  players: [], // { id, name } - liste des joueurs connectés (id="host" pour l'hôte)
  myRole: null,
  myWord: "",
};

// État de jeu faisant autorité, tenu uniquement par l'hôte.
const hostGame = {
  scores: {}, // id -> points cumulés
  manche: 1,
  turn: 1,
  roundPlayers: [], // { id, name, role, word, alive, eliminatedTurn, pointsEarned }
  playerOrder: [],
  wordCivil: "",
  wordUndercover: "",
  votes: {}, // voterId -> targetId
  tieRestrictedIds: null,
  readyIds: [],
  phase: "lobby",
  pendingEliminationId: null,
  lastEliminated: null,
  lastWinnerType: null,
};

function amIAlive(payload) {
  const me = payload.players.find((p) => p.id === remoteState.myId);
  return me ? me.alive : true;
}

// ---------- Connexion réseau ----------
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function broadcastToAll(msg) {
  Object.values(conns).forEach((c) => {
    if (c.open) c.send(msg);
  });
}

function sendAction(msg) {
  if (remoteState.isHost) {
    handleHostMessage("host", msg);
  } else if (hostConn && hostConn.open) {
    hostConn.send(msg);
  }
}

function createRoom(hostName) {
  remoteState.isHost = true;
  remoteState.myName = hostName;
  remoteState.myId = "host";
  remoteState.players = [{ id: "host", name: hostName }];
  attemptHostPeer(hostName);
}

function attemptHostPeer(hostName, retriesLeft) {
  if (retriesLeft === undefined) retriesLeft = 5;
  const code = generateRoomCode();
  const p = new Peer("uc-" + code, { debug: 0 });

  p.on("open", () => {
    peer = p;
    remoteState.roomCode = code;
    peer.on("connection", (conn) => {
      conn.on("data", (msg) => handleHostMessage(conn.peer, msg, conn));
      conn.on("close", () => {
        delete conns[conn.peer];
        remoteState.players = remoteState.players.filter((pl) => pl.id !== conn.peer);
        broadcastLobby();
        renderLobby();
      });
    });
    showRemoteLobby();
  });

  p.on("error", (err) => {
    if (err.type === "unavailable-id" && retriesLeft > 0) {
      p.destroy();
      attemptHostPeer(hostName, retriesLeft - 1);
    } else {
      showRemoteCreateError("Impossible de créer la partie (" + err.type + "). Réessaie.");
    }
  });
}

function joinRoom(code, name) {
  remoteState.isHost = false;
  remoteState.myName = name;
  remoteState.roomCode = code;

  const p = new Peer(undefined, { debug: 0 });

  p.on("open", (id) => {
    peer = p;
    remoteState.myId = id;
    const conn = p.connect("uc-" + code, { reliable: true });
    hostConn = conn;

    conn.on("open", () => {
      conn.send({ type: "join", name });
      showRemoteLobby();
    });
    conn.on("data", (msg) => handleGuestMessage(msg));
    conn.on("close", () => {
      showRemoteJoinError("La connexion à l'hôte a été perdue.");
      showScreen("screen-remote-join");
    });
    conn.on("error", () => {
      showRemoteJoinError("Connexion impossible. Vérifie le code et réessaie.");
    });
  });

  p.on("error", (err) => {
    showRemoteJoinError("Impossible de rejoindre (" + err.type + "). Vérifie le code.");
  });
}

// ---------- Messages : hôte reçoit ----------
function handleHostMessage(senderId, msg, conn) {
  if (msg.type === "join") {
    if (conn) conns[senderId] = conn;
    const name = (msg.name || "Joueur").trim().slice(0, 20) || "Joueur";
    if (!remoteState.players.find((p) => p.id === senderId)) {
      remoteState.players.push({ id: senderId, name });
    }
    broadcastLobby();
    renderLobby();
    return;
  }
  if (msg.type === "startVote") {
    advanceToVote();
    return;
  }
  if (msg.type === "nextManche") {
    hostGame.manche++;
    startRemoteManche(false);
    return;
  }
  if (msg.type === "endSession") {
    hostGame.phase = "end";
    broadcastPublicState();
    return;
  }
  if (msg.type === "newGame") {
    broadcastToAll({ type: "backToLobby" });
    showRemoteLobby();
    return;
  }
  if (hostGame.phase === "reveal" && msg.type === "ready") {
    onGuestReady(senderId);
  } else if (hostGame.phase === "vote" && msg.type === "vote") {
    onGuestVote(senderId, msg.targetId);
  } else if (hostGame.phase === "mrwhite" && msg.type === "mrWhiteGuess") {
    onMrWhiteGuess(senderId, msg.guess);
  } else if (hostGame.phase === "mrwhite" && msg.type === "skipGuess") {
    onMrWhiteGuess(senderId, null);
  }
}

function broadcastLobby() {
  broadcastToAll({ type: "lobby", players: remoteState.players });
}

// ---------- Messages : invité reçoit ----------
function handleGuestMessage(msg) {
  if (msg.type === "lobby") {
    remoteState.players = msg.players;
    renderLobby();
  } else if (msg.type === "yourWord") {
    remoteState.myRole = msg.role;
    remoteState.myWord = msg.word;
  } else if (msg.type === "state") {
    renderPublicState(msg);
  } else if (msg.type === "backToLobby") {
    showRemoteLobby();
  }
}

// ---------- Lobby ----------
function showRemoteLobby() {
  renderLobby();
  showScreen("screen-remote-lobby");
}

function renderLobby() {
  document.getElementById("roomCodeDisplay").textContent = remoteState.roomCode;

  const list = document.getElementById("remotePlayersList");
  list.innerHTML = "";
  remoteState.players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "player-row";
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = p.name + (p.id === remoteState.myId ? " (toi)" : "");
    row.appendChild(name);
    list.appendChild(row);
  });

  document.getElementById("remoteHostSettingsCard").classList.toggle("hidden", !remoteState.isHost);
  document.getElementById("remoteStartGameBtn").classList.toggle("hidden", !remoteState.isHost);
  document.getElementById("remoteWaitingHint").classList.toggle("hidden", remoteState.isHost);
}

function showRemoteCreateError(msg) {
  const el = document.getElementById("remoteCreateError");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hideRemoteCreateError() {
  document.getElementById("remoteCreateError").classList.add("hidden");
}
function showRemoteJoinError(msg) {
  const el = document.getElementById("remoteJoinError");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hideRemoteJoinError() {
  document.getElementById("remoteJoinError").classList.add("hidden");
}
function showRemoteLobbyError(msg) {
  const el = document.getElementById("remoteLobbyError");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hideRemoteLobbyError() {
  document.getElementById("remoteLobbyError").classList.add("hidden");
}

// ---------- Démarrage / déroulement de la manche (hôte) ----------
function startRemoteManche(isNewSession) {
  if (isNewSession) {
    hostGame.scores = {};
    remoteState.players.forEach((p) => (hostGame.scores[p.id] = 0));
    hostGame.manche = 1;
  }

  const total = remoteState.players.length;
  const undercoverCount = clamp(parseInt(document.getElementById("remoteUndercoverCountInput").value, 10) || 0, 1, total);
  const mrWhiteCount = document.getElementById("remoteMrWhiteCheckbox").checked ? 1 : 0;
  const civilCount = total - undercoverCount - mrWhiteCount;

  if (civilCount < 2) {
    showRemoteLobbyError("Il faut au moins 2 civils. Réduisez le nombre d'Undercover ou désactivez Mr. White.");
    showRemoteLobby();
    return;
  }
  hideRemoteLobbyError();

  const pairs = WORD_CATEGORIES.flatMap((c) => c.pairs);
  const [wordA, wordB] = pairs[Math.floor(Math.random() * pairs.length)];
  const swap = Math.random() < 0.5;
  hostGame.wordCivil = swap ? wordB : wordA;
  hostGame.wordUndercover = swap ? wordA : wordB;

  const ids = remoteState.players.map((p) => p.id);
  let remaining = ids.slice();
  const roles = {};

  if (mrWhiteCount === 1) {
    const blancId = remaining[Math.floor(Math.random() * remaining.length)];
    roles[blancId] = "blanc";
    remaining = remaining.filter((id) => id !== blancId);
  }
  const shuffledRemaining = shuffle(remaining);
  shuffledRemaining.slice(0, undercoverCount).forEach((id) => (roles[id] = "undercover"));
  shuffledRemaining.slice(undercoverCount).forEach((id) => (roles[id] = "civil"));

  hostGame.roundPlayers = remoteState.players.map((p) => ({
    id: p.id,
    name: p.name,
    role: roles[p.id],
    word: roles[p.id] === "civil" ? hostGame.wordCivil : roles[p.id] === "undercover" ? hostGame.wordUndercover : "",
    alive: true,
    eliminatedTurn: null,
    pointsEarned: 0,
  }));

  hostGame.playerOrder = shuffle(ids);
  hostGame.turn = 1;
  hostGame.votes = {};
  hostGame.tieRestrictedIds = null;
  hostGame.readyIds = [];
  hostGame.phase = "reveal";

  hostGame.roundPlayers.forEach((rp) => sendPrivateWord(rp.id, rp.role, rp.word));
  broadcastPublicState();
}

function sendPrivateWord(id, role, word) {
  if (id === "host") {
    remoteState.myRole = role;
    remoteState.myWord = word;
  } else if (conns[id] && conns[id].open) {
    conns[id].send({ type: "yourWord", role, word });
  }
}

function onGuestReady(id) {
  if (!hostGame.readyIds.includes(id)) hostGame.readyIds.push(id);
  broadcastPublicState();
  if (hostGame.readyIds.length >= hostGame.roundPlayers.length) {
    hostGame.phase = "clues";
    broadcastPublicState();
  }
}

function advanceToVote() {
  hostGame.phase = "vote";
  hostGame.votes = {};
  broadcastPublicState();
}

function onGuestVote(id, targetId) {
  if (hostGame.phase !== "vote") return;
  hostGame.votes[id] = targetId;
  broadcastPublicState();

  const aliveVotersCount = hostGame.roundPlayers.filter((p) => p.alive).length;
  if (Object.keys(hostGame.votes).length >= aliveVotersCount) {
    resolveRemoteVote();
  }
}

function resolveRemoteVote() {
  const counts = {};
  Object.values(hostGame.votes).forEach((targetId) => {
    counts[targetId] = (counts[targetId] || 0) + 1;
  });
  const entries = Object.entries(counts);
  const max = Math.max(0, ...entries.map(([, v]) => v));
  if (max === 0) return;
  const maxIds = entries.filter(([, v]) => v === max).map(([id]) => id);

  if (maxIds.length > 1) {
    hostGame.tieRestrictedIds = maxIds;
    hostGame.votes = {};
    broadcastPublicState();
    return;
  }

  hostGame.tieRestrictedIds = null;
  eliminateRemotePlayer(maxIds[0]);
}

function eliminateRemotePlayer(id) {
  const player = hostGame.roundPlayers.find((p) => p.id === id);
  player.alive = false;
  player.eliminatedTurn = hostGame.turn;
  hostGame.lastEliminated = { name: player.name, role: player.role, word: player.word };
  hostGame.pendingEliminationId = id;
  hostGame.phase = "elimination";
  broadcastPublicState();

  setTimeout(() => {
    if (player.role === "blanc") {
      hostGame.phase = "mrwhite";
      broadcastPublicState();
    } else {
      checkRemoteWinOrContinue();
    }
  }, 2500);
}

function onMrWhiteGuess(id, guess) {
  if (hostGame.phase !== "mrwhite" || id !== hostGame.pendingEliminationId) return;
  hostGame.pendingEliminationId = null;

  if (guess && normalize(guess) === normalize(hostGame.wordCivil)) {
    finishRemoteManche("blanc");
  } else {
    checkRemoteWinOrContinue();
  }
}

function checkRemoteWinOrContinue() {
  const alive = hostGame.roundPlayers.filter((p) => p.alive);
  const aliveCivil = alive.filter((p) => p.role === "civil").length;
  const aliveInfiltrators = alive.filter((p) => p.role === "undercover" || p.role === "blanc").length;

  if (aliveInfiltrators === 0) {
    finishRemoteManche("civil");
  } else if (aliveCivil <= 1) {
    finishRemoteManche("undercover");
  } else {
    hostGame.turn++;
    hostGame.tieRestrictedIds = null;
    hostGame.phase = "clues";
    broadcastPublicState();
  }
}

function finishRemoteManche(winnerType) {
  hostGame.roundPlayers.forEach((p) => {
    let pts = 0;
    if (winnerType === "civil" && p.role === "civil") {
      pts = POINTS.civil;
    } else if (winnerType === "undercover" && (p.role === "undercover" || p.role === "blanc")) {
      pts = p.role === "undercover" ? POINTS.undercover : POINTS.blanc;
    } else if (winnerType === "blanc" && p.role === "blanc") {
      pts = POINTS.blanc;
    }
    p.pointsEarned = pts;
    hostGame.scores[p.id] = (hostGame.scores[p.id] || 0) + pts;
  });

  hostGame.lastWinnerType = winnerType;
  hostGame.phase = "mancheResult";
  broadcastPublicState();
}

function buildScoreboard() {
  return remoteState.players
    .map((p) => ({ name: p.name, points: hostGame.scores[p.id] || 0 }))
    .sort((a, b) => b.points - a.points);
}

function buildPublicStatePayload() {
  const base = {
    type: "state",
    phase: hostGame.phase,
    manche: hostGame.manche,
    turn: hostGame.turn,
    players: hostGame.roundPlayers.map((p) => ({ id: p.id, name: p.name, alive: p.alive })),
  };

  if (hostGame.phase === "reveal") {
    base.readyIds = hostGame.readyIds;
  } else if (hostGame.phase === "clues") {
    base.order = hostGame.playerOrder.filter((id) => {
      const p = hostGame.roundPlayers.find((rp) => rp.id === id);
      return p && p.alive;
    });
  } else if (hostGame.phase === "vote") {
    const alive = hostGame.roundPlayers.filter((p) => p.alive);
    const candidates = hostGame.tieRestrictedIds
      ? alive.filter((p) => hostGame.tieRestrictedIds.includes(p.id))
      : alive;
    base.candidates = candidates.map((p) => p.id);
    base.votedIds = Object.keys(hostGame.votes);
    base.tie = !!hostGame.tieRestrictedIds;
  } else if (hostGame.phase === "elimination") {
    base.eliminated = hostGame.lastEliminated;
  } else if (hostGame.phase === "mrwhite") {
    base.mrWhiteId = hostGame.pendingEliminationId;
    const mw = hostGame.roundPlayers.find((p) => p.id === hostGame.pendingEliminationId);
    base.mrWhiteName = mw ? mw.name : "";
  } else if (hostGame.phase === "mancheResult") {
    base.winnerType = hostGame.lastWinnerType;
    base.roles = hostGame.roundPlayers.map((p) => ({
      name: p.name,
      role: p.role,
      word: p.word,
      pointsEarned: p.pointsEarned,
      alive: p.alive,
    }));
    base.scoreboard = buildScoreboard();
  } else if (hostGame.phase === "end") {
    base.scoreboard = buildScoreboard();
  }

  return base;
}

function broadcastPublicState() {
  const payload = buildPublicStatePayload();
  broadcastToAll(payload);
  renderPublicState(payload);
}

// ---------- Rendu (partagé hôte + invités) ----------
function renderPublicState(payload) {
  const badge = document.getElementById("remoteManchebadge");
  if (badge) badge.textContent = `Manche ${payload.manche} · Tour ${payload.turn}`;

  if (payload.phase === "mancheResult") {
    renderRemoteMancheResult(payload);
    showScreen("screen-remote-manche-result");
    return;
  }
  if (payload.phase === "end") {
    renderRemoteEnd(payload);
    showScreen("screen-remote-end");
    return;
  }

  showScreen("screen-remote-game");
  ["remotePhaseReveal", "remotePhaseClues", "remotePhaseVote", "remotePhaseElimination", "remotePhaseMrWhite"].forEach(
    (id) => document.getElementById(id).classList.add("hidden")
  );

  if (payload.phase === "reveal") {
    document.getElementById("remotePhaseReveal").classList.remove("hidden");
    renderRemoteReveal(payload);
  } else if (payload.phase === "clues") {
    document.getElementById("remotePhaseClues").classList.remove("hidden");
    renderRemoteClues(payload);
  } else if (payload.phase === "vote") {
    document.getElementById("remotePhaseVote").classList.remove("hidden");
    renderRemoteVote(payload);
  } else if (payload.phase === "elimination") {
    document.getElementById("remotePhaseElimination").classList.remove("hidden");
    renderRemoteElimination(payload);
  } else if (payload.phase === "mrwhite") {
    document.getElementById("remotePhaseMrWhite").classList.remove("hidden");
    renderRemoteMrWhite(payload);
  }
}

function renderRemoteReveal(payload) {
  const card = document.getElementById("remoteWordCard");
  if (remoteState.myWord) {
    card.textContent = remoteState.myWord;
    card.style.whiteSpace = "normal";
  } else {
    card.textContent = "Tu n'as pas de mot...\nÉcoute les autres et improvise !";
    card.style.whiteSpace = "pre-line";
  }

  const amReady = payload.readyIds.includes(remoteState.myId);
  document.getElementById("remoteReadyBtn").classList.toggle("hidden", amReady);
  document.getElementById("remoteReadyStatus").textContent = amReady
    ? `En attente des autres... (${payload.readyIds.length}/${payload.players.length} prêts)`
    : "";
}

function renderRemoteClues(payload) {
  const list = document.getElementById("remoteCluesOrderList");
  list.innerHTML = "";
  payload.order.forEach((id, i) => {
    const player = payload.players.find((p) => p.id === id);
    const li = document.createElement("li");
    const num = document.createElement("span");
    num.className = "order-num";
    num.textContent = i + 1;
    const nameSpan = document.createElement("span");
    nameSpan.textContent = player.name + (id === remoteState.myId ? " (toi)" : "");
    li.appendChild(num);
    li.appendChild(nameSpan);
    list.appendChild(li);
  });

  document.getElementById("remoteGoToVoteBtn").classList.toggle("hidden", !remoteState.isHost);
  document.getElementById("remoteCluesWaitingHint").classList.toggle("hidden", remoteState.isHost);
}

function renderRemoteVote(payload) {
  const hint = document.getElementById("remoteVoteHint");
  const box = document.getElementById("remoteVoteCandidates");
  const statusEl = document.getElementById("remoteVoteStatus");
  box.innerHTML = "";

  if (!amIAlive(payload)) {
    hint.textContent = "Tu as été éliminé. Regarde le vote se dérouler...";
    statusEl.textContent = `${payload.votedIds.length}/${payload.candidates.length} ont voté`;
    return;
  }

  hint.textContent = payload.tie
    ? "Égalité ! Revote uniquement parmi les joueurs suivants :"
    : "Touche le nom du joueur que tu accuses :";

  const iVoted = payload.votedIds.includes(remoteState.myId);
  payload.candidates
    .filter((id) => id !== remoteState.myId)
    .forEach((id) => {
      const player = payload.players.find((p) => p.id === id);
      const btn = document.createElement("button");
      btn.className = "btn-secondary";
      btn.textContent = player.name;
      btn.disabled = iVoted;
      btn.addEventListener("click", () => sendAction({ type: "vote", targetId: id }));
      box.appendChild(btn);
    });

  statusEl.textContent = iVoted
    ? `Vote envoyé. En attente des autres... (${payload.votedIds.length}/${payload.candidates.length})`
    : "";
}

function renderRemoteElimination(payload) {
  const el = payload.eliminated;
  let text = `${el.name} était ${ROLE_LABELS[el.role]} !`;
  if (el.role !== "blanc") text += `\nSon mot était : « ${el.word} »`;
  const target = document.getElementById("remoteEliminationText");
  target.textContent = text;
  target.style.whiteSpace = "pre-line";
}

function renderRemoteMrWhite(payload) {
  const isMe = payload.mrWhiteId === remoteState.myId;
  const textEl = document.getElementById("remoteMrWhiteText");
  const box = document.getElementById("remoteMrWhiteGuessBox");
  if (isMe) {
    textEl.textContent = "Tu as été démasqué ! Dernière chance : deviner le mot des civils ?";
    box.classList.remove("hidden");
    document.getElementById("remoteMrWhiteGuessInput").value = "";
  } else {
    textEl.textContent = `${payload.mrWhiteName} était Mr. White ! Il/elle tente de deviner le mot des civils...`;
    box.classList.add("hidden");
  }
}

function renderScoreboardInto(container, scoreboard) {
  container.innerHTML = "";
  scoreboard.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "score-row" + (i === 0 && entry.points > 0 ? " top1" : "");
    const rank = document.createElement("span");
    rank.className = "score-rank";
    rank.textContent = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    const name = document.createElement("span");
    name.className = "score-name";
    name.textContent = entry.name;
    const pts = document.createElement("span");
    pts.className = "score-points";
    pts.textContent = `${entry.points} pts`;
    row.appendChild(rank);
    row.appendChild(name);
    row.appendChild(pts);
    container.appendChild(row);
  });
}

function renderRemoteMancheResult(payload) {
  const banner = document.getElementById("remoteMancheWinnerBanner");
  banner.textContent = `${WINNER_TEXT[payload.winnerType]} (Manche ${payload.manche})`;
  banner.className = `winner-banner ${payload.winnerType}`;

  const rolesList = document.getElementById("remoteMancheRolesList");
  rolesList.innerHTML = "";
  payload.roles.forEach((p) => {
    const row = document.createElement("div");
    row.className = "eliminated-row";
    const name = document.createElement("span");
    name.textContent = p.name;
    const tag = document.createElement("span");
    tag.className = `role-tag ${p.role}`;
    tag.textContent = `${ROLE_LABELS[p.role]}${p.word ? " · " + p.word : ""} · +${p.pointsEarned} pts`;
    row.appendChild(name);
    row.appendChild(tag);
    rolesList.appendChild(row);
  });

  renderScoreboardInto(document.getElementById("remoteMancheScoreboard"), payload.scoreboard);

  document.getElementById("remoteNextMancheBtn").classList.toggle("hidden", !remoteState.isHost);
  document.getElementById("remoteEndSessionBtn").classList.toggle("hidden", !remoteState.isHost);
  document.getElementById("remoteMancheResultWaitingHint").classList.toggle("hidden", remoteState.isHost);
}

function renderRemoteEnd(payload) {
  renderScoreboardInto(document.getElementById("remoteFinalScoreboard"), payload.scoreboard);
  document.getElementById("remoteNewGameBtn").classList.toggle("hidden", !remoteState.isHost);
}

// ---------- Navigation & UI wiring ----------
document.getElementById("modeLocalBtn").addEventListener("click", () => showScreen("screen-setup"));
document.getElementById("modeRemoteBtn").addEventListener("click", () => showScreen("screen-remote-home"));

document.getElementById("remoteHomeBackBtn").addEventListener("click", () => showScreen("screen-mode-select"));
document.getElementById("remoteCreateBtn").addEventListener("click", () => showScreen("screen-remote-create"));
document.getElementById("remoteJoinBtn").addEventListener("click", () => showScreen("screen-remote-join"));
document.getElementById("remoteCreateBackBtn").addEventListener("click", () => showScreen("screen-remote-home"));
document.getElementById("remoteJoinBackBtn").addEventListener("click", () => showScreen("screen-remote-home"));

document.getElementById("remoteCreateSubmitBtn").addEventListener("click", () => {
  const name = document.getElementById("remoteHostNameInput").value.trim();
  if (!name) {
    showRemoteCreateError("Entre ton nom.");
    return;
  }
  hideRemoteCreateError();
  createRoom(name);
});

document.getElementById("remoteJoinSubmitBtn").addEventListener("click", () => {
  const code = document.getElementById("remoteJoinCodeInput").value.trim().toUpperCase();
  const name = document.getElementById("remoteJoinNameInput").value.trim();
  if (!code || !name) {
    showRemoteJoinError("Entre le code et ton nom.");
    return;
  }
  hideRemoteJoinError();
  joinRoom(code, name);
});

document.getElementById("copyRoomLinkBtn").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${remoteState.roomCode}`;
  const btn = document.getElementById("copyRoomLinkBtn");
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Lien copié !";
  } catch (e) {
    window.prompt("Copie ce lien :", url);
  }
  setTimeout(() => (btn.textContent = original), 1500);
});

document.getElementById("remoteStartGameBtn").addEventListener("click", () => {
  if (remoteState.players.length < 3) return;
  startRemoteManche(true);
});

document.getElementById("remoteReadyBtn").addEventListener("click", () => sendAction({ type: "ready" }));
document.getElementById("remoteGoToVoteBtn").addEventListener("click", () => sendAction({ type: "startVote" }));
document.getElementById("remoteSubmitGuessBtn").addEventListener("click", () => {
  const guess = document.getElementById("remoteMrWhiteGuessInput").value;
  sendAction({ type: "mrWhiteGuess", guess });
});
document.getElementById("remoteSkipGuessBtn").addEventListener("click", () => sendAction({ type: "skipGuess" }));
document.getElementById("remoteNextMancheBtn").addEventListener("click", () => sendAction({ type: "nextManche" }));
document.getElementById("remoteEndSessionBtn").addEventListener("click", () => sendAction({ type: "endSession" }));
document.getElementById("remoteNewGameBtn").addEventListener("click", () => sendAction({ type: "newGame" }));

// ---------- Rejoindre directement via un lien partagé (?room=CODE) ----------
(function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) {
    document.getElementById("remoteJoinCodeInput").value = room.toUpperCase();
    showScreen("screen-remote-join");
  }
})();
