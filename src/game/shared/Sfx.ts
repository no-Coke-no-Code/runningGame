// ============================================================
// StreetFire 音效与背景音乐管理器
// 完全基于 Web Audio API 程序化合成，无需任何外部音频文件。
// 设计：街头电子风 —— 跳跃(上扬 blip)、吃方块(爽快打击)、碰撞(噪声爆裂)，
// 背景音乐(循环合成器 bassline + hi-hat + kick，驱动速度感)。
// ============================================================

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private muted = false;
  private musicOn = false;

  // 浏览器要求音频在用户手势后才能启动
  unlock() {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        m ? 0 : 0.9,
        this.ctx.currentTime,
        0.02
      );
    }
  }

  // ---------------- 音效 ----------------

  playJump() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "square";
    // 上扬扫频，体现弹跳
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  playPickup() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    // 双音上行 + 短噪声拍击，爽快碰撞感
    [660, 990].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "triangle";
      const st = t + i * 0.05;
      osc.frequency.setValueAtTime(f, st);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.55, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.12);
      osc.connect(g).connect(this.sfxGain!);
      osc.start(st);
      osc.stop(st + 0.14);
    });
    // 噪声拍击（"啪"）
    this.noiseBurst(t, 0.08, 0.35, 1200);
  }

  playCrash() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    // 低频砸击
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.42);
    // 噪声爆裂（撞击碎片）
    this.noiseBurst(t, 0.35, 0.6, 800);
  }

  // 左右变道：轻巧短促的"嗖"声，音量偏弱，增强交互反馈
  playMove() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.06);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); // 偏弱
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  private noiseBurst(t: number, dur: number, vol: number, cutoff: number) {
    if (!this.ctx || !this.sfxGain) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur);
  }

  // ---------------- 背景音乐 ----------------

  startMusic() {
    if (!this.ctx || !this.musicGain) return;
    if (this.musicOn) return;
    this.musicOn = true;
    this.musicStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    // 16 分音符步进，约 140 BPM
    const stepDur = 60 / 140 / 4;
    const scheduler = () => {
      if (!this.ctx || !this.musicOn) return;
      while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
        this.scheduleStep(this.musicStep, this.nextNoteTime);
        this.nextNoteTime += stepDur;
        this.musicStep = (this.musicStep + 1) % 16;
      }
      this.musicTimer = window.setTimeout(scheduler, 25);
    };
    scheduler();
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  // 小调 bassline（A 小调氛围），街头低调律动
  private bassPattern = [
    55, 0, 55, 0, 82.4, 0, 55, 0,
    73.4, 0, 73.4, 0, 65.4, 0, 49, 0,
  ];

  private scheduleStep(step: number, time: number) {
    if (!this.ctx || !this.musicGain) return;
    // 底鼓：每拍（每 4 个 16 分）
    if (step % 4 === 0) this.kick(time);
    // hi-hat：每个 8 分
    if (step % 2 === 0) this.hat(time, 0.06);
    else this.hat(time, 0.03);
    // bassline
    const f = this.bassPattern[step];
    if (f > 0) this.bass(time, f);
  }

  private kick(time: number) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    g.gain.setValueAtTime(0.9, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    osc.connect(g).connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private hat(time: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    const len = Math.floor(this.ctx.sampleRate * 0.05);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    src.connect(filter).connect(g).connect(this.musicGain);
    src.start(time);
    src.stop(time + 0.05);
  }

  private bass(time: number, freq: number) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, time);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.4, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(filter).connect(g).connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.24);
  }

  destroy() {
    this.stopMusic();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
