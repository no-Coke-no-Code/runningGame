import type { RunnerTheme } from "./RunnerGame";

// 日间 / 夜间波普主题，与站点 CSS 变量保持一致
// （仅本模块内部使用，外部统一通过 themeFor 获取）
const lightTheme: RunnerTheme = {
  bg: "#7cc7ff",
  bgAlt: "#ffe27a",
  ground: "#ffd400",
  ink: "#0a0a0a",
  yellow: "#ffd400",
  magenta: "#ff00a8",
  red: "#ff2e4d",
  blue: "#2d2df2",
  cyan: "#00c2cb",
  cream: "#fff3d6",
};

const darkTheme: RunnerTheme = {
  bg: "#2a1a4a",
  bgAlt: "#5a1a6a",
  ground: "#ff00a8",
  ink: "#f6f0ff",
  yellow: "#ffe000",
  magenta: "#ff00a8",
  red: "#ff0033",
  blue: "#00a2e8",
  cyan: "#00d8c8",
  cream: "#fff3d6",
};

export function themeFor(mode: "light" | "dark"): RunnerTheme {
  return mode === "dark" ? darkTheme : lightTheme;
}
