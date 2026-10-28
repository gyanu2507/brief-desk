import { expect, test } from "@playwright/test";
import {
  mockBriefRunFailure,
  mockBriefRunSuccess,
  mockDeskApis,
} from "./helpers";

test.describe("brief-run workflow", () => {
  test.beforeEach(async ({ page }) => {
    await mockDeskApis(page);
  });

  test("successful auto run shows the drafted brief", async ({ page }) => {
    const answer =
      "Plan: auto · overview · facebook/react\n\nRisks look manageable for an eng manager. See #123.";
    await mockBriefRunSuccess(page, answer);
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Run agent" })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Run agent" }).click();

    await expect(page.getByText(/Risks look manageable/)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("failed run shows error and Retry", async ({ page }) => {
    await mockBriefRunFailure(page, "MCP orchestrate failed");
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Run agent" })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Run agent" }).click();

    await expect(page.locator(".run-error-bar")).toContainText("MCP orchestrate failed", {
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("Cancel run aborts an in-flight brief", async ({ page }) => {
    await page.route("**/api/brief-run", async (route) => {
      // Hang until the client aborts.
      await new Promise((resolve) => {
        route.request().frame()?.page()?.on("close", resolve);
        setTimeout(resolve, 30_000);
      });
      try {
        await route.abort("failed");
      } catch {
        // already cancelled
      }
    });

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Run agent" })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Run agent" }).click();
    await expect(page.getByRole("button", { name: "Cancel run" })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Cancel run" }).click();
    await expect(page.getByText(/Cancelled/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
