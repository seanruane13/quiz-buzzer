import { useRef, useLayoutEffect, useState } from 'react';

const STROKE_COLOR = '#e8e8d0';
const BG_COLOR = '#0f1f0f';
const LINE_WIDTH = 3.5;

export default function DrawingCanvas({ onSubmit, submitted }) {
  const canvasRef = useRef(null);
  const [hasContent, setHasContent] = useState(false);
  const drawing = useRef(false);
  const points = useRef([]); // buffer of recent points for bezier smoothing

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    clearCanvas(ctx, rect.width, rect.height);
  }, []);

  function clearCanvas(ctx, w, h) {
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
  }

  function applyStyle(ctx) {
    ctx.strokeStyle = STROKE_COLOR;
    ctx.fillStyle = STROKE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e) {
    if (submitted) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const pt = getPos(e);
    points.current = [pt];

    // Draw a dot so taps register as a mark
    const ctx = canvasRef.current.getContext('2d');
    applyStyle(ctx);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, LINE_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
    setHasContent(true);
  }

  function onPointerMove(e) {
    if (!drawing.current || submitted) return;
    e.preventDefault();
    const pt = getPos(e);
    const pts = points.current;
    pts.push(pt);

    // Keep a short rolling window and draw a smooth curve through mid-points
    if (pts.length > 3) pts.shift();

    const ctx = canvasRef.current.getContext('2d');
    applyStyle(ctx);
    ctx.beginPath();

    if (pts.length === 2) {
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      const mid1 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const mid2 = { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(pts[1].x, pts[1].y, mid2.x, mid2.y);
    }

    ctx.stroke();
  }

  function onPointerUp() {
    drawing.current = false;
    points.current = [];
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    clearCanvas(ctx, canvas.width / dpr, canvas.height / dpr);
    setHasContent(false);
  }

  function handleSubmit() {
    onSubmit(canvasRef.current.toDataURL('image/png'));
  }

  return (
    <div className="drawing-canvas-wrapper">
      <canvas
        ref={canvasRef}
        className="drawing-canvas"
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
          onClick={handleSubmit}
          disabled={submitted || !hasContent}
        >
          {submitted ? '✓ Answer Submitted' : 'Submit Answer'}
        </button>
      </div>
    </div>
  );
}
