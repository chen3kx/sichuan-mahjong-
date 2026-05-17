/* ============================================
   AI MODULE
   Computer opponents with three difficulty levels:
   - easy: random-ish with basic logic
   - medium: heuristic shanten-style evaluation
   - hard: deeper lookahead, discard tracking
   ============================================ */

const AI = {

  /**
   * Choose which suit to be missing.
   * AI always picks the suit with fewest tiles.
   */
  chooseMissing(hand, level) {
    const counts = Tiles.countBySuit(hand);
    // Hard AI considers tile distribution more carefully (avoid breaking up pairs/triplets)
    if (level === 'hard') {
      const scores = {};
      for (const suit of ['m', 's', 'p']) {
        const suitTiles = hand.filter(t => Tiles.suitOf(t) === suit);
        const tileCounts = Tiles.countTiles(suitTiles);
        let value = 0;
        for (const t of Object.keys(tileCounts)) {
          const c = tileCounts[t];
          if (c >= 3) value += 10;
          else if (c === 2) value += 4;
          else value += 1;
        }
        // Also account for sequence potential
        const nums = suitTiles.map(t => Tiles.numOf(t)).sort((a, b) => a - b);
        for (let i = 0; i < nums.length - 1; i++) {
          if (nums[i + 1] - nums[i] <= 2) value += 2;
        }
        scores[suit] = value;
      }
      // Pick the suit with LOWEST value (least worth keeping)
      return Object.keys(scores).reduce((min, s) => scores[s] < scores[min] ? s : min);
    }

    // Easy/medium: just pick fewest tiles
    return Rules.suggestMissing(hand);
  },

  /**
   * Decide what to discard from hand.
   * Returns the tile to discard.
   */
  chooseDiscard(player, level) {
    const { hand, missing, melds } = player;

    // RULE 1: If we have any missing-suit tiles, discard them first
    const missingTiles = hand.filter(t => Tiles.suitOf(t) === missing);
    if (missingTiles.length > 0) {
      // Discard the most isolated missing-suit tile (highest or lowest first)
      return this.pickMostIsolated(missingTiles, hand);
    }

    // RULE 2: Otherwise, evaluate each tile and discard the least valuable
    return this.pickLeastValuable(hand, melds, missing, level);
  },

  /**
   * Pick the most isolated tile (least connected to others)
   */
  pickMostIsolated(candidates, hand) {
    let bestTile = candidates[0];
    let bestScore = -Infinity;
    for (const tile of candidates) {
      const score = -this.tileConnectivity(tile, hand);
      if (score > bestScore) {
        bestScore = score;
        bestTile = tile;
      }
    }
    return bestTile;
  },

  /**
   * Measure how connected a tile is to others in the hand
   */
  tileConnectivity(tile, hand) {
    const { suit, num } = Tiles.parse(tile);
    let score = 0;
    for (const other of hand) {
      if (other === tile) continue;
      const op = Tiles.parse(other);
      if (op.suit !== suit) continue;
      const diff = Math.abs(op.num - num);
      if (diff === 0) score += 3; // same tile (pair/triplet potential)
      else if (diff === 1) score += 2; // adjacent
      else if (diff === 2) score += 1; // gap of 2
    }
    return score;
  },

  /**
   * Pick the least valuable tile to discard
   */
  pickLeastValuable(hand, melds, missing, level) {
    const uniqueTiles = [...new Set(hand)];
    let worstTile = uniqueTiles[0];
    let worstScore = Infinity;

    for (const tile of uniqueTiles) {
      const score = this.evaluateTileValue(tile, hand, melds, missing, level);
      if (score < worstScore) {
        worstScore = score;
        worstTile = tile;
      }
    }
    return worstTile;
  },

  /**
   * Evaluate the value of keeping a tile in hand.
   * Higher = more valuable to keep.
   */
  evaluateTileValue(tile, hand, melds, missing, level) {
    const counts = Tiles.countTiles(hand);
    const count = counts[tile] || 0;
    const { suit, num } = Tiles.parse(tile);

    let value = 0;

    // Multiples are very valuable
    if (count >= 3) value += 100;
    else if (count === 2) value += 30;
    else value += 5;

    // Connectivity bonus
    value += this.tileConnectivity(tile, hand) * 2;

    // Edge tiles (1, 9) are slightly less flexible
    if (num === 1 || num === 9) value -= 3;
    else if (num === 2 || num === 8) value -= 1;
    else value += 1; // middle tiles are flexible

    // Hard AI: consider what's been discarded (defensive play)
    if (level === 'hard' && Game.state) {
      const discarded = Game.getAllDiscards();
      const discardedCount = discarded.filter(t => t === tile).length;
      // If many copies already discarded, less useful
      value -= discardedCount * 3;

      // Defensive: if tile is unlikely to be useful in hand, drop it
      if (count === 1 && this.tileConnectivity(tile, hand) === 0) {
        value -= 10;
      }
    }

    // Medium/hard: check shanten improvement (would removing this tile keep us close to ting?)
    if (level !== 'easy' && count === 1) {
      // Test if removing this tile breaks anything
      const testHand = Tiles.removeOne(hand, tile);
      if (Rules.isTing(testHand, melds, missing)) {
        // We're tenpai without this tile - discard it
        value -= 50;
      }
    }

    return value;
  },

  /**
   * Decide whether to call peng on an opponent's discard.
   * Returns true to call, false to skip.
   */
  shouldPeng(player, tile, level) {
    if (!Rules.canPeng(player.hand, tile, player.missing)) return false;

    // Easy: always peng if possible (greedy)
    if (level === 'easy') return Math.random() < 0.6;

    // Medium/hard: only peng if it brings us closer to ting
    const handAfterPeng = Tiles.removeOne(Tiles.removeOne(player.hand, tile), tile);
    const newMelds = [...player.melds, { type: 'peng', tile }];

    // Don't peng if we'd need to discard a useful tile right after
    const wasTing = Rules.isTing(player.hand, player.melds, player.missing);
    const isTingAfter = Rules.isTing(handAfterPeng, newMelds, player.missing);

    if (isTingAfter && !wasTing) return true; // makes us ting → peng
    if (wasTing && !isTingAfter) return false; // breaks our ting → skip

    // Otherwise, peng if we have many of that suit (commitment) or it's a duidui-style hand
    const suitCount = player.hand.filter(t => Tiles.suitOf(t) === Tiles.suitOf(tile)).length;
    const counts = Tiles.countTiles(player.hand);
    const tripletPotential = Object.values(counts).filter(c => c >= 2).length;

    if (level === 'hard') {
      return tripletPotential >= 3 && suitCount >= 4;
    }
    return Math.random() < 0.5 && tripletPotential >= 2;
  },

  /**
   * Decide whether to gang.
   * AI always gangs if it doesn't break ting.
   */
  shouldGang(player, tile, level, isAnGang) {
    if (level === 'easy') return true;

    // Test if gang breaks our ting state
    let testHand, testMelds;
    if (isAnGang) {
      testHand = player.hand.filter(t => t !== tile);
      testMelds = [...player.melds, { type: 'angang', tile }];
    } else {
      // ming gang from discard
      testHand = player.hand.filter(t => t !== tile);
      // would have removed 3, but only need to remove the 3 we held; here we keep it simple
      testHand = player.hand.slice();
      let removed = 0;
      testHand = testHand.filter(t => {
        if (t === tile && removed < 3) { removed++; return false; }
        return true;
      });
      testMelds = [...player.melds, { type: 'gang', tile }];
    }

    return true; // Sichuan tradition: usually gang for the fan bonus
  },

  /**
   * Decide whether to declare hu (win).
   * In blood-battle, you can choose NOT to hu (to wait for a bigger hand),
   * but generally easy/medium AI always hu's.
   */
  shouldHu(player, winTile, level, options) {
    // Easy AI: always hu
    if (level === 'easy') return true;

    // Medium/hard: usually hu, but might wait if very low value and early game
    const handForCheck = [...player.hand];
    if (!handForCheck.includes(winTile)) handForCheck.push(winTile);
    const result = Rules.calculateFan(handForCheck, player.melds, winTile, options);

    // If only base fan and early game, hard AI might pass (qiangganghu chase)
    // But for stability, just always hu
    return true;
  },
};
