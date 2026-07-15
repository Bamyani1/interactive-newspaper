import { test, expect } from "../fixtures";
import { waitForSettledUi } from "../support/harness";

test("TimeControls lets Tab move focus before closing its date popup", async ({
  page,
}) => {
  await page.goto("/search");
  await waitForSettledUi(page);

  await page.getByRole("button", { name: "Select edition date" }).click();
  const listbox = page.getByRole("listbox", { name: "Available editions" });
  const activeOption = listbox.getByRole("option", { selected: true });
  await expect(activeOption).toBeFocused();

  await page.keyboard.press("Tab");

  await expect(
    page.getByRole("textbox", { name: "Search the archive" }),
  ).toBeFocused();
  await expect(listbox).toBeHidden();
});

test("Mobile More lets Shift+Tab reach its trigger before closing", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The More menu is a mobile navigation control.");

  await page.goto("/edition/2006-04-20");
  await waitForSettledUi(page);

  const moreButton = page.getByRole("button", { name: "More sections" });
  await moreButton.click();
  const menu = page.getByRole("menu", { name: "More sections" });
  await expect(menu.getByRole("menuitem").first()).toBeFocused();

  await page.keyboard.press("Shift+Tab");

  await expect(moreButton).toBeFocused();
  await expect(menu).toBeHidden();
});
