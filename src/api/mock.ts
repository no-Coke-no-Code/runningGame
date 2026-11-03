import {
  beetAndSourdoughStillLife,
  mushroomsOnBark,
  mushroomsScattered,
  passionFruitStillLife,
  peachAndCameraFlatlay,
  portraitManRedBeanie,
  portraitWomanPlants,
  portraitWomanStreet,
  radishesScattered,
  rainierCherries,
  stackedPears,
  summerBrunchTable,
  summerFruitAndWine,
  sunflowerCroissantBlanket,
  sunflowerCroissantPicnic,
  twoPears,
  watermelonSlices,
  watermelonSlicesFlatlay,
  watermelonSlicesTop,
  wineAndBaguetteStillLife,
} from "@/assets/figma";
import type {
  AboutContent,
  ArticleCardItem,
  ArticleContent,
  LandingContent,
  Product,
  ProductDetail,
  ShopContent,
} from "./types";

/** 模拟网络延迟 */
export function mockResolve<T>(data: T, delay = 300): Promise<T> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(structuredClone(data)), delay)
  );
}

/* ---------- Landing ---------- */

export const landingMock: LandingContent = {
  hero: {
    title: "Landing page title",
    sub: "Subheading that sets up context, shares more info about the website, or generally gets people psyched to keep scrolling.",
    buttonText: "Button",
    image: passionFruitStillLife,
  },
  featureCards: [
    {
      image: summerFruitAndWine,
      title: "Subheading",
      body: "Body text for whatever you’d like to add more to the subheading.",
    },
    {
      image: wineAndBaguetteStillLife,
      title: "Subheading",
      body: "Body text for whatever you’d like to expand on the main point.",
    },
    {
      image: sunflowerCroissantPicnic,
      title: "Subheading",
      body: "Body text for whatever you’d like to share more.",
    },
  ],
  textBlocks: [
    {
      title: "Subheading",
      body: "Body text for whatever you’d like to expand on the main point.",
    },
    {
      title: "Subheading",
      body: "Body text for whatever you’d like to say. Add main takeaway points, quotes, anecdotes.",
    },
    {
      title: "Subheading",
      body: "Body text for whatever you’d like to add more to the main point. It provides details, explanations, and context.",
    },
  ],
  sideImage: peachAndCameraFlatlay,
  bigCards: [
    {
      image: summerBrunchTable,
      title: "Subheading",
      body: "Body text for whatever you’d like to add more to the subheading.",
    },
    {
      image: sunflowerCroissantBlanket,
      title: "Subheading",
      body: "Body text for whatever you’d like to expand on the main point.",
    },
  ],
  quotes: [
    {
      quote: "“A terrific piece of praise”",
      name: "Name",
      description: "Description",
      avatar: portraitManRedBeanie,
    },
    {
      quote: "“A fantastic bit of feedback”",
      name: "Name",
      description: "Description",
      avatar: portraitWomanPlants,
    },
    {
      quote: "“A genuinely glowing review”",
      name: "Name",
      description: "Description",
      avatar: portraitWomanStreet,
    },
  ],
};

/* ---------- Shop ---------- */

export const shopMock: ShopContent = {
  hero: {
    title: "Shop title",
    sub: "Subheading with description of your shopping site",
    buttonText: "Button",
    image: stackedPears,
  },
  rows: [
    {
      heading: "Heading",
      sub: "A subheading for this section, as long or as short as you like",
      image: twoPears,
      imageFirst: false,
    },
    {
      heading: "Heading",
      sub: "A subheading for this section, as long or as short as you like",
      image: watermelonSlices,
      imageFirst: true,
    },
  ],
  featuredProduct: {
    id: "featured",
    image: stackedPears,
    title: "Featured product",
    description: "Description of featured product",
    price: "$10.99",
  },
  products: [
    {
      id: "p1",
      image: mushroomsScattered,
      title: "Product",
      description: "Description of top product",
      price: "$10.99",
    },
    {
      id: "p2",
      image: mushroomsOnBark,
      title: "Product",
      description: "Description of lower product",
      price: "$10.99",
    },
  ],
  featureLists: [
    [
      {
        icon: "globe",
        title: "Subheading",
        body: "Body text for whatever you’d like to say. Add main takeaway points, quotes, anecdotes, or even a very very short story.",
      },
      {
        icon: "lock",
        title: "Subheading",
        body: "Body text for whatever you’d like to claim. Add main takeaway points, quotes, anecdotes, or even a very very short story.",
      },
    ],
    [
      {
        icon: "avatar",
        title: "Subheading",
        body: "Body text for whatever you’d like to suggest. Add main takeaway points, quotes, anecdotes, or even a very very short story.",
      },
      {
        icon: "calendar",
        title: "Subheading",
        body: "Body text for whatever you’d like to type. Add main takeaway points, quotes, anecdotes, or even a very very short story.",
      },
    ],
  ],
};

/* ---------- Product Detail ---------- */

export const productDetailMock: ProductDetail = {
  id: "p1",
  name: "Product name",
  sub: "Subheading",
  price: "$10.99",
  description:
    "Body text for describing what this product is and why this product is simply a must-buy.",
  image: radishesScattered,
  finePrint: "Text box for additional details or fine print",
};

export const relatedProductsMock: Product[] = [
  {
    id: "p1",
    image: mushroomsScattered,
    title: "Product",
    description: "Description of first product",
    price: "$10.99",
  },
  {
    id: "p2",
    image: watermelonSlicesFlatlay,
    title: "Product",
    description: "Description of second product",
    price: "$10.99",
  },
  {
    id: "p3",
    image: watermelonSlicesTop,
    title: "Product",
    description: "Description of third product",
    price: "$10.99",
  },
  {
    id: "p4",
    image: mushroomsOnBark,
    title: "Product",
    description: "Description of fourth product",
    price: "$10.99",
  },
  {
    id: "p5",
    image: beetAndSourdoughStillLife,
    title: "Product",
    description: "Description of fifth product",
    price: "$10.99",
  },
  {
    id: "p6",
    image: rainierCherries,
    title: "Product",
    description: "Description of sixth product",
    price: "$10.99",
  },
];

/* ---------- Article ---------- */

export const articleMock: ArticleContent = {
  id: "a1",
  title: "Article or post title",
  subtitle:
    "Subheading that sets up context, shares more info about the author, or generally gets people psyched to keep reading",
  cover: passionFruitStillLife,
  paragraph1: `Body text for your whole article or post. We’ll put in some lorem ipsum to show how a filled-out page might look:

Excepteur efficient emerging, minim veniam anim aute carefully curated Ginza conversation exquisite perfect nostrud nisi intricate Content. Qui international first-class nulla ut. Punctual adipisicing, essential lovely queen tempor eiusmod irure. Exclusive izakaya charming Scandinavian impeccable aute quality of life soft power pariatur Melbourne occaecat discerning. Qui wardrobe aliquip, et Porter destination Toto remarkable officia Helsinki excepteur Basset hound. Zürich sleepy perfect consectetur.

Exquisite sophisticated iconic cutting-edge laborum deserunt Addis Ababa esse bureaux cupidatat id minim. Sharp classic the best commodo nostrud delightful. Conversation aute Rochester id. Qui sunt remarkable deserunt intricate airport handsome K-pop excepteur classic esse Asia-Pacific laboris.`,
  paragraph2: `Excepteur efficient emerging, minim veniam anim cloying aute carefully curated gauche. Espresso exquisite perfect nostrud nisi intricate. Punctual adipisicing Borzoi, essential lovely tempor eiusmod irure. Exclusive izakaya charming Quezon City impeccable aute quality of life soft power pariatur occaecat discerning. Qui wardrobe aliquip, et Amadeus rock opera.

Exquisite sophisticated iconic cutting-edge laborum deserunt esse bureaux cupidatat id minim. Sharp classic the best commodo nostrud delightful. Conversation aute wifey id. Qui sunt remarkable deserunt intricate airport excepteur classic esse riot girl.`,
  images: [summerBrunchTable, wineAndBaguetteStillLife],
};

export const relatedArticlesMock: ArticleCardItem[] = [
  {
    id: "a2",
    image: watermelonSlicesFlatlay,
    title: "Title",
    author: "Author",
  },
  { id: "a3", image: rainierCherries, title: "Title", author: "Author" },
  { id: "a4", image: mushroomsOnBark, title: "Title", author: "Author" },
];

/* ---------- About ---------- */

export const aboutMock: AboutContent = {
  title: "About",
  sub: "Subheading for description or instructions",
  paragraph: `Body text for your whole article or post. We’ll put in some lorem ipsum to show how a filled-out page might look:

Excepteur efficient emerging, minim veniam anim aute carefully curated Ginza conversation exquisite perfect nostrud nisi intricate Content. Qui international first-class nulla ut. Punctual adipisicing, essential lovely queen tempor eiusmod irure. Exclusive izakaya charming Scandinavian impeccable aute quality of life soft power pariatur Melbourne occaecat discerning. Qui wardrobe aliquip, et Porter destination Toto remarkable officia Helsinki excepteur Basset hound. Zürich sleepy perfect consectetur.`,
  image: portraitManRedBeanie,
};

/* ---------- Auth ---------- */

const demoUser = {
  id: "u_demo",
  name: "Demo User",
  email: "coke43",
  avatar: portraitManRedBeanie,
};

export const authMock = {
  /** 演示账号：coke43 / 123456 */
  login(email: string, password: string) {
    if (email === "coke43" && password === "123456") {
      return { token: "mock-token-" + Date.now(), user: demoUser };
    }
    return null;
  },
  me: demoUser,
  delay: 500,
};
