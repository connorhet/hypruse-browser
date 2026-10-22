// @vitest-environment jsdom
import { pageText } from '../../src/content/pagetext';
import { fakeGeometry } from '../helpers/fake-geometry';

function textOf(html: string, max?: number): string {
  document.body.innerHTML = html;
  const geometry = fakeGeometry(document);
  return pageText(document, geometry, geometry.viewport(), max);
}

describe('pageText', () => {
  it('reads what is shown in the viewport, in document order', () => {
    expect(
      textOf(`
        <h1 data-rect="0 0 500 40">Checkout</h1>
        <p data-rect="0 50 500 20">Payment   accepted.</p>
        <p data-rect="0 80 500 20">Order <b data-rect="60 80 40 20">42</b> is on its way</p>`),
    ).toBe('Checkout Payment accepted. Order 42 is on its way');
  });

  it('never reads a field, an editable region or code', () => {
    expect(
      textOf(`
        <p data-rect="0 0 500 20">Card holder</p>
        <input data-rect="0 30 200 20" value="Ada Lovelace">
        <textarea data-rect="0 60 200 40">private notes</textarea>
        <select data-rect="0 110 200 20"><option>Secret option</option></select>
        <div contenteditable data-rect="0 140 200 40"><p data-rect="0 140 200 20">draft</p></div>
        <script>var token = 'abc'</script>`),
    ).toBe('Card holder');
  });

  it('leaves out hidden text and text outside the viewport', () => {
    expect(
      textOf(`
        <p data-rect="0 0 500 20">Shown</p>
        <p data-rect="0 30 500 20" style="display: none">Display none</p>
        <p data-rect="0 60 500 20" style="visibility: hidden">Invisible</p>
        <p data-rect="0 90 500 20" aria-hidden="true">Aria hidden</p>
        <p data-rect="0 120 0 0">No box</p>
        <p data-rect="0 900 500 20">Below the fold</p>`),
    ).toBe('Shown');
  });

  it('is cut to the limit', () => {
    expect(textOf('<p data-rect="0 0 500 20">abcdefghij klmnop</p>', 12)).toBe('abcdefghij k');
  });
});
