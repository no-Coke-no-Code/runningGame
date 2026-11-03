/* ---------- 通用模型 ---------- */

export interface Product {
  id: string;
  image: string;
  title: string;
  description: string;
  price: string;
}

export interface FeatureCardItem {
  image: string;
  title: string;
  body: string;
}

export interface QuoteItem {
  quote: string;
  name: string;
  description: string;
  avatar: string;
}

export interface ArticleCardItem {
  id: string;
  image: string;
  title: string;
  author: string;
}

/* ---------- Landing ---------- */

export interface LandingContent {
  hero: {
    title: string;
    sub: string;
    buttonText: string;
    image: string;
  };
  featureCards: FeatureCardItem[];
  textBlocks: Array<{ title: string; body: string }>;
  sideImage: string;
  bigCards: FeatureCardItem[];
  quotes: QuoteItem[];
}

/* ---------- Shop ---------- */

export interface ShopHero {
  title: string;
  sub: string;
  buttonText: string;
  image: string;
}

export interface ShopRow {
  heading: string;
  sub: string;
  image: string;
  /** true = 图片在左，false = 图片在右 */
  imageFirst: boolean;
}

export interface ShopFeatureItem {
  /** 图标标识：globe | lock | avatar | calendar */
  icon: string;
  title: string;
  body: string;
}

export interface ShopContent {
  hero: ShopHero;
  rows: ShopRow[];
  featuredProduct: Product;
  products: Product[];
  featureLists: ShopFeatureItem[][];
}

/* ---------- Product Detail ---------- */

export interface ProductDetail {
  id: string;
  name: string;
  sub: string;
  price: string;
  description: string;
  image: string;
  finePrint: string;
}

/* ---------- Article ---------- */

export interface ArticleContent {
  id: string;
  title: string;
  subtitle: string;
  cover: string;
  paragraph1: string;
  paragraph2: string;
  images: [string, string];
}

/* ---------- About ---------- */

export interface AboutContent {
  title: string;
  sub: string;
  paragraph: string;
  image: string;
}

export interface ContactFormPayload {
  firstName: string;
  lastName: string;
  email: string;
  message: string;
}

/* ---------- Auth / User ---------- */

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  /** 头像地址，缺省时由首字母回退 */
  avatar?: string;
}
