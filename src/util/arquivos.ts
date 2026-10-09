import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { falhar } from './comum.js';

const TIPOS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/**
 * Descobre o tipo real pelo conteúdo (assinatura do arquivo), sem confiar no
 * que o navegador declarou. Impede, por exemplo, um HTML disfarçado de foto.
 */
export function tipoReal(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/** Lê uma data URL e confere que o conteúdo é mesmo do tipo permitido. */
export function lerDataUrl(dataUrl: string, op: { pdf?: boolean; maxMb?: number } = {}): { buf: Buffer; tipo: string; ext: string } {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl ?? ''));
  const msg = op.pdf ? 'Envie uma imagem (JPG, PNG, WEBP) ou PDF.' : 'Envie uma imagem JPG, PNG ou WEBP.';
  if (!m) falhar(msg);
  const buf = Buffer.from(m![2], 'base64');
  if (buf.length > (op.maxMb ?? 10) * 1024 * 1024) falhar(`Arquivo muito grande (máx. ${op.maxMb ?? 10} MB).`);
  const tipo = tipoReal(buf);
  if (!tipo || (tipo === 'application/pdf' && !op.pdf)) falhar(msg + ' O arquivo enviado não é de um desses tipos.');
  return { buf, tipo: tipo!, ext: TIPOS[tipo!] };
}

/** Grava um arquivo enviado como data URL. Retorna o nome do arquivo salvo. */
export async function salvarDataUrl(pasta: string, prefixo: string, dataUrl: string, op: { pdf?: boolean; maxMb?: number } = {}): Promise<{ arquivo: string; tipo: string }> {
  const { buf, tipo, ext } = lerDataUrl(dataUrl, op);
  await mkdir(pasta, { recursive: true });
  const arquivo = `${prefixo}-${randomBytes(8).toString('hex')}.${ext}`;
  await writeFile(join(pasta, arquivo), buf);
  return { arquivo, tipo };
}

export async function apagarArquivo(pasta: string, arquivo: string | null | undefined) {
  if (!arquivo || !/^[\w.-]+$/.test(arquivo) || arquivo.startsWith('.')) return;
  await unlink(join(pasta, arquivo)).catch(() => undefined);
}

/** Baixa uma imagem de uma URL (usado na importação). Falha silenciosamente. */
export async function baixarImagem(url: string, pasta: string, prefixo: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const tipo = (r.headers.get('content-type') ?? '').split(';')[0];
    const ext = TIPOS[tipo] ?? (/\.png$/i.test(url) ? 'png' : /\.jpe?g$/i.test(url) ? 'jpg' : null);
    if (!ext || ext === 'pdf') return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!tipoReal(buf)?.startsWith('image/') || buf.length > 15 * 1024 * 1024) return null;
    await mkdir(pasta, { recursive: true });
    const arquivo = `${prefixo}-${randomBytes(6).toString('hex')}.${ext}`;
    await writeFile(join(pasta, arquivo), buf);
    return arquivo;
  } catch {
    return null;
  }
}
