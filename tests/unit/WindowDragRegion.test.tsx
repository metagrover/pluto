import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WindowDragRegion } from '../../src/components/layout/WindowDragRegion';

describe('WindowDragRegion', () => {
  it('renders with drag-region and pointer-events-auto by default', () => {
    const html = renderToStaticMarkup(<WindowDragRegion />);
    expect(html).toContain('drag-region pointer-events-auto');
    expect(html).toContain('aria-hidden="true"');
  });

  it('preserves custom class names while appending drag classes', () => {
    const html = renderToStaticMarkup(
      <WindowDragRegion className="recording-capture-drag" />,
    );
    expect(html).toContain('recording-capture-drag drag-region pointer-events-auto');
  });

  it('supports fixed and absolute placement classes', () => {
    const html = renderToStaticMarkup(
      <WindowDragRegion className="fixed inset-x-0 top-0 z-[60] h-9" />,
    );
    expect(html).toContain('fixed inset-x-0 top-0 z-[60] h-9 drag-region pointer-events-auto');
  });

  it('passes through extra HTML attributes', () => {
    const html = renderToStaticMarkup(
      <WindowDragRegion data-testid="titlebar-drag" style={{ height: 40 }} />,
    );
    expect(html).toContain('data-testid="titlebar-drag"');
    expect(html).toContain('style="height:40px"');
  });
});
