/** Quadro de assinatura com dedo, caneta ou mouse. Gera PNG com fundo transparente. */
export interface QuadroAssinatura {
  vazio: () => boolean;
  limpar: () => void;
  png: () => string;
}

export function quadroAssinatura(canvas: HTMLCanvasElement, aoMudar?: () => void): QuadroAssinatura {
  const ctx = canvas.getContext('2d')!;
  let tracos = 0;
  let desenhando = false;
  let ultimo: { x: number; y: number } | null = null;

  const ajustar = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    tracos = 0;
    aoMudar?.();
  };
  ajustar();
  const obs = new ResizeObserver(() => { if (!tracos) ajustar(); });
  obs.observe(canvas);

  const ponto = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    desenhando = true;
    const p = ponto(e);
    ultimo = p;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!desenhando || !ultimo) return;
    e.preventDefault();
    const p = ponto(e);
    ctx.lineWidth = 1.6 + p.p * 2.2;
    ctx.beginPath();
    ctx.moveTo(ultimo.x, ultimo.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo = p;
  });
  const fim = () => {
    if (desenhando) { tracos++; aoMudar?.(); }
    desenhando = false;
    ultimo = null;
  };
  canvas.addEventListener('pointerup', fim);
  canvas.addEventListener('pointercancel', fim);
  canvas.style.touchAction = 'none';

  return {
    vazio: () => tracos === 0,
    limpar: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); tracos = 0; aoMudar?.(); },
    // Recorta a área em branco ao redor e limita a 900 px de largura para não pesar no banco
    png: () => {
      const { width: w, height: h } = canvas;
      const px = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) return canvas.toDataURL('image/png');
      const m = Math.round(12 * (window.devicePixelRatio || 1));
      x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const escala = Math.min(1, 900 / cw);
      const c = document.createElement('canvas');
      c.width = Math.round(cw * escala);
      c.height = Math.round(ch * escala);
      c.getContext('2d')!.drawImage(canvas, x0, y0, cw, ch, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    },
  };
}
