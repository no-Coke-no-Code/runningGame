import { http } from '@/utils/request';
import { landingMock, mockResolve } from './mock';
import type { LandingContent } from './types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/** 获取 Landing 页全部内容 */
export function getLandingContent(): Promise<LandingContent> {
  if (USE_MOCK) return mockResolve(landingMock);
  return http.get<LandingContent>('/landing/content');
}
