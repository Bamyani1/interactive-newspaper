export { computePageCount, transformArticles } from "./article-transform";
export { transformAds } from "./ad-transform";

import { computePageCount, transformArticles } from "./article-transform";
import { transformAds } from "./ad-transform";

const ocrAdapter = {
  transformArticles,
  transformAds,
  computePageCount,
};

export default ocrAdapter;
