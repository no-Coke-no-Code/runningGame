import { http } from '@/utils/request';
import { mockResolve, shopMock } from './mock';
import type { ShopContent } from './types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/** 获取 Shop 页全部内容 */
export function getShopContent(): Promise<ShopContent> {
  if (USE_MOCK) return mockResolve(shopMock);
  return http.get<ShopContent>('/shop/content');
}
