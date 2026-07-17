import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { App } from "./App";

beforeEach(() => {
  window.history.replaceState({}, "", "/?mode=edge");
});

test("an investigator can move from Organization activity to the exact failed Tool evidence", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: /inspect session-edge-017/i }));
  await user.click(screen.getByRole("button", { name: /reveal exact failed tool/i }));

  expect(screen.getByRole("heading", { name: /failed tool evidence/i })).toBeVisible();
  expect(screen.getByText("tool_use_fail_017")).toBeVisible();
  expect(screen.getByText(/permission denied: \/workspace\/dist/i)).toBeVisible();
});
