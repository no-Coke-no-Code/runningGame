<script setup lang="ts">
const columns = [
  { topic: 'Topic', pages: ['Page', 'Page', 'Page'] },
  { topic: 'Topic', pages: ['Page', 'Page', 'Page'] },
  { topic: 'Topic', pages: ['Page', 'Page', 'Page'] },
];

const socials = [
  {
    name: 'facebook',
    path: 'M13.5 9H16V6h-2.5C11.6 6 10 7.6 10 9.5V11H8v3h2v6h3v-6h2.5l.5-3H13V9.5c0-.3.2-.5.5-.5Z',
  },
  {
    name: 'linkedin',
    path: 'M6.5 8.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM5 10h3v9H5v-9Zm5.5 0h2.8v1.3h.1c.4-.8 1.4-1.6 2.9-1.6 3 0 3.7 2 3.7 4.6V19h-3v-4.2c0-1 0-2.3-1.4-2.3s-1.7 1.1-1.7 2.2V19h-3v-9Z',
  },
  {
    name: 'youtube',
    path: 'M20 8.2s-.2-1.4-.8-2c-.7-.8-1.6-.8-2-.9C14.4 5 12 5 12 5s-2.4 0-5.2.3c-.4.1-1.3.1-2 .9-.6.6-.8 2-.8 2S3.8 9.9 3.8 11.5v1.5c0 1.7.2 3.3.2 3.3s.2 1.4.8 2c.7.8 1.7.8 2.2.9 1.6.2 5 .3 5 .3s2.4 0 5.2-.3c.4-.1 1.3-.1 2-.9.6-.6.8-2 .8-2s.2-1.7.2-3.3v-1.5c0-1.7-.2-3.3-.2-3.3ZM10 14.8V9.3l5.2 2.8L10 14.8Z',
  },
  {
    name: 'instagram',
    path: 'M12 8.8A3.2 3.2 0 1 0 12 15.2 3.2 3.2 0 0 0 12 8.8ZM12 13.4a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm4.1-4.2a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 6.5c-1.5 0-1.7 0-2.3.1-.6 0-1 .1-1.4.3-.4.1-.7.3-1 .6-.3.3-.5.6-.6 1-.2.4-.3.8-.3 1.4-.1.6-.1.8-.1 2.3s0 1.7.1 2.3c0 .6.1 1 .3 1.4.1.4.3.7.6 1 .3.3.6.5 1 .6.4.2.8.3 1.4.3.6.1.8.1 2.3.1s1.7 0 2.3-.1c.6 0 1-.1 1.4-.3.4-.1.7-.3 1-.6.3-.3.5-.6.6-1 .2-.4.3-.8.3-1.4.1-.6.1-.8.1-2.3s0-1.7-.1-2.3c0-.6-.1-1-.3-1.4a2.6 2.6 0 0 0-.6-1c-.3-.3-.6-.5-1-.6-.4-.2-.8-.3-1.4-.3-.6-.1-.8-.1-2.3-.1ZM12 5c1.5 0 1.7 0 2.4.1.7 0 1.2.1 1.7.3.5.2.9.4 1.3.8.4.4.6.8.8 1.3.2.5.3 1 .3 1.7.1.7.1.9.1 2.4s0 1.7-.1 2.4c0 .7-.1 1.2-.3 1.7a3.6 3.6 0 0 1-.8 1.3c-.4.4-.8.6-1.3.8-.5.2-1 .3-1.7.3-.7.1-.9.1-2.4.1s-1.7 0-2.4-.1c-.7 0-1.2-.1-1.7-.3a3.6 3.6 0 0 1-1.3-.8 3.6 3.6 0 0 1-.8-1.3c-.2-.5-.3-1-.3-1.7C5 13.7 5 13.5 5 12s0-1.7.1-2.4c0-.7.1-1.2.3-1.7.2-.5.4-.9.8-1.3.4-.4.8-.6 1.3-.8.5-.2 1-.3 1.7-.3C9.9 5 10.1 5 11.6 5Z',
  },
];
</script>

<template>
  <footer class="site-footer">
    <div class="container">
      <div class="site-footer-divider" />
      <div class="site-footer-inner">
        <div class="site-footer-brand">
          <router-link to="/" class="site-footer-logo">Site name</router-link>
          <div class="social-icons">
            <a v-for="s in socials" :key="s.name" href="#" class="social-btn" :aria-label="s.name" @click.prevent>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="#828282">
                <path :d="s.path" />
              </svg>
            </a>
          </div>
        </div>
        <div class="site-footer-links">
          <div v-for="(col, i) in columns" :key="i" class="site-footer-col">
            <p class="site-footer-topic">{{ col.topic }}</p>
            <a v-for="(p, j) in col.pages" :key="j" href="#" class="site-footer-link" @click.prevent>{{ p }}</a>
          </div>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.site-footer {
  // 栏专用配色：与页面主体（奶油/深蓝）刻意区分，日间宝蓝、夜间近黑
  background: var(--bar-bg);
  color: var(--bar-ink);
  border-top: var(--border-ink-lg) solid var(--bar-ink);

  &-divider {
    height: 0;
    background: transparent;
  }

  &-inner {
    min-height: 263px;
    @include flex-center-y;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 32px;
  }

  &-brand {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 51px 0;
    gap: 24px;
  }

  &-logo {
    display: inline-block;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 400;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 1;
    // 与 header logo 呼应的原色锚点
    color: var(--pop-magenta);
    transition: transform 0.18s ease;

    &:hover {
      transform: scale(1.06);
    }
  }

  &-links {
    display: flex;
    gap: $gap-lg;
    flex-wrap: wrap;
  }

  &-col {
    width: 187px;
    display: flex;
    flex-direction: column;
    gap: $gap-md;
  }

  &-topic {
    font-family: var(--font-display);
    font-size: $fs-body-sm;
    font-weight: 400;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--bar-ink);
  }

  &-link {
    display: inline-block;
    font-size: $fs-body-sm;
    font-weight: 600;
    line-height: $lh-body-sm;
    color: var(--bar-ink);
    transition:
      color 0.2s ease,
      transform 0.18s ease;

    &:hover {
      color: var(--pop-yellow);
      transform: scale(1.05);
    }
  }
}

.social-icons {
  display: flex;
  gap: $gap-xs;
}

.social-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid var(--bar-ink);
  background: var(--pop-blue);
  @include flex-center;
  transition:
    transform 0.12s ease,
    background-color 0.2s ease;

  svg {
    fill: #fff;
  }

  &:hover {
    background: var(--pop-magenta);
    transform: translateY(-2px);
  }
}
</style>
