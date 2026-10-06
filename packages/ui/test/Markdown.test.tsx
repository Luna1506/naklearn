import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/Markdown.tsx';

describe('Markdown', () => {
  it('rendert Markdown und erlaubt Lücken-Spans', () => {
    const { container } = render(<Markdown text={'**fett** <span class="cloze">[…]</span>'} />);
    expect(container.querySelector('strong')?.textContent).toBe('fett');
    expect(container.querySelector('span.cloze')).not.toBeNull();
  });
  it('entfernt Skripte und Event-Handler', () => {
    const { container } = render(<Markdown text={'<script>alert(1)</script><img src=x onerror="alert(1)">'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull();
  });
});
