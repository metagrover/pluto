import {
  type DetailsHTMLAttributes,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

/** Native details menu with outside-click and Escape dismissal. */
export const DetailsMenu = forwardRef<
  HTMLDetailsElement,
  DetailsHTMLAttributes<HTMLDetailsElement>
>(function DetailsMenu(
  { onPointerDownCapture, onClickCapture, ...props },
  ref,
) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const insideEvents = useRef(new WeakSet<Event>());
  useImperativeHandle(ref, () => detailsRef.current!, []);

  useEffect(() => {
    const dismissOutside = (event: Event) => {
      const details = detailsRef.current;
      if (
        details?.open &&
        !insideEvents.current.has(event) &&
        !details.contains(event.target as Node)
      ) {
        details.open = false;
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      const details = detailsRef.current;
      if (event.key !== 'Escape' || event.defaultPrevented || !details?.open)
        return;
      event.preventDefault();
      details.open = false;
      details.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('click', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('click', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, []);

  return (
    <details
      {...props}
      ref={detailsRef}
      onPointerDownCapture={(event) => {
        // React events from nested portals belong to this menu too.
        insideEvents.current.add(event.nativeEvent);
        onPointerDownCapture?.(event);
      }}
      onClickCapture={(event) => {
        insideEvents.current.add(event.nativeEvent);
        onClickCapture?.(event);
      }}
    />
  );
});
