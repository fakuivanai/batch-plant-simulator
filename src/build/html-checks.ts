// Checks on the built pages: each one must open from a downloaded file, with
// no network. Links between pages are checked by the type system instead (see
// src/view/pages.ts).
import assert from 'node:assert/strict';
import { parse, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

function descendants(node: Node): Node[] {
  return [node, ...('childNodes' in node ? node.childNodes.flatMap(descendants) : [])];
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name === name)?.value;
}

export function checkPages(pages: ReadonlyMap<string, string>): void {
  for (const [file, html] of pages) {
    const elements = descendants(parse(html)).filter((node): node is Element => 'tagName' in node);
    for (const element of elements) {
      assert.ok(element.tagName !== 'link' && element.tagName !== 'base', `${file}: a separate resource or URL base`);
      for (const name of ['src', 'srcset', 'poster', 'data']) {
        const value = attribute(element, name);
        assert.ok(value === undefined || value.startsWith('data:'), `${file}: an external resource in ${name}`);
      }
    }
    assert.doesNotMatch(html, /@import\b|url\(\s*['"]?(?!data:|#)/i, `${file}: an external stylesheet resource`);
    assert.doesNotMatch(html, /\/home\/|\/Users\/|[A-Z]:\\Users\\/, `${file}: a machine-specific path`);
  }
}
