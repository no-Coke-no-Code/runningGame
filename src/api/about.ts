import { http } from '@/utils/request';
import { aboutMock, mockResolve } from './mock';
import type { AboutContent, ContactFormPayload } from './types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/** 获取 About 页内容 */
export function getAboutContent(): Promise<AboutContent> {
  if (USE_MOCK) return mockResolve(aboutMock);
  return http.get<AboutContent>('/about/content');
}

/** 提交联系表单 */
export function submitContactForm(payload: ContactFormPayload): Promise<null> {
  if (USE_MOCK) return mockResolve(null);
  return http.post<null>('/contact', payload);
}
