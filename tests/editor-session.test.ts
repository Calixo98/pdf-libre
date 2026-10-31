import { describe, expect, it } from 'vitest';
import { EditorSession, type SessionEvent } from '../src/editor/session';
import type { AnnotationDraft } from '../src/editor/model';

const highlight: AnnotationDraft = { kind: 'highlight', x: 10, y: 10, width: 50, height: 12, color: '#ffd400' };

describe('EditorSession', () => {
  it('empieza con una página por cada página del PDF, sin giro ni anotaciones', () => {
    const session = new EditorSession(3);
    expect(session.pages.map((page) => page.sourceIndex)).toEqual([0, 1, 2]);
    expect(session.pages.every((page) => page.rotation === 0 && page.annotations.length === 0)).toBe(true);
    expect(session.hasChanges).toBe(false);
  });

  it('deshace agregar una anotación', () => {
    const session = new EditorSession(1);
    session.addAnnotation(0, highlight);
    expect(session.pages[0]?.annotations).toHaveLength(1);

    session.undo();

    expect(session.pages[0]?.annotations).toHaveLength(0);
    expect(session.canUndo).toBe(false);
  });

  it('deshace borrar una anotación en la misma posición', () => {
    const session = new EditorSession(1);
    session.addAnnotation(0, highlight);
    const second = session.addAnnotation(0, { ...highlight, x: 200 });
    session.addAnnotation(0, { ...highlight, x: 300 });

    session.removeAnnotation(0, second?.id ?? -1);
    expect(session.pages[0]?.annotations.map((a) => a.kind === 'highlight' && a.x)).toEqual([10, 300]);

    session.undo();
    expect(session.pages[0]?.annotations.map((a) => a.kind === 'highlight' && a.x)).toEqual([10, 200, 300]);
  });

  it('normaliza el giro de página entre 0 y 270', () => {
    const session = new EditorSession(1);
    session.rotatePage(0, -1);
    expect(session.pages[0]?.rotation).toBe(270);
    session.rotatePage(0, 1);
    expect(session.pages[0]?.rotation).toBe(0);
    session.rotatePage(0, 1);
    session.rotatePage(0, 1);
    session.rotatePage(0, 1);
    session.rotatePage(0, 1);
    expect(session.pages[0]?.rotation).toBe(0);
  });

  it('mueve páginas y deshace el movimiento', () => {
    const session = new EditorSession(3);

    const newIndex = session.movePage(0, 1);

    expect(newIndex).toBe(1);
    expect(session.pages.map((page) => page.sourceIndex)).toEqual([1, 0, 2]);
    session.undo();
    expect(session.pages.map((page) => page.sourceIndex)).toEqual([0, 1, 2]);
  });

  it('no mueve una página fuera de los límites', () => {
    const session = new EditorSession(2);
    expect(session.movePage(0, -1)).toBe(0);
    expect(session.canUndo).toBe(false);
  });

  it('no deja borrar la última página y deshace el borrado en su sitio', () => {
    const session = new EditorSession(2);
    expect(session.deletePage(0)).toBe(true);
    expect(session.pages.map((page) => page.sourceIndex)).toEqual([1]);
    expect(session.deletePage(0)).toBe(false);

    session.undo();
    expect(session.pages.map((page) => page.sourceIndex)).toEqual([0, 1]);
  });

  it('emite eventos que describen el cambio', () => {
    const session = new EditorSession(2);
    const events: SessionEvent[] = [];
    session.subscribe((event) => events.push(event));

    session.addAnnotation(1, highlight);
    session.rotatePage(0, 1);
    session.movePage(0, 1);
    session.markSaved();

    expect(events).toEqual([
      { type: 'annotations', pageIndex: 1 },
      { type: 'rotation', pageIndex: 0 },
      { type: 'structure' },
      { type: 'saved' },
    ]);
  });

  it('marca cambios hasta que se guarda el PDF', () => {
    const session = new EditorSession(1);
    session.rotatePage(0, 1);
    expect(session.hasChanges).toBe(true);
    session.markSaved();
    expect(session.hasChanges).toBe(false);
  });
});
