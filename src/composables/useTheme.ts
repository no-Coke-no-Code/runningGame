import { onMounted, onUnmounted, ref, watch } from 'vue';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'app_theme';
const theme = ref<ThemeMode>('light');
let initialized = false;

/** 读取 localStorage 中保存的主题 */
function readStored(): ThemeMode | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

/** 读取系统偏好（prefers-color-scheme） */
function readSystem(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 把主题应用到 <html> 根元素 */
function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

/** 初始化主题：存储 > 系统偏好，只需在应用启动时调用一次 */
export function initTheme(): void {
  if (initialized) return;
  initialized = true;

  theme.value = readStored() ?? readSystem();
  applyTheme(theme.value);

  // 监听变化持久化 + 同步 DOM
  watch(theme, (mode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    applyTheme(mode);
  });
}

/** 主题 composable —— 任意组件可调用，共享同一份状态 */
export function useTheme() {
  // 跟随系统偏好变化（仅当用户未显式选择时）
  function onSystemChange(e: MediaQueryListEvent) {
    if (!readStored()) {
      theme.value = e.matches ? 'dark' : 'light';
    }
  }

  onMounted(() => {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onSystemChange);
  });

  onUnmounted(() => {
    window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', onSystemChange);
  });

  function toggle(): void {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  return { theme, toggle };
}
