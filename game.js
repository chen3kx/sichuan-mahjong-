/* ============================================
   GAME ENGINE
   State machine for Sichuan Blood-Battle Mahjong
   ============================================ */

const Game = {

  // The single source of truth for game state
  state: null,

  /**
   * Initialize a new game.
   * difficulty: 'easy' | 'medium' | 'hard'
   */
  startSinglePlayer(difficulty = 'medium') {
    UI.closeModal('difficulty-modal');
    UI.showScreen('game-screen');
    // Initialize audio on first user gesture (clicking the start button)
    Sound.init();
    Sound.resume();
    Sound.shuffle();
    this.isOnline = false; // ensure we're in offline mode
    UI.setConnectionStatus(false); // hide indicator
    this.state = this.createInitialState(difficulty);
    this.dealInitialHands();
    UI.renderAll();
    // Show missing-suit selection for human player
    setTimeout(() => UI.showMissingOverlay(), 600);
  },

  /**
   * Build the initial game state object.
   * Players: 0=human (south), 1=east, 2=north, 3=west
   */
  createInitialState(difficulty) {
    const deck = Tiles.shuffle(Tiles.buildDeck());
    return {
      difficulty,
      wall: deck,
      players: [0, 1, 2, 3].map(i => ({
        index: i,
        name: ['我', '李叔', '老王', '三姐'][i],
        hand: [],
        melds: [],
        discards: [],
        missing: null,
        score: 0,
        hasHu: false,
        huInfo: null,  // { types, fan, score, fromPlayer, tile }
        isAI: i !== 0,
      })),
      dealer: 0,
      currentTurn: 0,
      lastDiscard: null,
      lastDiscardPlayer: -1,
      phase: 'setup', // setup, choosing-missing, playing, ended
      round: 1,
      // Action prompts pending for the human player
      pendingActions: null,
      // Track gang flow for gangshanghua / qiangganghu
      gangPending: false,
      lastDrawWasGang: false,
    };
  },

  /**
   * Deal 13 tiles to each player. Dealer (player 0) gets the 14th later.
   */
  dealInitialHands() {
    for (let i = 0; i < 13; i++) {
      for (let p = 0; p < 4; p++) {
        this.state.players[p].hand.push(this.state.wall.shift());
      }
    }
    // Sort hands
    for (const player of this.state.players) {
      player.hand = Tiles.sortHand(player.hand);
    }
  },

  /**
   * Human chooses their missing suit
   */
  chooseMissing(suit) {
    // Route to online controller if in online mode
    if (this.isOnline) {
      OnlineGame.onChooseMissing(suit);
      return;
    }

    this.state.players[0].missing = suit;
    UI.hideMissingOverlay();
    Sound.missingSelect();
    // AIs choose their missing suit
    for (let i = 1; i < 4; i++) {
      this.state.players[i].missing = AI.chooseMissing(
        this.state.players[i].hand,
        this.state.difficulty
      );
    }
    UI.renderAll();
    UI.toast(`你选择了缺${Tiles.getSuitName(suit)}`, 'success');
    // Begin play
    this.state.phase = 'playing';
    setTimeout(() => this.startTurn(this.state.dealer), 800);
  },

  /**
   * Suggest missing for human
   */
  suggestMissing() {
    const suit = Rules.suggestMissing(this.state.players[0].hand);
    this.chooseMissing(suit);
  },

  /**
   * Begin a turn for the given player: draw a tile
   */
  startTurn(playerIdx) {
    if (this.state.phase === 'ended') return;

    // Check if all but one have hu'd or wall is empty
    const activePlayers = this.state.players.filter(p => !p.hasHu);
    if (activePlayers.length <= 1 || this.state.wall.length === 0) {
      this.endRound();
      return;
    }

    // Skip players who already hu'd
    while (this.state.players[playerIdx].hasHu) {
      playerIdx = (playerIdx + 1) % 4;
    }

    this.state.currentTurn = playerIdx;
    const player = this.state.players[playerIdx];

    // Draw a tile
    if (this.state.wall.length === 0) {
      this.endRound();
      return;
    }

    const drawnTile = this.state.wall.shift();
    player.hand.push(drawnTile);
    player.hand = Tiles.sortHand(player.hand);
    Sound.draw();

    UI.renderAll();
    UI.updateTurnIndicator(playerIdx);

    // Play turn-change sound for human
    if (playerIdx === 0) {
      Sound.yourTurn();
    }

    // Check if self-draw is a win for this player
    if (this.canPlayerHu(playerIdx, drawnTile, true)) {
      if (playerIdx === 0) {
        // Show hu button to human
        this.state.pendingActions = { hu: true, zimo: true, winTile: drawnTile };
        UI.showActions();
        UI.showHint('自摸胡牌！');
        return;
      } else {
        // AI decides
        if (AI.shouldHu(player, drawnTile, this.state.difficulty, { zimo: true })) {
          setTimeout(() => this.declareHu(playerIdx, drawnTile, true), 600);
          return;
        }
      }
    }

    // Check for concealed gang opportunity (only for current player on their own turn)
    const angangTiles = Rules.findAnGang(player.hand, player.missing);
    const addGangTiles = Rules.findAddGang(player.hand, player.melds, player.missing);

    if (playerIdx === 0) {
      // Human: present options if any
      if (angangTiles.length > 0 || addGangTiles.length > 0) {
        this.state.pendingActions = {
          gang: true,
          angangTiles,
          addGangTiles,
          pass: true
        };
        UI.showActions();
      }
      // Human will manually click a tile to discard
    } else {
      // AI: decide gang or discard
      if (angangTiles.length > 0 && AI.shouldGang(player, angangTiles[0], this.state.difficulty, true)) {
        setTimeout(() => this.performAnGang(playerIdx, angangTiles[0]), 600);
        return;
      }
      if (addGangTiles.length > 0 && AI.shouldGang(player, addGangTiles[0], this.state.difficulty, false)) {
        setTimeout(() => this.performAddGang(playerIdx, addGangTiles[0]), 600);
        return;
      }
      // AI discards
      setTimeout(() => {
        const discard = AI.chooseDiscard(player, this.state.difficulty);
        this.discardTile(playerIdx, discard);
      }, 700 + Math.random() * 400);
    }
  },

  /**
   * Player (human or AI) discards a tile
   */
  discardTile(playerIdx, tile) {
    const player = this.state.players[playerIdx];
    const idx = player.hand.indexOf(tile);
    if (idx < 0) return;

    player.hand.splice(idx, 1);
    player.discards.push(tile);
    this.state.lastDiscard = tile;
    this.state.lastDiscardPlayer = playerIdx;
    this.state.pendingActions = null;
    this.state.lastDrawWasGang = false;

    Sound.discard();
    UI.hideActions();
    UI.hideHint();
    UI.renderAll();
    UI.highlightLastDiscard();

    // Check if anyone can act on this discard (hu has priority, then peng/gang)
    this.checkReactions(playerIdx, tile);
  },

  /**
   * After a discard, check if any other player can hu / peng / gang
   * Priority order: hu (any player) > peng/gang (specific player) > next player draws
   */
  checkReactions(discarderIdx, tile) {
    // Check hu for all other players (blood battle: multiple can hu)
    const huPlayers = [];
    for (let i = 0; i < 4; i++) {
      if (i === discarderIdx) continue;
      if (this.state.players[i].hasHu) continue;
      if (this.canPlayerHu(i, tile, false)) {
        huPlayers.push(i);
      }
    }

    // Check peng/gang (only next-in-line precedence but any player can peng)
    const pengPlayers = [];
    const gangPlayers = [];
    for (let i = 0; i < 4; i++) {
      if (i === discarderIdx) continue;
      if (this.state.players[i].hasHu) continue;
      const player = this.state.players[i];
      if (Rules.canMingGang(player.hand, tile, player.missing)) {
        gangPlayers.push(i);
      } else if (Rules.canPeng(player.hand, tile, player.missing)) {
        pengPlayers.push(i);
      }
    }

    // If human can hu, prompt first
    if (huPlayers.includes(0)) {
      this.state.pendingActions = {
        hu: true,
        zimo: false,
        winTile: tile,
        fromPlayer: discarderIdx,
        // Also keep peng/gang options open as alternatives
        peng: pengPlayers.includes(0),
        gang: gangPlayers.includes(0),
        pass: true,
      };
      UI.showActions();
      UI.showHint('可以胡牌！');
      // AI players who can hu will be processed after human decides
      return;
    }

    // If human can peng/gang, prompt
    if (pengPlayers.includes(0) || gangPlayers.includes(0)) {
      this.state.pendingActions = {
        peng: pengPlayers.includes(0),
        gang: gangPlayers.includes(0),
        pass: true,
        winTile: tile,
        fromPlayer: discarderIdx,
      };
      UI.showActions();
      // But: if AI can hu, they should hu first
      if (huPlayers.length > 0) {
        // Trigger AI hu after a beat (with priority)
        setTimeout(() => this.processAiHuReactions(huPlayers, tile, discarderIdx), 300);
        return;
      }
      return;
    }

    // No human reactions - process AI reactions
    this.processAiReactions(huPlayers, pengPlayers, gangPlayers, tile, discarderIdx);
  },

  /**
   * Handle AI hu reactions (multiple AIs can hu)
   */
  processAiHuReactions(huPlayers, tile, discarderIdx) {
    let delay = 0;
    for (const idx of huPlayers) {
      if (idx === 0) continue; // human handled separately
      const player = this.state.players[idx];
      if (AI.shouldHu(player, tile, this.state.difficulty, { zimo: false })) {
        setTimeout(() => this.declareHu(idx, tile, false, discarderIdx), 500 + delay);
        delay += 700;
      }
    }
    if (delay > 0) {
      setTimeout(() => this.continueAfterReactions(discarderIdx), delay + 500);
    } else {
      this.continueAfterReactions(discarderIdx);
    }
  },

  /**
   * Process AI peng/gang reactions to a discard
   */
  processAiReactions(huPlayers, pengPlayers, gangPlayers, tile, discarderIdx) {
    // AI hu first
    const aiHu = huPlayers.filter(i => i !== 0);
    if (aiHu.length > 0) {
      this.processAiHuReactions(aiHu, tile, discarderIdx);
      return;
    }

    // AI gang (priority over peng since it's stronger)
    for (const idx of gangPlayers) {
      if (idx === 0) continue;
      const player = this.state.players[idx];
      if (AI.shouldGang(player, tile, this.state.difficulty, false)) {
        setTimeout(() => this.performMingGang(idx, tile, discarderIdx), 500);
        return;
      }
    }

    // AI peng
    for (const idx of pengPlayers) {
      if (idx === 0) continue;
      const player = this.state.players[idx];
      if (AI.shouldPeng(player, tile, this.state.difficulty)) {
        setTimeout(() => this.performPeng(idx, tile, discarderIdx), 500);
        return;
      }
    }

    // No reactions - advance to next player
    this.continueAfterReactions(discarderIdx);
  },

  continueAfterReactions(discarderIdx) {
    if (this.state.phase === 'ended') return;
    setTimeout(() => this.startTurn((discarderIdx + 1) % 4), 400);
  },

  /**
   * Human action button handler
   * action: 'pass' | 'peng' | 'gang' | 'hu'
   */
  action(action) {
    // Route to online controller if in online mode
    if (this.isOnline) {
      OnlineGame.onAction(action);
      return;
    }

    const pa = this.state.pendingActions;
    if (!pa) return;

    Sound.buttonClick();

    if (action === 'pass') {
      this.state.pendingActions = null;
      UI.hideActions();
      UI.hideHint();
      // If we were prompted for a reaction to a discard, continue AI reactions then advance
      if (pa.fromPlayer !== undefined) {
        // Check if other AIs would have acted
        const tile = pa.winTile;
        const huPlayers = [];
        const pengPlayers = [];
        const gangPlayers = [];
        for (let i = 1; i < 4; i++) {
          if (this.state.players[i].hasHu) continue;
          if (this.canPlayerHu(i, tile, false)) huPlayers.push(i);
          else {
            const player = this.state.players[i];
            if (Rules.canMingGang(player.hand, tile, player.missing)) gangPlayers.push(i);
            else if (Rules.canPeng(player.hand, tile, player.missing)) pengPlayers.push(i);
          }
        }
        this.processAiReactions(huPlayers, pengPlayers, gangPlayers, tile, pa.fromPlayer);
      } else {
        // pass on own gang option - just discard normally (wait for click)
      }
      return;
    }

    if (action === 'hu') {
      const tile = pa.winTile;
      this.state.pendingActions = null;
      UI.hideActions();
      UI.hideHint();
      this.declareHu(0, tile, pa.zimo, pa.fromPlayer);
      return;
    }

    if (action === 'peng') {
      const tile = pa.winTile;
      const fromPlayer = pa.fromPlayer;
      this.state.pendingActions = null;
      UI.hideActions();
      UI.hideHint();
      this.performPeng(0, tile, fromPlayer);
      return;
    }

    if (action === 'gang') {
      // Could be ming-gang (from discard) or an-gang/add-gang (own turn)
      if (pa.fromPlayer !== undefined) {
        const tile = pa.winTile;
        const fromPlayer = pa.fromPlayer;
        this.state.pendingActions = null;
        UI.hideActions();
        UI.hideHint();
        this.performMingGang(0, tile, fromPlayer);
      } else if (pa.angangTiles && pa.angangTiles.length > 0) {
        const tile = pa.angangTiles[0];
        this.state.pendingActions = null;
        UI.hideActions();
        this.performAnGang(0, tile);
      } else if (pa.addGangTiles && pa.addGangTiles.length > 0) {
        const tile = pa.addGangTiles[0];
        this.state.pendingActions = null;
        UI.hideActions();
        this.performAddGang(0, tile);
      }
      return;
    }
  },

  /**
   * Human clicked a tile in their hand - discard it
   */
  onHandTileClick(tile) {
    // Route to online controller if in online mode
    if (this.isOnline) {
      OnlineGame.onHandTileClick(tile);
      return;
    }

    if (this.state.currentTurn !== 0) return;
    if (this.state.phase !== 'playing') return;
    if (this.state.players[0].hasHu) return;
    if (this.state.players[0].hand.length % 3 !== 2) return; // must have 14 tiles (or after gang draw)

    const player = this.state.players[0];

    // Sichuan rule: if you have any tiles of the missing suit, you MUST discard those first
    const hasMissingTiles = player.hand.some(t => Tiles.suitOf(t) === player.missing);
    if (hasMissingTiles && Tiles.suitOf(tile) !== player.missing) {
      Sound.warning();
      UI.toast(`必须先打出缺门（${Tiles.getSuitName(player.missing)}）的牌`, 'warning');
      return;
    }

    // Clear pending pass-only action
    if (this.state.pendingActions && !this.state.pendingActions.fromPlayer) {
      this.state.pendingActions = null;
      UI.hideActions();
    }

    this.discardTile(0, tile);
  },

  /**
   * Check if a player can hu given a winning tile
   */
  canPlayerHu(playerIdx, winTile, isZimo) {
    const player = this.state.players[playerIdx];
    if (player.hasHu) return false;
    if (Tiles.suitOf(winTile) === player.missing) return false;

    // Build the test hand
    let testHand;
    if (isZimo) {
      // Already in hand
      testHand = player.hand.slice();
    } else {
      // Add the tile to hand
      testHand = [...player.hand, winTile];
    }

    if (Rules.hasMissingSuit(testHand, player.melds, player.missing)) return false;
    return Rules.canHu(testHand, player.melds);
  },

  /**
   * Declare hu (win) for a player
   */
  declareHu(playerIdx, winTile, isZimo, fromPlayer = null) {
    const player = this.state.players[playerIdx];

    // Add the win tile to hand if from discard
    let finalHand;
    if (isZimo) {
      finalHand = player.hand.slice();
    } else {
      finalHand = [...player.hand, winTile];
      player.hand = finalHand;
    }

    const options = {
      zimo: isZimo,
      gangshanghua: this.state.lastDrawWasGang && isZimo,
      haidi: this.state.wall.length === 0,
    };

    const result = Rules.calculateFan(finalHand, player.melds, winTile, options);

    player.hasHu = true;
    player.huInfo = {
      tile: winTile,
      zimo: isZimo,
      fromPlayer,
      fan: result.fan,
      types: result.types,
      score: result.score,
    };

    // Apply scoring: blood battle rules
    // - Self-draw (zimo): each remaining active player pays the score
    // - Discard (dianpao): only the discarder pays score
    const activePlayers = this.state.players.filter((p, i) => !p.hasHu && i !== playerIdx);

    if (isZimo) {
      for (const other of activePlayers) {
        other.score -= result.score;
        player.score += result.score;
      }
    } else {
      const discarder = this.state.players[fromPlayer];
      if (discarder && !discarder.hasHu) {
        discarder.score -= result.score;
        player.score += result.score;
      }
    }

    UI.showActionPopup('胡', playerIdx);
    if (isZimo) {
      Sound.zimo();
    } else {
      Sound.hu();
    }
    UI.toast(`${player.name} 胡牌！${result.types.map(t => t.name).join(' ')}`, 'success');
    UI.renderAll();

    // Check if game should end (only one active player left or wall empty)
    setTimeout(() => {
      const stillActive = this.state.players.filter(p => !p.hasHu);
      if (stillActive.length <= 1 || this.state.wall.length === 0) {
        this.endRound();
      } else {
        // Continue blood battle
        if (isZimo) {
          this.startTurn((playerIdx + 1) % 4);
        } else {
          this.continueAfterReactions(fromPlayer);
        }
      }
    }, 1500);
  },

  /**
   * Perform peng: take the discarded tile + 2 from hand → meld
   */
  performPeng(playerIdx, tile, fromPlayer) {
    const player = this.state.players[playerIdx];
    const discarder = this.state.players[fromPlayer];

    // Remove tile from discarder's discards
    const dIdx = discarder.discards.lastIndexOf(tile);
    if (dIdx >= 0) discarder.discards.splice(dIdx, 1);

    // Remove 2 copies from player's hand
    let removed = 0;
    player.hand = player.hand.filter(t => {
      if (t === tile && removed < 2) { removed++; return false; }
      return true;
    });

    player.melds.push({ type: 'peng', tile, from: fromPlayer });
    this.state.lastDiscard = null;
    this.state.currentTurn = playerIdx;

    Sound.peng();
    UI.showActionPopup('碰', playerIdx);
    UI.renderAll();
    UI.updateTurnIndicator(playerIdx);

    // After peng, player must discard
    if (playerIdx === 0) {
      UI.showHint('请打出一张牌');
    } else {
      setTimeout(() => {
        const discard = AI.chooseDiscard(player, this.state.difficulty);
        this.discardTile(playerIdx, discard);
      }, 800);
    }
  },

  /**
   * Perform ming-gang (exposed gang from discard)
   */
  performMingGang(playerIdx, tile, fromPlayer) {
    const player = this.state.players[playerIdx];
    const discarder = this.state.players[fromPlayer];

    const dIdx = discarder.discards.lastIndexOf(tile);
    if (dIdx >= 0) discarder.discards.splice(dIdx, 1);

    let removed = 0;
    player.hand = player.hand.filter(t => {
      if (t === tile && removed < 3) { removed++; return false; }
      return true;
    });

    player.melds.push({ type: 'gang', tile, from: fromPlayer });
    this.state.lastDiscard = null;
    this.state.currentTurn = playerIdx;

    Sound.gang();
    UI.showActionPopup('杠', playerIdx);
    UI.renderAll();

    // After gang: gang pays score (each opponent pays 1 to gang-er for ming gang in some rules)
    // Simplified: ming gang +1 point from discarder
    discarder.score -= 1;
    player.score += 1;

    // After gang, draw a replacement and continue turn
    setTimeout(() => this.gangDraw(playerIdx), 800);
  },

  /**
   * Perform an-gang (concealed gang from own hand)
   */
  performAnGang(playerIdx, tile) {
    const player = this.state.players[playerIdx];
    player.hand = player.hand.filter(t => t !== tile);
    player.melds.push({ type: 'angang', tile });

    Sound.gang();
    UI.showActionPopup('暗杠', playerIdx);
    UI.renderAll();

    // An-gang: each other active player pays 2
    const others = this.state.players.filter((p, i) => !p.hasHu && i !== playerIdx);
    for (const other of others) {
      other.score -= 2;
      player.score += 2;
    }

    setTimeout(() => this.gangDraw(playerIdx), 800);
  },

  /**
   * Perform added gang (peng → gang by drawing the 4th)
   */
  performAddGang(playerIdx, tile) {
    const player = this.state.players[playerIdx];
    // Find the peng meld and upgrade it
    const meld = player.melds.find(m => m.type === 'peng' && m.tile === tile);
    if (!meld) return;
    meld.type = 'gang';
    player.hand = Tiles.removeOne(player.hand, tile);

    Sound.gang();
    UI.showActionPopup('杠', playerIdx);
    UI.renderAll();

    // Each opponent pays 1
    const others = this.state.players.filter((p, i) => !p.hasHu && i !== playerIdx);
    for (const other of others) {
      other.score -= 1;
      player.score += 1;
    }

    setTimeout(() => this.gangDraw(playerIdx), 800);
  },

  /**
   * Draw a replacement tile after a gang
   */
  gangDraw(playerIdx) {
    if (this.state.wall.length === 0) {
      this.endRound();
      return;
    }
    const player = this.state.players[playerIdx];
    const tile = this.state.wall.shift();
    player.hand.push(tile);
    player.hand = Tiles.sortHand(player.hand);
    this.state.lastDrawWasGang = true;

    UI.renderAll();

    // Check for self-draw hu (gangshanghua)
    if (this.canPlayerHu(playerIdx, tile, true)) {
      if (playerIdx === 0) {
        this.state.pendingActions = { hu: true, zimo: true, winTile: tile, pass: true };
        UI.showActions();
        UI.showHint('杠上花！可胡牌');
        return;
      } else {
        if (AI.shouldHu(player, tile, this.state.difficulty, { zimo: true, gangshanghua: true })) {
          setTimeout(() => this.declareHu(playerIdx, tile, true), 600);
          return;
        }
      }
    }

    // Check for more gang opportunities
    const angangTiles = Rules.findAnGang(player.hand, player.missing);
    const addGangTiles = Rules.findAddGang(player.hand, player.melds, player.missing);

    if (playerIdx === 0) {
      if (angangTiles.length > 0 || addGangTiles.length > 0) {
        this.state.pendingActions = { gang: true, angangTiles, addGangTiles, pass: true };
        UI.showActions();
      }
    } else {
      if (angangTiles.length > 0 && AI.shouldGang(player, angangTiles[0], this.state.difficulty, true)) {
        setTimeout(() => this.performAnGang(playerIdx, angangTiles[0]), 600);
        return;
      }
      if (addGangTiles.length > 0 && AI.shouldGang(player, addGangTiles[0], this.state.difficulty, false)) {
        setTimeout(() => this.performAddGang(playerIdx, addGangTiles[0]), 600);
        return;
      }
      // AI discards
      setTimeout(() => {
        const discard = AI.chooseDiscard(player, this.state.difficulty);
        this.discardTile(playerIdx, discard);
      }, 800);
    }
  },

  /**
   * End the round and show results
   */
  endRound() {
    this.state.phase = 'ended';
    Sound.roundEnd();

    // Apply "查叫" rule: at end of round, players still playing (no hu) who are ting
    // get partial compensation, those not ting pay penalty (simplified version)
    // For now, just show final scores.

    UI.showResults();
  },

  /**
   * Start next round
   */
  nextRound() {
    UI.closeModal('result-modal');
    // In online mode, returning to lobby (host will start next round)
    if (this.isOnline) {
      UI.toast('等待房主开始下一局...', 'info');
      return;
    }
    const prevScores = this.state.players.map(p => p.score);
    const difficulty = this.state.difficulty;
    const round = this.state.round + 1;
    this.state = this.createInitialState(difficulty);
    this.state.round = round;
    // Carry over scores
    for (let i = 0; i < 4; i++) {
      this.state.players[i].score = prevScores[i];
    }
    this.dealInitialHands();
    UI.renderAll();
    setTimeout(() => UI.showMissingOverlay(), 600);
  },

  /**
   * Helper: get all discarded tiles across all players
   */
  getAllDiscards() {
    if (!this.state) return [];
    return this.state.players.flatMap(p => p.discards);
  },
};
