import { test, expect, type Page } from "../fixtures";
import { waitForSettledUi } from "../support/harness";

const SOURCE_EDITION = "/edition/2006-04-20";
const TARGET_EDITION = "/edition/1994-01-19";

async function setFeedScroll(page: Page, top: number) {
  const feed = page.locator("main .scrollbar-hide").first();
  await feed.evaluate((element, scrollTop) => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event("scroll"));
  }, top);
  await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(top);
  return feed;
}

test("edition feed restores across App Router Back and Forward", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The inner feed is independently scrollable on desktop.");

  await page.goto(SOURCE_EDITION);
  await waitForSettledUi(page);
  const feed = await setFeedScroll(page, 600);

  await page.getByRole("button", { name: "Select edition date" }).click();
  const editionList = page.getByRole("listbox", { name: "Available editions" });
  const january1994 = editionList.getByRole("group", { name: "January 1994" });
  await january1994.getByRole("option", { name: "Jan 19", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${TARGET_EDITION}$`));
  await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(0);

  await setFeedScroll(page, 180);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${SOURCE_EDITION}$`));
  await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(600);

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${TARGET_EDITION}$`));
  await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(180);

  await page.getByRole("link", { name: "Search the archive" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${TARGET_EDITION}$`));
  await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(180);
});
