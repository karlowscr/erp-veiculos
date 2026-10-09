import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Limitador } from '../http/app.js';
import { esc, moeda, telFmt, nomeLoja, enderecoLoja, urlLogo } from '../impressao/base.js';
import { falhar, texto, numero } from '../util/comum.js';
import { soDigitos } from '../util/validacao.js';
import { auditar } from './auth.js';
/**
 * Catálogo público (vitrine) servido em "/". Gerado no servidor: abre rápido
 * no celular, aparece no Google e com foto no WhatsApp. Não há link nem
 * menção à área administrativa.
 *
 * Recursos para o cliente: destaque do pátio, comparação com a FIPE (só
 * quando o preço está abaixo), simulador de financiamento, agendar visita,
 * avaliar a troca, salvar favoritos. Os pedidos chegam na área da loja em
 * "Contatos do site" e abrem a conversa no WhatsApp.
 */
const POR_PAGINA = 24;
const TIPOS_IMG = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const NOMES_COMB = { flex: 'Flex', gasolina: 'Gasolina', etanol: 'Etanol', diesel: 'Diesel', eletrico: 'Elétrico', hibrido: 'Híbrido', gnv: 'GNV' };
const NOMES_CAMBIO = { manual: 'Manual', automatico: 'Automático', automatizado: 'Automatizado', cvt: 'Automático CVT' };
/** "FIAT ARGO DRIVE" → "Fiat Argo Drive"; siglas curtas e códigos ficam em maiúsculas (HR-V, EXL, CVT, 4X4). */
const cap = (s) => String(s ?? '').split(/(\s+)/).map((p) => {
    if (/^\s+$/.test(p) || !p)
        return p;
    if (p.length <= 3 || /[-\d]/.test(p) && /^[A-Z0-9.\-/]+$/i.test(p))
        return p === p.toLowerCase() && p.length > 3 ? p : p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}).join('');
const km = (n) => `${Number(n ?? 0).toLocaleString('pt-BR')} km`;
const reais = (v) => moeda(v).replace(',00', '');
const SITUACAO_PUBLICA = "v.publicado = 1 AND v.situacao IN ('estoque','reservado')";
const TIPOS_CONTATO = ['interesse', 'visita', 'troca', 'financiamento'];
export function slug(v) {
    return `${v.id}-${`${v.marca} ${v.modelo} ${v.versao ?? ''} ${v.ano_mod}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`;
}
function whatsapp(e) {
    let d = String(e.whatsapp || e.telefone || '').replace(/\D/g, '');
    if (!d)
        return '';
    if (d.length <= 11)
        d = '55' + d;
    return d;
}
const linkWhats = (e, msg) => { const n = whatsapp(e); return n ? `https://wa.me/${n}?text=${encodeURIComponent(msg)}` : ''; };
/** Quanto o anúncio está abaixo da FIPE (só conta quando está abaixo ou igual). */
function abaixoFipe(v) {
    if (!v.mostrar_preco || !v.fipe_valor || !v.preco_venda || v.preco_venda > v.fipe_valor)
        return null;
    const dif = v.fipe_valor - v.preco_venda;
    return { dif, pct: Math.round((dif / v.fipe_valor) * 1000) / 10 };
}
function origemSite(ctx, req) {
    if (ctx.urlPublica)
        return ctx.urlPublica.replace(/\/$/, '');
    const host = String(req.bruto.headers.host ?? 'localhost').replace(/[^\w.:-]/g, '');
    return `${req.https ? 'https' : 'http'}://${host}`;
}
const ic = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const I = {
    whats: ic('<path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4a.5.5 0 0 0 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.7 11.7 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3Z"/>'),
    busca: ic('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"/>'),
    local: ic('<path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
    relogio: ic('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
    insta: ic('<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/>'),
    voltar: ic('<path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    compartilhar: ic('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
    tel: ic('<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/>'),
    coracao: ic('<path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20Z" fill="var(--preenche, none)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
    calendario: ic('<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
    troca: ic('<path d="M4 8h13l-3-3M20 16H7l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
    fotos: ic('<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="m4 18 5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
};
function layout(ctx, req, e, op) {
    const loja = nomeLoja(e);
    const origem = origemSite(ctx, req);
    const logo = urlLogo(e);
    const cor = /^#[0-9a-fA-F]{6}$/.test(e.cor_marca ?? '') ? e.cor_marca : '#f26b1d';
    const zap = linkWhats(e, `Olá! Vim pelo site da ${loja}.`);
    const mapa = enderecoLoja(e) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${loja} ${enderecoLoja(e).replace(/ · /g, ', ')}`)}` : '';
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(op.titulo)}</title>
<meta name="description" content="${esc(op.descricao)}">
<link rel="canonical" href="${esc(origem + op.canonico)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(loja)}"><meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(op.titulo)}"><meta property="og:description" content="${esc(op.descricao)}">
<meta property="og:url" content="${esc(origem + op.canonico)}">
${op.imagem ? `<meta property="og:image" content="${esc(origem + op.imagem)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="#1c2127">
${logo ? `<link rel="icon" href="${esc(logo)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/s/catalogo.css?v=3">
<style>:root{--marca:${cor}}</style>
${op.jsonLd ? `<script type="application/ld+json">${JSON.stringify(op.jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head><body class="${op.classe ?? ''}" data-whats="${esc(whatsapp(e))}" data-loja="${esc(loja)}">
<a class="pular" href="#principal">Ir para o conteúdo</a>
<header class="topo"><div class="faixa">
  <a class="marca" href="/">${logo ? `<img src="${esc(logo)}" alt="">` : `<span class="sigla">${esc(loja.slice(0, 1))}</span>`}<span class="nome">${esc(loja)}</span></a>
  <nav class="atalhos" aria-label="Atalhos">
    <a href="/#estoque">Estoque</a>
    <a href="/#troca">Venda ou troque seu carro</a>
    <a href="/?salvos=1" class="salvos" data-salvos hidden>${I.coracao}<span>Salvos</span> <b data-salvos-qtd>0</b></a>
  </nav>
  ${zap ? `<a class="btn-zap" href="${esc(zap)}" target="_blank" rel="noopener">${I.whats}<span>Chamar no WhatsApp</span></a>` : ''}
</div></header>
<main id="principal">${op.corpo}</main>
<footer class="rodape"><div class="faixa">
  <div class="rodape-loja">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<div><b>${esc(e.razao_social || loja)}</b>${e.cnpj ? `<small>CNPJ ${esc(String(e.cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'))}</small>` : ''}</div></div>
  <ul class="rodape-contato">
    ${enderecoLoja(e) ? `<li>${I.local}${mapa ? `<a href="${esc(mapa)}" target="_blank" rel="noopener">${esc(enderecoLoja(e))}</a>` : esc(enderecoLoja(e))}</li>` : ''}
    ${e.horario ? `<li>${I.relogio}${esc(e.horario)}</li>` : ''}
    ${e.telefone || e.whatsapp ? `<li>${I.tel}<a href="tel:+${esc(whatsapp(e))}">${esc(telFmt(e.whatsapp || e.telefone))}</a></li>` : ''}
    ${e.instagram ? `<li>${I.insta}<a href="https://instagram.com/${esc(e.instagram)}" target="_blank" rel="noopener">@${esc(e.instagram)}</a></li>` : ''}
  </ul>
  <p class="aviso-legal">Fotos e informações sujeitas a alteração sem aviso. Preços à vista, sujeitos à disponibilidade. Simulações de financiamento são estimativas e dependem de aprovação de crédito.</p>
</div></footer>
${op.barraFixa ?? (zap ? `<a class="zap-flutuante" href="${esc(zap)}" target="_blank" rel="noopener" aria-label="Conversar no WhatsApp">${I.whats}</a>` : '')}
<dialog class="janela" id="janela" aria-labelledby="janela-titulo">
  <form method="dialog" class="janela-fechar"><button aria-label="Fechar">×</button></form>
  <h2 id="janela-titulo"></h2><p class="janela-sub"></p>
  <form id="form-contato" class="form-contato" novalidate>
    <input type="hidden" name="tipo"><input type="hidden" name="veiculo_id">
    <div class="extra"></div>
    <label>Seu nome<input name="nome" required minlength="2" maxlength="80" autocomplete="name"></label>
    <label>WhatsApp com DDD<input name="telefone" required inputmode="tel" autocomplete="tel" placeholder="(85) 9 9999-9999"></label>
    <label class="mel" aria-hidden="true">Site<input name="site" tabindex="-1" autocomplete="off"></label>
    <p class="erro" role="alert" hidden></p>
    <button type="submit" class="btn-zap largo">${I.whats}<span>Enviar e abrir o WhatsApp</span></button>
    <small>Seu pedido chega à loja e a conversa abre no WhatsApp com tudo preenchido.</small>
  </form>
</dialog>
<script src="/s/catalogo.js?v=3" defer></script>
</body></html>`;
}
function cartao(v) {
    const titulo = `${cap(v.marca)} ${cap(v.modelo)}`;
    const fipe = abaixoFipe(v);
    return `<article class="cartao" data-id="${v.id}">
    <a class="cartao-link" href="/veiculo/${esc(slug(v))}">
      <div class="foto">${v.foto ? `<img src="/fotos-publicas/${esc(v.foto)}" alt="${esc(titulo)} ${v.ano_mod}" loading="lazy" decoding="async">` : '<div class="sem-foto"></div>'}
        ${v.qtd_fotos > 1 ? `<span class="qtd-fotos">${I.fotos}${v.qtd_fotos}</span>` : ''}
        ${v.situacao === 'reservado' ? '<span class="tarja reservado">Reservado</span>' : v.novo_no_patio ? '<span class="tarja">Chegou agora</span>' : ''}</div>
      <div class="info">
        <h3><span class="ano">${v.ano_fab}/${v.ano_mod}</span>${esc(titulo)}</h3>
        <p class="versao">${esc(cap(v.versao || ''))}</p>
        <ul class="dados"><li>${esc(km(v.km))}</li><li>${esc(NOMES_CAMBIO[v.cambio] ?? cap(v.cambio))}</li><li>${esc(NOMES_COMB[v.combustivel] ?? cap(v.combustivel))}</li></ul>
        <div class="preco-linha"><p class="preco ${v.mostrar_preco ? '' : 'consulte'}">${v.mostrar_preco ? reais(v.preco_venda) : 'Consulte o preço'}</p>
          ${fipe && fipe.pct >= 1 ? `<span class="fipe-selo" title="Preço ${reais(fipe.dif)} abaixo da tabela FIPE">${fipe.pct.toLocaleString('pt-BR')}% abaixo da FIPE</span>` : ''}</div>
      </div>
    </a>
    <button type="button" class="favoritar" data-favoritar="${v.id}" aria-pressed="false" aria-label="Salvar ${esc(titulo)}">${I.coracao}</button>
  </article>`;
}
const COLUNAS_CARTAO = `v.id, v.marca, v.modelo, v.versao, v.ano_fab, v.ano_mod, v.km, v.cambio, v.combustivel, v.preco_venda, v.mostrar_preco, v.destaque, v.situacao,
  v.fipe_valor, v.tipo, (julianday('now') - julianday(v.data_entrada)) < 8 AS novo_no_patio,
  (SELECT arquivo FROM veiculo_fotos f WHERE f.veiculo_id = v.id ORDER BY ordem, id LIMIT 1) AS foto,
  (SELECT COUNT(*) FROM veiculo_fotos f WHERE f.veiculo_id = v.id) AS qtd_fotos`;
/** Faixas de preço oferecidas como atalhos. */
const FAIXAS = [
    ['ate50', 'Até R$ 50 mil', 0, 50000], ['50a80', 'R$ 50 a 80 mil', 50000, 80000], ['80a120', 'R$ 80 a 120 mil', 80000, 120000], ['acima120', 'Acima de R$ 120 mil', 120000, 1e12],
];
async function inicio(ctx, req, e) {
    const q = req.query;
    const where = [SITUACAO_PUBLICA];
    const p = [];
    const busca = String(q.get('q') ?? '').trim().slice(0, 60);
    if (busca) {
        for (const t of busca.split(/\s+/).slice(0, 4)) {
            where.push('(v.marca LIKE ? OR v.modelo LIKE ? OR v.versao LIKE ? OR CAST(v.ano_mod AS TEXT) = ?)');
            p.push(`%${t}%`, `%${t}%`, `%${t}%`, t);
        }
    }
    const marca = String(q.get('marca') ?? '').slice(0, 40);
    if (marca) {
        where.push('v.marca = ? COLLATE NOCASE');
        p.push(marca);
    }
    const tipo = q.get('tipo') ?? '';
    if (tipo === 'carros')
        where.push("v.tipo <> 'moto'");
    if (tipo === 'motos')
        where.push("v.tipo = 'moto'");
    const faixa = FAIXAS.find(([k]) => k === q.get('faixa'));
    if (faixa) {
        where.push('v.mostrar_preco = 1 AND v.preco_venda >= ? AND v.preco_venda < ?');
        p.push(faixa[2], faixa[3]);
    }
    const salvos = q.get('salvos') === '1';
    const ids = String(q.get('ids') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 40);
    if (salvos) {
        where.push(`v.id IN (${ids.length ? ids.map(() => '?').join(',') : 'NULL'})`);
        p.push(...ids);
    }
    const ordens = {
        recentes: 'v.destaque DESC, v.data_entrada DESC, v.id DESC', menor: 'v.mostrar_preco DESC, v.preco_venda ASC', maior: 'v.preco_venda DESC',
        km: 'v.km ASC', ano: 'v.ano_mod DESC, v.km ASC',
    };
    const ordem = ordens[q.get('ordem') ?? ''] ? q.get('ordem') : 'recentes';
    const pagina = Math.max(1, Math.min(200, Math.floor(Number(q.get('pagina') ?? 1)) || 1));
    const filtrando = !!(busca || marca || tipo || faixa || salvos);
    const total = ctx.b.one(`SELECT COUNT(*) AS q FROM veiculos v WHERE ${where.join(' AND ')}`, p).q;
    const lista = ctx.b.all(`SELECT ${COLUNAS_CARTAO} FROM veiculos v WHERE ${where.join(' AND ')} ORDER BY ${ordens[ordem]} LIMIT ? OFFSET ?`, [...p, POR_PAGINA, (pagina - 1) * POR_PAGINA]);
    const todos = ctx.b.one(`SELECT COUNT(*) AS q, SUM(v.tipo = 'moto') AS motos, SUM(v.tipo <> 'moto') AS carros FROM veiculos v WHERE ${SITUACAO_PUBLICA}`) ?? {};
    const marcas = ctx.b.all(`SELECT v.marca, COUNT(*) AS q FROM veiculos v WHERE ${SITUACAO_PUBLICA} GROUP BY upper(v.marca) ORDER BY v.marca`);
    // Destaque da capa: o marcado como destaque, senão o que chegou por último
    const capa = !filtrando && pagina === 1 ? ctx.b.one(`SELECT ${COLUNAS_CARTAO}, v.descricao_catalogo, v.cor FROM veiculos v WHERE ${SITUACAO_PUBLICA} AND EXISTS (SELECT 1 FROM veiculo_fotos f WHERE f.veiculo_id = v.id) ORDER BY v.destaque DESC, v.data_entrada DESC, v.id DESC LIMIT 1`) : undefined;
    const loja = nomeLoja(e);
    const titulo = e.catalogo_titulo || `Seminovos em ${e.municipio || 'oferta'}`;
    const link = (mudar) => {
        const u = new URLSearchParams(q);
        u.delete('pagina');
        for (const [k, v] of Object.entries(mudar)) {
            if (v === null || v === '')
                u.delete(k);
            else
                u.set(k, v);
        }
        const s = u.toString();
        return '/' + (s ? '?' + s : '') + '#estoque';
    };
    const chip = (rot, ativo, href) => `<a class="chip" href="${esc(href)}"${ativo ? ' aria-current="true"' : ''}>${esc(rot)}</a>`;
    const opcao = (v, rot, atual) => `<option value="${esc(v)}"${v === atual ? ' selected' : ''}>${esc(rot)}</option>`;
    const paginas = Math.ceil(total / POR_PAGINA);
    const capaHtml = capa ? (() => {
        const t = `${cap(capa.marca)} ${cap(capa.modelo)}`;
        const fipe = abaixoFipe(capa);
        const zap = linkWhats(e, `Olá! Vi o ${t} ${capa.ano_fab}/${capa.ano_mod} no site e tenho interesse.`);
        return `<section class="vitrine-capa" aria-label="Destaque do pátio">
      <div class="faixa capa-grade">
        <div class="capa-texto">
          <p class="capa-rotulo">${capa.destaque ? 'Destaque do pátio' : 'Acabou de chegar'}</p>
          <h1 class="capa-nome"><span>${esc(cap(capa.marca))}</span> ${esc(cap(capa.modelo))}</h1>
          <p class="capa-versao">${esc(cap(capa.versao || ''))}</p>
          <dl class="capa-dados"><div><dt>Ano</dt><dd>${capa.ano_fab}/${capa.ano_mod}</dd></div><div><dt>Rodou</dt><dd>${esc(km(capa.km))}</dd></div><div><dt>Câmbio</dt><dd>${esc(NOMES_CAMBIO[capa.cambio] ?? cap(capa.cambio))}</dd></div></dl>
          <p class="capa-preco">${capa.mostrar_preco ? reais(capa.preco_venda) : 'Consulte o preço'}</p>
          ${fipe ? `<p class="capa-fipe">${reais(fipe.dif)} abaixo da tabela FIPE</p>` : ''}
          <div class="capa-acoes"><a class="btn" href="/veiculo/${esc(slug(capa))}">Ver fotos e detalhes</a>${zap ? `<a class="btn-zap" href="${esc(zap)}" target="_blank" rel="noopener">${I.whats}<span>Tenho interesse</span></a>` : ''}</div>
        </div>
        <a class="capa-foto" href="/veiculo/${esc(slug(capa))}" tabindex="-1" aria-hidden="true"><img src="/fotos-publicas/${esc(capa.foto)}" alt="" fetchpriority="high"></a>
      </div>
      <p class="faixa capa-rodape">${todos.q} veículo${todos.q === 1 ? '' : 's'} à venda na ${esc(loja)}${e.municipio ? ` em ${esc(e.municipio)}` : ''}. ${esc(e.catalogo_sobre || 'Todos com procedência conferida e documentação em dia.')}</p>
    </section>`;
    })() : `<section class="vitrine-capa simples"><div class="faixa"><h1 class="capa-nome">${esc(titulo)}</h1><p class="capa-versao">${esc(e.catalogo_sobre || `Veículos à venda na ${loja}.`)}</p></div></section>`;
    const vazioTexto = salvos ? ['Nenhum veículo salvo', 'Toque no coração dos veículos que você gostar para guardar aqui e comparar depois.']
        : filtrando ? ['Nada com esses filtros', 'Tente outra busca. Se você procura um modelo específico, a loja pode encontrar para você.']
            : ['Novidades chegando', 'Estamos preparando os próximos veículos. Fale com a loja: ela pode encontrar o carro certo para você.'];
    const corpo = `${capaHtml}
  <section class="estoque faixa" id="estoque" aria-labelledby="titulo-estoque">
    <div class="estoque-cab">
      <h2 id="titulo-estoque">${salvos ? 'Seus veículos salvos' : filtrando ? `${total} veículo${total === 1 ? '' : 's'} encontrado${total === 1 ? '' : 's'}` : 'Estoque completo'}</h2>
      ${filtrando ? `<a class="limpar" href="/#estoque">Limpar filtros</a>` : ''}
    </div>
    <form class="busca-linha" method="get" action="/#estoque" role="search">
      <label class="busca">${I.busca}<input type="search" name="q" value="${esc(busca)}" placeholder="Marca, modelo ou ano" aria-label="Buscar veículo"></label>
      ${marcas.length > 1 ? `<select name="marca" aria-label="Marca"><option value="">Todas as marcas</option>${marcas.map((m) => opcao(m.marca, cap(m.marca), marca)).join('')}</select>` : ''}
      <select name="ordem" aria-label="Ordenar">${opcao('recentes', 'Mais recentes', ordem)}${opcao('menor', 'Menor preço', ordem)}${opcao('maior', 'Maior preço', ordem)}${opcao('km', 'Menos rodados', ordem)}${opcao('ano', 'Mais novos', ordem)}</select>
      ${tipo ? `<input type="hidden" name="tipo" value="${esc(tipo)}">` : ''}${faixa ? `<input type="hidden" name="faixa" value="${esc(faixa[0])}">` : ''}
      <button type="submit">Buscar</button>
    </form>
    <nav class="chips" aria-label="Filtros rápidos">
      ${todos.motos && todos.carros ? `${chip('Carros', tipo === 'carros', link({ tipo: tipo === 'carros' ? null : 'carros' }))}${chip('Motos', tipo === 'motos', link({ tipo: tipo === 'motos' ? null : 'motos' }))}<span class="sep"></span>` : ''}
      ${FAIXAS.map(([k, rot]) => chip(rot, faixa?.[0] === k, link({ faixa: faixa?.[0] === k ? null : k }))).join('')}
    </nav>
    ${lista.length ? `<div class="grade">${lista.map(cartao).join('')}</div>`
        : `<div class="vazio"><h3>${vazioTexto[0]}</h3><p>${vazioTexto[1]}</p>${linkWhats(e, 'Olá! Estou procurando um veículo.') ? `<a class="btn-zap" href="${esc(linkWhats(e, 'Olá! Estou procurando um veículo.'))}" target="_blank" rel="noopener">${I.whats}<span>Pedir para a loja procurar</span></a>` : ''}</div>`}
    ${paginas > 1 ? `<nav class="paginas" aria-label="Páginas">${pagina > 1 ? `<a href="${esc(link({ pagina: String(pagina - 1) }))}" rel="prev">Anterior</a>` : ''}<span>Página ${pagina} de ${paginas}</span>${pagina < paginas ? `<a href="${esc(link({ pagina: String(pagina + 1) }))}" rel="next">Próxima</a>` : ''}</nav>` : ''}
  </section>
  <section class="troca" id="troca" aria-labelledby="titulo-troca"><div class="faixa troca-grade">
    <div><h2 id="titulo-troca">Venda ou troque seu carro</h2>
      <p>Conte qual é o seu veículo. A loja avalia e responde no WhatsApp com uma proposta, para vender ou usar como entrada.</p></div>
    <form class="troca-form" data-troca novalidate>
      <label>Marca e modelo<input name="t_modelo" required maxlength="60" placeholder="Ex.: Fiat Uno Way 1.0"></label>
      <label>Ano<input name="t_ano" required inputmode="numeric" maxlength="9" placeholder="2017/2018"></label>
      <label>Quilometragem<input name="t_km" inputmode="numeric" maxlength="9" placeholder="85.000"></label>
      <label>Está quitado?<select name="t_quitado"><option>Sim, quitado</option><option>Ainda está financiado</option></select></label>
      <button type="submit" class="btn">${I.troca}Pedir avaliação</button>
    </form>
  </div></section>`;
    return layout(ctx, req, e, {
        titulo: `${loja}: ${titulo}`, descricao: `${todos.q} veículo${todos.q === 1 ? "" : "s"} à venda na ${loja}${e.municipio ? ' em ' + e.municipio : ''}. Fotos, preços, simulação de financiamento e avaliação do seu carro pelo WhatsApp.`,
        imagem: capa?.foto ? `/fotos-publicas/${capa.foto}` : lista[0]?.foto ? `/fotos-publicas/${lista[0].foto}` : urlLogo(e) || undefined,
        canonico: pagina > 1 || filtrando ? link({}).replace('#estoque', '') : '/', corpo, classe: 'pg-inicio',
        jsonLd: { '@context': 'https://schema.org', '@type': 'AutoDealer', name: loja, telephone: e.whatsapp || e.telefone || undefined, address: enderecoLoja(e) || undefined, openingHours: e.horario || undefined },
    });
}
/** Mostrador que compara o preço com a FIPE (só aparece quando o preço está abaixo). */
function mostradorFipe(v) {
    const f = abaixoFipe(v);
    if (!f)
        return '';
    // Escala de 0% a 20% abaixo; o ponteiro vai para a esquerda quanto mais barato
    const fr = Math.min(1, f.pct / 20);
    const ang = Math.PI * (1 - (0.5 + fr * 0.5));
    const x = 60 + 46 * Math.cos(ang), y = 62 - 46 * Math.sin(ang);
    return `<div class="mostrador" role="img" aria-label="${f.pct.toLocaleString('pt-BR')}% abaixo da tabela FIPE">
    <svg viewBox="0 0 120 70" aria-hidden="true">
      <path d="M10 62a50 50 0 0 1 100 0" class="trilho"/>
      <path d="M10 62a50 50 0 0 1 50-50" class="faixa-boa"/>
      <line x1="60" y1="62" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="ponteiro"/><circle cx="60" cy="62" r="4.5" class="eixo"/>
    </svg>
    <div><b>${reais(f.dif)} abaixo da FIPE</b><span>Tabela FIPE ${reais(v.fipe_valor)}${v.fipe_referencia ? ` em ${esc(v.fipe_referencia)}` : ''}</span></div>
  </div>`;
}
async function detalhe(ctx, req, e, id, res) {
    const v = ctx.b.one(`SELECT v.* FROM veiculos v WHERE v.id = ? AND ${SITUACAO_PUBLICA}`, [id]);
    if (!v)
        return null;
    const certo = slug(v);
    if (req.caminho !== `/veiculo/${certo}`) {
        res.writeHead(301, { Location: `/veiculo/${encodeURI(certo)}` });
        res.end();
        return '';
    }
    const fotos = ctx.b.all('SELECT arquivo FROM veiculo_fotos WHERE veiculo_id = ? ORDER BY ordem, id', [id]);
    const loja = nomeLoja(e);
    const nome = `${cap(v.marca)} ${cap(v.modelo)}`;
    const titulo = `${nome} ${cap(v.versao || '')}`.trim();
    const origem = origemSite(ctx, req);
    const url = `${origem}/veiculo/${certo}`;
    const preco = v.mostrar_preco ? reais(v.preco_venda) : 'Consulte o preço';
    const zap = linkWhats(e, `Olá! Tenho interesse no ${titulo} ${v.ano_fab}/${v.ano_mod}${v.mostrar_preco ? ` anunciado por ${reais(v.preco_venda)}` : ''}. ${url}`);
    const opcionais = String(v.opcionais || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    const final = String(v.placa || '').slice(-1);
    const ficha = [
        ['Ano', `${v.ano_fab}/${v.ano_mod}`], ['Quilometragem', km(v.km)], ['Câmbio', NOMES_CAMBIO[v.cambio] ?? cap(v.cambio)],
        ['Combustível', NOMES_COMB[v.combustivel] ?? cap(v.combustivel)], ['Cor', cap(v.cor)], ['Portas', v.portas ? String(v.portas) : ''],
        ['Motor', v.potencia || v.cilindrada || ''], ['Final da placa', /\d/.test(final) ? final : ''], ['Condição', v.condicao === 'novo' ? '0 km' : 'Seminovo'],
    ].filter(([, val]) => val);
    const outros = ctx.b.all(`SELECT ${COLUNAS_CARTAO} FROM veiculos v WHERE ${SITUACAO_PUBLICA} AND v.id <> ? ORDER BY abs(v.preco_venda - ?) LIMIT 3`, [id, v.preco_venda]);
    const taxa = Number(e.catalogo_taxa_mes ?? 1.99);
    const entradaPct = Number(e.catalogo_entrada_pct ?? 30);
    const veiculoTxt = `${titulo} ${v.ano_fab}/${v.ano_mod}`;
    const simulador = v.mostrar_preco && v.preco_venda > 0 ? `
    <section class="bloco simulador" id="simular" aria-labelledby="t-sim" data-simulador data-preco="${v.preco_venda}" data-taxa="${taxa}">
      <h2 id="t-sim">Simule o financiamento</h2>
      <div class="sim-grade">
        <div class="sim-controles">
          <label class="sim-entrada"><span>Entrada <output data-entrada-valor>${reais(v.preco_venda * entradaPct / 100)}</output></span>
            <input type="range" min="0" max="90" step="5" value="${entradaPct}" data-entrada aria-label="Percentual de entrada"><small><span data-entrada-pct>${entradaPct}</span>% do valor do veículo</small></label>
          <fieldset class="sim-prazos"><legend>Em quantas vezes</legend>
            ${[24, 36, 48, 60].map((n) => `<label><input type="radio" name="prazo" value="${n}"${n === 48 ? ' checked' : ''}><span>${n}x</span></label>`).join('')}
          </fieldset>
        </div>
        <div class="sim-resultado" aria-live="polite">
          <span>Parcelas estimadas de</span><b data-parcela>—</b><small data-sim-resumo></small>
          <button type="button" class="btn" data-abrir="financiamento" data-veiculo="${v.id}" data-veiculo-nome="${esc(veiculoTxt)}">Quero esta simulação</button>
        </div>
      </div>
      <p class="sim-nota">Estimativa com juros de ${taxa.toLocaleString('pt-BR')}% ao mês. O valor final depende da análise de crédito do banco.</p>
    </section>` : '';
    const corpo = `
  <div class="faixa detalhe">
    <a class="voltar" href="/#estoque">${I.voltar}Todos os veículos</a>
    <div class="detalhe-grade">
      <section class="galeria" data-galeria aria-label="Fotos">
        <div class="palco" tabindex="0">${fotos.length ? fotos.map((f, i) => `<img src="/fotos-publicas/${esc(f.arquivo)}" alt="${esc(titulo)}, foto ${i + 1} de ${fotos.length}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}>`).join('') : '<div class="sem-foto"></div>'}</div>
        ${fotos.length > 1 ? `<button class="seta esq" type="button" data-ir="-1" aria-label="Foto anterior">‹</button><button class="seta dir" type="button" data-ir="1" aria-label="Próxima foto">›</button><span class="contador" aria-live="polite">1/${fotos.length}</span>
        <div class="miniaturas">${fotos.map((f, i) => `<button type="button" data-foto="${i}" aria-label="Ver foto ${i + 1}"><img src="/fotos-publicas/${esc(f.arquivo)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        <button type="button" class="ampliar" data-ampliar aria-label="Ver fotos em tela cheia">Tela cheia</button>
      </section>
      <aside class="resumo">
        ${v.situacao === 'reservado' ? '<p class="tarja reservado">Reservado: fale com a loja para entrar na fila</p>' : ''}
        <h1><span class="ano">${v.ano_fab}/${v.ano_mod}</span>${esc(nome)}</h1>
        <p class="versao">${esc(cap(v.versao || ''))}</p>
        <ul class="dados"><li>${esc(km(v.km))}</li><li>${esc(NOMES_CAMBIO[v.cambio] ?? cap(v.cambio))}</li><li>${esc(NOMES_COMB[v.combustivel] ?? cap(v.combustivel))}</li>${v.cor ? `<li>${esc(cap(v.cor))}</li>` : ''}</ul>
        <p class="preco grande ${v.mostrar_preco ? '' : 'consulte'}">${preco}</p>
        ${mostradorFipe(v)}
        <div class="resumo-acoes">
          ${zap ? `<a class="btn-zap largo" href="${esc(zap)}" target="_blank" rel="noopener">${I.whats}<span>Tenho interesse</span></a>` : ''}
          <button type="button" class="btn-sec" data-abrir="visita" data-veiculo="${v.id}" data-veiculo-nome="${esc(veiculoTxt)}">${I.calendario}Agendar visita</button>
          <button type="button" class="btn-sec" data-abrir="troca" data-veiculo="${v.id}" data-veiculo-nome="${esc(veiculoTxt)}">${I.troca}Dar meu carro na troca</button>
          <div class="resumo-mini">
            <button type="button" class="btn-mini favoritar" data-favoritar="${v.id}" aria-pressed="false">${I.coracao}<span>Salvar</span></button>
            <button type="button" class="btn-mini" data-compartilhar data-titulo="${esc(titulo)}" data-url="${esc(url)}">${I.compartilhar}<span>Compartilhar</span></button>
          </div>
        </div>
        <p class="loja-info">${esc(loja)}${e.municipio ? ` em ${esc(e.municipio)}/${esc(e.uf)}` : ''}${e.horario ? `<br>${esc(e.horario)}` : ''}</p>
      </aside>
    </div>
    ${simulador}
    <div class="detalhe-colunas">
      <section class="bloco"><h2>Ficha técnica</h2><dl class="ficha">${ficha.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl></section>
      ${v.descricao_catalogo || opcionais.length ? `<section class="bloco">
        ${v.descricao_catalogo ? `<h2>Sobre este veículo</h2><p class="texto">${esc(v.descricao_catalogo)}</p>` : ''}
        ${opcionais.length ? `<h2>Itens e opcionais</h2><ul class="opcionais">${opcionais.map((o) => `<li>${esc(o.charAt(0).toUpperCase() + o.slice(1))}</li>`).join('')}</ul>` : ''}
      </section>` : ''}
    </div>
    ${outros.length ? `<section class="outros"><h2>Na mesma faixa de preço</h2><div class="grade">${outros.map(cartao).join('')}</div></section>` : ''}
  </div>`;
    const barraFixa = `<div class="barra-fixa"><div><b>${preco}</b><span>${esc(nome)} ${v.ano_mod}</span></div>${zap ? `<a class="btn-zap" href="${esc(zap)}" target="_blank" rel="noopener">${I.whats}<span>Tenho interesse</span></a>` : ''}</div>`;
    const imagem = fotos[0] ? `/fotos-publicas/${fotos[0].arquivo}` : undefined;
    return layout(ctx, req, e, {
        titulo: `${titulo} ${v.ano_fab}/${v.ano_mod}: ${preco} | ${loja}`,
        descricao: `${titulo} ${v.ano_fab}/${v.ano_mod}, ${km(v.km)}, ${NOMES_CAMBIO[v.cambio] ?? v.cambio}, ${NOMES_COMB[v.combustivel] ?? v.combustivel}. ${preco}. ${loja}${e.municipio ? ', ' + e.municipio : ''}.`,
        imagem, canonico: `/veiculo/${certo}`, corpo, classe: 'pg-detalhe', barraFixa,
        jsonLd: {
            '@context': 'https://schema.org', '@type': 'Car', name: `${titulo} ${v.ano_mod}`, brand: { '@type': 'Brand', name: cap(v.marca) }, model: cap(v.modelo),
            vehicleModelDate: String(v.ano_mod), productionDate: String(v.ano_fab), color: cap(v.cor), fuelType: NOMES_COMB[v.combustivel] ?? v.combustivel,
            mileageFromOdometer: { '@type': 'QuantitativeValue', value: v.km, unitCode: 'KMT' }, image: imagem ? origem + imagem : undefined, url,
            offers: v.mostrar_preco ? { '@type': 'Offer', price: v.preco_venda, priceCurrency: 'BRL', availability: 'https://schema.org/InStock', seller: { '@type': 'AutoDealer', name: loja } } : undefined,
        },
    });
}
async function enviarArquivo(res, arquivo, cache) {
    const tipo = TIPOS_IMG[extname(arquivo).toLowerCase()];
    if (!tipo)
        return false;
    try {
        const s = await stat(arquivo);
        if (!s.isFile())
            return false;
        res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': cache, 'Content-Length': String(s.size), 'Cross-Origin-Resource-Policy': 'cross-origin' });
        res.end(await readFile(arquivo));
        return true;
    }
    catch {
        return false;
    }
}
/** Pedidos do site: 6 por hora por endereço de internet. */
const limiteContato = new Limitador(6, 60 * 60_000, 60 * 60_000);
export function registrarCatalogo(app, b, op) {
    const ctx = { b, pastaFotos: op.pastaFotos, pastaArquivos: op.pastaArquivos, urlPublica: op.urlPublica };
    // ---- Pedidos feitos no catálogo (visita, troca, financiamento) ----
    app.post('/api/site/contato', (req) => {
        const c = req.corpo;
        if (texto(c.site))
            return { ok: true }; // armadilha para robôs: campo invisível preenchido
        const espera = limiteContato.bloqueado(req.ip);
        if (espera)
            falhar('Recebemos vários pedidos seus. Fale direto pelo WhatsApp da loja.', 429);
        const tipo = TIPOS_CONTATO.includes(c.tipo) ? c.tipo : falhar('Pedido inválido.');
        const nome = texto(c.nome).replace(/\s+/g, ' ').slice(0, 80);
        if (nome.length < 2)
            falhar('Informe seu nome.');
        const telefone = soDigitos(c.telefone);
        if (telefone.length < 10 || telefone.length > 13)
            falhar('Informe o WhatsApp com DDD.');
        const veiculoId = numero(c.veiculo_id);
        const veiculo = veiculoId ? b.one(`SELECT v.id FROM veiculos v WHERE v.id = ? AND ${SITUACAO_PUBLICA}`, [veiculoId]) : undefined;
        const dados = {};
        for (const [k, val] of Object.entries(c.dados ?? {})) {
            if (/^[a-z_]{1,20}$/.test(k) && Object.keys(dados).length < 12)
                dados[k] = texto(val).slice(0, 120);
        }
        limiteContato.registrar(req.ip);
        const id = b.inserir('contatos_site', {
            tipo, nome, telefone, veiculo_id: veiculo?.id ?? null, mensagem: texto(c.mensagem).slice(0, 1000), dados: JSON.stringify(dados), ip: req.ip,
        });
        return { ok: true, id };
    }, { publica: true });
    app.get('/api/site/contatos', (req) => {
        const status = req.query.get('status');
        return b.all(`SELECT c.*, v.marca, v.modelo, v.ano_mod, v.placa, u.nome AS atendido_por_nome FROM contatos_site c
       LEFT JOIN veiculos v ON v.id = c.veiculo_id LEFT JOIN usuarios u ON u.id = c.atendido_por
       ${status === 'novo' || status === 'atendido' ? 'WHERE c.status = ?' : ''} ORDER BY c.status = 'novo' DESC, c.id DESC LIMIT 300`, status === 'novo' || status === 'atendido' ? [status] : []);
    });
    app.post('/api/site/contatos/:id/atendido', (req) => {
        const id = Number(req.params.id);
        const atendido = req.corpo.atendido !== false;
        b.run('UPDATE contatos_site SET status = ?, atendido_por = ? WHERE id = ?', [atendido ? 'atendido' : 'novo', atendido ? req.usuario.id : null, id]);
        auditar(b, req.usuario.id, atendido ? 'atender' : 'reabrir', 'contatos_site', id);
        return { ok: true };
    });
    const html = (res, status, corpo) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
        res.end(corpo);
    };
    app.paginas.push({
        prefixo: '/',
        tratar: async (req, res) => {
            const c = req.caminho;
            const e = b.one('SELECT * FROM empresa WHERE id = 1') ?? {};
            if (c === '/' + op.caminhoAdmin) {
                res.writeHead(301, { Location: `/${op.caminhoAdmin}/` });
                res.end();
                return true;
            }
            if (c === '/') {
                html(res, 200, await inicio(ctx, req, e));
                return true;
            }
            const m = /^\/veiculo\/(\d+)(?:-[a-z0-9-]*)?$/.exec(c);
            if (m) {
                const r = await detalhe(ctx, req, e, Number(m[1]), res);
                if (r === '')
                    return true;
                if (r) {
                    html(res, 200, r);
                    return true;
                }
                html(res, 404, layout(ctx, req, e, { titulo: `Veículo não disponível | ${nomeLoja(e)}`, descricao: '', canonico: '/', corpo: `<div class="faixa vazio pagina-vazia"><h1>Este veículo já foi vendido</h1><p>Veja os outros veículos da loja ou peça para a loja procurar um parecido.</p><a class="btn" href="/#estoque">Ver veículos disponíveis</a></div>` }));
                return true;
            }
            const f = /^\/fotos-publicas\/([\w-]+\.(?:jpg|jpeg|png|webp))$/i.exec(c);
            if (f) {
                const ok = b.one(`SELECT 1 FROM veiculo_fotos fo JOIN veiculos v ON v.id = fo.veiculo_id WHERE fo.arquivo = ? AND ${SITUACAO_PUBLICA}`, [f[1]]);
                if (ok && (await enviarArquivo(res, join(op.pastaFotos, f[1]), 'public, max-age=86400')))
                    return true;
                res.writeHead(404);
                res.end();
                return true;
            }
            if (c === '/marca/logo') {
                if (e.logo && /^[\w.-]+$/.test(e.logo) && (await enviarArquivo(res, join(op.pastaArquivos, e.logo), 'public, max-age=3600')))
                    return true;
                res.writeHead(404);
                res.end();
                return true;
            }
            if (c === '/robots.txt') {
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origemSite(ctx, req)}/sitemap.xml\n`);
                return true;
            }
            if (c === '/sitemap.xml') {
                const o = origemSite(ctx, req);
                const vs = b.all(`SELECT v.id, v.marca, v.modelo, v.versao, v.ano_mod FROM veiculos v WHERE ${SITUACAO_PUBLICA}`);
                res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
                res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(o)}/</loc></url>${vs.map((v) => `<url><loc>${esc(`${o}/veiculo/${slug(v)}`)}</loc></url>`).join('')}</urlset>`);
                return true;
            }
            return false;
        },
    });
}
