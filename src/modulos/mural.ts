/**
 * Mural dos clientes: fotos de clientes com o carro que compraram.
 *
 * - A loja publica fotos direto pela área administrativa.
 * - O próprio cliente pode enviar a foto pelo site. Nada aparece antes de a
 *   loja aprovar, e o envio tem travas para evitar abuso:
 *     · só imagem de verdade (conferida pelo conteúdo), até 8 MB;
 *     · dados de localização (EXIF/GPS) da foto são apagados;
 *     · no máximo 3 envios por dia por endereço de internet e por WhatsApp;
 *     · no máximo 40 fotos esperando aprovação ao mesmo tempo;
 *     · a mesma foto não entra duas vezes;
 *     · autorização de uso da imagem obrigatória (LGPD);
 *     · campo-armadilha e tempo mínimo de preenchimento contra robôs;
 *     · textos curtos e sem links.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { App } from '../http/app.js';
import type { Banco, Linha } from '../db/database.js';
import { falhar, texto } from '../util/comum.js';
import { lerDataUrl, apagarArquivo } from '../util/arquivos.js';
import { enviarNuvem } from '../util/nuvem.js';
import { soDigitos } from '../util/validacao.js';
import { auditar } from './auth.js';

const ENVIOS_POR_DIA = 3;
const MAX_PENDENTES = 40;

/** Remove de um JPEG os blocos de metadados (EXIF com GPS, XMP, Photoshop/IPTC, comentários). */
export function limparJpeg(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const partes: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf; // estrutura inesperada: devolve como veio
    const marcador = buf[i + 1];
    if (marcador === 0xda) { partes.push(buf.subarray(i)); return Buffer.concat(partes); } // início da imagem
    const tam = buf.readUInt16BE(i + 2);
    const fim = i + 2 + tam;
    if (fim > buf.length) return buf;
    // APP1 (EXIF/XMP), APP3..APP15 e COM saem; APP0 (JFIF) e APP2 (perfil de cor) ficam
    const descartar = marcador === 0xe1 || (marcador >= 0xe3 && marcador <= 0xef) || marcador === 0xfe;
    if (!descartar) partes.push(buf.subarray(i, fim));
    i = fim;
  }
  return buf;
}

const semLinks = (s: string) => s.replace(/https?:\/\/\S+|www\.\S+|\S+\.(com|net|org|br|io|me|ly)(\/\S*)?/gi, '').replace(/\s+/g, ' ').trim();
const instagram = (s: unknown) => texto(s).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/[^\w.]/g, '').slice(0, 40);

function camposTexto(c: Linha) {
  return {
    nome: semLinks(texto(c.nome)).slice(0, 60),
    cidade: semLinks(texto(c.cidade)).slice(0, 60),
    veiculo: semLinks(texto(c.veiculo)).slice(0, 60),
    mensagem: semLinks(String(c.mensagem ?? '')).slice(0, 200),
    instagram: instagram(c.instagram),
  };
}

async function guardarFoto(pasta: string, dataUrl: string): Promise<{ arquivo: string; hash: string }> {
  const { buf, tipo, ext } = lerDataUrl(dataUrl, { maxMb: 8 });
  const limpo = tipo === 'image/jpeg' ? limparJpeg(buf) : buf;
  const hash = createHash('sha256').update(limpo).digest('hex');
  await mkdir(pasta, { recursive: true });
  const arquivo = `mural-${randomBytes(8).toString('hex')}.${ext}`;
  await writeFile(join(pasta, arquivo), limpo);
  await enviarNuvem(join(pasta, arquivo), limpo);
  return { arquivo, hash };
}

export function registrarMural(app: App, b: Banco, pastaArquivos: string): void {
  const pasta = join(pastaArquivos, 'mural');

  // ---- Área da loja ----
  app.get('/api/mural', (req) => {
    const status = ['pendente', 'aprovado', 'recusado'].includes(req.query.get('status') ?? '') ? req.query.get('status') : 'pendente';
    const lista = b.all(
      `SELECT m.*, u.nome AS aprovado_por_nome FROM mural_fotos m LEFT JOIN usuarios u ON u.id = m.aprovado_por
       WHERE m.status = ? ORDER BY ${status === 'aprovado' ? 'm.destaque DESC, m.aprovado_em DESC' : 'm.id DESC'} LIMIT 300`, [status!]);
    const contagem = Object.fromEntries(b.all('SELECT status, COUNT(*) AS q FROM mural_fotos GROUP BY status').map((r) => [r.status, r.q]));
    return { lista: lista.map((m) => ({ ...m, url: `/arquivos/mural/${m.arquivo}` })), contagem };
  });

  app.post('/api/mural', async (req) => {
    const c = req.corpo;
    const dados = camposTexto(c);
    if (dados.nome.length < 2) falhar('Informe o nome do cliente.');
    const { arquivo, hash } = await guardarFoto(pasta, String(c.imagem ?? ''));
    const id = b.inserir('mural_fotos', {
      ...dados, arquivo, hash, origem: 'loja', status: 'aprovado', destaque: c.destaque ? 1 : 0,
      autorizado_em: new Date().toISOString().replace('T', ' ').slice(0, 19), aprovado_por: req.usuario!.id, aprovado_em: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
    auditar(b, req.usuario!.id, 'publicar', 'mural_fotos', id);
    return { id };
  });

  app.put('/api/mural/:id', (req) => {
    const id = Number(req.params.id);
    const atual = b.one('SELECT * FROM mural_fotos WHERE id = ?', [id]) ?? falhar('Foto não encontrada.', 404);
    const c = { ...atual, ...req.corpo };
    const dados = camposTexto(c);
    if (dados.nome.length < 2) falhar('Informe o nome do cliente.');
    const status = ['pendente', 'aprovado', 'recusado'].includes(c.status) ? c.status : atual.status;
    const agora = new Date().toISOString().replace('T', ' ').slice(0, 19);
    b.atualizar('mural_fotos', id, {
      ...dados, status, destaque: c.destaque ? 1 : 0,
      ...(status === 'aprovado' && atual.status !== 'aprovado' ? { aprovado_por: req.usuario!.id, aprovado_em: agora } : {}),
    });
    if (status !== atual.status) auditar(b, req.usuario!.id, status === 'aprovado' ? 'aprovar' : status === 'recusado' ? 'recusar' : 'reabrir', 'mural_fotos', id);
    return { ok: true };
  });

  app.delete('/api/mural/:id', async (req) => {
    const id = Number(req.params.id);
    const m = b.one('SELECT * FROM mural_fotos WHERE id = ?', [id]) ?? falhar('Foto não encontrada.', 404);
    b.run('DELETE FROM mural_fotos WHERE id = ?', [id]);
    await apagarArquivo(pasta, m.arquivo);
    auditar(b, req.usuario!.id, 'excluir', 'mural_fotos', id, { nome: m.nome });
    return { ok: true };
  });

  // ---- Envio pelo cliente (público) ----
  app.post('/api/site/mural', async (req) => {
    const c = req.corpo;
    if (texto(c.site)) return { ok: true }; // armadilha para robôs
    const preenchidoEm = Number(c.inicio);
    if (Number.isFinite(preenchidoEm) && Date.now() - preenchidoEm < 4000) falhar('Envio muito rápido. Confira os dados e tente de novo.');
    if (c.autorizo !== true) falhar('Para aparecer no mural, autorize o uso da sua foto.');
    const dados = camposTexto(c);
    if (dados.nome.length < 2) falhar('Informe seu nome.');
    const telefone = soDigitos(c.telefone);
    if (telefone.length < 10 || telefone.length > 13) falhar('Informe seu WhatsApp com DDD. Ele não aparece no site; a loja usa só para confirmar que você é cliente.');
    const recentes = b.one(
      "SELECT COUNT(*) AS q FROM mural_fotos WHERE origem = 'cliente' AND (ip = ? OR telefone = ?) AND criado_em > datetime('now', '-1 day')",
      [req.ip, telefone])!.q as number;
    if (recentes >= ENVIOS_POR_DIA) falhar('Você já enviou fotos hoje. Aguarde a loja aprovar ou tente de novo amanhã.', 429);
    const pendentes = b.one("SELECT COUNT(*) AS q FROM mural_fotos WHERE status = 'pendente'")!.q as number;
    if (pendentes >= MAX_PENDENTES) falhar('O mural está recebendo muitas fotos agora. Tente de novo mais tarde.', 429);
    // Do site só aceitamos JPEG (o navegador converte e reduz antes de enviar)
    const bruto = String(c.imagem ?? '');
    if (!/^data:image\/jpeg;base64,/.test(bruto)) falhar('Envie uma foto (JPG, PNG ou WEBP).');
    const { buf } = lerDataUrl(bruto, { maxMb: 8 });
    const hash = createHash('sha256').update(limparJpeg(buf)).digest('hex');
    if (b.one('SELECT 1 FROM mural_fotos WHERE hash = ?', [hash])) falhar('Esta foto já foi enviada ao mural.');
    const { arquivo } = await guardarFoto(pasta, bruto);
    b.inserir('mural_fotos', {
      ...dados, arquivo, hash, telefone, origem: 'cliente', status: 'pendente', ip: req.ip,
      autorizado_em: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
    return { ok: true };
  }, { publica: true });
}

/** Fotos aprovadas para o site. */
export function fotosMural(b: Banco, limite: number, offset = 0): Linha[] {
  return b.all("SELECT id, arquivo, nome, cidade, veiculo, mensagem, instagram FROM mural_fotos WHERE status = 'aprovado' ORDER BY destaque DESC, aprovado_em DESC, id DESC LIMIT ? OFFSET ?", [limite, offset]);
}
