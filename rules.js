/* ============================================
   RULES ENGINE
   Sichuan Mahjong "Blood Battle to the End"
   - Hu (win) detection
   - Fan (score multiplier) calculation
   - Action eligibility (peng/gang)
   ============================================ */

// Node.js: require Tiles. On browser, Tiles is already a global.
if (typeof module !== 'undefined' && module.exports) {
  var Tiles = require('./tiles.js');
}

const Rules = {

  /**
   * Check if a 14-tile hand can form a valid winning structure:
   * 4 sets (triplets or sequences) + 1 pair, OR
   * 7 pairs (qidui)
   * Note: hand must include the winning tile.
   */
  canHu(hand, melds = []) {
    if (hand.length === 0) return false;
    // The hand must total 14 tiles when including all melds (3 per meld for peng, 4 for gang)
    const meldTileCount = melds.reduce((sum, m) => sum + (m.type === 'gang' || m.type === 'angang' ? 4 : 3), 0);
    const needed = 14 - meldTileCount + melds.filter(m => m.type === 'gang' || m.type === 'angang').length;
    // Simplified: hand tiles + 3 * meldCount should equal 14 for standard
    // Actually for sichuan, each gang doesn't add to the 14-tile structure since gang = triplet
    if (hand.length + melds.length * 3 !== 14) return false;

    const counts = Tiles.countTiles(hand);

    // Check seven pairs (only valid with no melds)
    if (melds.length === 0 && this.isQiDui(counts)) return true;

    // Check standard 4 sets + 1 pair
    return this.isStandardHu(counts, 4 - melds.length);
  },

  // Seven pairs: all tile counts must be even (2 or 4), and total must equal 14
  isQiDui(counts) {
    const values = Object.values(counts);
    const total = values.reduce((a, b) => a + b, 0);
    if (total !== 14) return false;
    return values.every(c => c === 2 || c === 4);
  },

  // Check if remaining tiles can form `setsNeeded` sets + 1 pair
  isStandardHu(countsObj, setsNeeded) {
    // Try each tile as the pair, then verify the rest forms sets
    const tiles = Object.keys(countsObj).filter(t => countsObj[t] >= 2);
    for (const pairTile of tiles) {
      const counts = { ...countsObj };
      counts[pairTile] -= 2;
      if (this.canFormSets(counts, setsNeeded)) {
        return true;
      }
    }
    return false;
  },

  // Recursively check whether the count map forms exactly `setsNeeded` triplets/sequences
  canFormSets(counts, setsNeeded) {
    // Find first tile with non-zero count
    const tiles = Object.keys(counts).filter(t => counts[t] > 0).sort();
    if (tiles.length === 0) return setsNeeded === 0;
    if (setsNeeded === 0) return false;

    const first = tiles[0];
    const { suit, num } = Tiles.parse(first);

    // Try triplet
    if (counts[first] >= 3) {
      counts[first] -= 3;
      if (this.canFormSets(counts, setsNeeded - 1)) {
        counts[first] += 3;
        return true;
      }
      counts[first] += 3;
    }

    // Try sequence (only within same suit, num+1 and num+2)
    if (num <= 7) {
      const t2 = suit + (num + 1);
      const t3 = suit + (num + 2);
      if ((counts[t2] || 0) >= 1 && (counts[t3] || 0) >= 1) {
        counts[first]--;
        counts[t2]--;
        counts[t3]--;
        if (this.canFormSets(counts, setsNeeded - 1)) {
          counts[first]++;
          counts[t2]++;
          counts[t3]++;
          return true;
        }
        counts[first]++;
        counts[t2]++;
        counts[t3]++;
      }
    }

    return false;
  },

  /**
   * Check if hand contains the missing suit (cannot Hu in Sichuan rules)
   */
  hasMissingSuit(hand, melds, missing) {
    if (hand.some(t => Tiles.suitOf(t) === missing)) return true;
    if (melds.some(m => Tiles.suitOf(m.tile) === missing)) return true;
    return false;
  },

  /**
   * Full hu validation: check structure + Sichuan rules (缺一门)
   */
  validateHu(hand, melds, missing, winTile) {
    // Must have the win tile in hand
    if (!hand.includes(winTile)) return false;
    // Cannot have missing suit
    if (this.hasMissingSuit(hand, melds, missing)) return false;
    return this.canHu(hand, melds);
  },

  /**
   * Check if player can call peng on a tile (already has 2 of them)
   */
  canPeng(hand, tile, missing) {
    if (Tiles.suitOf(tile) === missing) return false;
    return hand.filter(t => t === tile).length >= 2;
  },

  /**
   * Check if player can call ming-gang on a discarded tile (already has 3 of them)
   */
  canMingGang(hand, tile, missing) {
    if (Tiles.suitOf(tile) === missing) return false;
    return hand.filter(t => t === tile).length >= 3;
  },

  /**
   * Find all possible an-gang (concealed gang) tiles in hand (4 of a kind)
   */
  findAnGang(hand, missing) {
    const counts = Tiles.countTiles(hand);
    return Object.keys(counts).filter(t =>
      counts[t] === 4 && Tiles.suitOf(t) !== missing
    );
  },

  /**
   * Find tiles in hand that match an existing peng meld (for added gang)
   */
  findAddGang(hand, melds, missing) {
    const pengTiles = melds.filter(m => m.type === 'peng').map(m => m.tile);
    return hand.filter(t =>
      pengTiles.includes(t) && Tiles.suitOf(t) !== missing
    );
  },

  /**
   * Calculate fan (multiplier) for a winning hand.
   * Returns: { fan, types: [...names], score }
   */
  calculateFan(hand, melds, winTile, options = {}) {
    const types = [];
    let fan = 1; // Base: 平胡 1 fan (or sometimes 0 base, +1 for self-draw etc.)

    const allTiles = [...hand];
    melds.forEach(m => {
      const count = (m.type === 'gang' || m.type === 'angang') ? 4 : 3;
      for (let i = 0; i < count; i++) allTiles.push(m.tile);
    });

    const counts = Tiles.countTiles(hand);
    const suitCounts = Tiles.countBySuit(allTiles);

    // Check 清一色 (all same suit) - 4 fan
    const distinctSuits = Object.entries(suitCounts).filter(([_, c]) => c > 0).length;
    if (distinctSuits === 1) {
      fan += 4;
      types.push({ name: '清一色', fan: 4 });
    }

    // Check 七对 / 龙七对 (seven pairs)
    let isQiDui = false;
    if (melds.length === 0 && Rules.isQiDui(counts)) {
      isQiDui = true;
      const hasFour = Object.values(counts).filter(c => c === 4).length;
      if (hasFour > 0) {
        // 龙七对: 8 fan, each extra pair of 4 adds more
        fan += 8;
        types.push({ name: '龙七对', fan: 8 });
        if (hasFour > 1) {
          fan += (hasFour - 1) * 2;
          types.push({ name: `双龙七对 ×${hasFour}`, fan: (hasFour - 1) * 2 });
        }
      } else {
        fan += 4;
        types.push({ name: '七对', fan: 4 });
      }
    }

    // Check 对对胡 (all triplets, no sequences) - skip if qidui
    if (!isQiDui) {
      const isDuiDui = this.isDuiDuiHu(hand, melds);
      if (isDuiDui) {
        fan += 2;
        types.push({ name: '对对胡', fan: 2 });
      }
    }

    // 根 (4 identical tiles in melds count as gang already; for hand quartets in qidui already counted)
    // For non-qidui, count gang separately
    if (!isQiDui) {
      const gangs = melds.filter(m => m.type === 'gang' || m.type === 'angang');
      gangs.forEach(g => {
        if (g.type === 'angang') {
          fan += 2;
          types.push({ name: '暗杠', fan: 2 });
        } else {
          fan += 1;
          types.push({ name: '明杠', fan: 1 });
        }
      });
    }

    // 自摸 (self-draw) - 1 fan
    if (options.zimo) {
      fan += 1;
      types.push({ name: '自摸', fan: 1 });
    }

    // 杠上花 (win on gang-draw)
    if (options.gangshanghua) {
      fan += 2;
      types.push({ name: '杠上花', fan: 2 });
    }

    // 抢杠胡 (rob the gang)
    if (options.qiangganghu) {
      fan += 2;
      types.push({ name: '抢杠胡', fan: 2 });
    }

    // 海底捞月 (last tile)
    if (options.haidi) {
      fan += 1;
      types.push({ name: '海底捞月', fan: 1 });
    }

    // Cap fan to prevent runaway (typical Sichuan rule: max 4 fan = 16x base, but we'll allow up to 8 fan = 256x)
    const cappedFan = Math.min(fan, 8);
    const baseScore = 1;
    const score = baseScore * Math.pow(2, cappedFan - 1);

    return { fan: cappedFan, rawFan: fan, types, score };
  },

  /**
   * Check if hand is duidui (all triplets - pengpeng hu)
   * All melds must be triplets/gangs, and the hand portion must be triplets + 1 pair
   */
  isDuiDuiHu(hand, melds) {
    // All melds are by definition peng/gang (triplets/quads), so check hand
    const counts = Tiles.countTiles(hand);
    let pairs = 0;
    let triplets = 0;
    for (const t of Object.keys(counts)) {
      const c = counts[t];
      if (c === 2) pairs++;
      else if (c === 3) triplets++;
      else if (c === 4) { triplets++; /* extra one is awkward */ return false; }
      else return false;
    }
    return pairs === 1 && (pairs + triplets) === (5 - melds.length);
  },

  /**
   * Suggest the best missing suit (the one with fewest tiles)
   */
  suggestMissing(hand) {
    const counts = Tiles.countBySuit(hand);
    let minSuit = 'm';
    let minCount = counts.m;
    if (counts.s < minCount) { minSuit = 's'; minCount = counts.s; }
    if (counts.p < minCount) { minSuit = 'p'; minCount = counts.p; }
    return minSuit;
  },

  /**
   * After missing-suit is chosen, check if any winning tile would complete the hand.
   * Returns array of tiles that would win.
   */
  findTingTiles(hand, melds, missing) {
    const tingTiles = [];
    const suits = ['m', 's', 'p'].filter(s => s !== missing);
    for (const suit of suits) {
      for (let n = 1; n <= 9; n++) {
        const tile = suit + n;
        const testHand = [...hand, tile];
        if (this.canHu(testHand, melds) && !this.hasMissingSuit(testHand, melds, missing)) {
          tingTiles.push(tile);
        }
      }
    }
    return tingTiles;
  },

  /**
   * Check if a player is in "ting" state (one tile away from winning)
   */
  isTing(hand, melds, missing) {
    return this.findTingTiles(hand, melds, missing).length > 0;
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Rules;
}
