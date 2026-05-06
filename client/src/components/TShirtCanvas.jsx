import { useRef, useLayoutEffect, useState } from 'react';

const BG = '#ffffff';
const LINE_WIDTH = 3.5;

const PALETTE = [
  { label: 'Black',  hex: '#111111' },
  { label: 'Red',    hex: '#dc2626' },
  { label: 'Orange', hex: '#ea580c' },
  { label: 'Yellow', hex: '#ca8a04' },
  { label: 'Green',  hex: '#16a34a' },
  { label: 'Teal',   hex: '#0891b2' },
  { label: 'Blue',   hex: '#2563eb' },
  { label: 'Purple', hex: '#9333ea' },
  { label: 'Pink',   hex: '#db2777' },
  { label: 'Brown',  hex: '#92400e' },
  { label: 'Eraser', hex: '#ffffff', isEraser: true },
];

export default function TShirtCanvas({ onSubmit, submitted }) {
  const canvasRef = useRef(null);
  const [hasContent, setHasContent] = useState(false);
  const [color, setColor] = useState(PALETTE[0].hex);
  const drawing = useRef(false);
  const points = useRef([]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    fill(ctx, rect.width, rect.height);
  }, []);

  function fill(ctx, w, h) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
  }

  function style(ctx, c) {
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = c === BG ? LINE_WIDTH * 3 : LINE_WIDTH; // eraser is wider
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function pos(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    if (submitted) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const pt = pos(e);
    points.current = [pt];
    const ctx = canvasRef.current.getContext('2d');
    style(ctx, color);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    if (color !== BG) setHasContent(true);
  }

  function onPointerMove(e) {
    if (!drawing.current || submitted) return;
    e.preventDefault();
    const pt = pos(e);
    const pts = points.current;
    pts.push(pt);
    if (pts.length > 3) pts.shift();

    const ctx = canvasRef.current.getContext('2d');
    style(ctx, color);
    ctx.beginPath();

    if (pts.length === 2) {
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      const m1 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const m2 = { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
      ctx.moveTo(m1.x, m1.y);
      ctx.quadraticCurveTo(pts[1].x, pts[1].y, m2.x, m2.y);
    }
    ctx.stroke();
    if (color !== BG) setHasContent(true);
  }

  function onPointerUp() {
    drawing.current = false;
    points.current = [];
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    fill(canvas.getContext('2d'), canvas.width / dpr, canvas.height / dpr);
    setHasContent(false);
  }

  return (
    <div className="drawing-canvas-wrapper">
      <div className="color-palette">
        {PALETTE.map((c) => (
          <button
            key={c.hex}
            className={`color-swatch${c.isEraser ? ' color-swatch-eraser' : ''}${color === c.hex ? ' color-swatch-active' : ''}`}
            style={{ background: c.hex }}
            onClick={() => setColor(c.hex)}
            aria-label={c.label}
            title={c.label}
          />
        ))}
      </div>

      <canvas
        ref={canvasRef}
        className="drawing-canvas tshirt-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />

      <div className="canvas-actions">
        <button className="btn btn-ghost" onClick={handleClear} disabled={submitted}>
          Clear
        </button>
        <button
          className="btn btn-primary btn-large"
          onClick={() => onSubmit(canvasRef.current.toDataURL('image/png'))}
          disabled={submitted || !hasContent}
        >
          {submitted ? '✓ Design Submitted' : 'Submit Design'}
        </button>
      </div>
    </div>
  );
}
