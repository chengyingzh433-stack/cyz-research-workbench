import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
it('provides a scalable book mark and Windows icon sizes',()=>{
  const svg=readFileSync('apps/desktop/public/icons/book.svg','utf8');
  expect(svg).toContain('viewBox="0 0 256 256"');expect(svg).toContain('<title>');
  const png=readFileSync('apps/desktop/public/icons/book.png');
  expect(png.subarray(1,4).toString()).toBe('PNG');expect(png.readUInt32BE(16)).toBe(256);
  const ico=readFileSync('apps/desktop/public/icons/book.ico');
  expect(ico.readUInt16LE(2)).toBe(1);expect(ico.readUInt16LE(4)).toBe(7);
  expect(Array.from({length:7},(_,i)=>ico[6+i*16]||256)).toEqual([16,24,32,48,64,128,256]);
});
