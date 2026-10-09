import { join } from 'node:path';
import type { App } from '../http/app.js';
import type { Banco, Linha } from '../db/database.js';
import { falhar, texto, numero } from '../util/comum.js';
import { salvarDataUrl, apagarArquivo } from '../util/arquivos.js';
import { auditar } from './auth.js';

export const TIPOS_DOCUMENTO = ['CNH', 'RG', 'CPF', 'CRLV', 'ATPV-e', 'Comprovante de residência', 'Contrato', 'Procuração', 'Outro'];

export function registrarDocumentos(app: App, b: Banco, pastaArquivos: string): void {
  const pasta = join(pastaArquivos, 'documentos');

  const comArquivos = (docs: Linha[]) => {
    if (!docs.length) return docs;
    const arqs = b.all(`SELECT * FROM documento_arquivos WHERE documento_id IN (${docs.map(() => '?').join(',')}) ORDER BY ordem, id`, docs.map((d) => d.id));
    return docs.map((d) => ({ ...d, arquivos: arqs.filter((a) => a.documento_id === d.id).map((a) => ({ id: a.id, url: `/arquivos/documentos/${a.arquivo}`, tipo: a.tipo })) }));
  };

  app.get('/api/documentos/tipos', () => TIPOS_DOCUMENTO);

  app.get('/api/documentos', (req) => {
    const q = `%${texto(req.query.get('q'))}%`;
    const pessoa = req.query.get('pessoa_id');
    const docs = b.all(
      `SELECT d.*, p.nome AS pessoa_nome FROM documentos d LEFT JOIN pessoas p ON p.id = d.pessoa_id
       WHERE (d.nome LIKE ? OR d.numero LIKE ? OR d.tipo LIKE ?) ${pessoa ? 'AND d.pessoa_id = ?' : ''} ORDER BY d.id DESC LIMIT 1000`,
      pessoa ? [q, q, q, Number(pessoa)] : [q, q, q]);
    return comArquivos(docs);
  });

  app.get('/api/documentos/:id', (req) => {
    const d = b.one('SELECT * FROM documentos WHERE id = ?', [Number(req.params.id)]) ?? falhar('Documento não encontrado.', 404);
    return comArquivos([d])[0];
  });

  const ler = (c: Linha) => {
    const tipo = texto(c.tipo);
    if (!tipo) falhar('Escolha o tipo do documento.');
    const pessoaId = c.pessoa_id ? numero(c.pessoa_id) : null;
    let nome = texto(c.nome);
    if (pessoaId && !nome) nome = b.one('SELECT nome FROM pessoas WHERE id = ?', [pessoaId])?.nome ?? '';
    if (!nome) falhar('Informe o nome do titular.');
    return { tipo, pessoa_id: pessoaId, nome, numero: texto(c.numero), obs: texto(c.obs) };
  };

  const gravarArquivos = async (docId: number, lista: unknown) => {
    if (!Array.isArray(lista)) return;
    if (lista.length > 10) falhar('Envie no máximo 10 arquivos por vez.');
    let ordem = (b.one('SELECT COALESCE(MAX(ordem), -1) + 1 AS o FROM documento_arquivos WHERE documento_id = ?', [docId])!.o as number);
    for (const dataUrl of lista) {
      const s = await salvarDataUrl(pasta, `doc${docId}`, String(dataUrl), { pdf: true, maxMb: 12 });
      b.inserir('documento_arquivos', { documento_id: docId, arquivo: s.arquivo, tipo: s.tipo, ordem: ordem++ });
    }
  };

  app.post('/api/documentos', async (req) => {
    const id = b.inserir('documentos', ler(req.corpo));
    await gravarArquivos(id, req.corpo.arquivos);
    auditar(b, req.usuario!.id, 'criar', 'documentos', id);
    return { id };
  });

  app.put('/api/documentos/:id', async (req) => {
    const id = Number(req.params.id);
    const atual = b.one('SELECT * FROM documentos WHERE id = ?', [id]) ?? falhar('Documento não encontrado.', 404);
    b.atualizar('documentos', id, ler({ ...atual, ...req.corpo }));
    if (Array.isArray(req.corpo.remover)) {
      for (const aid of req.corpo.remover.map(Number)) {
        const a = b.one('SELECT * FROM documento_arquivos WHERE id = ? AND documento_id = ?', [aid, id]);
        if (!a) continue;
        b.run('DELETE FROM documento_arquivos WHERE id = ?', [aid]);
        await apagarArquivo(pasta, a.arquivo);
      }
    }
    await gravarArquivos(id, req.corpo.arquivos);
    auditar(b, req.usuario!.id, 'alterar', 'documentos', id);
    return { ok: true };
  });

  app.delete('/api/documentos/:id', async (req) => {
    const id = Number(req.params.id);
    const arqs = b.all('SELECT arquivo FROM documento_arquivos WHERE documento_id = ?', [id]);
    b.run('DELETE FROM documentos WHERE id = ?', [id]);
    for (const a of arqs) await apagarArquivo(pasta, a.arquivo);
    auditar(b, req.usuario!.id, 'excluir', 'documentos', id);
    return { ok: true };
  });
}
