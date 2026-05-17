/* ============================================
   SOUND MODULE
   Programmatic audio synthesis via Web Audio API
   No external files needed - all sounds generated on-demand
   ============================================ */

const Sound = {

  ctx: null,
  enabled: true,
  masterVolume: 0.5,

  /**
   * Initialize audio context (must be called from user gesture due to browser policy)
   */
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio not supported:', e);
      this.enabled = false;
    }
  },

  /**
   * Ensure audio context is running (browsers suspend it until user gesture)
   */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  /**
   * Build an envelope-shaped tone
   * params: { freq, type, duration, attack, decay, sustain, release, volume, pan }
   */
  tone(params) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const {
      freq = 440,
      type = 'sine',
      duration = 0.2,
      attack = 0.005,
      decay = 0.05,
      sustain = 0.3,
      release = 0.1,
      volume = 0.3,
      pan = 0,
      freqEnd = null,  // for pitch sweeps
    } = params;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), now + duration);
    }

    // ADSR envelope
    const peak = volume * this.masterVolume;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.linearRampToValueAtTime(peak * sustain, now + attack + decay);
    gain.gain.setValueAtTime(peak * sustain, now + duration - release);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain);
    if (panner) {
      panner.pan.setValueAtTime(pan, now);
      gain.connect(panner);
      panner.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }

    osc.start(now);
    osc.stop(now + duration + 0.05);
  },

  /**
   * Generate filtered noise (for percussive sounds like tile clacks)
   */
  noise(params) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const {
      duration = 0.1,
      volume = 0.3,
      filterFreq = 2000,
      filterQ = 1,
      filterType = 'bandpass',
      attack = 0.001,
      release = 0.05,
    } = params;

    // Create a short noise buffer
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.Q.setValueAtTime(filterQ, now);

    const gain = ctx.createGain();
    const peak = volume * this.masterVolume;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + duration + 0.01);
  },

  // ============================================
  // GAME SOUND EFFECTS
  // ============================================

  /**
   * Tile click / hover - very subtle wooden tap
   */
  tileClick() {
    this.noise({
      duration: 0.05,
      volume: 0.15,
      filterFreq: 3500,
      filterQ: 3,
      filterType: 'bandpass',
    });
  },

  /**
   * Discarding a tile - solid wooden CLACK
   */
  discard() {
    if (!this.enabled || !this.ctx) return;
    // Layer: high-frequency noise burst + low body thump
    this.noise({
      duration: 0.08,
      volume: 0.35,
      filterFreq: 2800,
      filterQ: 2,
      filterType: 'bandpass',
    });
    this.tone({
      freq: 180,
      freqEnd: 90,
      type: 'sine',
      duration: 0.1,
      attack: 0.001,
      decay: 0.02,
      sustain: 0.3,
      release: 0.08,
      volume: 0.4,
    });
  },

  /**
   * Drawing a tile - softer paper-shuffle sound
   */
  draw() {
    this.noise({
      duration: 0.12,
      volume: 0.18,
      filterFreq: 4500,
      filterQ: 1,
      filterType: 'highpass',
      release: 0.1,
    });
  },

  /**
   * PENG! - bold, decisive double-thump
   */
  peng() {
    if (!this.enabled || !this.ctx) return;
    // Two quick thumps with bell-like overtones
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // First thump
    this.tone({
      freq: 260, freqEnd: 130, type: 'sine',
      duration: 0.18, attack: 0.002, decay: 0.04, sustain: 0.4, release: 0.13,
      volume: 0.5,
    });
    this.noise({
      duration: 0.08, volume: 0.3,
      filterFreq: 2200, filterQ: 1.5, filterType: 'bandpass',
    });

    // Second thump 80ms later with higher pitch
    setTimeout(() => {
      this.tone({
        freq: 380, freqEnd: 190, type: 'sine',
        duration: 0.22, attack: 0.002, decay: 0.05, sustain: 0.4, release: 0.15,
        volume: 0.45,
      });
      this.noise({
        duration: 0.08, volume: 0.3,
        filterFreq: 2800, filterQ: 1.5, filterType: 'bandpass',
      });
    }, 80);
  },

  /**
   * GANG! - powerful triple-thump with a metallic ring
   */
  gang() {
    if (!this.enabled || !this.ctx) return;

    // Three rapid thumps escalating
    [0, 70, 140].forEach((delay, i) => {
      setTimeout(() => {
        const baseFreq = 220 + i * 80;
        this.tone({
          freq: baseFreq, freqEnd: baseFreq * 0.5, type: 'sine',
          duration: 0.18, attack: 0.002, decay: 0.04, sustain: 0.4, release: 0.13,
          volume: 0.5,
        });
        this.noise({
          duration: 0.08, volume: 0.3,
          filterFreq: 2500 + i * 400, filterQ: 1.5, filterType: 'bandpass',
        });
      }, delay);
    });

    // Metallic ring on top
    setTimeout(() => {
      this.tone({
        freq: 1200, freqEnd: 900, type: 'triangle',
        duration: 0.5, attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.4,
        volume: 0.2,
      });
      this.tone({
        freq: 1800, freqEnd: 1500, type: 'sine',
        duration: 0.6, attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.5,
        volume: 0.12,
      });
    }, 100);
  },

  /**
   * HU! - triumphant chord with bell shimmer
   */
  hu() {
    if (!this.enabled || !this.ctx) return;

    // Major chord ascending (C - E - G - C high)
    const notes = [
      { freq: 523, delay: 0 },     // C5
      { freq: 659, delay: 70 },    // E5
      { freq: 784, delay: 140 },   // G5
      { freq: 1047, delay: 210 },  // C6
    ];

    notes.forEach(({ freq, delay }) => {
      setTimeout(() => {
        this.tone({
          freq, type: 'sine',
          duration: 0.8, attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.7,
          volume: 0.3,
        });
        // Overtone
        this.tone({
          freq: freq * 2, type: 'sine',
          duration: 0.6, attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.5,
          volume: 0.1,
        });
      }, delay);
    });

    // Big drum hit at start
    this.tone({
      freq: 100, freqEnd: 50, type: 'sine',
      duration: 0.4, attack: 0.001, decay: 0.05, sustain: 0.3, release: 0.34,
      volume: 0.5,
    });

    // Cymbal-like shimmer
    setTimeout(() => {
      this.noise({
        duration: 0.8, volume: 0.15,
        filterFreq: 6000, filterQ: 0.5, filterType: 'highpass',
        attack: 0.01, release: 0.7,
      });
    }, 100);
  },

  /**
   * ZIMO (self-draw win) - similar to hu but with extra flourish
   */
  zimo() {
    this.hu();
    // Add ascending arpeggio after
    setTimeout(() => {
      const notes = [659, 784, 988, 1175]; // E G B D ascending
      notes.forEach((freq, i) => {
        setTimeout(() => {
          this.tone({
            freq, type: 'triangle',
            duration: 0.3, attack: 0.005, decay: 0.05, sustain: 0.4, release: 0.25,
            volume: 0.18,
          });
        }, i * 60);
      });
    }, 400);
  },

  /**
   * Missing-suit selection confirmation
   */
  missingSelect() {
    this.tone({
      freq: 440, freqEnd: 660, type: 'triangle',
      duration: 0.25, attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.2,
      volume: 0.25,
    });
  },

  /**
   * Player turn change - subtle ding
   */
  yourTurn() {
    this.tone({
      freq: 880, type: 'sine',
      duration: 0.15, attack: 0.005, decay: 0.05, sustain: 0.3, release: 0.1,
      volume: 0.18,
    });
    setTimeout(() => {
      this.tone({
        freq: 1320, type: 'sine',
        duration: 0.2, attack: 0.005, decay: 0.05, sustain: 0.3, release: 0.15,
        volume: 0.15,
      });
    }, 80);
  },

  /**
   * Warning / illegal action
   */
  warning() {
    this.tone({
      freq: 200, freqEnd: 150, type: 'sawtooth',
      duration: 0.2, attack: 0.005, decay: 0.05, sustain: 0.4, release: 0.15,
      volume: 0.2,
    });
  },

  /**
   * Button click - UI feedback
   */
  buttonClick() {
    this.tone({
      freq: 600, type: 'sine',
      duration: 0.08, attack: 0.002, decay: 0.02, sustain: 0.3, release: 0.06,
      volume: 0.15,
    });
  },

  /**
   * Shuffling/dealing sound at round start
   */
  shuffle() {
    if (!this.enabled || !this.ctx) return;
    // Rapid succession of tile clacks
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        this.noise({
          duration: 0.04,
          volume: 0.2,
          filterFreq: 2500 + Math.random() * 1500,
          filterQ: 2,
          filterType: 'bandpass',
        });
      }, i * 60);
    }
  },

  /**
   * Round end / game over - descending chord
   */
  roundEnd() {
    const notes = [523, 440, 349, 262]; // C A F C descending
    notes.forEach((freq, i) => {
      setTimeout(() => {
        this.tone({
          freq, type: 'sine',
          duration: 0.4, attack: 0.01, decay: 0.05, sustain: 0.4, release: 0.34,
          volume: 0.25,
        });
      }, i * 120);
    });
  },

  /**
   * Toggle sound on/off
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  },
};
