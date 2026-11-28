import { describe, expect, it } from 'vitest';
import { Drawing } from '../src/core/document';
import { type Ctx, type IO, runInteractive } from '../src/core/commands';
import { createRegistry } from '../src/core/registry';
import { createApi } from '../src/core/api';
import { attachLisp } from '../src/core/lisp/index';
import { Interp, wcmatch } from '../src/core/lisp/interp';
import { show } from '../src/core/lisp/types';
import type { Entity } from '../src/core/entities';
import { measure } from '../src/core/dim';

function setup() {
  const doc = new Drawing();
  const reg = createRegistry();
  const ctx: Ctx = { doc, selection: new Set(), print: () => {} };
  const lisp = attachLisp(reg, () => ctx);
  const api = createApi({ doc, reg, ctx: () => ctx, version: 't', setSelection: () => {}, lisp });
  const run = async (code: string) => {
    const r = await lisp.run(code, null);
    if (r.error) throw new Error(r.error);
    return r;
  };
  const types = () => doc.all().map((e) => e.type).sort();
  return { doc, reg, ctx, lisp, api, run, types };
}

const ev = async (code: string) => show(await new Interp().evalString(code));

describe('Lõi AutoLISP', () => {
  it('số nguyên / số thực, danh sách, chuỗi', async () => {
    expect(await ev('(/ 7 2)')).toBe('3');
    expect(await ev('(/ 7 2.0)')).toBe('3.5');
    expect(await ev('(+ 1 2.5)')).toBe('3.5');
    expect(await ev("(mapcar '(lambda (x) (* x x)) '(1 2 3))")).toBe('(1 4 9)');
    expect(await ev("(cdr (assoc 8 '((0 . \"LINE\") (8 . \"TUONG\"))))")).toBe('"TUONG"');
    expect(await ev("(vl-sort '(3 1 2) '<)")).toBe('(1 2 3)');
    expect(await ev('(substr "Xin chào" 5)')).toBe('"chào"');
    expect(await ev('(rtos 2.5 2 2)')).toBe('"2.50"');
    expect(await ev('(strcase "abc")')).toBe('"ABC"');
    expect(await ev('(atoi "12abc")')).toBe('12');
    expect(await ev('(sqrt 2)')).toBe('1.41421');
    expect(await ev("(apply '+ '(1 2 3))")).toBe('6');
    expect(await ev('(vl-string-subst "B" "A" "xAyA")')).toBe('"xByA"');
    expect(await ev("(cadr '(1 2 3))")).toBe('2');
    expect(await ev("(vl-position 'c '(a b c))")).toBe('2');
  });

  it('defun có biến cục bộ (phạm vi động), đệ quy, while, foreach, cond', async () => {
    const L = new Interp();
    await L.evalString('(setq x 10) (defun fact (n / r) (setq x 0) (if (<= n 1) 1 (* n (fact (1- n)))))');
    expect(show(await L.evalString('(fact 10)'))).toBe('3628800');
    expect(show(await L.evalString('x'))).toBe('0');
    await L.evalString('(defun f (/ x) (setq x 99)) (setq x 5) (f)');
    expect(show(await L.evalString('x'))).toBe('5');
    expect(show(await L.evalString('(setq i 0 s 0) (while (< i 5) (setq s (+ s i) i (1+ i))) s'))).toBe('10');
    expect(show(await L.evalString("(cond ((= 1 2) 'a) ((= 1 1) 'b) (t 'c))"))).toBe('B');
  });

  it('wcmatch theo kiểu AutoCAD', () => {
    expect(wcmatch('TUONG_1', 'TU*')).toBe(true);
    expect(wcmatch('A12', 'A##')).toBe(true);
    expect(wcmatch('CUA', 'TU*,CUA')).toBe(true);
    expect(wcmatch('CUA', '~CUA')).toBe(false);
    expect(wcmatch('B', '[ABC]')).toBe(true);
    expect(wcmatch('A*B', 'A`*B')).toBe(true);
  });

  it('vl-catch-all-apply bắt lỗi; *error* được gọi', async () => {
    expect(await ev("(vl-catch-all-error-p (vl-catch-all-apply '/ '(1 0)))")).toBe('T');
    const { lisp } = setup();
    const r = await lisp.run('(defun *error* (m) (princ (strcat "LOI:" m))) (/ 1 0)', null);
    expect(r.error).toBe('divide by zero');
    expect(r.output).toContain('LOI:divide by zero');
  });

  it('chú thích khối ;| |; và chuỗi thoát', async () => {
    expect(await ev(';| chú thích\n nhiều dòng |; (strcat "a\\"b" "\\n")')).toBe('"a\\"b\\n"');
  });
});

describe('AutoLISP với bản vẽ', () => {
  it('entmake / entget / entmod / entdel / entlast', async () => {
    const { doc, run } = setup();
    await run(`(entmake '((0 . "LINE") (8 . "TUONG") (62 . 1) (10 0.0 0.0 0.0) (11 1000.0 0.0 0.0)))`);
    const l = doc.all()[0] as Extract<Entity, { type: 'LINE' }>;
    expect(l).toMatchObject({ type: 'LINE', layer: 'TUONG', color: 1, a: [0, 0], b: [1000, 0] });
    const r = await run('(cdr (assoc 11 (entget (entlast))))');
    expect(r.value).toBe('(1000.0 0.0 0.0)');
    await run('(setq e (entget (entlast))) (entmod (subst (cons 8 "CUA") (assoc 8 e) e))');
    expect(doc.all()[0].layer).toBe('CUA');
    await run(`(entmake (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(100 . "AcDbPolyline") '(90 . 3) '(70 . 1) '(10 0 0) '(10 100 0) '(10 100 100)))`);
    expect(doc.all()[1]).toMatchObject({ type: 'LWPOLYLINE', closed: true, pts: [[0, 0], [100, 0], [100, 100]] });
    await run(`(entmake '((0 . "TEXT") (10 5.0 5.0 0.0) (11 5.0 5.0 0.0) (40 . 250.0) (1 . "Phòng ngủ") (72 . 1) (73 . 2) (50 . 0.0)))`);
    expect(doc.all()[2]).toMatchObject({ type: 'TEXT', text: 'Phòng ngủ', ha: 'C', va: 'M', h: 250 });
    await run(`(entmake '((0 . "ARC") (10 0.0 0.0 0.0) (40 . 10.0) (50 . 0.0) (51 . ${Math.PI / 2})))`);
    expect((doc.all()[3] as Extract<Entity, { type: 'ARC' }>).end).toBeCloseTo(90, 9);
    await run('(entdel (entlast))');
    expect(doc.entities.size).toBe(3);
  });

  it('entmake BLOCK … ENDBLK rồi chèn INSERT', async () => {
    const { doc, run } = setup();
    await run(`(entmake '((0 . "BLOCK") (2 . "COT") (10 0.0 0.0 0.0) (70 . 0)))
      (entmake '((0 . "CIRCLE") (10 0.0 0.0 0.0) (40 . 200.0)))
      (entmake '((0 . "ENDBLK")))
      (entmake '((0 . "INSERT") (2 . "COT") (10 1000.0 1000.0 0.0)))`);
    expect(doc.blocks.get('COT')?.ents).toHaveLength(1);
    expect(doc.all()).toMatchObject([{ type: 'INSERT', name: 'COT', p: [1000, 1000] }]);
  });

  it('ssget "_X" với bộ lọc, <OR, sslength / ssname; ssget cửa sổ', async () => {
    const { run } = setup();
    await run(`(entmake '((0 . "LINE") (8 . "TUONG") (10 0 0) (11 10 0)))
      (entmake '((0 . "LINE") (8 . "CUA") (10 0 5) (11 10 5)))
      (entmake '((0 . "CIRCLE") (8 . "TUONG") (10 100 100) (40 . 5)))`);
    expect((await run(`(sslength (ssget "_X" '((0 . "LINE") (8 . "TU*"))))`)).value).toBe('1');
    expect((await run(`(sslength (ssget "_X" '((-4 . "<OR") (0 . "CIRCLE") (8 . "CUA") (-4 . "OR>"))))`)).value).toBe('2');
    expect((await run(`(sslength (ssget "_W" '(-1 -1) '(11 6)))`)).value).toBe('2');
    expect((await run(`(ssget "_X" '((0 . "TEXT")))`)).value).toBe('nil');
    expect((await run(`(cdr (assoc 0 (entget (ssname (ssget "_X" '((0 . "CIRCLE"))) 0))))`)).value).toBe('"CIRCLE"');
  });

  it('(command ...) gọi lệnh như gõ: LINE, CIRCLE, RECTANG, -LAYER, ERASE', async () => {
    const { doc, run, types } = setup();
    await run(`(command "_.-LAYER" "_M" "TUONG" "_C" "1" "TUONG" "")`);
    expect(doc.currentLayer).toBe('TUONG');
    expect(doc.layers.get('TUONG')!.color).toBe(1);
    await run(`(command "_.LINE" '(0 0) '(1000 0) '(1000 1000) "")`);
    await run(`(command "_.CIRCLE" '(500 500) 200)`);
    await run(`(command "_.RECTANG" '(0 0) "@300,200")`);
    expect(types()).toEqual(['CIRCLE', 'LINE', 'LINE', 'LWPOLYLINE']);
    expect(doc.all().every((e) => e.layer === 'TUONG')).toBe(true);
    await run(`(command "_.ERASE" (ssget "_X" '((0 . "LINE"))) "")`);
    expect(types()).toEqual(['CIRCLE', 'LWPOLYLINE']);
    // Cả đoạn lisp là một bước hoàn tác.
    doc.undo();
    expect(types()).toEqual(['CIRCLE', 'LINE', 'LINE', 'LWPOLYLINE']);
  });

  it('(command) TEXT, -HATCH theo HPSCALE và tên mẫu quen thuộc, DIMLINEAR, -INSERT, ZOOM', async () => {
    const { doc, run } = setup();
    await run(`(command "_.TEXT" "_J" "_MC" '(100 100) 250 0 "Bếp")`);
    expect(doc.all()[0]).toMatchObject({ type: 'TEXT', text: 'Bếp', ha: 'C', va: 'M', h: 250 });
    await run(`(command "_.RECTANG" '(0 0) '(1000 1000))
      (setvar "HPSCALE" 25.0)
      (command "_.-HATCH" "_P" "ANSI31" "_S" (ssget "_X" '((0 . "LWPOLYLINE"))) "" "")`);
    const h = doc.all().find((e) => e.type === 'HATCH') as Extract<Entity, { type: 'HATCH' }>;
    expect(h).toMatchObject({ pattern: 'LINE45', scale: 25 });
    await run(`(command "_.DIMLINEAR" '(0 0) '(1000 0) '(500 -500))`);
    const d = doc.all().find((e) => e.type === 'DIMENSION') as Extract<Entity, { type: 'DIMENSION' }>;
    expect(measure(d)).toBe(1000);
    await run(`(entmake '((0 . "BLOCK") (2 . "B1") (10 0 0 0))) (entmake '((0 . "POINT") (10 0 0 0))) (entmake '((0 . "ENDBLK")))
      (command "_.-INSERT" "B1" '(50 50) 2 2 0) (command "_.ZOOM" "_E")`);
    expect(doc.all().find((e) => e.type === 'INSERT')).toMatchObject({ name: 'B1', sx: 2 });
  });

  it('defun C:XXX thành lệnh gõ được trên dòng lệnh', async () => {
    const { doc, reg, ctx, run } = setup();
    await run(`(defun c:VEVONG (/ p) (setq p (getpoint "Tâm:")) (command "_.CIRCLE" p 100) (princ))`);
    expect(reg.resolve('VEVONG')).toBeTruthy();
    const io: IO = {
      getPoint: async () => [10, 20],
      getDistance: async () => null,
      getAngle: async () => null,
      getString: async () => null,
      getEntity: async () => null,
      getSelection: async () => [],
      print: () => {},
    };
    await runInteractive(reg, ctx, io, 'VEVONG');
    expect(doc.all()).toMatchObject([{ type: 'CIRCLE', c: [10, 20], r: 100 }]);
  });

  it('tblsearch, getvar / setvar (CLAYER, DIMSCALE, DIMTXT)', async () => {
    const { doc, run } = setup();
    expect((await run('(tblsearch "LAYER" "0")')).value).toContain('(2 . "0")');
    expect((await run('(tblsearch "LAYER" "KHONGCO")')).value).toBe('nil');
    await run(`(command "_.-LAYER" "_N" "DIM" "") (setvar "CLAYER" "DIM") (setvar "DIMSCALE" 40) (setvar "DIMTXT" 2.5)`);
    expect(doc.currentLayer).toBe('DIM');
    expect(doc.dimStyle.txt).toBeCloseTo(100, 9);
    expect((await run('(getvar "DIMTXT")')).value).toBe('2.5');
  });

  it('vlax-curve-* và vla-get / vla-put', async () => {
    const { doc, run } = setup();
    await run(`(entmake '((0 . "LWPOLYLINE") (90 . 3) (70 . 0) (10 0 0) (10 300 0) (10 300 400)))`);
    expect((await run('(vlax-curve-getDistAtParam (entlast) (vlax-curve-getEndParam (entlast)))')).value).toBe('700.0');
    expect((await run('(vlax-curve-getEndParam (entlast))')).value).toBe('2.0');
    expect((await run('(vlax-curve-getPointAtDist (entlast) 500)')).value).toBe('(300.0 200.0 0.0)');
    expect((await run('(vlax-curve-getDistAtPoint (entlast) (list 300 100))')).value).toBe('400.0');
    await run(`(vl-load-com) (setq o (vlax-ename->vla-object (entlast))) (vla-put-Layer o "MOI") (vla-put-Color o 3)`);
    expect(doc.all()[0]).toMatchObject({ layer: 'MOI', color: 3 });
    expect((await run('(vla-get-Length o)')).value).toBe('700.0');
    expect((await run('(vla-get-ObjectName o)')).value).toBe('"AcDbPolyline"');
    expect((await run("(vlax-get o 'Coordinates)")).value).toBe('(0.0 0.0 300.0 0.0 300.0 400.0)');
  });

  it('LSPCHECK báo hàm chưa có; API mhcad.lisp chạy được', async () => {
    const { lisp, api, doc } = setup();
    expect(lisp.check('(defun c:x () (foo 1) (car (list 1)) (dcl-form-show))')).toEqual(['DCL-FORM-SHOW', 'FOO']);
    const r = await api.lisp('(repeat 10 (entmake (list (cons 0 "POINT") (list 10 (getvar "LTSCALE") 0 0)))) (sslength (ssget "_X"))');
    expect(r.value).toBe('10');
    expect(r.delta).toBe(10);
    expect(doc.entities.size).toBe(10);
  });

  it('getpoint khi không có giao diện báo lỗi rõ', async () => {
    const { lisp } = setup();
    const r = await lisp.run('(getpoint "Điểm:")', null);
    expect(r.error).toMatch(/giao diện/);
  });
});
