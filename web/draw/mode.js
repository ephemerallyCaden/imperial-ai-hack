// Shell adapter for Caden's Draw module (#118): mount(el) -> unmount. mountDraw has no unmount of its own, so this
// stops its sim worker and removes the stylesheet when the user leaves Draw.
import { mountDraw } from "./draw.js";

export function mount(el) {
  const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: new URL("./draw.css", import.meta.url).href });
  document.head.append(css);
  const { worker } = mountDraw(el);
  return () => { worker.terminate(); css.remove(); el.classList.remove("dr-root"); };
}
