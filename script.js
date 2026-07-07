// ---------- Points attribués au camp gagnant d'une manche ----------
const POINTS = { civil: 2, undercover: 10, blanc: 6 };

// ---------- État du jeu ----------
const state = {
  sessionPlayers: [], // { id, name } - stable pour toute la partie (plusieurs manches)
  scores: {}, // id -> points cumulés sur la partie
  manche: 1,

  players: [], // manche en cours : { id, name, role, word, alive, eliminatedTurn, pointsEarned }
  playerOrder: [], // ids dans l'ordre aléatoire de passage (révélation + description)
  turn: 1, // tour de description/vote au sein de la manche en cours
  wordCivil: "",
  wordUndercover: "",
  revealIndex: 0,
  voteCounts: {}, // id -> nombre de votes
  tieRestrictedIds: null, // ids autorisés à voter en cas d'égalité
};

const ROLE_LABELS = { civil: "CIVIL", undercover: "UNDERCOVER", blanc: "MR. WHITE" };
const WINNER_TEXT = {
  civil: "🎉 Les Civils gagnent la manche !",
  undercover: "🕵️ Les Infiltrés gagnent la manche !",
  blanc: "🎭 Mr. White gagne la manche !",
};

// ---------- Utilitaires ----------
function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(str) {
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showModal(id) {
  document.getElementById(id).classList.remove("hidden");
}

// Joueurs (en vie) dans l'ordre aléatoire de passage tiré pour la manche
function aliveInOrder() {
  return state.playerOrder
    .map((id) => state.players.find((p) => p.id === id))
    .filter((p) => p.alive);
}

function hideModal(id) {
  document.getElementById(id).classList.add("hidden");
}

// ---------- Setup screen ----------
const playerCountInput = document.getElementById("playerCountInput");
const playerNamesContainer = document.getElementById("playerNamesContainer");
const undercoverCountInput = document.getElementById("undercoverCountInput");
const mrWhiteCheckbox = document.getElementById("mrWhiteCheckbox");
const categorySelect = document.getElementById("categorySelect");
const wordsCountText = document.getElementById("wordsCountText");
const setupError = document.getElementById("setupError");

function syncPlayerNameInputs() {
  const count = clamp(parseInt(playerCountInput.value, 10) || 0, 3, 20);
  playerCountInput.value = count;

  while (playerNamesContainer.children.length < count) {
    const idx = playerNamesContainer.children.length + 1;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = `Joueur ${idx}`;
    input.className = "player-name-input";
    playerNamesContainer.appendChild(input);
  }
  while (playerNamesContainer.children.length > count) {
    playerNamesContainer.removeChild(playerNamesContainer.lastElementChild);
  }
}

function populateCategorySelect() {
  categorySelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "Toutes les catégories";
  categorySelect.appendChild(allOption);

  WORD_CATEGORIES.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat.name;
    opt.textContent = cat.name;
    categorySelect.appendChild(opt);
  });

  updateWordsCountText();
}

function getPairsForSelectedCategory() {
  const selected = categorySelect.value;
  if (selected === "all") {
    return WORD_CATEGORIES.flatMap((c) => c.pairs);
  }
  const cat = WORD_CATEGORIES.find((c) => c.name === selected);
  return cat ? cat.pairs : [];
}

function updateWordsCountText() {
  const pairs = getPairsForSelectedCategory();
  wordsCountText.textContent = `${pairs.length} paires de mots disponibles`;
}

function showSetupError(msg) {
  setupError.textContent = msg;
  setupError.classList.remove("hidden");
}

function clearSetupError() {
  setupError.classList.add("hidden");
  setupError.textContent = "";
}

function assignRolesAndWords(total) {
  const undercoverCount = clamp(parseInt(undercoverCountInput.value, 10) || 0, 1, total);
  const mrWhiteCount = mrWhiteCheckbox.checked ? 1 : 0;
  const pairs = getPairsForSelectedCategory();

  const [wordA, wordB] = pairs[Math.floor(Math.random() * pairs.length)];
  const swap = Math.random() < 0.5;
  const wordCivil = swap ? wordB : wordA;
  const wordUndercover = swap ? wordA : wordB;

  const order = shuffle([...Array(total).keys()]);
  const roles = new Array(total);
  order.slice(0, undercoverCount).forEach((i) => (roles[i] = "undercover"));
  order.slice(undercoverCount, undercoverCount + mrWhiteCount).forEach((i) => (roles[i] = "blanc"));
  order.slice(undercoverCount + mrWhiteCount).forEach((i) => (roles[i] = "civil"));

  return { roles, wordCivil, wordUndercover };
}

function startGame() {
  clearSetupError();

  const nameInputs = Array.from(playerNamesContainer.querySelectorAll(".player-name-input"));
  const names = nameInputs.map((input, i) => input.value.trim() || `Joueur ${i + 1}`);
  const total = names.length;

  const undercoverCount = clamp(parseInt(undercoverCountInput.value, 10) || 0, 1, total);
  const mrWhiteCount = mrWhiteCheckbox.checked ? 1 : 0;
  const civilCount = total - undercoverCount - mrWhiteCount;

  if (civilCount < 2) {
    showSetupError("Il faut au moins 2 civils. Réduisez le nombre d'Undercover ou désactivez Mr. White.");
    return;
  }

  const pairs = getPairsForSelectedCategory();
  if (pairs.length === 0) {
    showSetupError("Aucune paire de mots disponible pour cette catégorie.");
    return;
  }

  state.sessionPlayers = names.map((name, i) => ({ id: i, name }));
  state.scores = {};
  state.sessionPlayers.forEach((sp) => (state.scores[sp.id] = 0));
  state.manche = 1;

  startManche();
}

function startManche() {
  const total = state.sessionPlayers.length;
  const { roles, wordCivil, wordUndercover } = assignRolesAndWords(total);

  state.wordCivil = wordCivil;
  state.wordUndercover = wordUndercover;
  state.players = state.sessionPlayers.map((sp, i) => ({
    id: sp.id,
    name: sp.name,
    role: roles[i],
    word: roles[i] === "civil" ? wordCivil : roles[i] === "undercover" ? wordUndercover : "",
    alive: true,
    eliminatedTurn: null,
    pointsEarned: 0,
  }));

  state.playerOrder = shuffle(state.players.map((p) => p.id));

  state.turn = 1;
  state.revealIndex = 0;
  state.voteCounts = {};
  state.tieRestrictedIds = null;

  showScreen("screen-reveal");
  renderReveal();
}

// ---------- Reveal screen ----------
const passNameEl = document.getElementById("passName");
const revealCard = document.getElementById("revealCard");
const nextPlayerBtn = document.getElementById("nextPlayerBtn");

function currentRevealPlayer() {
  const id = state.playerOrder[state.revealIndex];
  return state.players.find((p) => p.id === id);
}

function renderReveal() {
  const player = currentRevealPlayer();
  passNameEl.textContent = `Passe le téléphone à ${player.name}`;
  revealCard.textContent = "Touche pour révéler ton mot";
  revealCard.className = "reveal-card";
  nextPlayerBtn.classList.add("hidden");
}

revealCard.addEventListener("click", () => {
  const player = currentRevealPlayer();
  // Le rôle n'est jamais affiché ici : seul le mot compte, comme dans le vrai jeu.
  // On ne le découvre qu'après avoir été éliminé (ou à la fin de la manche).
  revealCard.classList.add("shown");
  if (player.word) {
    revealCard.textContent = player.word;
  } else {
    revealCard.textContent = "Tu n'as pas de mot...\nÉcoute les autres et improvise !";
  }
  revealCard.style.whiteSpace = "pre-line";
  nextPlayerBtn.classList.remove("hidden");
});

nextPlayerBtn.addEventListener("click", () => {
  state.revealIndex++;
  if (state.revealIndex < state.playerOrder.length) {
    renderReveal();
  } else {
    showScreen("screen-clues");
    renderClues();
  }
});

// ---------- Clues screen ----------
const cluesTitle = document.getElementById("cluesTitle");
const cluesOrderList = document.getElementById("cluesOrderList");
const goToVoteBtn = document.getElementById("goToVoteBtn");

function renderClues() {
  cluesTitle.textContent = `Manche ${state.manche} · Tour ${state.turn} - Description`;
  cluesOrderList.innerHTML = "";
  aliveInOrder().forEach((p, i) => {
    const li = document.createElement("li");
    const num = document.createElement("span");
    num.className = "order-num";
    num.textContent = i + 1;
    const name = document.createElement("span");
    name.textContent = p.name;
    li.appendChild(num);
    li.appendChild(name);
    cluesOrderList.appendChild(li);
  });
}

goToVoteBtn.addEventListener("click", () => {
  showScreen("screen-vote");
  renderVote();
});

// ---------- Vote screen ----------
const voteTitle = document.getElementById("voteTitle");
const voteHint = document.getElementById("voteHint");
const voteList = document.getElementById("voteList");
const validateVoteBtn = document.getElementById("validateVoteBtn");

function renderVote() {
  voteTitle.textContent = `Manche ${state.manche} · Tour ${state.turn} - Vote`;

  const alivePlayers = aliveInOrder();
  const votable = state.tieRestrictedIds
    ? alivePlayers.filter((p) => state.tieRestrictedIds.includes(p.id))
    : alivePlayers;

  voteHint.textContent = state.tieRestrictedIds
    ? "Égalité ! Revotez uniquement entre les joueurs suivants :"
    : "Comptez les votes à voix haute et appuyez sur + pour chaque joueur désigné :";

  state.voteCounts = {};
  votable.forEach((p) => (state.voteCounts[p.id] = 0));

  voteList.innerHTML = "";
  votable.forEach((p) => {
    const row = document.createElement("div");
    row.className = "player-row";

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = p.name;

    const controls = document.createElement("div");
    controls.className = "vote-controls";

    const minusBtn = document.createElement("button");
    minusBtn.className = "btn-secondary";
    minusBtn.textContent = "−";
    minusBtn.addEventListener("click", () => {
      state.voteCounts[p.id] = Math.max(0, state.voteCounts[p.id] - 1);
      countSpan.textContent = state.voteCounts[p.id];
    });

    const countSpan = document.createElement("span");
    countSpan.className = "vote-count";
    countSpan.textContent = state.voteCounts[p.id];

    const plusBtn = document.createElement("button");
    plusBtn.className = "btn-primary";
    plusBtn.textContent = "+";
    plusBtn.addEventListener("click", () => {
      state.voteCounts[p.id]++;
      countSpan.textContent = state.voteCounts[p.id];
    });

    controls.appendChild(minusBtn);
    controls.appendChild(countSpan);
    controls.appendChild(plusBtn);
    row.appendChild(name);
    row.appendChild(controls);
    voteList.appendChild(row);
  });
}

validateVoteBtn.addEventListener("click", () => {
  const entries = Object.entries(state.voteCounts);
  const max = Math.max(...entries.map(([, v]) => v));

  if (max === 0) {
    alert("Attribuez au moins un vote avant de valider.");
    return;
  }

  const maxIds = entries.filter(([, v]) => v === max).map(([id]) => parseInt(id, 10));

  if (maxIds.length > 1) {
    state.tieRestrictedIds = maxIds;
    const names = maxIds.map((id) => state.players.find((p) => p.id === id).name).join(", ");
    alert(`Égalité entre : ${names}. Revotez uniquement entre eux.`);
    renderVote();
    return;
  }

  state.tieRestrictedIds = null;
  eliminatePlayer(maxIds[0]);
});

// ---------- Élimination ----------
function eliminatePlayer(playerId) {
  const player = state.players.find((p) => p.id === playerId);
  player.alive = false;
  player.eliminatedTurn = state.turn;

  if (player.role === "blanc") {
    document.getElementById("mrWhiteGuessInput").value = "";
    showModal("mrWhiteModal");
  } else {
    checkWinOrContinue();
  }
}

// ---------- Mr. White guess modal ----------
const mrWhiteGuessInput = document.getElementById("mrWhiteGuessInput");
const submitGuessBtn = document.getElementById("submitGuessBtn");
const skipGuessBtn = document.getElementById("skipGuessBtn");

submitGuessBtn.addEventListener("click", () => {
  const guess = normalize(mrWhiteGuessInput.value);
  hideModal("mrWhiteModal");
  if (guess && guess === normalize(state.wordCivil)) {
    finishManche("blanc");
  } else {
    checkWinOrContinue();
  }
});

skipGuessBtn.addEventListener("click", () => {
  hideModal("mrWhiteModal");
  checkWinOrContinue();
});

// ---------- Win logic ----------
function checkWinOrContinue() {
  const alive = state.players.filter((p) => p.alive);
  const aliveCivil = alive.filter((p) => p.role === "civil").length;
  const aliveInfiltrators = alive.filter((p) => p.role === "undercover" || p.role === "blanc").length;

  if (aliveInfiltrators === 0) {
    finishManche("civil");
  } else if (aliveCivil <= 1) {
    finishManche("undercover");
  } else {
    state.turn++;
    state.tieRestrictedIds = null;
    showScreen("screen-clues");
    renderClues();
  }
}

// ---------- Fin de manche (la partie continue, aux joueurs de décider) ----------
const mancheWinnerBanner = document.getElementById("mancheWinnerBanner");
const mancheRolesList = document.getElementById("mancheRolesList");
const mancheScoreboard = document.getElementById("mancheScoreboard");
const nextMancheBtn = document.getElementById("nextMancheBtn");
const endSessionBtn = document.getElementById("endSessionBtn");

function renderRolesList(container, players, showPoints) {
  container.innerHTML = "";
  const sorted = players.slice().sort((a, b) => {
    const ta = a.eliminatedTurn ?? Infinity;
    const tb = b.eliminatedTurn ?? Infinity;
    return ta - tb;
  });

  sorted.forEach((p) => {
    const row = document.createElement("div");
    row.className = "eliminated-row";

    const name = document.createElement("span");
    name.textContent = p.name;

    const tag = document.createElement("span");
    tag.className = `role-tag ${p.role}`;
    let tagText = ROLE_LABELS[p.role] + (p.word ? ` · ${p.word}` : "");
    if (showPoints) tagText += ` · +${p.pointsEarned ?? 0} pts`;
    tag.textContent = tagText;

    row.appendChild(name);
    row.appendChild(tag);
    container.appendChild(row);
  });
}

function renderScoreboard(container) {
  container.innerHTML = "";
  const sorted = state.sessionPlayers
    .slice()
    .sort((a, b) => (state.scores[b.id] || 0) - (state.scores[a.id] || 0));

  sorted.forEach((sp, i) => {
    const row = document.createElement("div");
    row.className = "score-row" + (i === 0 && state.scores[sp.id] > 0 ? " top1" : "");

    const rank = document.createElement("span");
    rank.className = "score-rank";
    rank.textContent = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;

    const name = document.createElement("span");
    name.className = "score-name";
    name.textContent = sp.name;

    const pts = document.createElement("span");
    pts.className = "score-points";
    pts.textContent = `${state.scores[sp.id] || 0} pts`;

    row.appendChild(rank);
    row.appendChild(name);
    row.appendChild(pts);
    container.appendChild(row);
  });
}

function finishManche(winnerType) {
  state.players.forEach((p) => {
    let pts = 0;
    if (winnerType === "civil" && p.role === "civil") {
      pts = POINTS.civil;
    } else if (winnerType === "undercover" && (p.role === "undercover" || p.role === "blanc")) {
      pts = p.role === "undercover" ? POINTS.undercover : POINTS.blanc;
    } else if (winnerType === "blanc" && p.role === "blanc") {
      pts = POINTS.blanc;
    }
    p.pointsEarned = pts;
    state.scores[p.id] = (state.scores[p.id] || 0) + pts;
  });

  mancheWinnerBanner.textContent = `${WINNER_TEXT[winnerType]} (Manche ${state.manche})`;
  mancheWinnerBanner.className = `winner-banner ${winnerType}`;

  renderRolesList(mancheRolesList, state.players, true);
  renderScoreboard(mancheScoreboard);

  showScreen("screen-manche-result");
}

nextMancheBtn.addEventListener("click", () => {
  state.manche++;
  startManche();
});

const finalScoreboard = document.getElementById("finalScoreboard");

endSessionBtn.addEventListener("click", () => {
  renderScoreboard(finalScoreboard);
  showScreen("screen-end");
});

document.getElementById("newGameBtn").addEventListener("click", () => {
  showScreen("screen-setup");
});

// ---------- Rules modal ----------
document.getElementById("rulesBtn").addEventListener("click", () => showModal("rulesModal"));
document.getElementById("closeRulesBtn").addEventListener("click", () => hideModal("rulesModal"));

// ---------- Init ----------
playerCountInput.addEventListener("change", syncPlayerNameInputs);
categorySelect.addEventListener("change", updateWordsCountText);
document.getElementById("startBtn").addEventListener("click", startGame);

syncPlayerNameInputs();
populateCategorySelect();
