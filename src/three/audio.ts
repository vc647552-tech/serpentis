import { GamePhase, PreyKind, SnakeSpecies } from '../game/types';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windActive = false;

  private muted = false;
  private volume = 0.75;

  private slitherAccum = 0;
  private birdAccum = 1.6;
  private cricketAccum = 0.8;
  private rattleAccum = 0;
  private hissCooldown = 0;

  private ensureContext(): { ctx: AudioContext; gain: GainNode } | null {
    if (this.muted || this.volume <= 0.01 || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.buildPinkNoiseBuffer(this.ctx, 3.0);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    if (!this.windActive && this.ctx && this.masterGain && this.noiseBuffer) {
      this.startAmbientWind(this.ctx, this.masterGain, this.noiseBuffer);
    }
    return this.masterGain ? { ctx: this.ctx, gain: this.masterGain } : null;
  }

  private buildPinkNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  private startAmbientWind(ctx: AudioContext, master: GainNode, buf: AudioBuffer): void {
    this.windActive = true;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 310;
    filter.Q.value = 0.95;

    const gain = ctx.createGain();
    gain.gain.value = 0.045;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();

    this.windSource = src;
    this.windFilter = filter;
    this.windGain = gain;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public updateSoundscape(
    dt: number,
    phase: GamePhase,
    speed: number,
    isBoosting: boolean,
    species: SnakeSpecies,
    nearPrey: boolean,
    elapsed: number,
  ): void {
    if (!this.ctx || !this.masterGain || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Modulate forest canopy breeze gently
    if (this.windFilter && this.windGain) {
      const breeze = 260 + Math.sin(elapsed * 0.35) * 95 + (isBoosting ? 120 : 0);
      this.windFilter.frequency.setTargetAtTime(breeze, now, 0.2);
      this.windGain.gain.setTargetAtTime(phase === 'playing' ? 0.055 : 0.032, now, 0.25);
    }

    // Distant woodland birdsong
    this.birdAccum -= dt;
    if (this.birdAccum <= 0) {
      this.birdAccum = 2.6 + Math.random() * 4.5;
      this.playBirdChirp();
    }

    // Forest cricket/cicada chirps
    this.cricketAccum -= dt;
    if (this.cricketAccum <= 0) {
      this.cricketAccum = 1.8 + Math.random() * 3.2;
      this.playCricketTrill();
    }

    if (phase !== 'playing') return;

    // Realistic grass/leaf slither brush synced to snake cadence
    this.slitherAccum -= dt * (speed / 5.5);
    if (this.slitherAccum <= 0) {
      this.slitherAccum = isBoosting ? 0.16 : 0.25;
      this.playSlitherRustle(isBoosting);
    }

    // Rattlesnake tail rattle when sprinting or hunting
    if (species === 'rattler' && (isBoosting || nearPrey)) {
      this.rattleAccum -= dt;
      if (this.rattleAccum <= 0) {
        this.rattleAccum = isBoosting ? 0.11 : 0.22;
        this.playRattleTick();
      }
    }

    // Snake warning hiss on lunging close to prey
    this.hissCooldown = Math.max(0, this.hissCooldown - dt);
    if (nearPrey && this.hissCooldown <= 0) {
      this.hissCooldown = 2.4;
      this.playHiss();
    }
  }

  private playBirdChirp(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const base = 1950 + Math.random() * 1150;
    const notes = 2 + Math.floor(Math.random() * 2);

    for (let i = 0; i < notes; i++) {
      const t = now + i * 0.11;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * (1 + i * 0.08), t);
      osc.frequency.exponentialRampToValueAtTime(base * (1.28 + Math.random() * 0.18), t + 0.055);
      osc.frequency.exponentialRampToValueAtTime(base * 0.92, t + 0.09);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.022, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  private playCricketTrill(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const freq = 4150 + Math.random() * 450;
    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.042;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.012, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.035);
    }
  }

  private playSlitherRustle(isBoosting: boolean): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime((isBoosting ? 1850 : 1250) + Math.random() * 420, now);
    filter.Q.value = 1.4;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(isBoosting ? 0.052 : 0.026, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, Math.random() * 1.8, 0.2);
  }

  private playRattleTick(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 4600;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, Math.random() * 1.5, 0.085);
  }

  public playHiss(): void {
    const audio = this.ensureContext();
    if (!audio || !this.noiseBuffer) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3400, now);
    filter.frequency.exponentialRampToValueAtTime(1900, now + 0.34);
    filter.Q.value = 1.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.085, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(now, Math.random() * 1.2, 0.38);
  }

  public playStart(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;

    const now = ctx.currentTime;
    const notes = [220, 277.18, 329.63, 440];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.055);
      gain.gain.setValueAtTime(0.0001, now + i * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.055 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.055 + 0.35);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.36);
    });
    this.playHiss();
  }

  public playUiClick(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.06);
    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playEat(kind: PreyKind, combo: number): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;

    const now = ctx.currentTime;
    const jitter = 0.94 + Math.random() * 0.12;
    const baseFreq =
      (kind === 'elephant'
        ? 180
        : kind === 'boar'
          ? 250
          : kind === 'deer'
            ? 320
            : kind === 'rabbit'
              ? 540
              : kind === 'mouse'
                ? 620
                : kind === 'frog'
                  ? 460
                  : kind === 'berry'
                    ? 390
                    : 340) *
      (1 + Math.min(combo, 6) * 0.05) *
      jitter;

    // Crunchy organic strike foley
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.11, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(now, Math.random(), 0.1);
    }

    const snap = ctx.createOscillator();
    const snapGain = ctx.createGain();
    snap.type = 'triangle';
    snap.frequency.setValueAtTime(baseFreq * 1.35, now);
    snap.frequency.exponentialRampToValueAtTime(baseFreq * 0.55, now + 0.1);
    snapGain.gain.setValueAtTime(0.13, now);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    snap.connect(snapGain);
    snapGain.connect(master);
    snap.start(now);
    snap.stop(now + 0.13);

    const chime = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(baseFreq, now + 0.03);
    chime.frequency.exponentialRampToValueAtTime(baseFreq * 1.25, now + 0.18);
    chimeGain.gain.setValueAtTime(0.0001, now + 0.03);
    chimeGain.gain.exponentialRampToValueAtTime(0.09, now + 0.055);
    chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    chime.connect(chimeGain);
    chimeGain.connect(master);
    chime.start(now + 0.03);
    chime.stop(now + 0.28);
  }

  public playCrash(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;

    const now = ctx.currentTime;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(145, now);
    sub.frequency.exponentialRampToValueAtTime(36, now + 0.38);
    subGain.gain.setValueAtTime(0.24, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(85, now + 0.36);

    sub.connect(filter);
    filter.connect(subGain);
    subGain.connect(master);
    sub.start(now);
    sub.stop(now + 0.42);

    // Timber/earth impact noise burst
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 650;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.22, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      src.connect(lp);
      lp.connect(ng);
      ng.connect(master);
      src.start(now, 0, 0.28);
    }
  }

  public playLayEgg(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(135, now + 0.18);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.09, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playHatch(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    // Crisp shell crackle burst
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.11, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(master);
      src.start(now, Math.random(), 0.12);
    }

    // Bright ascending hatchling chime
    const notes = [440, 554.37, 659.25];
    notes.forEach((f, idx) => {
      const t = now + 0.04 + idx * 0.055;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.085, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  public playTelegraphHorn(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.2);
    lp.type = 'lowpass';
    lp.frequency.value = 950;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.07, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(lp);
    lp.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playHurt(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(195, now);
    osc.frequency.exponentialRampToValueAtTime(68, now + 0.22);
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playVillagerHit(killed: boolean): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(killed ? 340 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(killed ? 140 : 185, now + 0.14);
    g.gain.setValueAtTime(killed ? 0.14 : 0.08, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playVenomSpit(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(4200, now);
      bp.frequency.exponentialRampToValueAtTime(1600, now + 0.24);
      bp.Q.value = 1.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(master);
      src.start(now, Math.random() * 0.8, 0.28);
    }

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.18);
    g.gain.setValueAtTime(0.09, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  public playShockwave(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(170, now);
    sub.frequency.exponentialRampToValueAtTime(42, now + 0.36);
    sg.gain.setValueAtTime(0.24, now);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    sub.connect(sg);
    sg.connect(master);
    sub.start(now);
    sub.stop(now + 0.4);

    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.setValueAtTime(2800, now);
      hp.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.14, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      src.connect(hp);
      hp.connect(ng);
      ng.connect(master);
      src.start(now, Math.random(), 0.24);
    }
  }

  public playStealth(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    const notes = [520, 680, 920];
    notes.forEach((f, idx) => {
      const t = now + idx * 0.045;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.22);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.065, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  public playTailWhip(latched: boolean): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(latched ? 2200 : 1400, now);
      bp.frequency.exponentialRampToValueAtTime(620, now + 0.16);
      bp.Q.value = 1.6;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(latched ? 0.16 : 0.09, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(master);
      src.start(now, Math.random(), 0.18);
    }

    if (latched) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(240, now + 0.03);
      osc.frequency.exponentialRampToValueAtTime(460, now + 0.19);
      g.gain.setValueAtTime(0.11, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.21);
      osc.connect(g);
      g.connect(master);
      osc.start(now + 0.03);
      osc.stop(now + 0.22);
    }
  }

  public playDevour(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(210, now);
    sub.frequency.exponentialRampToValueAtTime(75, now + 0.24);
    sg.gain.setValueAtTime(0.2, now);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    sub.connect(sg);
    sg.connect(master);
    sub.start(now);
    sub.stop(now + 0.27);

    const chime = ctx.createOscillator();
    const cg = ctx.createGain();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(480, now + 0.05);
    chime.frequency.exponentialRampToValueAtTime(720, now + 0.22);
    cg.gain.setValueAtTime(0.0001, now + 0.05);
    cg.gain.exponentialRampToValueAtTime(0.11, now + 0.08);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    chime.connect(cg);
    cg.connect(master);
    chime.start(now + 0.05);
    chime.stop(now + 0.29);
  }

  public playBloodDrink(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    // Sharp fang puncture + warm crimson drain pulse
    const fang = ctx.createOscillator();
    const fg = ctx.createGain();
    fang.type = 'sawtooth';
    fang.frequency.setValueAtTime(520, now);
    fang.frequency.exponentialRampToValueAtTime(160, now + 0.14);
    fg.gain.setValueAtTime(0.11, now);
    fg.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    fang.connect(fg);
    fg.connect(master);
    fang.start(now);
    fang.stop(now + 0.17);

    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2100;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.09, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(master);
      src.start(now, Math.random() * 0.5, 0.15);
    }
  }

  public playRivalHorn(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, gain: master } = audio;
    const now = ctx.currentTime;

    const freqs = [185, 246.94];
    freqs.forEach((f, idx) => {
      const t = now + idx * 0.14;
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.08, t + 0.28);
      lp.type = 'lowpass';
      lp.frequency.value = 780;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(lp);
      lp.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.34);
    });
  }

  public dispose(): void {
    if (this.windSource) {
      try {
        this.windSource.stop();
      } catch {
        // Ignore already stopped
      }
      this.windSource = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
      this.masterGain = null;
    }
  }
}
