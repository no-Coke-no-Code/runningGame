import type { RunnerTheme3D } from "./ThreeRunner";

// 白天街头：90 年代洛杉矶暖沙天空 + 沥青马路 + 红砖/暖黄墙面 + 撞色涂鸦
// （仅本模块内部使用，外部统一通过 theme3DFor 获取）
const lightTheme3D: RunnerTheme3D = {
  sky: "#8ec6f0",      // 暖沙蓝天空
  ground: "#3a3f47",   // 沥青深灰
  wallL: "#d46a48",    // 红砖（左墙）
  wallR: "#e8b96b",    // 暖黄旧墙（右墙）
  ink: "#1e1a16",
  yellow: "#ffd400",   // 分道黄线 / 涂鸦
  magenta: "#ff2e9a",  // 涂鸦撞色
  red: "#d94a2f",      // 红路缘石 / 建筑强调
  blue: "#2d7df2",
  cyan: "#16d1c4",
  cream: "#fff4dc",
  fog: "#cfe0ee",      // 淡蓝灰雾气，增加空气感且不显米黄
};

// 夜间街头（保留，日/夜切换仍可用）
const darkTheme3D: RunnerTheme3D = {
  sky: "#1a2a55",
  ground: "#2a2d33",
  wallL: "#3a3550",
  wallR: "#4a2a5a",
  ink: "#f6f0ff",
  yellow: "#ffe000",
  magenta: "#ff00a8",
  red: "#ff0033",
  blue: "#00a2e8",
  cyan: "#00d8c8",
  cream: "#fff3d6",
  fog: "#22305a",
};

export function theme3DFor(mode: "light" | "dark"): RunnerTheme3D {
  return mode === "dark" ? darkTheme3D : lightTheme3D;
}
