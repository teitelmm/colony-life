/**
 * Fully synthesised WebAudio sound effects — no asset files. Sounds are
 * positioned relative to the listener (camera focus) with distance
 * attenuation and stereo panning.
 */

export type SfxName =
  | 'mg_old'
  | 'mg_new'
  | 'cannon'
  | 'harpoon'
  | 'explosion'
  | 'bigExplosion'
  | 'splash'
  | 'bigSplash'
  | 'hitMetal'
  | 'hitWood'
  | 'pickup'
  | 'jam'
  | 'break'
  | 'ropeHit';

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engineOsc?: OscillatorNode;
  private engineOsc2?: OscillatorNode;
  private engineGain?: GainNode;
  private engineFilter?: BiquadFilterNode;
  private listenerX = 0;
  private listenerZ = 0;
  private recent = new Map<string, number>();
  muted = false;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(comp);

    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startAmbience();
    this.startEngine();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  setListener(x: number, z: number): void {
    this.listenerX = x;
    this.listenerZ = z;
  }

  private startAmbience(): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = c.createGain();
    g.gain.value = 0.06;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    lfo.start();
  }

  private startEngine(): void {
    const c = this.ctx!;
    this.engineOsc = c.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 40;
    this.engineOsc2 = c.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 20;
    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    const g2 = c.createGain();
    g2.gain.value = 0.4;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(g2).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();
  }

  /** Player engine drone, 0..1 load. */
  setEngine(load: number, running: boolean): void {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    const f = 38 + load * 55;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.15);
    this.engineOsc2!.frequency.setTargetAtTime(f / 2, t, 0.15);
    this.engineFilter!.frequency.setTargetAtTime(220 + load * 600, t, 0.2);
    this.engineGain!.gain.setTargetAtTime(running ? 0.05 + load * 0.07 : 0, t, 0.25);
  }

  play(name: SfxName, x = this.listenerX, z = this.listenerZ, volume = 1): void {
    if (!this.ctx || this.muted) return;
    const c = this.ctx;
    const now = c.currentTime;
    // Rate-limit identical rapid sounds (e.g. many MGs firing at once).
    const last = this.recent.get(name) ?? -1;
    const minGap = name.startsWith('mg') ? 0.03 : name === 'hitMetal' || name === 'hitWood' || name === 'splash' ? 0.04 : 0;
    if (now - last < minGap) return;
    this.recent.set(name, now);

    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    const dist = Math.hypot(dx, dz);
    const att = volume / (1 + dist / 18);
    if (att < 0.02) return;
    const pan = c.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, dx / 30));
    const out = c.createGain();
    out.gain.value = att;
    out.connect(pan).connect(this.master);
    // Distant sounds lose their highs.
    const air = c.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 18000 / (1 + dist / 25);
    air.connect(out);
    const dest = air;

    const noiseBurst = (dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.002, freqEnd?: number) => {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, now);
      if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, now + dur);
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain, now + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      s.connect(f).connect(g).connect(dest);
      s.start(now, Math.random() * 1.5);
      s.stop(now + dur + 0.05);
    };
    const tone = (dur: number, type: OscillatorType, f0: number, f1: number, gain: number) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g).connect(dest);
      o.start(now);
      o.stop(now + dur + 0.02);
    };

    switch (name) {
      case 'mg_old':
        noiseBurst(0.13, 'bandpass', 1400, 0.8, 0.9);
        tone(0.08, 'square', 160, 60, 0.25);
        break;
      case 'mg_new':
        noiseBurst(0.09, 'bandpass', 2200, 1, 0.8);
        tone(0.05, 'triangle', 220, 90, 0.2);
        break;
      case 'cannon':
        noiseBurst(1.4, 'lowpass', 900, 0.5, 1.2, 0.003, 120);
        tone(0.9, 'sine', 95, 28, 1.0);
        noiseBurst(0.25, 'highpass', 2500, 0.5, 0.4);
        break;
      case 'harpoon':
        tone(0.35, 'sawtooth', 320, 90, 0.25);
        noiseBurst(0.3, 'bandpass', 900, 2, 0.4, 0.01, 300);
        break;
      case 'explosion':
        noiseBurst(1.6, 'lowpass', 1400, 0.4, 1.3, 0.004, 80);
        tone(1.0, 'sine', 70, 22, 1.1);
        break;
      case 'bigExplosion':
        noiseBurst(2.8, 'lowpass', 1800, 0.4, 1.6, 0.005, 60);
        tone(1.8, 'sine', 55, 18, 1.4);
        noiseBurst(1.2, 'bandpass', 3000, 0.6, 0.35, 0.3);
        break;
      case 'splash':
        noiseBurst(0.35, 'bandpass', 2600, 0.8, 0.35, 0.005, 900);
        break;
      case 'bigSplash':
        noiseBurst(1.3, 'bandpass', 1200, 0.5, 0.9, 0.02, 350);
        noiseBurst(1.8, 'highpass', 3500, 0.5, 0.25, 0.15);
        break;
      case 'hitMetal':
        tone(0.25, 'sine', 1400 + Math.random() * 1600, 900, 0.18);
        noiseBurst(0.06, 'highpass', 3000, 0.7, 0.5);
        break;
      case 'hitWood':
        noiseBurst(0.12, 'lowpass', 900, 1.5, 0.8);
        tone(0.08, 'triangle', 180, 90, 0.3);
        break;
      case 'break':
        noiseBurst(0.7, 'lowpass', 700, 0.7, 1, 0.01, 150);
        tone(0.5, 'sawtooth', 110, 40, 0.3);
        break;
      case 'pickup':
        tone(0.12, 'triangle', 660, 880, 0.3);
        setTimeout(() => this.ctx && tone(0.18, 'triangle', 990, 1320, 0.25), 70);
        break;
      case 'jam':
        tone(0.1, 'square', 300, 200, 0.2);
        noiseBurst(0.08, 'highpass', 2000, 1, 0.4);
        break;
      case 'ropeHit':
        tone(0.2, 'sawtooth', 140, 60, 0.35);
        noiseBurst(0.15, 'lowpass', 1200, 1, 0.6);
        break;
    }
  }
}
