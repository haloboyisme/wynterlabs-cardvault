import {useEffect} from 'react';

const activeScans = new Set<symbol>();
let leaving = false;
let reset: ReturnType<typeof setTimeout> | undefined;
const message = 'Leave the scanner?\n\nYour camera will stop and unfinished cards may be lost. Cards already saved to your collection will stay safe.\n\nPress OK to leave, or Cancel to keep scanning.';
function click(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.composedPath().find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const destination = new URL(link.href, location.href);
  if (!['http:', 'https:'].includes(destination.protocol)) return;
  if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return;
  if (!window.confirm(message)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  // Do not show a second native warning for an approved document navigation.
  leaving = true;
  queueMicrotask(() => {if (event.defaultPrevented) leaving = false;});
  clearTimeout(reset);
  reset = setTimeout(() => {leaving = false;}, 1000);
}
function unload(event: BeforeUnloadEvent) {
  if (leaving) return;
  event.preventDefault();
  event.returnValue = '';
}
export function useScanExitWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const owner = Symbol('active scan');
    activeScans.add(owner);
    if (activeScans.size === 1) {
      document.addEventListener('click', click, true);
      window.addEventListener('beforeunload', unload);
    }
    return () => {
      activeScans.delete(owner);
      if (!activeScans.size) {
        document.removeEventListener('click', click, true);
        window.removeEventListener('beforeunload', unload);
        clearTimeout(reset);
        leaving = false;
      }
    };
  }, [active]);
}
