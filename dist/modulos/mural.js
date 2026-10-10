/**
 * Mural dos clientes: fotos de clientes com o carro que compraram, publicadas
 * pela loja na área administrativa. No site, cada foto pode ser compartilhada.
 * Os dados de localização (EXIF/GPS) das fotos são apagados ao publicar.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { falhar, texto } from '../util/comum.js';
import { lerDataUrl, apagarArquivo } from '../util/arquivos.js';
import { enviarNuvem } from '../util/nuvem.js';
import { auditar } from './auth.js';
/** Remove de um JPEG os blocos de metadados (EXIF com GPS, XMP, Photoshop/IPTC, comentários). */
export function limparJpeg(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8)
        return buf;
    const partes = [buf.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= buf.length) {
        if (buf[i] !== 0xff)
            return buf; // estrutura inesperada: devolve como veio
        const marcador = buf[i + 1];
        if (marcador === 0xda) {
            partes.push(buf.subarray(i));
            return Buffer.concat(partes);
        } // início da imagem
        const tam = buf.readUInt16BE(i + 2);
        const fim = i + 2 + tam;
        if (fim > buf.length)
            return buf;
        // APP1 (EXIF/XMP), APP3..APP15 e COM saem; APP0 (JFIF) e APP2 (perfil de cor) ficam
        const descartar = marcador === 0xe1 || (marcador >= 0xe3 && marcador <= 0xef) || marcador === 0xfe;
        if (!descartar)
            partes.push(buf.subarray(i, fim));
        i = fim;
    }
    return buf;
}
const semLinks = (s) => s.replace(/https?:\/\/\S+|www\.\S+|\S+\.(com|net|org|br|io|me|ly)(\/\S*)?/gi, '').replace(/\s+/g, ' ').trim();
const instagram = (s) => texto(s).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/[^\w.]/g, '').slice(0, 40);
function camposTexto(c) {
    return {
        nome: semLinks(texto(c.nome)).slice(0, 60),
        cidade: semLinks(texto(c.cidade)).slice(0, 60),
        veiculo: semLinks(texto(c.veiculo)).slice(0, 60),
        mensagem: semLinks(String(c.mensagem ?? '')).slice(0, 200),
        instagram: instagram(c.instagram),
    };
}
async function guardarFoto(pasta, dataUrl) {
    const { buf, tipo, ext } = lerDataUrl(dataUrl, { maxMb: 8 });
    const limpo = tipo === 'image/jpeg' ? limparJpeg(buf) : buf;
    const hash = createHash('sha256').update(limpo).digest('hex');
    await mkdir(pasta, { recursive: true });
    const arquivo = `mural-${randomBytes(8).toString('hex')}.${ext}`;
    await writeFile(join(pasta, arquivo), limpo);
    await enviarNuvem(join(pasta, arquivo), limpo);
    return { arquivo, hash };
}
export function registrarMural(app, b, pastaArquivos) {
    const pasta = join(pastaArquivos, 'mural');
    // ---- Área da loja ----
    app.get('/api/mural', (req) => {
        const status = ['pendente', 'aprovado', 'recusado'].includes(req.query.get('status') ?? '') ? req.query.get('status') : 'pendente';
        const lista = b.all(`SELECT m.*, u.nome AS aprovado_por_nome FROM mural_fotos m LEFT JOIN usuarios u ON u.id = m.aprovado_por
       WHERE m.status = ? ORDER BY ${status === 'aprovado' ? 'm.destaque DESC, m.aprovado_em DESC' : 'm.id DESC'} LIMIT 300`, [status]);
        const contagem = Object.fromEntries(b.all('SELECT status, COUNT(*) AS q FROM mural_fotos GROUP BY status').map((r) => [r.status, r.q]));
        return { lista: lista.map((m) => ({ ...m, url: `/arquivos/mural/${m.arquivo}` })), contagem };
    });
    app.post('/api/mural', async (req) => {
        const c = req.corpo;
        const dados = camposTexto(c);
        if (dados.nome.length < 2)
            falhar('Informe o nome do cliente.');
        const { arquivo, hash } = await guardarFoto(pasta, String(c.imagem ?? ''));
        const id = b.inserir('mural_fotos', {
            ...dados, arquivo, hash, origem: 'loja', status: 'aprovado', destaque: c.destaque ? 1 : 0,
            autorizado_em: new Date().toISOString().replace('T', ' ').slice(0, 19), aprovado_por: req.usuario.id, aprovado_em: new Date().toISOString().replace('T', ' ').slice(0, 19),
        });
        auditar(b, req.usuario.id, 'publicar', 'mural_fotos', id);
        return { id };
    });
    app.put('/api/mural/:id', (req) => {
        const id = Number(req.params.id);
        const atual = b.one('SELECT * FROM mural_fotos WHERE id = ?', [id]) ?? falhar('Foto não encontrada.', 404);
        const c = { ...atual, ...req.corpo };
        const dados = camposTexto(c);
        if (dados.nome.length < 2)
            falhar('Informe o nome do cliente.');
        const status = ['pendente', 'aprovado', 'recusado'].includes(c.status) ? c.status : atual.status;
        const agora = new Date().toISOString().replace('T', ' ').slice(0, 19);
        b.atualizar('mural_fotos', id, {
            ...dados, status, destaque: c.destaque ? 1 : 0,
            ...(status === 'aprovado' && atual.status !== 'aprovado' ? { aprovado_por: req.usuario.id, aprovado_em: agora } : {}),
        });
        if (status !== atual.status)
            auditar(b, req.usuario.id, status === 'aprovado' ? 'aprovar' : status === 'recusado' ? 'recusar' : 'reabrir', 'mural_fotos', id);
        return { ok: true };
    });
    app.delete('/api/mural/:id', async (req) => {
        const id = Number(req.params.id);
        const m = b.one('SELECT * FROM mural_fotos WHERE id = ?', [id]) ?? falhar('Foto não encontrada.', 404);
        b.run('DELETE FROM mural_fotos WHERE id = ?', [id]);
        await apagarArquivo(pasta, m.arquivo);
        auditar(b, req.usuario.id, 'excluir', 'mural_fotos', id, { nome: m.nome });
        return { ok: true };
    });
}
/** Fotos aprovadas para o site. */
export function fotosMural(b, limite, offset = 0) {
    return b.all("SELECT id, arquivo, nome, cidade, veiculo, mensagem, instagram FROM mural_fotos WHERE status = 'aprovado' ORDER BY destaque DESC, aprovado_em DESC, id DESC LIMIT ? OFFSET ?", [limite, offset]);
}
