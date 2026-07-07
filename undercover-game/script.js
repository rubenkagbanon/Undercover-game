// ---------- État du jeu ----------
const state = {
  players: [], // { id, name, role: 'civil'|'undercover'|'blanc', word, alive, eliminatedRound }
  round: 1,
  wordCivil: "",
  wordUndercover: "",
  revealIndex: 0,
  voteCounts: {}, // id -> nombre de votes
  tieRestrictedIds: null, // ids autorisés à voter en cas d'égalité
  pendingEliminationId: null,
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

function startGame() {
  clearSetupError();

  const nameInputs = Array.from(playerNamesContainer.querySelectorAll(".player-name-input"));
  const names = nameInputs.map((input, i) => input.value.trim() || `Joueur ${i + 1}`);
  const total = names.length;

  const undercoverCount = clamp(parseInt(undercoverCountInput.value, 10) || 0, 1, total);
  const mrWhiteEnabled = mrWhiteCheckbox.checked;
  const mrWhiteCount = mrWhiteEnabled ? 1 : 0;
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

  const [wordA, wordB] = pairs[Math.floor(Math.random() * pairs.length)];
  const swap = Math.random() < 0.5;
  state.wordCivil = swap ? wordB : wordA;
  state.wordUndercover = swap ? wordA : wordB;

  const order = shuffle([...Array(total).keys()]);
  const roles = new Array(total);
  order.slice(0, undercoverCount).forEach((i) => (roles[i] = "undercover"));
  order.slice(undercoverCount, undercoverCount + mrWhiteCount).forEach((i) => (roles[i] = "blanc"));
  order.slice(undercoverCount + mrWhiteCount).forEach((i) => (roles[i] = "civil"));

  state.players = names.map((name, i) => ({
    id: i,
    name,
    role: roles[i],
    word: roles[i] === "civil" ? state.wordCivil : roles[i] === "undercover" ? state.wordUndercover : "",
    alive: true,
    eliminatedRound: null,
  }));

  state.round = 1;
  state.revealIndex = 0;
  state.voteCounts = {};
  state.tieRestrictedIds = null;
  state.pendingEliminationId = null;

  showScreen("screen-reveal");
  renderReveal();
}

// ---------- Reveal screen ----------
const passNameEl = document.getElementById("passName");
const revealCard = document.getElementById("revealCard");
const nextPlayerBtn = document.getElementById("nextPlayerBtn");

function renderReveal() {
  const player = state.players[state.revealIndex];
  passNameEl.textContent = `Passe le téléphone à ${player.name}`;
  revealCard.textContent = "Touche pour révéler ton rôle";
  revealCard.className = "reveal-card";
  nextPlayerBtn.classList.add("hidden");
}

revealCard.addEventListener("click", () => {
  const player = state.players[state.revealIndex];
  revealCard.classList.add("shown", `role-${player.role}`);
  if (player.role === "civil") {
    revealCard.textContent = `Tu es CIVIL\nMot : ${player.word}`;
  } else if (player.role === "undercover") {
    revealCard.textContent = `Tu es UNDERCOVER\nMot : ${player.word}`;
  } else {
    revealCard.textContent = "Tu es MR. WHITE\nTu n'as pas de mot, bluffe !";
  }
  revealCard.style.whiteSpace = "pre-line";
  nextPlayerBtn.classList.remove("hidden");
});

nextPlayerBtn.addEventListener("click", () => {
  state.revealIndex++;
  if (state.revealIndex < state.players.length) {
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
  cluesTitle.textContent = `Manche ${state.round} - Description`;
  cluesOrderList.innerHTML = "";
  state.players
    .filter((p) => p.alive)
    .forEach((p, i) => {
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
  voteTitle.textContent = `Manche ${state.round} - Vote`;

  const alivePlayers = state.players.filter((p) => p.alive);
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
  openEliminationConfirm(maxIds[0]);
});

// ---------- Elimination modal ----------
const eliminationText = document.getElementById("eliminationText");
const eliminationConfirmStep = document.getElementById("eliminationConfirmStep");
const eliminationRevealStep = document.getElementById("eliminationRevealStep");
const eliminationRevealText = document.getElementById("eliminationRevealText");
const confirmEliminateBtn = document.getElementById("confirmEliminateBtn");
const cancelEliminateBtn = document.getElementById("cancelEliminateBtn");
const continueAfterRevealBtn = document.getElementById("continueAfterRevealBtn");

function openEliminationConfirm(playerId) {
  state.pendingEliminationId = playerId;
  const player = state.players.find((p) => p.id === playerId);
  eliminationText.textContent = `Éliminer ${player.name} ?`;
  eliminationConfirmStep.classList.remove("hidden");
  eliminationRevealStep.classList.add("hidden");
  showModal("eliminationModal");
}

cancelEliminateBtn.addEventListener("click", () => {
  hideModal("eliminationModal");
  state.pendingEliminationId = null;
});

const ROLE_LABELS = { civil: "CIVIL", undercover: "UNDERCOVER", blanc: "MR. WHITE" };

confirmEliminateBtn.addEventListener("click", () => {
  const player = state.players.find((p) => p.id === state.pendingEliminationId);
  player.alive = false;
  player.eliminatedRound = state.round;

  let text = `${player.name} était ${ROLE_LABELS[player.role]} !`;
  if (player.role !== "blanc") {
    text += `\nSon mot était : « ${player.word} »`;
  }
  eliminationRevealText.textContent = text;
  eliminationRevealText.style.whiteSpace = "pre-line";

  eliminationConfirmStep.classList.add("hidden");
  eliminationRevealStep.classList.remove("hidden");
});

continueAfterRevealBtn.addEventListener("click", () => {
  hideModal("eliminationModal");
  const player = state.players.find((p) => p.id === state.pendingEliminationId);
  state.pendingEliminationId = null;

  if (player.role === "blanc") {
    document.getElementById("mrWhiteGuessInput").value = "";
    showModal("mrWhiteModal");
  } else {
    checkWinOrContinue();
  }
});

// ---------- Mr. White guess modal ----------
const mrWhiteGuessInput = document.getElementById("mrWhiteGuessInput");
const submitGuessBtn = document.getElementById("submitGuessBtn");
const skipGuessBtn = document.getElementById("skipGuessBtn");

submitGuessBtn.addEventListener("click", () => {
  const guess = normalize(mrWhiteGuessInput.value);
  hideModal("mrWhiteModal");
  if (guess && guess === normalize(state.wordCivil)) {
    endGame("blanc");
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
    endGame("civil");
  } else if (aliveCivil <= 1) {
    endGame("undercover");
  } else {
    state.round++;
    state.tieRestrictedIds = null;
    showScreen("screen-clues");
    renderClues();
  }
}

// ---------- End screen ----------
const winnerBanner = document.getElementById("winnerBanner");
const eliminatedList = document.getElementById("eliminatedList");

const WINNER_TEXT = {
  civil: "🎉 Les Civils gagnent !",
  undercover: "🕵️ Les Infiltrés gagnent !",
  blanc: "🎭 Mr. White gagne !",
};

function endGame(winnerType) {
  showScreen("screen-end");
  winnerBanner.textContent = WINNER_TEXT[winnerType];
  winnerBanner.className = `winner-banner ${winnerType}`;

  eliminatedList.innerHTML = "";
  const sorted = state.players.slice().sort((a, b) => {
    const ra = a.eliminatedRound ?? Infinity;
    const rb = b.eliminatedRound ?? Infinity;
    return ra - rb;
  });

  sorted.forEach((p) => {
    const row = document.createElement("div");
    row.className = "eliminated-row";

    const name = document.createElement("span");
    name.textContent = p.alive
      ? `${p.name} (survivant)`
      : `${p.name} — éliminé manche ${p.eliminatedRound}`;

    const tag = document.createElement("span");
    tag.className = `role-tag ${p.role}`;
    tag.textContent = ROLE_LABELS[p.role] + (p.word ? ` · ${p.word}` : "");

    row.appendChild(name);
    row.appendChild(tag);
    eliminatedList.appendChild(row);
  });
}

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
