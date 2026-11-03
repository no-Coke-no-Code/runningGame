// ============================================================
// StreetFire Runner —— 纯 Canvas 横版跑酷（无第三方依赖）
// 设计：波普风街头跑酷，收集品牌胶囊、躲避路障（消防栓/路锥）
// 物理：重力 + 跳跃 + 地面滚动；碰撞用 AABB
// ============================================================

export interface RunnerTheme {
  bg: string;
  bgAlt: string;
  ground: string;
  ink: string;
  yellow: string;
  magenta: string;
  red: string;
  blue: string;
  cyan: string;
  cream: string;
}

export type RunnerState = "ready" | "playing" | "paused" | "over";

export interface RunnerStats {
  state: RunnerState;
  score: number; // 距离得分
  coins: number; // 收集的品牌胶囊数
  speed: number; // 当前滚动速度 px/s
  best: number; // 历史最高分（localStorage）
  powerups: { kind: string; remain: number }[]; // 道具状态（2D 模式恒为空，3D 模式填充）
}

const GROUND_H = 96; // 地面高度
const GRAVITY = 2600; // 重力加速度 px/s^2
const JUMP_V = 980; // 起跳初速度
const START_SPEED = 360; // 起始速度
const MAX_SPEED = 760;
const SPEED_RAMP = 7.5; // 每秒加速
const SPAWN_GAP = [620, 1050] as const; // 障碍物/金币生成间距随机区间
const BEST_KEY = "streetfire_runner_best";

// 路障类型
type ObstacleKind = "cone" | "hydrant";
// 收集物
type PickupKind = "capsule";

interface Entity {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: ObstacleKind | PickupKind;
  // 用于动画
  t: number;
}

export class RunnerGame {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private theme: RunnerTheme;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private raf = 0;
  private lastTs = 0;
  private acc = 0; // 障碍物生成累加距离
  private nextGap = 0;
  private obstacles: Entity[] = [];
  private pickups: Entity[] = [];
  private particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  private player = { x: 120, y: 0, w: 46, h: 64, vy: 0, onGround: true, runT: 0 };
  private stats: RunnerStats;
  private hillOffset = 0;

  // 事件回调：jump / pickup / crash / move，供外部接入音效
  onEvent: ((type: "jump" | "pickup" | "crash" | "move") => void) | null = null;

  constructor(canvas: HTMLCanvasElement, theme: RunnerTheme) {
    this.canvas = canvas;
    this.theme = theme;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.stats = {
      state: "ready",
      score: 0,
      coins: 0,
      speed: START_SPEED,
      best: Number(localStorage.getItem(BEST_KEY) || 0),
      powerups: [],
    };
    this.resize();
  }

  // 监听主题变化
  setTheme(theme: RunnerTheme) {
    this.theme = theme;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.player.y === 0) this.player.y = this.height - GROUND_H - this.player.h;
  }

  getStats() {
    return this.stats;
  }

  start() {
    this.reset();
    this.stats.state = "playing";
    this.lastTs = performance.now();
    this.loop(this.lastTs);
  }

  private reset() {
    this.obstacles = [];
    this.pickups = [];
    this.particles = [];
    this.acc = 0;
    this.nextGap = 500;
    this.player.y = this.height - GROUND_H - this.player.h;
    this.player.vy = 0;
    this.player.onGround = true;
    this.player.runT = 0;
    this.stats.score = 0;
    this.stats.coins = 0;
    this.stats.speed = START_SPEED;
  }

  pause() {
    if (this.stats.state !== "playing") return;
    this.stats.state = "paused";
    cancelAnimationFrame(this.raf);
  }

  resume() {
    if (this.stats.state !== "paused") return;
    this.stats.state = "playing";
    this.lastTs = performance.now();
    this.loop(this.lastTs);
  }

  // 跳跃：空格 / 点击 / 上箭头
  jump() {
    if (this.stats.state === "ready") {
      this.start();
      return;
    }
    if (this.stats.state === "over") {
      this.start();
      return;
    }
    if (this.stats.state === "paused") {
      this.resume();
      return;
    }
    if (this.stats.state === "playing" && this.player.onGround) {
      this.player.vy = -JUMP_V;
      this.player.onGround = false;
      this.onEvent?.("jump");
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  private loop = (ts: number) => {
    const dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;
    this.update(dt);
    this.draw();
    if (this.stats.state === "playing" || this.stats.state === "paused") {
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  private update(dt: number) {
    if (this.stats.state !== "playing") return;

    // 加速
    this.stats.speed = Math.min(MAX_SPEED, this.stats.speed + SPEED_RAMP * dt);
    const dist = this.stats.speed * dt;
    this.stats.score += dist * 0.02;

    // 玩家物理
    this.player.runT += dt;
    if (!this.player.onGround) {
      this.player.vy += GRAVITY * dt;
      this.player.y += this.player.vy * dt;
      const floor = this.height - GROUND_H - this.player.h;
      if (this.player.y >= floor) {
        this.player.y = floor;
        this.player.vy = 0;
        this.player.onGround = true;
      }
    }

    // 背景视差
    this.hillOffset = (this.hillOffset + dist * 0.3) % this.width;

    // 生成障碍/金币
    this.acc += dist;
    if (this.acc >= this.nextGap) {
      this.acc = 0;
      this.nextGap =
        SPAWN_GAP[0] + Math.random() * (SPAWN_GAP[1] - SPAWN_GAP[0]);
      this.spawn();
    }

    // 移动 & 回收
    const move = (e: Entity) => {
      e.x -= dist;
      e.t += dt;
    };
    this.obstacles.forEach(move);
    this.pickups.forEach(move);
    this.obstacles = this.obstacles.filter((e) => e.x + e.w > -40);
    this.pickups = this.pickups.filter((e) => e.x + e.w > -40);

    // 碰撞检测
    this.handleCollisions();

    // 粒子
    this.particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 1400 * dt;
      p.life -= dt;
    });
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private spawn() {
    const groundY = this.height - GROUND_H;
    // 障碍
    const isObstacle = Math.random() < 0.62;
    if (isObstacle) {
      const kind: ObstacleKind = Math.random() < 0.5 ? "cone" : "hydrant";
      const w = kind === "cone" ? 40 : 46;
      const h = kind === "cone" ? 56 : 64;
      this.obstacles.push({ x: this.width + 20, y: groundY - h, w, h, kind, t: 0 });
    }
    // 金币（胶囊）——在障碍上方/旁边，便于跳跃收集
    const n = 1 + Math.floor(Math.random() * 3);
    const baseY = groundY - 70 - Math.random() * 90;
    for (let i = 0; i < n; i++) {
      this.pickups.push({
        x: this.width + 40 + i * 46,
        y: baseY,
        w: 26,
        h: 36,
        kind: "capsule",
        t: 0,
      });
    }
  }

  private aabb(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  private handleCollisions() {
    const p = this.player;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      // 缩小碰撞盒，手感更友好
      const ob = { x: o.x + 6, y: o.y + 4, w: o.w - 12, h: o.h - 6 };
      const pb = { x: p.x + 8, y: p.y + 4, w: p.w - 14, h: p.h - 6 };
      if (this.aabb(pb, ob)) {
        // 撞到障碍不死亡：撞飞该障碍（移除）并给出音效/粒子反馈，游戏继续
        this.burst(o.x + o.w / 2, o.y + o.h / 2, this.theme.red);
        this.obstacles.splice(i, 1);
        this.onEvent?.("crash");
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const c = this.pickups[i];
      const cb = { x: c.x + 2, y: c.y + 2, w: c.w - 4, h: c.h - 4 };
      const pb = { x: p.x + 6, y: p.y + 4, w: p.w - 12, h: p.h - 6 };
      if (this.aabb(pb, cb)) {
        this.stats.coins += 1;
        this.burst(c.x + c.w / 2, c.y + c.h / 2, this.theme.yellow);
        this.pickups.splice(i, 1);
        this.onEvent?.("pickup");
      }
    }
  }

  private burst(x: number, y: number, color: string) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 200;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 100,
        life: 0.5 + Math.random() * 0.3,
        color,
      });
    }
  }

  private gameOver() {
    this.stats.state = "over";
    const final = Math.floor(this.stats.score);
    if (final > this.stats.best) {
      this.stats.best = final;
      localStorage.setItem(BEST_KEY, String(final));
    }
    cancelAnimationFrame(this.raf);
  }

  // ---------------- 绘制 ----------------
  private draw() {
    const { ctx } = this;
    const W = this.width;
    const H = this.height;
    const t = this.theme;

    // 天空
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, t.bg);
    grad.addColorStop(1, t.bgAlt);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 半调网点装饰
    this.drawHalftone(W, H, t);

    // 远处太阳（波普大圆）
    ctx.save();
    ctx.fillStyle = t.yellow;
    ctx.beginPath();
    ctx.arc(W - 150, 130, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = t.ink;
    ctx.stroke();
    ctx.restore();

    // 远景楼群（视差）
    this.drawSkyline(W, H, t);

    // 地面
    const gy = H - GROUND_H;
    ctx.fillStyle = t.ground;
    ctx.fillRect(0, gy, W, GROUND_H);
    ctx.fillStyle = t.ink;
    ctx.fillRect(0, gy, W, 6);
    // 地面波点
    ctx.fillStyle = t.cream;
    for (let x = -((this.hillOffset * 1.4) % 48); x < W; x += 48) {
      ctx.beginPath();
      ctx.arc(x, gy + 30, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 实体
    this.obstacles.forEach((o) => this.drawObstacle(o, t));
    this.pickups.forEach((c) => this.drawCapsule(c, t));
    this.drawPlayer(t);

    // 粒子
    this.particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 6, 6);
    });
    ctx.globalAlpha = 1;

    // 状态遮罩
    if (this.stats.state === "ready") this.drawCenterText("STREET RUN", "点击 / 空格 开始", t);
    if (this.stats.state === "paused") this.drawCenterText("PAUSED", "点击继续", t);
    if (this.stats.state === "over") {
      this.drawCenterText("GAME OVER", "点击重来 · 得分 " + Math.floor(this.stats.score), t);
    }
  }

  private drawHalftone(W: number, H: number, t: RunnerTheme) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = t.ink;
    const step = 22;
    for (let y = step; y < H * 0.6; y += step) {
      for (let x = ((y / step) % 2) * step; x < W; x += step * 2) {
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawSkyline(W: number, H: number, t: RunnerTheme) {
    const { ctx } = this;
    const gy = H - GROUND_H;
    const base = gy - 10;
    ctx.save();
    ctx.globalAlpha = 0.5;
    const off = this.hillOffset;
    const buildings = [60, 110, 80, 140, 90, 120, 70, 100, 130];
    const bw = 120;
    for (let i = -1; i < Math.ceil(W / bw) + 1; i++) {
      const idx = ((i % buildings.length) + buildings.length) % buildings.length;
      const h = buildings[idx];
      const x = i * bw - (off % bw);
      ctx.fillStyle = i % 2 ? t.magenta : t.blue;
      ctx.fillRect(x, base - h, bw - 14, h);
      ctx.fillStyle = t.cream;
      for (let wy = base - h + 14; wy < base - 14; wy += 22) {
        for (let wx = x + 10; wx < x + bw - 24; wx += 22) {
          ctx.fillRect(wx, wy, 8, 12);
        }
      }
    }
    ctx.restore();
  }

  private drawPlayer(t: RunnerTheme) {
    const { ctx } = this;
    const p = this.player;
    ctx.save();
    // 影子
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, this.height - GROUND_H + 4, p.w / 2, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // 身体（胶囊人）— 波普粗描边
    const legSwing = p.onGround ? Math.sin(p.runT * 18) * 6 : 0;
    ctx.fillStyle = t.red;
    ctx.strokeStyle = t.ink;
    ctx.lineWidth = 4;
    // 躯干
    const bx = p.x + 6;
    const by = p.y + 18;
    this.roundRect(bx, by, p.w - 12, p.h - 30, 10);
    ctx.fill();
    ctx.stroke();
    // 头
    ctx.fillStyle = t.yellow;
    this.circle(p.x + p.w / 2, p.y + 12, 12);
    ctx.fill();
    ctx.stroke();
    // 腿
    ctx.strokeStyle = t.ink;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(p.x + p.w / 2 - 6, p.y + p.h - 12);
    ctx.lineTo(p.x + p.w / 2 - 6 + legSwing, p.y + p.h);
    ctx.moveTo(p.x + p.w / 2 + 6, p.y + p.h - 12);
    ctx.lineTo(p.x + p.w / 2 + 6 - legSwing, p.y + p.h);
    ctx.stroke();
    ctx.restore();
  }

  private drawObstacle(o: Entity, t: RunnerTheme) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = t.ink;
    ctx.lineWidth = 4;
    if (o.kind === "cone") {
      ctx.fillStyle = t.magenta;
      ctx.beginPath();
      ctx.moveTo(o.x + o.w / 2, o.y);
      ctx.lineTo(o.x + o.w, o.y + o.h);
      ctx.lineTo(o.x, o.y + o.h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = t.cream;
      ctx.fillRect(o.x + o.w * 0.3, o.y + o.h * 0.4, o.w * 0.4, 8);
    } else {
      // 消防栓
      ctx.fillStyle = t.red;
      this.roundRect(o.x + 6, o.y + 14, o.w - 12, o.h - 14, 6);
      ctx.fill();
      ctx.stroke();
      this.circle(o.x + o.w / 2, o.y + 12, 10);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCapsule(c: Entity, t: RunnerTheme) {
    const { ctx } = this;
    const bob = Math.sin(c.t * 4) * 3;
    ctx.save();
    ctx.translate(0, bob);
    ctx.strokeStyle = t.ink;
    ctx.lineWidth = 3;
    ctx.fillStyle = t.cyan;
    this.roundRect(c.x, c.y, c.w, c.h, c.w / 2);
    ctx.fill();
    ctx.stroke();
    // 高光
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(c.x + 6, c.y + 6, 4, c.h - 12);
    ctx.restore();
  }

  private drawCenterText(title: string, sub: string, t: RunnerTheme) {
    const { ctx } = this;
    const W = this.width;
    const H = this.height;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = t.yellow;
    ctx.strokeStyle = t.ink;
    ctx.lineWidth = 6;
    ctx.font = `900 56px ${"'Anton', 'Archivo Black', sans-serif"}`;
    ctx.strokeText(title, W / 2, H / 2 - 10);
    ctx.fillText(title, W / 2, H / 2 - 10);
    ctx.fillStyle = t.cream;
    ctx.font = `700 22px 'Poppins', sans-serif`;
    ctx.fillText(sub, W / 2, H / 2 + 36);
    ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  private circle(x: number, y: number, r: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
  }
}
