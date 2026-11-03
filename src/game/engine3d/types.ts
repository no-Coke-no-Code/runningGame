// ============================================================
// StreetFire 3D Runner —— 类型定义
// 游戏实体的数据结构与对外类型。
// ============================================================
import * as THREE from "three";

/** 主题色板（3D） */
export interface RunnerTheme3D {
  sky: string;
  ground: string;
  wallL: string;
  wallR: string;
  ink: string;
  yellow: string;
  magenta: string;
  red: string;
  blue: string;
  cyan: string;
  cream: string;
  fog: string;
}

/** 游戏状态机 */
export type RunnerState = "ready" | "playing" | "paused" | "over";

/** 对外暴露的统计信息（HUD 用） */
export interface RunnerStats {
  state: RunnerState;
  score: number;
  coins: number;
  speed: number;
  best: number;
  powerups: { kind: PowerupKind; remain: number }[]; // 当前生效的道具及剩余秒数（HUD 用）
}

/** 障碍物（路锥 / 消防栓 / 停在赛道上的车辆） */
export interface Obstacle {
  mesh: THREE.Object3D;
  lane: number;
  z: number;
  topY: number; // 顶部高度（用于跳跃躲避判定）
  kind: "cone" | "hydrant" | "car";
  /** 沿 z 向的半长（判定窗口）；路障很小可缺省，车辆必须给（4.4 长） */
  halfZ?: number;
  /** 车辆被撞后的横向甩飞方向（-1 左 / 1 右）；同时用作"已撞过"标记 */
  knockDir?: number;
}

/** 可拾取金币 */
export interface Pickup {
  mesh: THREE.Object3D;
  lane: number;
  z: number;
  taken: boolean;
}

/** 道具种类 */
export type PowerupKind = "magnet" | "shield" | "invincible";

/** 道具 */
export interface Powerup {
  mesh: THREE.Object3D;
  kind: PowerupKind;
  lane: number;
  z: number;
  taken: boolean;
  baseY: number; // 浮动基准高度，用于上下浮动动画
}
