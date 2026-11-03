<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RunnerGame } from "@/game/engine2d/RunnerGame";
import { themeFor } from "@/game/engine2d/themes";
import { ThreeRunner } from "@/game/engine3d/ThreeRunner";
import { theme3DFor } from "@/game/engine3d/themes3d";
import { useTheme } from "@/composables/useTheme";
import { Sfx } from "@/game/shared/Sfx";

const { theme } = useTheme();
// 2D 与 3D 使用各自独立的 canvas，避免同一 canvas 重复获取不同类型的 context
const canvas2dRef = ref<HTMLCanvasElement>();
const canvas3dRef = ref<HTMLCanvasElement>();
const stageRef = ref<HTMLElement>();
const mode = ref<"2d" | "3d">("3d");
const sceneMode = ref<"street" | "metro">("street");

const game2d = ref<RunnerGame>();
const game3d = ref<ThreeRunner>();
const active = computed(() =>
  mode.value === "3d" ? game3d.value : game2d.value
);

const score = ref(0);
const coins = ref(0);
const best = ref(0);
const speedKmh = ref(0);
const vignette = ref(0); // 高速暗角强度 0~1
const state = ref<"ready" | "playing" | "paused" | "over">("ready");
// 道具 HUD：当前生效的道具及剩余秒数（由引擎 getStats 同步）
const activePowerups = ref<{ kind: string; remain: number }[]>([]);
const POWERUP_META: Record<string, { label: string; color: string; icon: string }> = {
  magnet: { label: "磁铁", color: "#16d1c4", icon: "🧲" },
  shield: { label: "护盾", color: "#ffd23a", icon: "🛡️" },
  invincible: { label: "无敌", color: "#ff3da6", icon: "⚡" },
};
const muted = ref(false);
let syncTimer = 0;

// 音效与背景音乐管理器（基于 Web Audio 程序化合成，无需音频文件）
const sfx = new Sfx();

// 引擎事件 → 音效：跳跃 / 吃方块 / 碰撞 / 左右移动
function handleEngineEvent(type: "jump" | "pickup" | "crash" | "move") {
  if (type === "jump") sfx.playJump();
  else if (type === "pickup") sfx.playPickup();
  else if (type === "crash") sfx.playCrash();
  else if (type === "move") sfx.playMove();
}

// 首次用户手势解锁音频并视状态播放 BGM
function ensureAudio() {
  sfx.unlock();
  if (!muted.value && state.value === "playing") sfx.startMusic();
}

function toggleMute() {
  muted.value = !muted.value;
  sfx.setMuted(muted.value);
  if (muted.value) sfx.stopMusic();
  else if (state.value === "playing") sfx.startMusic();
}

function sync() {
  const g = active.value;
  if (!g) return;
  const s = g.getStats();
  score.value = Math.floor(s.score);
  coins.value = s.coins;
  best.value = s.best;
  // 3D 速度范围约 16~36 → 映射成 90~210 km/h 的观感
  speedKmh.value = mode.value === "3d" ? Math.round(60 + s.speed * 4.2) : 0;
  // 暗角：速度超过 60% 后逐渐增强，最高约 0.85
  const ratio = mode.value === "3d" ? (s.speed - 16) / (36 - 16) : 0;
  vignette.value = Math.max(0, Math.min(0.85, ((ratio - 0.6) / 0.4) * 0.85));
  state.value = s.state;
  // 道具状态：仅 3D 模式有道具系统（2D 引擎 RunnerStats 不含 powerups）
  activePowerups.value =
    mode.value === "3d" ? (g as ThreeRunner).getStats().powerups ?? [] : [];
}

// 惰性创建当前模式的引擎（仅在该 canvas 挂载后）
function ensureActive() {
  if (mode.value === "3d") {
    if (!game3d.value && canvas3dRef.value) {
      game3d.value = new ThreeRunner(
        canvas3dRef.value,
        theme3DFor(theme.value as "light" | "dark")
      );
      game3d.value.onEvent = handleEngineEvent;
      // 同步当前选中的场景到引擎，避免依赖两侧默认值恰好一致
      game3d.value.setSceneMode(sceneMode.value);
    }
  } else {
    if (!game2d.value && canvas2dRef.value) {
      game2d.value = new RunnerGame(
        canvas2dRef.value,
        themeFor(theme.value as "light" | "dark")
      );
      game2d.value.onEvent = handleEngineEvent;
    }
  }
  sync();
  if (!syncTimer) syncTimer = window.setInterval(sync, 100);
}

function startCurrent() {
  if (mode.value === "3d") game3d.value?.jump();
  else game2d.value?.jump();
}

function onPointer() {
  ensureAudio(); // 用户手势解锁音频
  active.value?.jump();
}

function onKey(e: KeyboardEvent) {
  if (e.code === "Space" || e.key === " ") {
    // 空格：暂停 / 开始（含结束后重开）切换
    e.preventDefault();
    primaryAction();
  } else if (e.code === "ArrowUp") {
    // 上箭头：跳跃
    e.preventDefault();
    active.value?.jump();
  } else if (e.code === "KeyP" || e.code === "Escape") {
    // 暂停 / 继续（仅在进行或已暂停时有效）
    e.preventDefault();
    togglePause();
  } else if (e.code === "ArrowLeft" || e.code === "KeyA") {
    e.preventDefault();
    game3d.value?.moveLeft();
  } else if (e.code === "ArrowRight" || e.code === "KeyD") {
    e.preventDefault();
    game3d.value?.moveRight();
  } else if (e.code === "KeyW") {
    e.preventDefault();
    active.value?.jump();
  }
}

// 切换暂停：进行中→暂停，已暂停→继续
function togglePause() {
  const r = active.value as any;
  if (!r || typeof r.pause !== "function" || typeof r.resume !== "function")
    return;
  if (state.value === "playing") r.pause();
  else if (state.value === "paused") r.resume();
}

// 空格主操作：进行中→暂停；暂停→继续；未开始/结束后→开始
function primaryAction() {
  ensureAudio(); // 用户手势解锁音频
  const r = active.value as any;
  if (!r) return;
  if (state.value === "playing") r.pause?.();
  else if (state.value === "paused") r.resume?.();
  else r.jump?.();
}

// 全屏游玩：进入/退出浏览器全屏（需用户手势触发）
const isFullscreen = ref(false);
function onFsChange() {
  isFullscreen.value = !!document.fullscreenElement;
  // 全屏尺寸变化后让 canvas 重新适配
  onResize();
}
function toggleFullscreen() {
  const el = stageRef.value;
  if (!el) return;
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    el.requestFullscreen?.();
  }
}

// 切换模式：销毁旧引擎、创建新引擎（各自独立 canvas，context 类型不冲突）
function switchMode(m: "2d" | "3d") {
  if (m === mode.value) return;
  active.value?.destroy();
  if (mode.value === "3d") game3d.value = undefined;
  else game2d.value = undefined;
  mode.value = m;
  requestAnimationFrame(() => {
    ensureActive();
    startCurrent();
  });
}

// 切换场景：街头 / 地铁
function switchScene(m: "street" | "metro") {
  if (m === sceneMode.value) return;
  sceneMode.value = m;
  game3d.value?.setSceneMode(m);
}

function onResize() {
  active.value?.resize();
}

onMounted(() => {
  ensureActive();
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  document.addEventListener("fullscreenchange", onFsChange);
});

onBeforeUnmount(() => {
  window.clearInterval(syncTimer);
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("fullscreenchange", onFsChange);
  game2d.value?.destroy();
  game3d.value?.destroy();
  sfx.destroy();
});

watch(theme, (m) => {
  game2d.value?.setTheme(themeFor(m as "light" | "dark"));
  game3d.value?.setTheme(theme3DFor(m as "light" | "dark"));
});

// 游戏状态变化 → 控制背景音乐：进行中播放，暂停/结束停止
watch(state, (s) => {
  if (s === "playing" && !muted.value) sfx.startMusic();
  else sfx.stopMusic();
});

const statusText = computed(() => {
  switch (state.value) {
    case "ready":
      return "点击 / 空格 开始";
    case "playing":
      return "奔跑中…";
    case "paused":
      return "已暂停";
    case "over":
      return "撞到了！点击重来";
  }
});
</script>

<template>
  <div class="game-page">
    <!-- 顶部信息条 -->
    <div class="game-hud">
      <div class="game-hud-group game-hud-group--left">
        <div class="game-hud-title">STREET RUN</div>
        <div class="game-hud-stats">
          <span class="stat stat--best"
            >最高 <b>{{ best }}</b></span
          >
        </div>
      </div>
      <div class="game-hud-group game-hud-group--right">
        <div class="game-mode-switch">
          <button :class="{ active: mode === '3d' }" @click="switchMode('3d')">
            3D
          </button>
          <button :class="{ active: mode === '2d' }" @click="switchMode('2d')">
            2D
          </button>
        </div>
        <div class="game-scene-switch" v-if="mode === '3d'">
          <button
            :class="{ active: sceneMode === 'street' }"
            @click="switchScene('street')"
          >
            街头
          </button>
          <button
            :class="{ active: sceneMode === 'metro' }"
            @click="switchScene('metro')"
          >
            地铁
          </button>
        </div>
        <div class="game-hud-actions">
          <button class="game-pause-btn" @click="toggleMute">
            {{ muted ? "🔇" : "🔊" }}
          </button>
          <button
            class="game-pause-btn"
            v-if="state === 'playing' || state === 'paused'"
            @click="togglePause"
          >
            {{ state === "paused" ? "继续" : "暂停" }}
          </button>
          <button class="game-pause-btn" @click="toggleFullscreen">
            {{ isFullscreen ? "退出" : "全屏" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 画布区：2D / 3D 各自独立 canvas，避免 context 类型冲突 -->
    <div
      class="game-stage"
      ref="stageRef"
      :class="{ 'is-over': state === 'over' }"
    >
      <canvas
        v-if="mode === '2d'"
        ref="canvas2dRef"
        class="game-canvas"
        @pointerdown="onPointer"
      />
      <canvas
        v-else
        ref="canvas3dRef"
        class="game-canvas"
        @pointerdown="onPointer"
      />

      <!-- 游戏内 HUD 叠层：始终显示在画布内（全屏时也能看到分数/速度/胶囊） -->
      <div class="game-inner-hud" v-if="state !== 'ready'">
        <div class="ihud-group ihud-group--top">
          <span class="ihud ihud--score"
            ><b>{{ score }}</b> 分</span
          >
          <span class="ihud ihud--coin"
            ><b>{{ coins }}</b> 🪙</span
          >
        </div>
        <span class="ihud ihud--speed" v-if="mode === '3d'">
          <b>{{ speedKmh }}</b> <i class="ihud--unit">km/h</i>
        </span>
        <!-- 道具生效提示 + 倒计时条 -->
        <div class="ihud-powerups" v-if="mode === '3d'">
          <div
            v-for="p in activePowerups"
            :key="p.kind"
            class="pw-bar"
            :style="{ '--pw-color': POWERUP_META[p.kind]?.color }"
          >
            <span class="pw-icon">{{ POWERUP_META[p.kind]?.icon }}</span>
            <span class="pw-label">{{ POWERUP_META[p.kind]?.label }}</span>
            <span class="pw-time">{{ p.remain.toFixed(1) }}s</span>
            <span class="pw-track"
              ><span
                class="pw-fill"
                :style="{
                  width: Math.max(0, Math.min(100, (p.remain / 10) * 100)) + '%',
                }"
              ></span
            ></span>
          </div>
        </div>
      </div>

      <!-- 高速暗角（vignette） -->
      <div
        class="game-vignette"
        :class="{ 'is-hot': vignette > 0.6 }"
        :style="{ opacity: vignette }"
        v-if="mode === '3d'"
      ></div>

      <!-- 开场宣传画（未开始时显示，取代空白） -->
      <div
        class="game-poster"
        v-if="state === 'ready'"
        @pointerdown="onPointer"
      >
        <div class="poster-art">
          <span class="poster-burst poster-burst--magenta"></span>
          <span class="poster-burst poster-burst--cyan"></span>
          <div class="poster-character">🛹</div>
          <div class="poster-title">STREET<br />RUN</div>
          <div class="poster-sub">街 头 无 限 跑 酷</div>
        </div>
        <div class="poster-cta">点击 / 空格 开始狂奔</div>
        <div class="poster-modes">
          <span
            >当前场景：{{
              sceneMode === "metro" ? "地铁隧道" : "晴朗街头"
            }}</span
          >
        </div>
      </div>

      <!-- 游戏结束：半透明波普漫画风海报，点击 / 空格 重新开始 -->
      <div
        class="game-over-poster"
        v-if="state === 'over'"
        @pointerdown="onPointer"
      >
        <div class="over-burst over-burst--magenta"></div>
        <div class="over-burst over-burst--cyan"></div>
        <div class="over-card">
          <div class="over-stamp">GAME<br />OVER</div>
          <div class="over-score">
            本局 <b>{{ score }}</b> 分
          </div>
          <div class="over-best">
            最高纪录 <b>{{ best }}</b> 分
          </div>
          <div class="over-cta">点击 / 空格 重新开始</div>
          <div class="over-tip">
            ← → 换道 · 空格 暂停/开始 · 躲开路锥与消防栓
          </div>
        </div>
      </div>

      <div class="game-hint" v-if="mode === '3d' && state === 'playing'">
        ← → 换道 · W 跳跃 · 空格 暂停
      </div>
    </div>

    <!-- 操作提示 -->
    <p class="game-tip">
      空格 暂停/开始 · 点击/W/↑ 跳跃
      <template v-if="mode === '3d'">· ← → 左右换道</template>
      · 躲避路锥与消防栓 · 收集金币 🪙 · 随速度提升越来越刺激
    </p>
  </div>
</template>

<style scoped lang="scss">
.game-page {
  min-height: calc(100vh - #{$header-height});
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $gap-md;
  padding: $gap-lg $gap-md;
  background: var(--color-bg, #fff3d6);
}

.game-hud {
  width: min(960px, 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: $gap-sm $gap-md;
  background: var(--pop-yellow);
  border: var(--border-ink-lg) solid var(--color-ink);
  box-shadow: var(--shadow-hard);
  padding: $gap-sm $gap-md;

  // 左：标题 + 统计；右：模式/场景/操作
  &-group {
    display: flex;
    align-items: center;
    gap: $gap-md;

    &--right {
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  }

  .game-pause-btn {
    border: var(--border-ink) solid var(--color-ink);
    border-radius: 999px;
    background: #fff;
    color: var(--color-ink);
    font-family: var(--font-display);
    font-weight: 800;
    padding: 4px 16px;
    cursor: pointer;
    box-shadow: var(--shadow-hard);
    transition: transform 0.08s ease;

    &:active {
      transform: translate(2px, 2px);
      box-shadow: none;
    }
  }

  &-actions {
    display: flex;
    gap: $gap-sm;
  }

  &-title {
    font-family: var(--font-display);
    font-size: $fs-h3;
    line-height: 1;
    color: var(--color-ink);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  &-stats {
    display: flex;
    gap: $gap-md;
    font-weight: 700;
    color: var(--color-ink);

    .stat b {
      font-size: $fs-h4;
    }
    .stat--coin b {
      color: var(--pop-magenta);
    }
    .stat--speed b {
      color: var(--pop-blue, #2d7df2);
      font-size: $fs-h3;
    }
    .stat--best {
      opacity: 0.7;
    }
  }
}

.game-mode-switch {
  display: flex;
  border: var(--border-ink) solid var(--color-ink);
  border-radius: 999px;
  overflow: hidden;

  button {
    border: none;
    background: transparent;
    font-weight: 800;
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: 0.04em;
    padding: 6px 16px;
    cursor: pointer;
    color: var(--color-ink);
    transform: skewX(-6deg);

    &.active {
      background: var(--color-ink);
      color: var(--pop-yellow);
    }
  }
}

.game-stage {
  position: relative;
  width: min(960px, 100%);
  aspect-ratio: 16 / 9;
  border: var(--border-ink-lg) solid var(--color-ink);
  box-shadow: var(--shadow-hard-lg);
  overflow: hidden;
  background: #7cc7ff;
  cursor: pointer;
  transition: transform 0.12s ease;

  &.is-over {
    animation: shake 0.32s ease;
  }
}

@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-8px);
  }
  75% {
    transform: translateX(8px);
  }
}

.game-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

// 全屏游玩：让舞台铺满整个屏幕，canvas 自适应（aspect-ratio 在全屏时让位给 100vw/100vh）
.game-stage:fullscreen {
  width: 100vw;
  height: 100vh;
  aspect-ratio: auto;
  border: none;
  box-shadow: none;
}

.game-status {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  background: var(--color-ink);
  color: var(--pop-yellow);
  font-family: var(--font-display);
  font-size: $fs-body;
  letter-spacing: 0.04em;
  padding: 6px 18px;
  border-radius: 999px;
  pointer-events: none;
}

.game-hint {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: $fs-body-sm;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 999px;
  pointer-events: none;
}

// 高速暗角：从画面四角向内压暗，强化速度压迫感
.game-vignette {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: radial-gradient(
    ellipse 75% 75% at center,
    rgba(0, 0, 0, 0) 55%,
    rgba(0, 0, 0, 0.85) 100%
  );
  transition: opacity 0.15s linear;
  mix-blend-mode: multiply;

  // 极速时叠加暖红描边，提示"危险高速"
  &.is-hot {
    box-shadow: inset 0 0 60px 10px rgba(255, 46, 77, 0.45);
  }
}

.game-tip {
  width: min(960px, 100%);
  text-align: center;
  font-size: $fs-body-sm;
  font-weight: 600;
  color: var(--color-ink);
  opacity: 0.8;
}

.game-scene-switch {
  display: flex;
  border: var(--border-ink) solid var(--color-ink);
  border-radius: 999px;
  overflow: hidden;
  button {
    border: none;
    background: transparent;
    font-weight: 800;
    font-family: var(--font-display);
    padding: 4px 14px;
    cursor: pointer;
    color: var(--color-ink);

    &.active {
      background: var(--pop-magenta);
      color: #fff;
    }
  }
}

// 画布内常驻 HUD 叠层（全屏时也能看到分数/速度/胶囊）
.game-inner-hud {
  position: absolute;
  inset: 0;
  z-index: 4; // 在暗角(3)之上、海报(5)之下
  pointer-events: none; // 不拦截点击跳跃

  // 右上角：分数 + 胶囊
  .ihud-group--top {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    gap: 8px;
  }

  .ihud {
    font-family: "Bungee", var(--font-display);
    font-weight: 400;
    font-size: 18px;
    line-height: 1;
    color: #fff;
    background: var(--color-ink);
    border: 3px solid var(--pop-yellow);
    border-radius: 10px;
    padding: 7px 14px;
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.55);
    transform: skewX(-6deg) rotate(-2deg); // 倾斜，运动街头感
    white-space: nowrap;
    letter-spacing: 0.02em;

    b {
      font-size: 24px;
      -webkit-text-stroke: 1px rgba(0, 0, 0, 0.4);
    }
    &--score b {
      color: var(--pop-yellow);
    }
    &--coin b {
      color: var(--pop-magenta);
    }
  }

  // 右下角：当前速度（超大字、街头风字体、黄色+黑粗描边，数字远大于 km/h，倾斜体现速度感）
  .ihud--speed {
    position: absolute;
    right: 16px;
    bottom: 12px;
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-family: "Bungee", var(--font-display);
    font-weight: 400;
    line-height: 0.9;
    color: #ffe14d; // 黄色字体
    -webkit-text-stroke: 3px #1a1a1a; // 黑色粗描边
    text-shadow: 5px 5px 0 rgba(0, 0, 0, 0.45);
    transform: skewX(-8deg) rotate(-3deg); // 倾斜，强化冲刺速度感
    transform-origin: bottom right;
    white-space: nowrap;
    letter-spacing: 0.02em;

    b {
      font-size: 78px; // 数字巨大
    }

    // km/h 单位明显更小，凸显数字的速度压迫感
    .ihud--unit {
      font-size: 24px;
      font-style: normal;
      -webkit-text-stroke: 2px #1a1a1a;
    }
  }

  // 道具生效提示 + 倒计时进度条（左下角，波普风卡片堆叠）
  .ihud-powerups {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }

  .pw-bar {
    display: grid;
    grid-template-columns: auto auto auto;
    align-items: center;
    gap: 6px 8px;
    background: var(--color-ink);
    border: 3px solid var(--pw-color, #fff);
    border-radius: 10px;
    padding: 5px 10px;
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.55);
    transform: skewX(-6deg) rotate(-2deg);
    min-width: 168px;

    .pw-icon {
      font-size: 20px;
      line-height: 1;
    }
    .pw-label {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 15px;
      color: var(--pw-color, #fff);
      letter-spacing: 0.02em;
    }
    .pw-time {
      font-family: "Bungee", var(--font-display);
      font-size: 14px;
      color: #fff;
      -webkit-text-stroke: 0.5px #000;
      text-align: right;
    }
    // 倒计时进度条横跨整行
    .pw-track {
      grid-column: 1 / -1;
      height: 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.22);
      overflow: hidden;
    }
    .pw-fill {
      display: block;
      height: 100%;
      background: var(--pw-color, #fff);
      border-radius: 999px;
      transition: width 0.1s linear;
    }
  }
}

.game-poster {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $gap-sm;
  cursor: pointer;
  background: repeating-linear-gradient(
    45deg,
    var(--pop-yellow) 0 28px,
    #ffe14d 28px 56px
  );
  overflow: hidden;

  .poster-art {
    position: relative;
    width: min(560px, 86%);
    aspect-ratio: 16 / 9;
    background: var(--pop-cyan, #16d1c4);
    border: var(--border-ink-lg) solid var(--color-ink);
    box-shadow: var(--shadow-hard-lg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .poster-burst {
    position: absolute;
    border-radius: 50%;
    &--magenta {
      width: 180px;
      height: 180px;
      background: var(--pop-magenta);
      top: -50px;
      right: -40px;
    }
    &--cyan {
      width: 120px;
      height: 120px;
      background: var(--pop-blue, #2d7df2);
      bottom: -36px;
      left: -28px;
      opacity: 0.85;
    }
  }

  .poster-character {
    font-size: 96px;
    line-height: 1;
    filter: drop-shadow(3px 3px 0 var(--color-ink));
    z-index: 1;
    animation: bob 1.4s ease-in-out infinite;
  }

  .poster-title {
    font-family: var(--font-display);
    font-size: clamp(40px, 8vw, 84px);
    line-height: 0.92;
    color: #fff;
    text-align: center;
    letter-spacing: 0.02em;
    text-shadow: 4px 4px 0 var(--color-ink), -2px -2px 0 var(--pop-magenta);
    z-index: 1;
  }

  .poster-sub {
    font-family: var(--font-display);
    font-size: $fs-body;
    letter-spacing: 0.3em;
    color: var(--color-ink);
    background: var(--pop-yellow);
    padding: 2px 14px;
    border: var(--border-ink) solid var(--color-ink);
    z-index: 1;
  }

  .poster-cta {
    font-family: var(--font-display);
    font-size: $fs-h4;
    color: #fff;
    background: var(--color-ink);
    padding: 8px 28px;
    border-radius: 999px;
    border: var(--border-ink) solid var(--color-ink);
    box-shadow: var(--shadow-hard);
    animation: pulse 1.2s ease-in-out infinite;
  }

  .poster-modes {
    font-size: $fs-body-sm;
    font-weight: 700;
    color: var(--color-ink);
    opacity: 0.75;
  }
}

// 游戏结束：半透明波普漫画风海报（露出底层画面，保留漫画爆炸框 / 粗黑边 / 网点）
.game-over-poster {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  // 半透明底色 + 网点（halftone）叠层，让背后 3D 画面隐约可见
  background: radial-gradient(var(--color-ink) 1.4px, transparent 1.6px) 0 0 /
      14px 14px,
    rgba(20, 18, 16, 0.55);
  animation: overfade 0.28s ease both;
  overflow: hidden;

  .over-burst {
    position: absolute;
    border-radius: 50%;
    &--magenta {
      width: 220px;
      height: 220px;
      background: var(--pop-magenta);
      top: 6%;
      right: 8%;
      opacity: 0.85;
      transform: rotate(-8deg);
    }
    &--cyan {
      width: 150px;
      height: 150px;
      background: var(--pop-blue, #2d7df2);
      bottom: 8%;
      left: 7%;
      opacity: 0.8;
    }
  }

  .over-card {
    position: relative;
    z-index: 1;
    width: min(520px, 88%);
    padding: $gap-lg $gap-md;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: $gap-sm;
    background: var(--pop-yellow);
    border: var(--border-ink-lg) solid var(--color-ink);
    box-shadow: var(--shadow-hard-lg);
    border-radius: 14px;
    transform: rotate(-1.5deg);
    animation: overpop 0.32s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }

  .over-stamp {
    font-family: var(--font-display);
    font-size: clamp(46px, 10vw, 96px);
    line-height: 0.9;
    color: #fff;
    text-align: center;
    letter-spacing: 0.02em;
    text-shadow: 5px 5px 0 var(--color-ink), -2px -2px 0 var(--pop-magenta);
    transform: rotate(-2deg);
  }

  .over-score {
    font-family: var(--font-display);
    font-size: $fs-h3;
    color: var(--color-ink);
    b {
      color: var(--pop-magenta);
      font-size: $fs-h2;
    }
  }

  .over-best {
    font-size: $fs-body;
    font-weight: 700;
    color: var(--color-ink);
    opacity: 0.85;
    b {
      color: var(--pop-blue, #2d7df2);
    }
  }

  .over-cta {
    margin-top: 4px;
    font-family: var(--font-display);
    font-size: $fs-h4;
    color: #fff;
    background: var(--color-ink);
    padding: 10px 30px;
    border-radius: 999px;
    border: var(--border-ink) solid var(--color-ink);
    box-shadow: var(--shadow-hard);
    animation: pulse 1.1s ease-in-out infinite;
  }

  .over-tip {
    font-size: $fs-body-sm;
    font-weight: 700;
    color: var(--color-ink);
    opacity: 0.7;
    text-align: center;
  }
}

@keyframes overfade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes overpop {
  0% {
    transform: rotate(-1.5deg) scale(0.6);
    opacity: 0;
  }
  100% {
    transform: rotate(-1.5deg) scale(1);
    opacity: 1;
  }
}

@keyframes bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-12px);
  }
}
@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.06);
  }
}
</style>
