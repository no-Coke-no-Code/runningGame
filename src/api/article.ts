import { http } from '@/utils/request';
import { articleMock, mockResolve, relatedArticlesMock } from './mock';
import type { ArticleCardItem, ArticleContent } from './types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/** 获取文章详情 */
export function getArticle(id: string): Promise<ArticleContent> {
  if (USE_MOCK) return mockResolve({ ...articleMock, id });
  return http.get<ArticleContent>(`/articles/${id}`);
}

/** 获取相关文章列表 */
export function getRelatedArticles(id: string): Promise<ArticleCardItem[]> {
  if (USE_MOCK) return mockResolve(relatedArticlesMock);
  return http.get<ArticleCardItem[]>(`/articles/${id}/related`);
}
