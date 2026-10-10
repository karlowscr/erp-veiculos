/** Permissões por usuário, catálogo público, entrada pelo documento, FIPE e proteções de segurança. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarAplicacao } from '../aplicacao.js';
import { Fipe } from '../modulos/fipe.js';
import { conferirLeitura } from '../modulos/leitor-documento.js';
import { codigoTotp, passoAtual, conferirTotp, base32, deBase32 } from '../util/totp.js';
import { tipoReal } from '../util/arquivos.js';
import { ROTAS } from '../http/permissoes.js';
const pasta = mkdtempSync(join(tmpdir(), 'erp-seg-'));
mkdirSync(join(pasta, 'pub'), { recursive: true });
writeFileSync(join(pasta, 'pub', 'index.html'), '<!doctype html><title>admin</title>');
// FIPE falsa (sem internet nos testes)
const respostasFipe = {
    '/carros/marcas': [{ codigo: '21', nome: 'Fiat' }, { codigo: '59', nome: 'VW - VolksWagen' }],
    '/carros/marcas/21/modelos': { modelos: [{ codigo: 9001, nome: 'ARGO DRIVE 1.3 8V Flex' }, { codigo: 9002, nome: 'ARGO 1.0 6V Flex' }, { codigo: 9003, nome: 'UNO Mille 1.0' }], anos: [] },
    '/carros/marcas/21/modelos/9001/anos': [{ codigo: '2020-5', nome: '2020 Flex' }],
    '/carros/marcas/21/modelos/9002/anos': [{ codigo: '2020-5', nome: '2020 Flex' }],
    '/carros/marcas/21/modelos/9001/anos/2020-5': { Valor: 'R$ 60.575,00', Marca: 'Fiat', Modelo: 'ARGO DRIVE 1.3 8V Flex', AnoModelo: 2020, Combustivel: 'Flex', CodigoFipe: '001493-1', MesReferencia: 'outubro de 2026' },
};
const fetchFipe = (async (url) => {
    const caminho = String(url).replace(/^.*\/fipe\/api\/v1/, '');
    const r = respostasFipe[caminho];
    return new Response(JSON.stringify(r ?? {}), { status: r ? 200 : 404, headers: { 'content-type': 'application/json' } });
});
const { app, banco, caminhoAdmin } = criarAplicacao({
    pastaDados: pasta, pastaPublica: join(pasta, 'pub'), pastaSite: join(pasta, 'pub'), caminhoAdmin: 'painel-secreto-1',
    buscarFipe: fetchFipe, leitorDocumento: async () => ({
        modelo: 'teste', avisos: [],
        dados: { tipo_documento: 'CRLV-e', placa: 'PMX4G21', renavam: '00123456789', chassi: '9BD358A4NLYK12345', marca: 'Fiat', modelo: 'ARGO', versao: 'DRIVE 1.3', ano_fab: 2020, ano_mod: 2020, cor: 'BRANCA', combustivel: 'flex', tipo_veiculo: 'automovel', proprietario_nome: 'MARIA DE SOUSA', proprietario_doc: '52998224725' },
    }),
});
let servidor;
let base = '';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const fotoPng = 'data:image/png;base64,' + PNG.toString('base64');
class Cliente {
    cookie = '';
    async req(m, u, c, h = {}) {
        const r = await fetch(base + u, { method: m, redirect: 'manual', headers: { ...(c ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...h }, body: c ? JSON.stringify(c) : undefined });
        const sc = r.headers.get('set-cookie');
        if (sc)
            this.cookie = sc.split(';')[0];
        const txt = await r.text();
        let json = txt;
        try {
            json = JSON.parse(txt);
        }
        catch { /* html */ }
        return { status: r.status, json, txt, headers: r.headers };
    }
    async ok(m, u, c) {
        const r = await this.req(m, u, c);
        assert.ok(r.status < 300, `${m} ${u} → ${r.status} ${JSON.stringify(r.json)}`);
        return r.json;
    }
}
const adm = new Cliente();
let veiculoId = 0;
before(async () => {
    servidor = app.servidor();
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
    await adm.ok('POST', '/api/setup', { nome: 'Dono', email: 'dono@loja.com', senha: 'SenhaForte2026' });
    await adm.ok('POST', '/api/login', { email: 'dono@loja.com', senha: 'SenhaForte2026' });
    await adm.ok('PUT', '/api/empresa', { nome_fantasia: 'CR Veículos', razao_social: 'CR VEICULOS LTDA', municipio: 'Ocara', uf: 'CE', whatsapp: '5585987346133' });
});
after(() => { servidor.close(); banco.fechar(); rmSync(pasta, { recursive: true, force: true }); });
test('toda rota protegida tem permissão declarada', () => {
    for (const r of app.listarRotas()) {
        if (!r.publica)
            assert.ok(ROTAS[`${r.metodo} ${r.padrao}`], `sem permissão: ${r.metodo} ${r.padrao}`);
    }
    const publicas = app.listarRotas().filter((r) => r.publica).map((r) => r.metodo + ' ' + r.padrao).sort();
    assert.deepEqual(publicas, ['GET /api/saude', 'GET /api/setup', 'POST /api/login', 'POST /api/logout', 'POST /api/setup', 'POST /api/site/contato', 'POST /api/site/mural']);
});
test('cabeçalhos de segurança e área administrativa só no endereço secreto', async () => {
    assert.equal(caminhoAdmin, 'painel-secreto-1');
    const cat = await adm.req('GET', '/');
    assert.equal(cat.status, 200);
    assert.ok(!cat.txt.includes(caminhoAdmin), 'catálogo não pode citar a área administrativa');
    assert.match(cat.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(cat.headers.get('x-frame-options'), 'DENY');
    assert.equal(cat.headers.get('x-content-type-options'), 'nosniff');
    const admin = await adm.req('GET', `/${caminhoAdmin}/`);
    assert.equal(admin.status, 200);
    assert.equal(admin.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await adm.req('GET', `/${caminhoAdmin}`)).status, 301);
    assert.equal((await adm.req('GET', '/painel/')).status, 404);
    assert.equal((await adm.req('GET', '/index.html')).status, 404);
    const robots = await adm.req('GET', '/robots.txt');
    assert.ok(!robots.txt.includes(caminhoAdmin));
    assert.equal((await adm.req('GET', '/s/../erp.db')).status, 404);
});
test('login: bloqueio por tentativas, sessão guardada como hash e erro sem detalhes', async () => {
    const c = new Cliente();
    await adm.ok('POST', '/api/usuarios', { nome: 'Alvo', email: 'alvo@loja.com', senha: 'Senha2026xx', perfil: 'vendedor' });
    for (let i = 0; i < 5; i++)
        assert.equal((await c.req('POST', '/api/login', { email: 'alvo@loja.com', senha: 'errada' + i })).status, 401);
    const bloq = await c.req('POST', '/api/login', { email: 'alvo@loja.com', senha: 'Senha2026xx' });
    assert.equal(bloq.status, 429, 'conta bloqueada mesmo com a senha certa');
    const u = (await adm.ok('GET', '/api/usuarios')).find((x) => x.email === 'alvo@loja.com');
    assert.equal(u.bloqueado, true);
    await adm.ok('PUT', `/api/usuarios/${u.id}`, { desbloquear: true });
    await c.ok('POST', '/api/login', { email: 'alvo@loja.com', senha: 'Senha2026xx' });
    const token = c.cookie.split('=')[1];
    assert.equal(banco.one('SELECT 1 FROM sessoes WHERE token = ?', [token]), undefined, 'token puro não fica no banco');
    assert.equal((await c.req('POST', '/api/login', { email: 'nao@existe.com', senha: 'x' })).json.erro, 'E-mail ou senha incorretos.');
    assert.equal((await adm.req('POST', '/api/usuarios', { nome: 'X', email: 'x@loja.com', senha: '12345678' })).status, 400, 'senha fraca recusada');
});
test('permissões por usuário: pode adicionar cliente mas não excluir', async () => {
    await adm.ok('POST', '/api/usuarios', { nome: 'Ana', email: 'ana@loja.com', senha: 'AnaLoja2026', perfil: 'vendedor', permissoes: ['clientes.ver', 'clientes.criar'] });
    const ana = new Cliente();
    await ana.ok('POST', '/api/login', { email: 'ana@loja.com', senha: 'AnaLoja2026' });
    const me = await ana.ok('GET', '/api/me');
    assert.deepEqual(me.permissoes.sort(), ['clientes.criar', 'clientes.ver']);
    const p = await ana.ok('POST', '/api/pessoas', { nome: 'Cliente Novo', cpf_cnpj: '52998224725' });
    assert.equal((await ana.req('PUT', `/api/pessoas/${p.id}`, { nome: 'Outro' })).status, 403);
    assert.equal((await ana.req('DELETE', `/api/pessoas/${p.id}`)).status, 403);
    assert.equal((await ana.req('GET', '/api/veiculos')).status, 403);
    assert.equal((await ana.req('GET', '/api/usuarios')).status, 403);
    // Sem permissão de gerenciar, não consegue se promover
    assert.equal((await ana.req('PUT', `/api/usuarios/${me.id}`, { admin: true })).status, 403);
    // Admin dá a permissão de excluir: vale na hora (sessão é encerrada e precisa entrar de novo)
    await adm.ok('PUT', `/api/usuarios/${me.id}`, { permissoes: ['clientes.ver', 'clientes.criar', 'clientes.excluir'] });
    assert.equal((await ana.req('GET', '/api/me')).status, 401, 'mudança de permissão desconecta');
    await ana.ok('POST', '/api/login', { email: 'ana@loja.com', senha: 'AnaLoja2026' });
    await ana.ok('DELETE', `/api/pessoas/${p.id}`);
    // Gerente de usuários que não é admin não dá permissões que não tem
    await adm.ok('POST', '/api/usuarios', { nome: 'Gu', email: 'gu@loja.com', senha: 'GuLoja2026', perfil: 'gerente', permissoes: ['usuarios.gerenciar', 'clientes.ver'] });
    const gu = new Cliente();
    await gu.ok('POST', '/api/login', { email: 'gu@loja.com', senha: 'GuLoja2026' });
    assert.equal((await gu.req('POST', '/api/usuarios', { nome: 'Z', email: 'z@loja.com', senha: 'ZLoja20266', permissoes: ['financeiro.ver'] })).status, 403);
    assert.equal((await gu.req('POST', '/api/usuarios', { nome: 'Z', email: 'z@loja.com', senha: 'ZLoja20266', admin: true })).status, 403);
    // Sempre fica um administrador
    const eu = await adm.ok('GET', '/api/me');
    assert.equal((await adm.req('PUT', `/api/usuarios/${eu.id}`, { admin: false })).status, 400);
});
test('produção: pedido de outro site é recusado (CSRF) e erro interno não vaza detalhes', async () => {
    const app2 = criarAplicacao({ pastaDados: join(pasta, 'p2'), pastaPublica: join(pasta, 'pub'), pastaSite: join(pasta, 'pub'), caminhoAdmin: 'painel-dois-2', servidor: { producao: true } }).app;
    const s = app2.servidor();
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const b2 = `http://127.0.0.1:${s.address().port}`;
    const semOrigem = await fetch(b2 + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(semOrigem.status, 403);
    const outro = await fetch(b2 + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://golpe.com' }, body: '{}' });
    assert.equal(outro.status, 403);
    const certo = await fetch(b2 + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: b2 }, body: JSON.stringify({ nome: 'A', email: 'a@b.com', senha: 'SenhaForte2026' }) });
    assert.equal(certo.status, 200);
    const grande = await fetch(b2 + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: b2 }, body: JSON.stringify({ x: 'a'.repeat(2 * 1024 * 1024) }) });
    assert.equal(grande.status, 413);
    s.close();
});
test('entrada pelo documento, fotos, FIPE e catálogo público', async () => {
    // Fipe com fetch falso
    const fipe = new Fipe(banco, fetchFipe);
    const r = await fipe.procurar({ tipo: 'carros', marca: 'FIAT', modelo: 'ARGO', versao: 'DRIVE 1.3', ano: 2020, combustivel: 'flex' });
    assert.equal(r.candidatos[0].modelo_nome, 'ARGO DRIVE 1.3 8V Flex');
    const doc = await adm.ok('POST', '/api/veiculos/ler-documento', { arquivo: fotoPng });
    assert.equal(doc.dados.placa, 'PMX4G21');
    assert.match(doc.documento, /^docveic-[0-9a-f]{16}\.png$/);
    // Arquivo disfarçado é recusado
    assert.equal((await adm.req('POST', '/api/veiculos/ler-documento', { arquivo: 'data:image/png;base64,' + Buffer.from('<html>oi</html>').toString('base64') })).status, 400);
    const e = await adm.ok('POST', '/api/veiculos/entrada', {
        origem: 'compra', veiculo: { ...doc.dados, km: 45200 }, custo: 52000, preco_venda: 64900, preco_minimo: 61000, forma_pagamento: 'pix',
        documento: doc.documento, proprietario: { nome: doc.dados.proprietario_nome, cpf_cnpj: doc.dados.proprietario_doc },
        fipe: { fipe_codigo: '001493-1', fipe_modelo: 'Fiat ARGO DRIVE 1.3', fipe_valor: 60575, fipe_referencia: 'outubro de 2026' },
    });
    veiculoId = e.id;
    const v = await adm.ok('GET', `/api/veiculos/${e.id}`);
    assert.equal(v.preco_compra, 52000);
    assert.equal(v.fipe_valor, 60575);
    assert.equal(v.negociacoes[0].tipo, 'compra');
    const tit = banco.one('SELECT status FROM titulos WHERE negociacao_id = ?', [e.negociacao_id]);
    assert.equal(tit?.status, 'pago', 'pago no Pix');
    // Sem foto não publica; com foto publica
    assert.equal((await adm.req('POST', `/api/veiculos/${e.id}/catalogo`, { publicado: true })).status, 400);
    const f1 = await adm.ok('POST', `/api/veiculos/${e.id}/fotos`, { imagem: fotoPng });
    const f2 = await adm.ok('POST', `/api/veiculos/${e.id}/fotos`, { imagem: fotoPng });
    await adm.ok('PUT', `/api/veiculos/${e.id}/fotos/ordem`, { ids: [f2.id, f1.id] });
    // Foto não publicada não aparece para o público
    assert.equal((await new Cliente().req('GET', `/fotos-publicas/${f2.arquivo}`)).status, 404);
    assert.equal((await new Cliente().req('GET', `/fotos/${f2.arquivo}`)).status, 401);
    await adm.ok('POST', `/api/veiculos/${e.id}/catalogo`, { publicado: true, descricao_catalogo: 'Único dono <script>alert(1)</script>' });
    const visitante = new Cliente();
    const home = await visitante.req('GET', '/');
    assert.match(home.txt, /Fiat Argo/);
    assert.match(home.txt, /R\$\s?64\.900/);
    assert.ok(!home.txt.includes('52.000'), 'custo nunca aparece no catálogo');
    assert.ok(!home.txt.includes('PMX4G21'), 'placa completa não aparece');
    const det = await visitante.req('GET', `/veiculo/${e.id}`);
    assert.equal(det.status, 301);
    const url = det.headers.get('location');
    const pag = await visitante.req('GET', url);
    assert.equal(pag.status, 200);
    assert.ok(pag.txt.includes('&lt;script&gt;'), 'texto do anúncio é escapado');
    assert.match(pag.txt, /wa\.me\/5585987346133/);
    assert.match(pag.txt, /og:image/);
    assert.equal((await visitante.req('GET', `/fotos-publicas/${f2.arquivo}`)).status, 200);
    assert.match((await visitante.req('GET', '/sitemap.xml')).txt, new RegExp(`/veiculo/${e.id}-`));
    // Filtros
    assert.match((await visitante.req('GET', '/?q=argo')).txt, /1 veículo\s*<span>encontrado/);
    assert.match((await visitante.req('GET', '/?faixa=ate50')).txt, /0 veículos\s*<span>encontrados/);
    // Pedido de visita feito pelo site chega em Contatos do site
    const pedido = await visitante.req('POST', '/api/site/contato', { tipo: 'visita', nome: 'Carla', telefone: '(85) 99999-1234', veiculo_id: e.id, dados: { v_dia: '2026-10-20', v_periodo: 'Manhã' } });
    assert.equal(pedido.status, 200);
    assert.equal((await visitante.req('POST', '/api/site/contato', { tipo: 'visita', nome: 'X', telefone: '1' })).status, 400);
    assert.equal((await visitante.req('GET', '/api/site/contatos')).status, 401);
    const contatos = await adm.ok('GET', '/api/site/contatos?status=novo');
    assert.equal(contatos[0].nome, 'Carla');
    assert.equal(contatos[0].marca, 'Fiat');
    await adm.ok('POST', `/api/site/contatos/${contatos[0].id}/atendido`, {});
    assert.equal((await adm.ok('GET', '/api/contadores')).contatos_novos, 0);
});
test('custo escondido de quem não tem permissão e exclusão protegida', async () => {
    await adm.ok('POST', '/api/usuarios', { nome: 'Vend', email: 'vend@loja.com', senha: 'Senha2026vv', perfil: 'vendedor' });
    const vend = new Cliente();
    await vend.ok('POST', '/api/login', { email: 'vend@loja.com', senha: 'Senha2026vv' });
    const v = await vend.ok('GET', `/api/veiculos/${veiculoId}`);
    assert.equal(v.preco_compra, undefined);
    assert.equal(v.custo_total, undefined);
    assert.equal(v.fipe_valor, 60575, 'vendedor vê a FIPE');
    const lista = await vend.ok('GET', '/api/veiculos');
    assert.equal(lista[0].custo_total, undefined);
    assert.equal((await vend.ok('GET', '/api/painel')).estoque.custo, null);
    assert.equal((await vend.req('DELETE', `/api/veiculos/${veiculoId}`)).status, 403);
    // Com compra registrada, nem o admin exclui sem cancelar antes
    assert.equal((await adm.req('DELETE', `/api/veiculos/${veiculoId}`)).status, 400);
    // Veículo só cadastrado (sem compra) pode ser excluído
    const so = await adm.ok('POST', '/api/veiculos/entrada', { origem: 'estoque', custo: 1000, veiculo: { marca: 'Honda', modelo: 'CG 160', ano_fab: 2021, ano_mod: 2021, placa: 'ABC1D23', renavam: '00123456789', chassi: '9C2KC2200MR000001', tipo: 'moto' } });
    await adm.ok('DELETE', `/api/veiculos/${so.id}`);
});
test('recibo com a logo e o nome da loja', async () => {
    const t = banco.one("SELECT id FROM titulos WHERE status = 'pago' LIMIT 1");
    const r = await adm.req('GET', `/api/titulos/${t.id}/recibo`);
    assert.equal(r.status, 200);
    assert.match(r.txt, /COMPROVANTE DE PAGAMENTO/);
    assert.match(r.txt, /cinquenta e dois mil reais/);
    assert.ok(!r.txt.includes('onclick'), 'sem scripts embutidos (CSP)');
});
test('utilitários: TOTP, tipo de arquivo e leitura do documento', () => {
    // Vetor do RFC 6238 (segredo ASCII "12345678901234567890", T = 59 s → 94287082, 6 dígitos = 287082)
    const segredo = base32(Buffer.from('12345678901234567890'));
    assert.equal(deBase32(segredo).toString(), '12345678901234567890');
    assert.equal(codigoTotp(segredo, 1), '287082');
    const agora = Date.now();
    const c = codigoTotp(segredo, passoAtual(agora));
    const passo = conferirTotp(segredo, c, 0, agora);
    assert.ok(passo > 0);
    assert.equal(conferirTotp(segredo, c, passo, agora), 0, 'mesmo código não vale duas vezes');
    assert.equal(tipoReal(PNG), 'image/png');
    assert.equal(tipoReal(Buffer.from('%PDF-1.7')), 'application/pdf');
    assert.equal(tipoReal(Buffer.from('<svg>')), null);
    const l = conferirLeitura({ placa: 'pmx-4g21', chassi: '9BD358A4NLYK1234O', renavam: '123', ano_fab: 2020, ano_mod: 2020, alienacao_fiduciaria: true });
    assert.equal(l.dados.placa, 'PMX4G21');
    assert.equal(l.dados.chassi, '9BD358A4NLYK12340', 'O vira 0 no chassi');
    assert.ok(l.avisos.some((a) => /alienação/.test(a)));
    assert.ok(l.avisos.some((a) => /RENAVAM/.test(a)));
});
