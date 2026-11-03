<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getLandingContent } from '@/api/landing';
import type { LandingContent } from '@/api/types';
import FeatureCard from '@/components/FeatureCard.vue';
import QuoteCard from '@/components/QuoteCard.vue';
import PageSkeleton from '@/components/PageSkeleton.vue';

const loading = ref(true);
const content = ref<LandingContent>();

onMounted(async () => {
  try {
    content.value = await getLandingContent();
  } catch {
    // 错误提示由请求层统一处理
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-page-loading="loading" class="landing-page">
    <!-- 加载完成：真实内容 -->
    <template v-if="!loading && content">
      <!-- Hero（首屏顶部内容，直接展示，避免与 loading 闪烁冲突） -->
      <section class="container landing-page-hero">
        <div class="landing-page-hero-copy">
          <h1 class="landing-page-hero-title">{{ content.hero.title }}</h1>
          <p class="landing-page-hero-sub">{{ content.hero.sub }}</p>
        </div>
        <el-button class="btn-primary btn-lg">{{ content.hero.buttonText }}</el-button>
      </section>

      <section class="container landing-page-hero-image-wrap">
        <div class="landing-page-hero-image pop-frame">
          <img :src="content.hero.image" alt="Hero" />
        </div>
      </section>

      <!-- Feature cards x3 -->
      <section v-reveal class="container landing-page-section">
        <h2 class="section-heading">Section heading</h2>
        <div class="landing-page-cards-row">
          <FeatureCard
            v-for="card in content.featureCards"
            :key="card.image"
            v-reveal
            :image="card.image"
            :title="card.title"
            :body="card.body"
          />
        </div>
      </section>

      <!-- Split section -->
      <section v-reveal class="container landing-page-section landing-page-split">
        <div class="landing-page-split-left">
          <h2 class="section-heading">Section heading</h2>
          <div class="landing-page-split-texts">
            <div v-for="(block, i) in content.textBlocks" :key="i" class="landing-page-split-text">
              <h3 class="text-subheading">{{ block.title }}</h3>
              <p class="text-body">{{ block.body }}</p>
            </div>
          </div>
          <div class="landing-page-split-buttons">
            <el-button class="btn-primary btn-md">Button</el-button>
            <el-button class="btn-secondary btn-md">Secondary button</el-button>
          </div>
        </div>
        <div class="landing-page-split-image pop-frame">
          <img :src="content.sideImage" alt="Section image" />
        </div>
      </section>

      <!-- Big cards x2 -->
      <section v-reveal class="container landing-page-section">
        <h2 class="section-heading">Section heading</h2>
        <div class="landing-page-cards-row">
          <FeatureCard
            v-for="card in content.bigCards"
            :key="card.image"
            v-reveal
            :image="card.image"
            :title="card.title"
            :body="card.body"
            :image-height="341"
          />
        </div>
      </section>

      <!-- Quotes -->
      <section v-reveal class="container landing-page-section">
        <h2 class="section-heading">Section heading</h2>
        <div class="landing-page-cards-row">
          <QuoteCard
            v-for="q in content.quotes"
            :key="q.quote"
            v-reveal
            :quote="q.quote"
            :name="q.name"
            :description="q.description"
            :avatar="q.avatar"
          />
        </div>
      </section>

      <!-- CTA -->
      <section v-reveal class="landing-page-cta-section">
        <div class="container landing-page-cta-inner">
          <h2 class="section-heading">Section heading</h2>
          <div class="landing-page-cta-buttons">
            <el-button class="btn-primary btn-lg">Button</el-button>
            <el-button class="btn-secondary btn-lg">Secondary button</el-button>
          </div>
        </div>
      </section>
    </template>

    <!-- 加载中：骨架屏 -->
    <PageSkeleton v-else variant="landing" />
  </div>
</template>

<style scoped lang="scss">
.landing-page {
  background: var(--color-bg);

  &-hero {
    margin-top: 48px;
    display: flex;
    flex-direction: column;
    gap: 40px;

    .el-button {
      align-self: flex-start;
    }
  }

  &-hero-copy {
    max-width: 844px;
    display: flex;
    flex-direction: column;
    gap: $gap-md;
  }

  &-hero-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-display;
    line-height: 0.92;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    // 波普描边 + 硬投影
    text-shadow: var(--shadow-hard-sm);
    color: var(--pop-blue);

    // 用描边感：叠加黑边（通过 -webkit-text-stroke 模拟漫画描边）
    -webkit-text-stroke: 2px var(--color-ink);
  }

  &-hero-sub {
    font-size: $fs-body-lg;
    line-height: $lh-body-lg;
    font-weight: 500;
  }

  &-hero-image-wrap {
    margin-top: $gap-2xl;
  }

  &-hero-image {
    width: 100%;
    height: 640px;
  }

  &-section {
    margin-top: 180px;
    display: flex;
    flex-direction: column;
    gap: $gap-xl;
  }

  // 跨兄弟：图区后接区块，缩小上间距
  &-hero-image-wrap + &-section {
    margin-top: 150px;
  }

  &-cards-row {
    display: flex;
    gap: $gap-lg;
  }

  &-split {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    gap: 60px;
  }

  &-split-left {
    max-width: 624px;
    display: flex;
    flex-direction: column;
    gap: $gap-xl;
  }

  &-split-texts {
    display: flex;
    flex-direction: column;
    gap: $gap-xl;
  }

  &-split-text {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: $gap-xs;

    .text-body,
    .text-subheading {
      max-width: 516px;
    }
  }

  &-split-buttons {
    @include flex-center-y;
    gap: $gap-sm;

    .el-button + .el-button {
      margin-left: 0;
    }
  }

  &-split-image {
    width: 704px;
    height: 704px;
    flex-shrink: 0;
  }

  &-cta-section {
    margin-top: 150px;
    background: var(--pop-blue);
    border-top: var(--border-ink-lg) solid var(--color-ink);
    border-bottom: var(--border-ink-lg) solid var(--color-ink);
  }

  &-cta-inner {
    min-height: 236px;
    @include flex-center-y;
    justify-content: space-between;
    gap: 32px;
    flex-wrap: wrap;

    .section-heading {
      color: var(--color-bg);
      -webkit-text-stroke: 1.5px var(--color-ink);
    }
  }

  &-cta-buttons {
    @include flex-center-y;
    gap: $gap-md;

    .el-button + .el-button {
      margin-left: 0;
    }
  }
}
</style>
