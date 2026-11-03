import { http } from '@/utils/request';
import { mockResolve, productDetailMock, relatedProductsMock } from './mock';
import type { Product, ProductDetail } from './types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/** 获取商品详情 */
export function getProductDetail(id: string): Promise<ProductDetail> {
  if (USE_MOCK) return mockResolve({ ...productDetailMock, id });
  return http.get<ProductDetail>(`/products/${id}`);
}

/** 获取相关商品列表 */
export function getRelatedProducts(id: string): Promise<Product[]> {
  if (USE_MOCK) return mockResolve(relatedProductsMock);
  return http.get<Product[]>(`/products/${id}/related`);
}
