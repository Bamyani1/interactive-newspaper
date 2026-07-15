import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("primitive gallery fits a 390px reduced-motion viewport", async ({ page }) => {
  const response = await page.goto("/dev/primitives");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Primitive component library" }),
  ).toBeVisible();

  const sizeRow = page.getByTestId("button-size-row");
  await expect(sizeRow).toBeVisible();
  expect(await sizeRow.evaluate((element) => getComputedStyle(element).flexWrap)).toBe(
    "wrap",
  );

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.viewportWidth).toBe(390);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);

  const iconBox = await page
    .getByRole("button", { name: "Open controls" })
    .boundingBox();
  expect(iconBox?.width).toBe(44);
  expect(iconBox?.height).toBe(44);

  const computed = await page.evaluate(() => {
    const standardButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="button-size-row"] button:not([aria-label])',
    );
    const input = document.querySelector<HTMLInputElement>("#i1");
    if (!standardButton || !input) throw new Error("Primitive fixtures missing");
    const buttonStyle = getComputedStyle(standardButton);
    const inputStyle = getComputedStyle(input);
    return {
      buttonLetterSpacing: Number.parseFloat(buttonStyle.letterSpacing),
      inputFontSize: inputStyle.fontSize,
      inputPaddingBlock: inputStyle.paddingTop,
      inputPaddingInline: inputStyle.paddingLeft,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      bodyTransition: getComputedStyle(document.body).transitionProperty,
    };
  });

  expect(computed.buttonLetterSpacing).toBeCloseTo(1.68, 2);
  expect(computed.inputFontSize).toBe("16px");
  expect(computed.inputPaddingBlock).toBe("12px");
  expect(computed.inputPaddingInline).toBe("16px");
  expect(computed.scrollBehavior).toBe("auto");
  expect(computed.bodyTransition).toBe("none");
});
