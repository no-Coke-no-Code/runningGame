import { createRouter, createWebHistory } from "vue-router";
import { ElMessageBox } from "element-plus";
import { useUserStore } from "@/stores";

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: "/",
      name: "landing",
      component: () => import("@/views/LandingPage.vue"),
    },
    {
      path: "/shop",
      name: "shop",
      component: () => import("@/views/ShopPage.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/product/:id?",
      name: "product",
      component: () => import("@/views/ProductDetailPage.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/article/:id?",
      name: "article",
      component: () => import("@/views/ArticlePage.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/about",
      name: "about",
      component: () => import("@/views/AboutPage.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: () => import("@/views/DashboardPage.vue"),
      meta: { requiresAuth: true, hideChrome: true },
    },
    {
      path: "/game",
      name: "game",
      component: () => import("@/views/GamePage.vue"),
      meta: {},
    },
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginPage.vue"),
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  const userStore = useUserStore();

  // 已登录却访问登录页：直接回首页
  if (to.name === "login" && userStore.isLoggedIn) {
    return { name: "landing" };
  }

  // 受保护页面 + 未登录：弹窗让用户选择是否去登录
  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    try {
      await ElMessageBox.confirm(
        "该页面需要登录后才能查看，是否前往登录页？",
        "需要登录",
        {
          confirmButtonText: "去登录",
          cancelButtonText: "再看看",
          type: "warning",
          confirmButtonClass: "btn-pop-confirm",
          cancelButtonClass: "btn-pop-cancel",
          closeOnClickModal: false,
          closeOnPressEscape: false,
        }
      );
      // 用户确认：带 redirect 跳登录页，并中断当前导航
      return { name: "login", query: { redirect: to.fullPath } };
    } catch {
      // 用户取消：留在当前页，中断本次跳转
      return false;
    }
  }

  return true;
});

export default router;
