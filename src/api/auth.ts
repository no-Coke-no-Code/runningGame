import { http } from '@/utils/request';
import type { UserInfo } from '@/api/types';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: UserInfo;
}

/** 登录：返回 token 与用户信息 */
export function login(payload: LoginPayload): Promise<LoginResult> {
  return http.post<LoginResult>('/auth/login', payload);
}

/** 登出 */
export function logout(): Promise<void> {
  return http.post<void>('/auth/logout');
}

/** 获取当前登录用户（用于刷新页面后恢复登录态） */
export function getCurrentUser(): Promise<UserInfo> {
  return http.get<UserInfo>('/auth/me');
}
