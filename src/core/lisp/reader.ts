// Đọc mã AutoLISP thành dữ liệu (S-expression).

import { LispError, Pair, Real, Sym, type Value } from './types';

const QUOTE = Sym.of('QUOTE');

export function readAll(src: string): Value[] {
  let i = 0;
  const n = src.length;

  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === ';') {
        if (src[i + 1] === '|') {
          // Chú thích khối ;| ... |;
          const e = src.indexOf('|;', i + 2);
          i = e < 0 ? n : e + 2;
        } else {
          while (i < n && src[i] !== '\n') i++;
        }
        continue;
      }
      return;
    }
  };

  const readString = (): string => {
    i++; // "
    let s = '';
    while (i < n && src[i] !== '"') {
      let c = src[i++];
      if (c === '\\' && i < n) {
        const e = src[i++];
        if (e === 'n') c = '\n';
        else if (e === 't') c = '\t';
        else if (e === 'r') c = '\r';
        else if (e === 'e') c = '\x1b';
        else if (/[0-7]/.test(e)) {
          let o = e;
          while (o.length < 3 && /[0-7]/.test(src[i] ?? '')) o += src[i++];
          c = String.fromCharCode(parseInt(o, 8));
        } else c = e;
      }
      s += c;
    }
    if (src[i] !== '"') throw new LispError('malformed string on input');
    i++;
    return s;
  };

  const atom = (tok: string): Value => {
    if (/^[+-]?\d+$/.test(tok)) {
      const v = Number(tok);
      // Số nguyên quá lớn thành số thực (như AutoLISP 32-bit).
      return Math.abs(v) > 2147483647 ? new Real(v) : v;
    }
    if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(tok)) return new Real(Number(tok));
    if (tok.toUpperCase() === 'NIL') return null;
    return Sym.of(tok);
  };

  const read = (): Value => {
    skip();
    if (i >= n) throw new LispError('malformed list on input');
    const c = src[i];
    if (c === '(') {
      i++;
      const items: Value[] = [];
      let tail: Value | undefined;
      for (;;) {
        skip();
        if (i >= n) throw new LispError('malformed list on input');
        if (src[i] === ')') {
          i++;
          break;
        }
        // Cặp chấm: (a . b)
        if (src[i] === '.' && /[\s()]/.test(src[i + 1] ?? ' ') && items.length) {
          i++;
          tail = read();
          skip();
          if (src[i] !== ')') throw new LispError('malformed dotted pair');
          i++;
          break;
        }
        items.push(read());
      }
      if (tail !== undefined) {
        if (Array.isArray(tail)) return [...items, ...tail];
        if (tail === null) return items.length ? items : null;
        if (items.length === 1) return new Pair(items[0], tail);
        throw new LispError('danh sách chấm nhiều phần tử chưa hỗ trợ');
      }
      return items.length ? items : null;
    }
    if (c === ')') {
      i++;
      throw new LispError('extra right paren on input');
    }
    if (c === "'") {
      i++;
      return [QUOTE, read()];
    }
    if (c === '"') return readString();
    let j = i;
    while (j < n && !/[\s()'";]/.test(src[j])) j++;
    const tok = src.slice(i, j);
    i = j;
    return atom(tok);
  };

  const out: Value[] = [];
  for (;;) {
    skip();
    if (i >= n) break;
    if (src[i] === ')') {
      // Ngoặc thừa ở cấp ngoài cùng: bỏ qua như AutoCAD.
      i++;
      continue;
    }
    out.push(read());
  }
  return out;
}
