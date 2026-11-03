<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { Moon, Sunny } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { useTheme } from "@/composables/useTheme";
import { useUserStore } from "@/stores";

const navItems = [
  { label: "Shop", to: "/shop" },
  { label: "Article", to: "/article" },
  { label: "About", to: "/about" },
  { label: "Game", to: "/game" },
  { label: "Dashboard", to: "/dashboard" },
];

const { theme, toggle } = useTheme();
const userStore = useUserStore();
const router = useRouter();

const isLoggedIn = computed(() => userStore.isLoggedIn);
const user = computed(() => userStore.user);
const avatarText = computed(() =>
  (user.value?.name || user.value?.email || "?").charAt(0).toUpperCase()
);

async function onLogout() {
  await userStore.logout();
  ElMessage.success("已退出登录");
  router.push("/");
}
</script>

<template>
  <header class="site-header">
    <div class="container site-header-inner">
      <router-link to="/" class="site-header-logo">Site name</router-link>
      <nav class="header-nav">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-link"
        >
          {{ item.label }}
        </router-link>

        <!-- 主题切换按钮 -->
        <button
          class="theme-toggle"
          type="button"
          :aria-label="theme === 'dark' ? '切换到日光模式' : '切换到暗夜模式'"
          @click="toggle"
        >
          <el-icon :size="20">
            <Sunny v-if="theme === 'dark'" />
            <Moon v-else />
          </el-icon>
        </button>

        <!-- 登录态：头像下拉 -->
        <el-dropdown v-if="isLoggedIn" trigger="click" class="user-menu">
          <span class="user-trigger">
            <img
              v-if="user?.avatar"
              class="user-avatar"
              :src="user.avatar"
              alt="avatar"
            />
            <span v-else class="user-avatar user-avatar--text">{{
              avatarText
            }}</span>
            <span class="user-name">{{ user?.name || user?.email }}</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>{{ user?.email }}</el-dropdown-item>
              <el-dropdown-item divided @click="onLogout"
                >退出登录</el-dropdown-item
              >
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <!-- 未登录：登录按钮 -->
        <el-button
          v-else
          class="btn-primary nav-cta"
          @click="$router.push('/login')"
        >
          登录
        </el-button>
      </nav>
    </div>
  </header>
</template>

<style scoped lang="scss">
.site-header {
  position: relative;
  z-index: 10;
  // 栏专用配色：与页面主体（奶油/深蓝）刻意拉开对比，日间宝蓝、夜间近黑
  background: var(--bar-bg);
  border-bottom: var(--border-ink) solid var(--bar-ink);

  // 导航压在深色 hero 图上时，仍沿用栏专用底色，保证与主体区分、文字可读
  &-inner {
    height: $header-height;
    @include flex-center-y;
    justify-content: space-between;
  }

  &-logo {
    display: inline-block;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 400;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 1;
    // 原色锚点：品红 logo 在白/黑栏上形成波普撞色
    color: var(--pop-magenta);
    transition: transform 0.18s ease;

    &:hover {
      transform: scale(1.06);
    }
  }
}

.header-nav {
  @include flex-center-y;
  gap: $gap-xl;
}

.nav-link {
  display: inline-block;
  font-size: $fs-body;
  font-weight: 700;
  line-height: $lh-body;
  color: var(--bar-ink);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  position: relative;
  transition: color 0.2s ease, transform 0.18s ease;

  &::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: -4px;
    width: 0;
    height: 3px;
    background: var(--pop-red);
    transition: width 0.2s ease;
  }

  &:hover::after,
  &.router-link-active::after {
    width: 100%;
  }

  &:hover {
    color: var(--pop-red);
    transform: scale(1.06);
  }
}

.theme-toggle {
  width: 40px;
  height: 40px;
  border: 2px solid var(--bar-ink);
  border-radius: 50%;
  background: var(--toggle-bg);
  color: var(--bar-ink);
  cursor: pointer;
  @include flex-center;
  box-shadow: var(--shadow-press);
  transition: transform 0.18s ease, box-shadow 0.18s ease,
    background-color 0.2s ease, color 0.2s ease;

  &:hover {
    // 上浮 + 阴影加深 + 背景切换为波普品红，形成明显的状态转换
    transform: translate(-2px, -2px);
    box-shadow: var(--shadow-hard-sm);
    background: var(--pop-magenta);
    color: var(--color-ink);
  }

  &:active {
    // 按下回弹
    transform: translate(1px, 1px);
    box-shadow: var(--shadow-press);
  }
}

.nav-cta {
  height: 44px;
  padding: 0 22px;
  font-size: $fs-body-sm;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  // 波普按钮：透明底 + 粗黑描边，与漫画格风格统一
  --el-button-bg-color: transparent;
  --el-button-border-color: var(--bar-ink);
  --el-button-text-color: var(--bar-ink);
  --el-button-hover-bg-color: rgb(0 0 0 / 8%);
  --el-button-hover-border-color: var(--bar-ink);
  --el-button-hover-text-color: var(--bar-ink);
  --el-button-active-bg-color: transparent;
  border-width: var(--border-ink);
}

/* 登录态用户菜单 */
.user-menu {
  margin-left: 4px;
}

.user-trigger {
  @include flex-center-y;
  gap: 8px;
  cursor: pointer;
  outline: none;
  transition: transform 0.18s ease;

  &:hover {
    transform: translate(-2px, -2px);
  }
}

.user-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--bar-ink);
  box-shadow: var(--shadow-press);
  transition: box-shadow 0.18s ease;

  &--text {
    @include flex-center;
    background: var(--pop-yellow);
    color: var(--color-black);
    font-weight: 700;
    font-size: $fs-body-sm;
  }

  .user-trigger:hover & {
    box-shadow: var(--shadow-hard-sm);
  }
}

.user-name {
  display: inline-block;
  font-size: $fs-body-sm;
  font-weight: 700;
  color: var(--bar-ink);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: transform 0.18s ease;

  &:hover {
    transform: scale(1.05);
  }
}
</style>
