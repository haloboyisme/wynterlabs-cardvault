import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {ScanPhotoWindow} from "./ScanPhotoWindow";
afterEach(cleanup);
it("leaves search usable, moves with keyboard, and closes explicitly", () => {
  const close = vi.fn();
  render(<><input aria-label="Manual search"/><ScanPhotoWindow src="blob:card" onClose={close}/></>);
  fireEvent.change(screen.getByLabelText("Manual search"), {target:{value:"Black Lotus"}});
  expect(screen.getByLabelText("Manual search")).toHaveValue("Black Lotus");
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-modal", "false");
  const before = dialog.style.left;
  fireEvent.keyDown(screen.getByRole("button", {name:"Move card photo"}), {key:"ArrowRight"});
  expect(dialog.style.left).not.toBe(before);
  fireEvent.click(screen.getByRole("button", {name:"Close enlarged card"}));
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document, {key:"Escape"});
  expect(close).toHaveBeenCalledTimes(2);
});
