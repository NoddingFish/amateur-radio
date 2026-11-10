"use strict";

if (window.matchMedia("(pointer: coarse)").matches) {
  ["gesturestart", "gesturechange"].forEach((type) => {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  });
}

document.querySelectorAll("[data-open-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    const dialog = document.getElementById(button.dataset.openDialog);
    dialog.showModal();
    dialog.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  });
});
document.querySelectorAll(".navigation-dialog, .hint-dialog").forEach((dialog) => {
  dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
});
window.matchMedia("(max-width: 760px)").addEventListener("change", () => {
  document.querySelectorAll(".navigation-dialog[open]").forEach((dialog) => dialog.close());
});
