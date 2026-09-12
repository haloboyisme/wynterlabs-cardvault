import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ScanReveal } from "./ScanReveal";
it("flips the selected card, preserves its image label and offers plain mode",()=>{
 const {container,rerender}=render(<ScanReveal name="Example card" imageUris={{}} revealKey="capture-1"/>);
 expect(screen.getByRole("img",{name:"Image unavailable for Example card"})).toBeVisible();
 expect(container.querySelector(".scan-reveal-flip")).not.toBeNull();
 const first=container.querySelector(".scan-reveal-art");
 rerender(<ScanReveal name="Example card" imageUris={{}} revealKey="capture-2"/>);
 expect(container.querySelector(".scan-reveal-art")).not.toBe(first);
 fireEvent.change(screen.getByLabelText("Preview animation"),{target:{value:"instant"}});
 expect(container.querySelector(".scan-reveal-instant")).not.toBeNull();
 expect(screen.getByRole("button",{name:"Replay card reveal"})).toBeVisible();
});
