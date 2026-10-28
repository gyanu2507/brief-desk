import { expect, test } from "@playwright/test";
import { mockDeskApis } from "./helpers";

test.describe("desk shell", () => {
  test.beforeEach(async ({ page }) => {
    await mockDeskApis(page);
  });

  test("loads branding, sources, and primary run control", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("BRIEF-DESK")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Multi-source briefing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Auto", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Trending", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run agent" })).toBeVisible();
  });

  test("switching source updates the primary CTA", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Trending", exact: true }).click();
    await expect(page.getByRole("button", { name: "Rank trending" })).toBeVisible();
    await page.getByRole("button", { name: "Corpus", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start brief" })).toBeVisible();
  });
});
