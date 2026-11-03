<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Avatar, Calendar, Lock, Place } from '@element-plus/icons-vue';
import { getShopContent } from '@/api/shop';
import type { ShopContent } from '@/api/types';
import ProductCard from '@/components/ProductCard.vue';
import PageSkeleton from '@/components/PageSkeleton.vue';

const iconMap: Record<string, unknown> = {
  globe: Place,
  lock: Lock,
  avatar: Avatar,
  calendar: Calendar,
};

const loading = ref(true);
const content = ref<ShopContent>();

onMounted(async () => {
  try {
    content.value = await getShopContent();
  } catch {
    // 错误提示由请求层统一处理
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-page-loading="loading" class="shop-page">
    <template v-if="!loading && content">
      <!-- Hero：背景图 + 24% 黑色遮罩（渐变叠加，无需 absolute），负边距滑入透明导航下方 -->
      <section
        class="shop-page-hero"
        :style="{
          backgroundImage: `linear-gradient(rgb(0 0 0 / 24%), rgb(0 0 0 / 24%)), url(${content.hero.image})`,
        }"
      >
        <div class="shop-page-hero-content">
          <div class="shop-page-title-group">
            <h1 class="shop-page-title">{{ content.hero.title }}</h1>
            <p class="shop-page-sub">{{ content.hero.sub }}</p>
          </div>
          <el-button class="btn-primary btn-lg">{{ content.hero.buttonText }}</el-button>
        </div>
      </section>

      <!-- 交替图文行（首屏顶部内容，直接展示） -->
      <section class="container shop-page-rows-section">
        <div v-for="(row, i) in content.rows" :key="i" class="shop-page-media-row" v-reveal>
          <div v-if="row.imageFirst" class="shop-page-row-image pop-frame">
            <img :src="row.image" alt="Heading image" />
          </div>
          <div class="shop-page-row-copy">
            <h2 class="shop-page-row-heading">{{ row.heading }}</h2>
            <p class="shop-page-row-sub">{{ row.sub }}</p>
            <div class="shop-page-row-buttons">
              <el-button class="btn-primary btn-md">Button</el-button>
              <el-button class="btn-secondary btn-md">Secondary button</el-button>
            </div>
          </div>
          <div v-if="!row.imageFirst" class="shop-page-row-image pop-frame">
            <img :src="row.image" alt="Heading image" />
          </div>
        </div>
      </section>

      <!-- 商品区 -->
      <section v-reveal class="container shop-page-section">
        <h2 class="section-heading">Section heading</h2>
        <div class="shop-page-products-grid">
          <ProductCard
            class="shop-page-product-big"
            v-reveal
            :image="content.featuredProduct.image"
            :title="content.featuredProduct.title"
            :description="content.featuredProduct.description"
            :price="content.featuredProduct.price"
            :image-height="735"
          />
          <div class="shop-page-product-list">
            <ProductCard
              v-for="p in content.products"
              :key="p.id"
              v-reveal
              :image="p.image"
              :title="p.title"
              :description="p.description"
              :price="p.price"
            />
          </div>
        </div>
      </section>

      <!-- 特性列表 -->
      <section v-reveal class="container shop-page-section shop-page-features-section">
        <h2 class="section-heading">Section heading</h2>
        <div class="shop-page-features-grid">
          <div v-for="(list, i) in content.featureLists" :key="i" class="shop-page-feature-list" v-reveal>
            <div v-for="(item, j) in list" :key="j" class="shop-page-feature-item">
              <el-icon :size="32" color="#454545">
                <component :is="iconMap[item.icon] ?? Place" />
              </el-icon>
              <h3 class="text-subheading">{{ item.title }}</h3>
              <p class="shop-page-feature-body">{{ item.body }}</p>
            </div>
          </div>
        </div>
      </section>
    </template>

    <PageSkeleton v-else variant="shop" />
  </div>
</template>

<style scoped lang="scss">
.shop-page {
  background: var(--color-bg);

  &-hero {
    margin-top: -$header-height;
    height: 720px;
    background-color: var(--pop-blue);
    background-size: cover;
    background-position: center;
    @include flex-center;
    // 半调网点叠加，强化波普丝网印刷感
    position: relative;

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image: radial-gradient(rgba(255, 255, 255, 0.12) 2px, transparent 2.1px);
      background-size: 14px 14px;
      pointer-events: none;
    }
  }

  &-hero-content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 40px;
    max-width: 844px;
  }

  &-title-group {
    display: flex;
    flex-direction: column;
    gap: $gap-sm;
    text-align: center;
  }

  &-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-h1;
    line-height: 0.95;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    color: var(--pop-yellow);
    -webkit-text-stroke: 2px var(--color-ink);
    text-shadow: var(--shadow-hard);
  }

  &-sub {
    font-size: $fs-body-lg;
    font-weight: 600;
    line-height: 34px;
    color: $color-white;
    text-shadow: 0 2px 0 rgba(0, 0, 0, 0.4);
  }

  &-rows-section {
    margin-top: 120px;
    display: flex;
    flex-direction: column;
    gap: $gap-2xl;
  }

  &-media-row {
    @include flex-center-y;
    justify-content: space-between;
    gap: 140px;
  }

  &-row-copy {
    width: 516px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: $gap-md;
  }

  &-row-heading {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-h3;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.01em;
  }

  &-row-sub {
    font-size: $fs-body-lg;
    line-height: $lh-body-lg;
    color: var(--color-text-gray);
  }

  &-row-buttons {
    display: flex;
    gap: $gap-sm;

    .el-button + .el-button {
      margin-left: 0;
    }
  }

  &-row-image {
    width: 624px;
    height: 400px;
    object-fit: cover;
    background: var(--color-bg-gray);
    flex-shrink: 0;
  }

  &-section {
    margin-top: 150px;
    display: flex;
    flex-direction: column;
    gap: $gap-xl;
  }

  &-products-grid {
    display: flex;
    gap: 30px;
  }

  &-product-big {
    width: 735px;
    flex-shrink: 0;
  }

  &-product-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }

  &-features-section {
    margin-bottom: 150px;
  }

  &-features-grid {
    display: flex;
    justify-content: space-between;
    gap: $gap-lg;
  }

  &-feature-list {
    width: 515px;
    display: flex;
    flex-direction: column;
    gap: $gap-xl;
  }

  &-feature-item {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: $gap-xs;

    .el-icon {
      width: 56px;
      height: 56px;
      border: 2px solid var(--color-ink);
      border-radius: 50%;
      background: var(--pop-yellow);
      box-shadow: var(--shadow-press);
      color: var(--color-ink) !important;
      @include flex-center;
    }

    .text-subheading {
      font-family: var(--font-display);
      font-weight: 400;
      font-size: $fs-body-lg;
      line-height: 1;
      text-transform: uppercase;
      letter-spacing: 0.01em;
    }
  }

  &-feature-body {
    font-size: $fs-body;
    line-height: $lh-body;
    color: var(--color-text-gray);
  }
}
</style>
