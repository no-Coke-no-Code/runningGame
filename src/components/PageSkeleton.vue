<script setup lang="ts">
import SkeletonBlock from './SkeletonBlock.vue';

defineProps<{
  variant: 'landing' | 'shop' | 'product' | 'article' | 'about';
}>();
</script>

<template>
  <div class="page-skeleton" :class="`page-skeleton--${variant}`">
    <!-- Landing -->
    <template v-if="variant === 'landing'">
      <section class="container sk-hero">
        <SkeletonBlock :width="'60%'" :height="'56px'" :radius="'var(--radius-md)'" />
        <SkeletonBlock :width="'40%'" :height="'24px'" />
        <SkeletonBlock :width="'180px'" :height="'52px'" :radius="'var(--radius-md)'" />
      </section>
      <section class="container sk-hero-image">
        <SkeletonBlock :height="'640px'" :radius="'var(--radius-md)'" />
      </section>
      <section class="container sk-section">
        <SkeletonBlock :width="'30%'" :height="'32px'" />
        <div class="sk-cards-row">
          <SkeletonBlock v-for="i in 3" :key="i" class="sk-card" :height="'320px'" :radius="'var(--radius-md)'" />
        </div>
      </section>
      <section class="container sk-split">
        <div class="sk-split-left">
          <SkeletonBlock :width="'50%'" :height="'32px'" />
          <SkeletonBlock v-for="i in 2" :key="i" :height="'120px'" :radius="'var(--radius-md)'" />
          <SkeletonBlock :width="'200px'" :height="'48px'" :radius="'var(--radius-md)'" />
        </div>
        <SkeletonBlock class="sk-split-image" :height="'704px'" :radius="'var(--radius-md)'" />
      </section>
      <section class="container sk-section">
        <SkeletonBlock :width="'30%'" :height="'32px'" />
        <div class="sk-cards-row">
          <SkeletonBlock v-for="i in 2" :key="i" class="sk-card" :height="'341px'" :radius="'var(--radius-md)'" />
        </div>
      </section>
      <section class="container sk-section">
        <SkeletonBlock :width="'30%'" :height="'32px'" />
        <div class="sk-cards-row">
          <SkeletonBlock v-for="i in 3" :key="i" class="sk-quote" :height="'220px'" :radius="'var(--radius-md)'" />
        </div>
      </section>
      <section class="sk-cta">
        <div class="container sk-cta-inner">
          <SkeletonBlock :width="'40%'" :height="'40px'" />
          <SkeletonBlock :width="'220px'" :height="'56px'" :radius="'var(--radius-md)'" />
        </div>
      </section>
    </template>

    <!-- Shop -->
    <template v-else-if="variant === 'shop'">
      <section class="sk-shop-hero">
        <div class="sk-shop-hero-content">
          <SkeletonBlock :width="'50%'" :height="'64px'" />
          <SkeletonBlock :width="'36%'" :height="'28px'" />
          <SkeletonBlock :width="'200px'" :height="'56px'" :radius="'var(--radius-md)'" />
        </div>
      </section>
      <section class="container sk-rows">
        <div v-for="i in 3" :key="i" class="sk-media-row">
          <SkeletonBlock class="sk-row-image" :height="'400px'" :radius="'var(--radius-md)'" />
          <div class="sk-row-copy">
            <SkeletonBlock :width="'70%'" :height="'40px'" />
            <SkeletonBlock :width="'90%'" :height="'80px'" />
            <SkeletonBlock :width="'220px'" :height="'44px'" :radius="'var(--radius-md)'" />
          </div>
        </div>
      </section>
      <section class="container sk-section">
        <SkeletonBlock :width="'30%'" :height="'32px'" />
        <div class="sk-products">
          <SkeletonBlock class="sk-product-big" :height="'735px'" :radius="'var(--radius-md)'" />
          <div class="sk-product-list">
            <SkeletonBlock v-for="i in 3" :key="i" :height="'220px'" :radius="'var(--radius-md)'" />
          </div>
        </div>
      </section>
      <section class="container sk-section">
        <SkeletonBlock :width="'30%'" :height="'32px'" />
        <div class="sk-features">
          <div v-for="i in 2" :key="i" class="sk-feature-list">
            <SkeletonBlock v-for="j in 3" :key="j" :height="'110px'" :radius="'var(--radius-md)'" />
          </div>
        </div>
      </section>
    </template>

    <!-- Product -->
    <template v-else-if="variant === 'product'">
      <section class="container sk-product-main">
        <SkeletonBlock class="sk-product-image" :height="'613px'" :radius="'var(--radius-md)'" />
        <div class="sk-product-copy">
          <SkeletonBlock :width="'60%'" :height="'48px'" />
          <SkeletonBlock :width="'80%'" :height="'24px'" />
          <SkeletonBlock :width="'40%'" :height="'32px'" />
          <SkeletonBlock :height="'120px'" />
          <SkeletonBlock :width="'100%'" :height="'62px'" :radius="'var(--radius-md)'" />
        </div>
      </section>
      <section class="container sk-section">
        <SkeletonBlock :width="'30%'" :height="'32px'" />
        <div class="sk-related-grid">
          <SkeletonBlock v-for="i in 3" :key="i" :height="'238px'" :radius="'var(--radius-md)'" />
        </div>
      </section>
    </template>

    <!-- Article -->
    <template v-else-if="variant === 'article'">
      <section class="container sk-article-title">
        <SkeletonBlock :width="'60%'" :height="'56px'" />
        <SkeletonBlock :width="'40%'" :height="'24px'" />
      </section>
      <section class="container sk-article-hero">
        <SkeletonBlock :height="'650px'" :radius="'var(--radius-md)'" />
      </section>
      <section class="container sk-article-body">
        <SkeletonBlock :height="'20px'" />
        <SkeletonBlock :width="'70%'" :height="'20px'" />
      </section>
      <section class="container sk-article-images">
        <SkeletonBlock v-for="i in 2" :key="i" class="sk-article-image" :height="'360px'" :radius="'var(--radius-md)'" />
      </section>
      <section class="container sk-article-body">
        <SkeletonBlock :height="'20px'" />
        <SkeletonBlock :width="'70%'" :height="'20px'" />
      </section>
      <section class="container sk-section">
        <SkeletonBlock :width="'35%'" :height="'32px'" />
        <div class="sk-related-cards">
          <SkeletonBlock v-for="i in 3" :key="i" class="sk-related-card" :height="'240px'" :radius="'var(--radius-md)'" />
        </div>
      </section>
    </template>

    <!-- About -->
    <template v-else-if="variant === 'about'">
      <div class="container sk-about-layout">
        <div class="sk-about-left">
          <SkeletonBlock :width="'55%'" :height="'56px'" />
          <SkeletonBlock :width="'80%'" :height="'24px'" />
          <SkeletonBlock :height="'80px'" />
          <SkeletonBlock :width="'40%'" :height="'32px'" />
          <div class="sk-form">
            <SkeletonBlock :height="'72px'" :radius="'var(--radius-md)'" />
            <SkeletonBlock :height="'72px'" :radius="'var(--radius-md)'" />
            <SkeletonBlock :height="'160px'" :radius="'var(--radius-md)'" />
            <SkeletonBlock :width="'100%'" :height="'62px'" :radius="'var(--radius-md)'" />
          </div>
        </div>
        <SkeletonBlock class="sk-about-image" :height="'657px'" :radius="'var(--radius-md)'" />
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.page-skeleton {
  background: var(--color-bg);
}

.sk-hero,
.sk-article-title,
.sk-about-left {
  display: flex;
  flex-direction: column;
  gap: $gap-md;
}

.sk-hero {
  margin-top: 48px;
}

.sk-hero-image,
.sk-article-hero {
  margin-top: $gap-2xl;
}

.sk-section {
  margin-top: 150px;
  display: flex;
  flex-direction: column;
  gap: $gap-xl;
}

.sk-cards-row {
  display: flex;
  gap: $gap-lg;

  .sk-card,
  .sk-quote {
    flex: 1;
  }
}

.sk-split {
  margin-top: 150px;
  display: flex;
  justify-content: space-between;
  gap: 60px;

  &-left {
    max-width: 624px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: $gap-xl;
  }

  &-image {
    width: 704px;
    flex-shrink: 0;
  }
}

.sk-cta {
  margin-top: 150px;
  background: var(--pop-blue);
  border-top: var(--border-ink-lg) solid var(--color-ink);
  border-bottom: var(--border-ink-lg) solid var(--color-ink);

  &-inner {
    min-height: 236px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 32px;
    flex-wrap: wrap;
  }
}

// Shop
.sk-shop-hero {
  margin-top: -$header-height;
  height: 720px;
  background: var(--pop-blue);
  display: flex;
  align-items: center;
  justify-content: center;

  &-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 40px;
    max-width: 844px;
  }
}

.sk-rows {
  margin-top: 120px;
  display: flex;
  flex-direction: column;
  gap: $gap-2xl;
}

.sk-media-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 140px;

  .sk-row-image {
    width: 624px;
    flex-shrink: 0;
  }

  .sk-row-copy {
    width: 516px;
    display: flex;
    flex-direction: column;
    gap: $gap-md;
  }
}

.sk-products {
  display: flex;
  gap: 30px;

  .sk-product-big {
    width: 735px;
    flex-shrink: 0;
  }

  .sk-product-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }
}

.sk-features {
  display: flex;
  justify-content: space-between;
  gap: $gap-lg;

  .sk-feature-list {
    width: 515px;
    display: flex;
    flex-direction: column;
    gap: $gap-xl;
  }
}

// Product
.sk-product-main {
  display: flex;
  align-items: center;
  gap: 140px;

  .sk-product-image {
    width: 625px;
    flex-shrink: 0;
  }

  .sk-product-copy {
    width: 515px;
    display: flex;
    flex-direction: column;
    gap: $gap-md;
  }
}

.sk-related-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: $gap-lg;
}

// Article
.sk-article-title {
  margin-top: 48px;
}

.sk-article-body {
  margin-top: $gap-xl;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sk-article-images {
  margin-top: $gap-xl;
  display: flex;
  gap: $gap-lg;

  .sk-article-image {
    flex: 1;
  }
}

.sk-related-cards {
  display: flex;
  gap: $gap-lg;

  .sk-related-card {
    flex: 1;
  }
}

// About
.sk-about-layout {
  margin-top: $gap-2xl;
  margin-bottom: 98px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 60px;

  .sk-about-left {
    width: 626px;

    .sk-form {
      margin-top: $gap-2xl;
      display: flex;
      flex-direction: column;
      gap: $gap-md;
    }
  }

  .sk-about-image {
    width: 508px;
    flex-shrink: 0;
  }
}
</style>
