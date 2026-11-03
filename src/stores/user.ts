import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { UserInfo } from "@/api/types";
import {
  login as loginApi,
  logout as logoutApi,
  getCurrentUser,
} from "@/api/auth";
import { setToken } from "@/utils/request";
import { authMock, mockResolve } from "@/api/mock";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const STORAGE_KEY = "app_user";

function loadPersisted(): { user: UserInfo; token: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

interface LoginPayload {
  email: string;
  password: string;
}

export const useUserStore = defineStore("user", () => {
  const persisted = loadPersisted();

  const user = ref<UserInfo | null>(persisted?.user ?? null);
  const token = ref<string | null>(persisted?.token ?? null);
  /** 是否在恢复登录态（刷新后拉取 /auth/me） */
  const initializing = ref(false);

  const isLoggedIn = computed(() => !!token.value && !!user.value);

  function persist() {
    if (user.value && token.value) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ user: user.value, token: token.value })
      );
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function applySession(tokenValue: string, userInfo: UserInfo) {
    token.value = tokenValue;
    user.value = userInfo;
    setToken(tokenValue); // 同步给请求层
    persist();
  }

  async function login(payload: LoginPayload): Promise<void> {
    if (USE_MOCK) {
      const res = await mockResolve(
        authMock.login(payload.email, payload.password)
          ? {
              token: authMock.login(payload.email, payload.password)!.token,
              user: authMock.login(payload.email, payload.password)!.user,
            }
          : null,
        authMock.delay
      );
      if (!res) {
        throw new Error("邮箱或密码错误（演示账号：coke43 / 123456）");
      }
      applySession(res.token, res.user);
      return;
    }
    const res = await loginApi(payload);
    applySession(res.token, res.user);
  }

  async function logout(): Promise<void> {
    if (!USE_MOCK) {
      try {
        await logoutApi();
      } catch {
        /* 即使接口失败也清除本地登录态 */
      }
    }
    user.value = null;
    token.value = null;
    setToken(null);
    persist();
  }

  /** 应用启动时调用：若本地有 token，则拉取最新用户信息以恢复登录态 */
  async function restore(): Promise<void> {
    if (!token.value) return;
    initializing.value = true;
    try {
      const info = USE_MOCK
        ? await mockResolve(authMock.me, 200)
        : await getCurrentUser();
      user.value = info;
      persist();
    } catch {
      // 恢复失败（token 失效等）：清空登录态
      user.value = null;
      token.value = null;
      setToken(null);
      persist();
    } finally {
      initializing.value = false;
    }
  }

  return { user, token, initializing, isLoggedIn, login, logout, restore };
});
