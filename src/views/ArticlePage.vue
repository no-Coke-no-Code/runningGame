<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getArticle, getRelatedArticles } from '@/api/article';
import type { ArticleCardItem, ArticleContent } from '@/api/types';
import ArticleCard from '@/components/ArticleCard.vue';
import PageSkeleton from '@/components/PageSkeleton.vue';

const route = useRoute();

const loading = ref(true);
const article = ref<ArticleContent>();
const related = ref<ArticleCardItem[]>([]);

onMounted(async () => {
  const id = String(route.params.id);
  try {
    const [articleData, relatedData] = await Promise.all([
      getArticle(id),
      getRelatedArticles(id),
    ]);
    article.value = articleData;
    related.value = relatedData;
  } catch {
    // 错误提示由请求层统一处理
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-page-loading="loading" class="article-page">
    <!-- 加载完成：真实内容 -->
    <template v-if="!loading && article">
      <!-- 标题（首屏顶部内容，直接展示） -->
      <section class="container article-page-title">
        <div class="article-page-title-inner">
          <h1 class="article-page-heading">{{ article.title }}</h1>
          <p class="article-page-subtitle">{{ article.subtitle }}</p>
        </div>
      </section>

      <!-- 主图 -->
      <section v-reveal class="container article-page-hero-image-wrap">
        <div class="article-page-hero-image pop-frame">
          <img :src="article.cover" alt="Article cover" />
        </div>
      </section>

      <!-- 正文 -->
      <section v-reveal class="container article-page-body">
        <p class="article-page-paragraph">{{ article.paragraph1 }}</p>
      </section>

      <!-- 双图 -->
      <section v-reveal class="container article-page-images-row">
        <div
          v-for="(img, i) in article.images"
          :key="i"
          class="article-page-inline-image pop-frame"
        >
          <img :src="img" alt="Article image" />
        </div>
      </section>

      <section v-reveal class="container article-page-body">
        <p class="article-page-paragraph">{{ article.paragraph2 }}</p>
      </section>

      <!-- 相关文章 -->
      <section v-reveal class="container article-page-related-section">
        <h2 class="article-page-related-heading">Related articles or posts</h2>
        <div class="article-page-related-cards">
          <ArticleCard
            v-for="a in related"
            :key="a.id"
            v-reveal
            :image="a.image"
            :title="a.title"
            :author="a.author"
          />
        </div>
      </section>
    </template>

    <!-- 加载中：骨架屏 -->
    <PageSkeleton v-else variant="article" />
  </div>
</template>

<style scoped lang="scss">
.article-page {
  background: var(--color-bg);

  &-title {
    margin-top: $gap-2xl;
  }

  &-title-inner {
    max-width: 733px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: $gap-md;
  }

  &-heading {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-display;
    line-height: 0.95;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    -webkit-text-stroke: 1.5px var(--color-ink);
    color: var(--pop-blue);
  }

  &-subtitle {
    font-size: $fs-body-lg;
    font-weight: 500;
    line-height: $lh-body-lg;
  }

  &-hero-image-wrap {
    margin-top: $gap-2xl;
  }

  &-hero-image {
    width: 100%;
    height: 650px;
    object-fit: cover;
  }

  &-body {
    margin-top: $gap-2xl;
  }

  &-paragraph {
    max-width: 842px;
    font-size: $fs-body;
    font-weight: 500;
    line-height: $lh-body;
    white-space: pre-line;
  }

  &-images-row {
    margin-top: $gap-2xl;
    display: flex;
    gap: $gap-lg;
  }

  &-inline-image {
    width: 50%;
    height: 436px;
    object-fit: cover;
  }

  &-related-section {
    margin-top: 120px;
    margin-bottom: 150px;
    display: flex;
    flex-direction: column;
    gap: $gap-xl;
  }

  &-related-heading {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-h3;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.01em;
  }

  &-related-cards {
    display: flex;
    gap: $gap-lg;
  }
}
</style>
