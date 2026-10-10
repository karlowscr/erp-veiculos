import { api, sessao, definirAoDeslogar, pode } from './api.js';
import { html, montar, $, aoEnviar, campos, mostrarErro, rotulo, iniciais } from './ui.js';
import { icone } from './icones.js';
import * as painel from './paginas/painel.js';
import * as veiculos from './paginas/veiculos.js';
import * as pessoas from './paginas/pessoas.js';
import * as negociacoes from './paginas/negociacoes.js';
import * as financeiro from './paginas/financeiro.js';
import * as notas from './paginas/notas.js';
import * as renave from './paginas/renave.js';
import * as config from './paginas/config.js';
import * as contratos from './paginas/contratos.js';
import * as assinaturas from './paginas/assinaturas.js';
import * as cobrancas from './paginas/cobrancas.js';
import * as carnes from './paginas/carnes.js';
import * as documentos from './paginas/documentos.js';
import * as usuarios from './paginas/usuarios.js';
import * as conta from './paginas/conta.js';
import * as contatos from './paginas/contatos.js';
import * as mural from './paginas/mural.js';
const GRUPOS = [
    { nome: '', itens: [{ rota: 'painel', texto: 'Painel', icone: 'painel', pagina: painel }] },
    { nome: 'Vendas', itens: [
            { rota: 'veiculos', texto: 'Veículos', icone: 'carro', pagina: veiculos, perm: ['veiculos.ver', 'veiculos.criar'] },
            { rota: 'contatos', texto: 'Contatos do site', icone: 'mensagem', pagina: contatos, perm: ['site.contatos'], contador: 'contatos_novos' },
            { rota: 'mural', texto: 'Mural dos clientes', icone: 'camera', pagina: mural, perm: ['site.mural'] },
            { rota: 'negociacoes', texto: 'Negociações', icone: 'setas', pagina: negociacoes, perm: ['negociacoes.ver'] },
            { rota: 'contratos', texto: 'Contratos', icone: 'arquivo', pagina: contratos, perm: ['contratos.ver'] },
            { rota: 'assinaturas', texto: 'Ass. digital', icone: 'caneta', pagina: assinaturas, perm: ['contratos.ver', 'contratos.assinar'], contador: 'contratos_pendentes' },
        ] },
    { nome: 'Financeiro', itens: [
            { rota: 'financeiro', texto: 'Financeiro', icone: 'dolar', pagina: financeiro },
            { rota: 'cobrancas', texto: 'Cobranças', icone: 'cartao', pagina: cobrancas, perm: ['cobrancas.ver'], contador: 'cobrancas_atrasadas' },
            { rota: 'carnes', texto: 'Carnês', icone: 'recibo', pagina: carnes, perm: ['carnes.ver'] },
        ] },
    { nome: 'Cadastros', itens: [
            { rota: 'pessoas', texto: 'Clientes', icone: 'usuarios', pagina: pessoas, perm: ['clientes.ver'] },
            { rota: 'documentos', texto: 'Documentos', icone: 'pdf', pagina: documentos, perm: ['documentos.ver'] },
        ] },
    { nome: 'Fiscal', itens: [
            { rota: 'notas', texto: 'Notas fiscais', icone: 'nota', pagina: notas, perm: ['notas.ver'] },
            { rota: 'renave', texto: 'RENAVE', icone: 'escudo', pagina: renave, perm: ['renave.ver'] },
        ] },
    { nome: 'Sistema', itens: [
            { rota: 'usuarios', texto: 'Usuários', icone: 'cadeado', pagina: usuarios, perm: ['usuarios.gerenciar'] },
            { rota: 'config', texto: 'Configurações', icone: 'engrenagem', pagina: config, perm: ['config.ver'] },
            { rota: 'conta', texto: 'Minha conta', icone: 'usuario', pagina: conta },
        ] },
];
const MENU = GRUPOS.flatMap((g) => g.itens);
const app = document.getElementById('app');
const loja = { nome: 'Pátio', logo: '' };
function marca() {
    const simbolo = loja.logo ? html `<img src="/marca/logo?v=${loja.logo.slice(0, 24)}" alt="">` : html `<span class="marca-sigla">${iniciais(loja.nome).slice(0, 2)}</span>`;
    return html `<a class="marca" href="#/painel">${simbolo}<b>${loja.nome}</b></a>`;
}
function layout() {
    const u = sessao.usuario;
    const visivel = (m) => !m.perm || pode(...m.perm);
    return html `
  <a class="pular" href="#conteudo">Ir para o conteúdo</a>
  <div class="barra-movel">${marca()}<button class="icone-btn claro" data-menu aria-label="Abrir menu" aria-expanded="false">${icone('menu', 22)}</button></div>
  <aside class="lateral" id="lateral">
    ${marca()}
    <nav id="menu" aria-label="Menu principal">${GRUPOS.map((g) => {
        const itens = g.itens.filter(visivel);
        if (!itens.length)
            return '';
        return html `<div class="grupo">${g.nome ? html `<span class="grupo-nome">${g.nome}</span>` : ''}${itens.map((m) => html `
        <a href="#/${m.rota}" data-rota="${m.rota}">${icone(m.icone)}<span>${m.texto}</span>${m.contador ? html `<em class="contador" data-contador="${m.contador}" hidden></em>` : ''}</a>`)}</div>`;
    })}<div class="grupo"><a href="/" target="_blank" rel="noopener">${icone('olho')}<span>Ver catálogo</span></a></div></nav>
    <div class="usuario"><span class="avatar">${iniciais(u.nome)}</span><div><b>${u.nome}</b><small>${u.admin ? 'Administrador' : rotulo(u.perfil)}</small></div>
      <button class="icone-btn claro" data-sair title="Sair" aria-label="Sair">${icone('sair')}</button></div>
  </aside>
  <div class="cortina" data-fechar-menu></div>
  <main id="conteudo" tabindex="-1"></main>`;
}
async function atualizarContadores() {
    try {
        const c = await api.get('/api/contadores');
        document.querySelectorAll('[data-contador]').forEach((el) => {
            const n = c[el.dataset.contador] ?? 0;
            el.textContent = String(n);
            el.hidden = !n;
        });
    }
    catch { /* contadores são opcionais */ }
}
async function navegar() {
    if (!sessao.usuario)
        return;
    const [rota = 'painel', ...params] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    const item = MENU.find((m) => m.rota === rota && (!m.perm || pode(...m.perm))) ?? MENU[0];
    document.querySelectorAll('#menu a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.rota === item.rota));
    document.body.classList.remove('menu-aberto');
    // Elemento novo a cada navegação: ouvintes da página anterior não sobrevivem
    const antigo = $('#conteudo');
    const main = antigo.cloneNode(false);
    antigo.replaceWith(main);
    main.innerHTML = '<div class="carregando"><span></span></div>';
    try {
        await item.pagina.render(main, params);
        document.title = `${item.texto} · ${loja.nome}`;
    }
    catch (e) {
        montar(main, html `<div class="vazio"><p>${e.message}</p></div>`);
    }
    main.focus({ preventScroll: true });
    atualizarContadores();
}
function telaEntrada(precisaSetup) {
    montar(app, html `
  <div class="entrada">
    <div class="entrada-lado">
      ${marca()}
      <p>Estoque, vendas, contratos, cobranças, nota fiscal e RENAVE num só lugar.</p>
    </div>
    <div class="entrada-caixa">
      <h1>${precisaSetup ? 'Criar o primeiro acesso' : 'Entrar'}</h1>
      <p>${precisaSetup ? 'Este usuário será o administrador do sistema.' : 'Use o e-mail e a senha cadastrados.'}</p>
      <form id="f-entrada">
        <div class="grade-form">${campos(precisaSetup ? [
        { nome: 'nome', rotulo: 'Seu nome', obrigatorio: true, largura: 4 },
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true, largura: 4 },
        { nome: 'senha', rotulo: 'Senha (8+ caracteres, com letras e números)', tipo: 'senha', obrigatorio: true, largura: 4, attrs: 'minlength="8" autocomplete="new-password"' },
    ] : [
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true, largura: 4, attrs: 'autocomplete="username"' },
        { nome: 'senha', rotulo: 'Senha', tipo: 'senha', obrigatorio: true, largura: 4, attrs: 'autocomplete="current-password"' },
    ])}</div>
        <button type="submit" class="largo">${precisaSetup ? 'Criar e entrar' : 'Entrar'}</button>
      </form>
    </div>
  </div>`);
    aoEnviar($('#f-entrada'), async (d) => {
        if (precisaSetup)
            await api.post('/api/setup', d);
        const r = await api.post('/api/login', { email: d.email, senha: d.senha });
        if (r.precisa_codigo)
            return pedirCodigo(d.email, d.senha);
        await iniciar();
    });
}
/** Segunda etapa: código de 6 dígitos do aplicativo autenticador. */
function pedirCodigo(email, senha) {
    const caixa = $('.entrada-caixa');
    montar(caixa, html `
    <h1>Verificação em duas etapas</h1>
    <p>Abra o aplicativo autenticador no celular e digite o código de 6 dígitos.</p>
    <form id="f-codigo"><div class="grade-form">${campos([
        { nome: 'codigo', rotulo: 'Código', obrigatorio: true, largura: 4, attrs: 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" autofocus' },
    ])}</div><button type="submit" class="largo">Confirmar</button></form>
    <p><a href="#" data-voltar>Voltar</a></p>`);
    caixa.querySelector('[data-voltar]').addEventListener('click', (e) => { e.preventDefault(); iniciar(); });
    caixa.querySelector('input[name=codigo]').focus();
    aoEnviar($('#f-codigo'), async (d) => {
        await api.post('/api/login', { email, senha, codigo: d.codigo });
        await iniciar();
    });
}
async function carregarLoja() {
    try {
        const e = await api.get('/api/empresa');
        loja.nome = e.nome_fantasia || e.razao_social || 'Pátio';
        loja.logo = e.logo || '';
        aplicarCor(e.cor_marca);
    }
    catch { /* mantém o padrão */ }
}
/** A cor principal escolhida em Configurações também colore os destaques do painel. */
function aplicarCor(cor) {
    const r = document.documentElement.style;
    if (!cor || !/^#[0-9a-fA-F]{6}$/.test(cor)) {
        for (const v of ['--laranja', '--laranja-escuro', '--laranja-claro', '--laranja-borda'])
            r.removeProperty(v);
        return;
    }
    r.setProperty('--laranja', cor);
    r.setProperty('--laranja-escuro', `color-mix(in oklab, ${cor} 82%, #000)`);
    r.setProperty('--laranja-claro', `color-mix(in oklab, ${cor} 9%, #fff)`);
    r.setProperty('--laranja-borda', `color-mix(in oklab, ${cor} 32%, #fff)`);
}
/** Redesenha a marca depois que a logo ou o nome mudam nas configurações. */
function atualizarMarca() {
    document.querySelectorAll('.marca').forEach((el) => { el.outerHTML = marca().s; });
}
async function iniciar() {
    try {
        sessao.usuario = await api.get('/api/me');
    }
    catch {
        sessao.usuario = undefined;
        const { precisaSetup } = await api.get('/api/setup');
        return telaEntrada(precisaSetup);
    }
    await carregarLoja();
    montar(app, layout());
    app.querySelector('[data-sair]').addEventListener('click', async () => {
        await api.post('/api/logout');
        sessao.usuario = undefined;
        location.hash = '';
        iniciar();
    });
    app.querySelector('[data-menu]').addEventListener('click', (e) => {
        const aberto = document.body.classList.toggle('menu-aberto');
        e.currentTarget.setAttribute('aria-expanded', String(aberto));
    });
    app.querySelector('[data-fechar-menu]').addEventListener('click', () => document.body.classList.remove('menu-aberto'));
    await navegar();
}
definirAoDeslogar(() => {
    if (sessao.usuario) {
        sessao.usuario = undefined;
        iniciar();
    }
});
window.addEventListener('hashchange', () => navegar().catch(mostrarErro));
// Disparado pelas configurações quando o nome ou a logo da loja mudam
window.addEventListener('loja-alterada', async () => { await carregarLoja(); atualizarMarca(); });
window.addEventListener('contadores', () => { atualizarContadores(); });
iniciar().catch(mostrarErro);
