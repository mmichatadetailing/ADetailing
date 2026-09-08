/** Nested dialogs must release their own lock without unlocking another overlay. */
export function createScrollLock(getStyle: () => { overflow: string }) {
  let locks = 0;
  let previousOverflow = "";
  return () => {
    const style = getStyle();
    if (locks === 0) previousOverflow = style.overflow;
    locks += 1;
    style.overflow = "hidden";
    let released = false;
    return () => {
      if (released) return;
      released = true;
      locks -= 1;
      if (locks === 0) style.overflow = previousOverflow;
    };
  };
}

export const lockBodyScroll = createScrollLock(() => document.body.style);
