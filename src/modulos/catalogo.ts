import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { trazerDaNuvem } from '../util/nuvem.js';
import { join, extname } from 'node:path';
import type { ServerResponse } from 'node:http';
import { Limitador, type App, type Req } from '../http/app.js';
import type { Banco, Linha } from '../db/database.js';
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
const TIPOS_IMG: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const NOMES_COMB: Record<string, string> = { flex: 'Flex', gasolina: 'Gasolina', etanol: 'Etanol', diesel: 'Diesel', eletrico: 'Elétrico', hibrido: 'Híbrido', gnv: 'GNV' };
const NOMES_CAMBIO: Record<string, string> = { manual: 'Manual', automatico: 'Automático', automatizado: 'Automatizado', cvt: 'Automático CVT' };
/** "FIAT ARGO DRIVE" → "Fiat Argo Drive"; siglas curtas e códigos ficam em maiúsculas (HR-V, EXL, CVT, 4X4). */
const cap = (s: string) => String(s ?? '').split(/(\s+)/).map((p) => {
  if (/^\s+$/.test(p) || !p) return p;
  if (p.length <= 3 || /[-\d]/.test(p) && /^[A-Z0-9.\-/]+$/i.test(p)) return p === p.toLowerCase() && p.length > 3 ? p : p.toUpperCase();
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}).join('');
const km = (n: number) => `${Number(n ?? 0).toLocaleString('pt-BR')} km`;
const reais = (v: number) => moeda(v).replace(',00', '');
const SITUACAO_PUBLICA = "v.publicado = 1 AND v.situacao IN ('estoque','reservado')";
const TIPOS_CONTATO = ['interesse', 'visita', 'troca', 'financiamento'];

export function slug(v: Linha): string {
  return `${v.id}-${`${v.marca} ${v.modelo} ${v.versao ?? ''} ${v.ano_mod}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`;
}

function whatsapp(e: Linha): string {
  let d = String(e.whatsapp || e.telefone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return d;
}
const linkWhats = (e: Linha, msg: string) => { const n = whatsapp(e); return n ? `https://wa.me/${n}?text=${encodeURIComponent(msg)}` : ''; };

/** Quanto o anúncio está abaixo da FIPE (só conta quando está abaixo ou igual). */
function abaixoFipe(v: Linha): { pct: number; dif: number } | null {
  if (!v.mostrar_preco || !v.fipe_valor || !v.preco_venda || v.preco_venda > v.fipe_valor) return null;
  const dif = v.fipe_valor - v.preco_venda;
  return { dif, pct: Math.round((dif / v.fipe_valor) * 1000) / 10 };
}

interface Ctx { b: Banco; pastaFotos: string; pastaArquivos: string; urlPublica?: string }

function origemSite(ctx: Ctx, req: Req): string {
  if (ctx.urlPublica) return ctx.urlPublica.replace(/\/$/, '');
  const host = String(req.bruto.headers.host ?? 'localhost').replace(/[^\w.:-]/g, '');
  return `${req.https ? 'https' : 'http'}://${host}`;
}

const ic = (d: string, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
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

const J = {
  seta: ic('<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  carteira: ic('<rect x="3" y="6" width="18" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M16 15h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  grafico: ic('<path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  mais: ic('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
};

/** Divide o título em duas linhas (a segunda sai em outro tom, como nas referências). */
function duasLinhas(t: string): [string, string] {
  const s = t.trim();
  const m = /^(.+?)\s+((?:em|na|no|para|com|de)\s.+)$/i.exec(s);
  if (m && m[1].length >= 6) return [m[1], m[2]];
  const p = s.split(/\s+/);
  if (p.length < 2) return [s, ''];
  const meio = Math.ceil(p.length / 2);
  return [p.slice(0, meio).join(' '), p.slice(meio).join(' ')];
}
const titulo2 = (t: string, tag = 'h2', extra = '') => {
  const [a, b] = duasLinhas(t);
  return `<${tag} class="titulo-duplo"${extra}>${esc(a)}${b ? ` <span>${esc(b)}</span>` : ''}</${tag}>`;
};

function layout(ctx: Ctx, req: Req, e: Linha, op: { titulo: string; descricao: string; imagem?: string; canonico: string; corpo: string; jsonLd?: unknown; classe?: string; barraFixa?: string }): string {
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
<meta name="theme-color" content="${cor}">
${logo ? `<link rel="icon" href="${esc(logo)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/s/catalogo.css?v=${versaoSite.css}">
<style>:root{--marca:${cor}}</style>
${op.jsonLd ? `<script type="application/ld+json">${JSON.stringify(op.jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head><body class="${op.classe ?? ''}" data-whats="${esc(whatsapp(e))}" data-loja="${esc(loja)}">
<a class="pular" href="#principal">Ir para o conteúdo</a>
<header class="topo">
  <nav class="pilula" aria-label="Menu">
    <a class="marca" href="/">${logo ? `<img src="${esc(logo)}" alt="">` : `<span class="sigla">${esc(loja.slice(0, 1))}</span>`}<span class="nome">${esc(loja)}</span></a>
    <span class="atalhos">
      <a href="/#estoque">Estoque</a>
      <a href="/#vantagens">Como comprar</a>
      <a href="/#troca">Troca</a>
      <a href="/#duvidas">Dúvidas</a>
    </span>
    <a href="/?salvos=1" class="salvos" data-salvos hidden aria-label="Veículos salvos">${I.coracao}<b data-salvos-qtd>0</b></a>
    ${zap ? `<a class="btn-zap" href="${esc(zap)}" target="_blank" rel="noopener">${I.whats}<span>WhatsApp</span></a>` : ''}
  </nav>
</header>
<main id="principal">${op.corpo}</main>
<footer class="rodape"><div class="faixa">
  <div class="rodape-loja">${logo ? `<img src="${esc(logo)}" alt="">` : `<span class="sigla">${esc(loja.slice(0, 1))}</span>`}<div><b>${esc(e.razao_social || loja)}</b>${e.cnpj ? `<small>CNPJ ${esc(String(e.cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'))}</small>` : ''}</div></div>
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
<script src="/s/catalogo.js?v=${versaoSite.js}" defer></script>
</body></html>`;
}

function cartao(v: Linha): string {
  const titulo = `${cap(v.marca)} ${cap(v.modelo)}`;
  const fipe = abaixoFipe(v);
  return `<article class="cartao" data-id="${v.id}">
    <a class="cartao-link" href="/veiculo/${esc(slug(v))}">
      <div class="foto">${v.foto ? `<img src="/fotos-publicas/${esc(v.foto)}" alt="${esc(titulo)} ${v.ano_mod}" loading="lazy" decoding="async">` : '<div class="sem-foto"></div>'}
        ${v.qtd_fotos > 1 ? `<span class="qtd-fotos">${I.fotos}${v.qtd_fotos}</span>` : ''}
        ${v.situacao === 'reservado' ? '<span class="tarja reservado">Reservado</span>' : v.novo_no_patio ? '<span class="tarja">Chegou agora</span>' : ''}</div>
      <div class="info">
        <p class="ano">${v.ano_fab}/${v.ano_mod}</p>
        <h3>${esc(titulo)}</h3>
        <p class="versao">${esc(cap(v.versao || ''))}</p>
        <ul class="dados"><li>${esc(km(v.km))}</li><li>${esc(NOMES_CAMBIO[v.cambio] ?? cap(v.cambio))}</li><li>${esc(NOMES_COMB[v.combustivel] ?? cap(v.combustivel))}</li></ul>
        <div class="preco-linha">
          <div><p class="preco ${v.mostrar_preco ? '' : 'consulte'}">${v.mostrar_preco ? reais(v.preco_venda) : 'Consulte o preço'}</p>
          ${fipe && fipe.pct >= 1 ? `<span class="fipe-selo" title="Preço ${reais(fipe.dif)} abaixo da tabela FIPE">${fipe.pct.toLocaleString('pt-BR')}% abaixo da FIPE</span>` : ''}</div>
          <span class="circulo" aria-hidden="true">${J.seta}</span>
        </div>
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
const FAIXAS: [string, string, number, number][] = [
  ['ate50', 'Até R$ 50 mil', 0, 50000], ['50a80', 'R$ 50 a 80 mil', 50000, 80000], ['80a120', 'R$ 80 a 120 mil', 80000, 120000], ['acima120', 'Acima de R$ 120 mil', 120000, 1e12],
];

/** Número que conta até o valor quando aparece na tela. */
const contador = (valor: number, op: { casas?: number; prefixo?: string; sufixo?: string } = {}) =>
  `<b class="contador-num" data-contar="${valor}" data-casas="${op.casas ?? 0}" data-prefixo="${esc(op.prefixo ?? '')}" data-sufixo="${esc(op.sufixo ?? '')}">${esc((op.prefixo ?? '') + valor.toLocaleString('pt-BR', { minimumFractionDigits: op.casas ?? 0, maximumFractionDigits: op.casas ?? 0 }) + (op.sufixo ?? ''))}</b>`;

function faixaChamada(e: Linha, titulo: string, texto: string): string {
  const zap = linkWhats(e, `Olá! Vim pelo site da ${nomeLoja(e)}.`);
  return `<section class="chamada"><div class="chamada-caixa">
    ${titulo2(titulo)}
    <p>${esc(texto)}</p>
    ${zap ? `<a class="btn-claro" href="${esc(zap)}" target="_blank" rel="noopener">${I.whats}<span>Conversar no WhatsApp</span></a>` : ''}
  </div></section>`;
}

async function inicio(ctx: Ctx, req: Req, e: Linha): Promise<string> {
  const q = req.query;
  const where = [SITUACAO_PUBLICA];
  const p: any[] = [];
  const busca = String(q.get('q') ?? '').trim().slice(0, 60);
  if (busca) {
    for (const t of busca.split(/\s+/).slice(0, 4)) {
      where.push('(v.marca LIKE ? OR v.modelo LIKE ? OR v.versao LIKE ? OR CAST(v.ano_mod AS TEXT) = ?)');
      p.push(`%${t}%`, `%${t}%`, `%${t}%`, t);
    }
  }
  const marca = String(q.get('marca') ?? '').slice(0, 40);
  if (marca) { where.push('upper(v.marca) = upper(?)'); p.push(marca); }
  const tipo = q.get('tipo') ?? '';
  if (tipo === 'carros') where.push("v.tipo <> 'moto'");
  if (tipo === 'motos') where.push("v.tipo = 'moto'");
  const faixa = FAIXAS.find(([k]) => k === q.get('faixa'));
  if (faixa) { where.push('v.mostrar_preco = 1 AND v.preco_venda >= ? AND v.preco_venda < ?'); p.push(faixa[2], faixa[3]); }
  const salvos = q.get('salvos') === '1';
  const ids = String(q.get('ids') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 40);
  if (salvos) { where.push(`v.id IN (${ids.length ? ids.map(() => '?').join(',') : 'NULL'})`); p.push(...ids); }
  const ordens: Record<string, string> = {
    recentes: 'v.destaque DESC, v.data_entrada DESC, v.id DESC', menor: 'v.mostrar_preco DESC, v.preco_venda ASC', maior: 'v.preco_venda DESC',
    km: 'v.km ASC', ano: 'v.ano_mod DESC, v.km ASC',
  };
  const ordem = ordens[q.get('ordem') ?? ''] ? (q.get('ordem') as string) : 'recentes';
  const pagina = Math.max(1, Math.min(200, Math.floor(Number(q.get('pagina') ?? 1)) || 1));
  const filtrando = !!(busca || marca || tipo || faixa || salvos);
  const total = ctx.b.one(`SELECT COUNT(*) AS q FROM veiculos v WHERE ${where.join(' AND ')}`, p)!.q as number;
  const lista = ctx.b.all(`SELECT ${COLUNAS_CARTAO} FROM veiculos v WHERE ${where.join(' AND ')} ORDER BY ${ordens[ordem]} LIMIT ? OFFSET ?`, [...p, POR_PAGINA, (pagina - 1) * POR_PAGINA]);
  const todos = ctx.b.one(`SELECT COUNT(*) AS q, SUM(CASE WHEN v.tipo = 'moto' THEN 1 ELSE 0 END) AS motos, SUM(CASE WHEN v.tipo <> 'moto' THEN 1 ELSE 0 END) AS carros,
    MAX(CASE WHEN v.mostrar_preco = 1 AND v.fipe_valor > 0 AND v.preco_venda > 0 AND v.preco_venda <= v.fipe_valor THEN (v.fipe_valor - v.preco_venda) * 100.0 / v.fipe_valor END) AS maior_desconto
    FROM veiculos v WHERE ${SITUACAO_PUBLICA}`) ?? {};
  const marcas = ctx.b.all(`SELECT MIN(v.marca) AS marca, COUNT(*) AS q FROM veiculos v WHERE ${SITUACAO_PUBLICA} GROUP BY upper(v.marca) ORDER BY MIN(v.marca)`);
  // Destaque da capa: o marcado como destaque, senão o que chegou por último
  const capa = !filtrando && pagina === 1 ? ctx.b.one(`SELECT ${COLUNAS_CARTAO}, v.descricao_catalogo, v.cor FROM veiculos v WHERE ${SITUACAO_PUBLICA} AND EXISTS (SELECT 1 FROM veiculo_fotos f WHERE f.veiculo_id = v.id) ORDER BY v.destaque DESC, v.data_entrada DESC, v.id DESC LIMIT 1`) : undefined;
  const loja = nomeLoja(e);
  const titulo = e.catalogo_titulo || `Seminovos em ${e.municipio || 'oferta'}`;
  const link = (mudar: Record<string, string | null>) => {
    const u = new URLSearchParams(q);
    u.delete('pagina');
    for (const [k, v] of Object.entries(mudar)) { if (v === null || v === '') u.delete(k); else u.set(k, v); }
    const s = u.toString();
    return '/' + (s ? '?' + s : '') + '#estoque';
  };
  const chip = (rot: string, ativo: boolean, href: string) => `<a class="chip" href="${esc(href)}"${ativo ? ' aria-current="true"' : ''}>${esc(rot)}</a>`;
  const opcao = (v: string, rot: string, atual: string) => `<option value="${esc(v)}"${v === atual ? ' selected' : ''}>${esc(rot)}</option>`;
  const paginas = Math.ceil(total / POR_PAGINA);
  const taxa = Number(e.catalogo_taxa_mes ?? 1.99);
  const qtd = Number(todos.q ?? 0);
  const desconto = Number(todos.maior_desconto ?? 0);
  const zapGeral = linkWhats(e, `Olá! Vim pelo site da ${loja}.`);
  const sobre = e.catalogo_sobre || 'Todos com procedência conferida e documentação em dia.';

  // ---- Capa: título grande, o veículo em destaque no centro e cartões de vidro em volta ----
  const capaHtml = !filtrando && pagina === 1 ? (() => {
    const t = capa ? `${cap(capa.marca)} ${cap(capa.modelo)}` : '';
    const fipe = capa ? abaixoFipe(capa) : null;
    const [l1, l2] = duasLinhas(titulo);
    return `<section class="capa${capa ? '' : ' sem-destaque'}" aria-label="${esc(loja)}">
      <div class="capa-brilho" aria-hidden="true"></div>
      <div class="capa-topo">
        <h1 class="titulo-duplo grande">${esc(l1)}${l2 ? ` <span>${esc(l2)}</span>` : ''}</h1>
        <p class="capa-sub">${qtd} veículo${qtd === 1 ? '' : 's'} à venda na ${esc(loja)}${e.municipio ? ` em ${esc(e.municipio)}` : ''}. ${esc(sobre)}</p>
      </div>
      ${capa ? `<div class="capa-palco">
        <a class="capa-foto" href="/veiculo/${esc(slug(capa))}" aria-label="Ver ${esc(t)}"><img src="/fotos-publicas/${esc(capa.foto)}" alt="${esc(t)} ${capa.ano_mod}" fetchpriority="high"></a>
        <a class="vidro vidro-a" href="/veiculo/${esc(slug(capa))}">
          <span class="vidro-rotulo">${capa.destaque ? 'Destaque do pátio' : 'Acabou de chegar'}</span>
          <b class="vidro-num">${capa.mostrar_preco ? reais(capa.preco_venda) : 'Consulte'}</b>
          <span>${esc(t)} ${capa.ano_fab}/${capa.ano_mod}</span>
          <span class="vidro-acao"><span class="btn-mini-claro">Ver fotos e detalhes</span><span class="circulo">${J.seta}</span></span>
        </a>
        ${fipe && fipe.pct >= 1 ? `<div class="vidro vidro-b"><b class="vidro-num">${fipe.pct.toLocaleString('pt-BR')}%</b><span>abaixo da tabela FIPE<br>${reais(fipe.dif)} de diferença</span></div>` : ''}
        <div class="vidro vidro-c"><b class="vidro-num">${esc(km(capa.km).replace(' km', ''))}<small> km</small></b><span>${esc(NOMES_CAMBIO[capa.cambio] ?? cap(capa.cambio))}, ${esc(NOMES_COMB[capa.combustivel] ?? cap(capa.combustivel))}</span></div>
      </div>` : `<div class="capa-acoes"><a class="btn-claro" href="#estoque">Ver o estoque</a>${zapGeral ? `<a class="btn-vidro" href="${esc(zapGeral)}" target="_blank" rel="noopener">${I.whats}<span>Falar com a loja</span></a>` : ''}</div>`}
    </section>`;
  })() : '';

  const vazioTexto = salvos ? ['Nenhum veículo salvo', 'Toque no coração dos veículos que você gostar para guardar aqui e comparar depois.']
    : filtrando ? ['Nada com esses filtros', 'Tente outra busca. Se você procura um modelo específico, a loja pode encontrar para você.']
      : ['Novidades chegando', 'Estamos preparando os próximos veículos. Fale com a loja: ela pode encontrar o carro certo para você.'];

  const estoque = `<section class="estoque${filtrando || pagina > 1 ? ' sem-capa' : ''}" id="estoque" aria-labelledby="titulo-estoque"><div class="faixa">
    <div class="estoque-cab">
      ${salvos ? '<h2 class="titulo-duplo" id="titulo-estoque">Seus veículos<span>salvos para comparar</span></h2>'
        : filtrando ? `<h2 class="titulo-duplo" id="titulo-estoque">${total} veículo${total === 1 ? '' : 's'}<span>encontrado${total === 1 ? '' : 's'}</span></h2>`
          : '<h2 class="titulo-duplo" id="titulo-estoque">Estoque completo<span>escolha o seu</span></h2>'}
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
  </div></section>`;

  // ---- Faixa forte: números da loja e o que dá para fazer pelo site ----
  const vantagens = `<section class="intensa" id="vantagens" aria-labelledby="t-vant"><div class="faixa">
    <div class="intensa-cab">
      <h2 class="titulo-duplo claro" id="t-vant">Comprar aqui<span>é simples assim</span></h2>
      <div class="numeros">
        <div>${contador(qtd)}<span>veículo${qtd === 1 ? '' : 's'} no pátio agora</span></div>
        <div>${contador(60, { prefixo: 'até ', sufixo: 'x' })}<span>no simulador de financiamento</span></div>
        ${desconto >= 1 ? `<div>${contador(Math.floor(desconto * 10) / 10, { casas: 1, sufixo: '%' })}<span>o maior desconto sobre a FIPE no estoque</span></div>` : ''}
      </div>
    </div>
    <div class="bento">
      <a class="vidro bento-a" href="#estoque">${J.carteira}<b>Simule a parcela</b><span>Em cada veículo você escolhe a entrada e o prazo, e vê a parcela na hora. Juros de referência de ${taxa.toLocaleString('pt-BR')}% ao mês.</span><span class="circulo">${J.seta}</span></a>
      <a class="vidro" href="#troca">${I.troca}<b>Seu carro na troca</b><span>Conte qual é o seu carro e receba a proposta pelo WhatsApp.</span><span class="circulo">${J.seta}</span></a>
      <button type="button" class="vidro" data-abrir="visita">${I.calendario}<b>Agende uma visita</b><span>Escolha o dia e o período. A loja confirma com você.</span><span class="circulo">${J.seta}</span></button>
      <a class="vidro" href="#estoque">${J.grafico}<b>Comparação com a FIPE</b><span>Quando o preço está abaixo da tabela, mostramos quanto.</span><span class="circulo">${J.seta}</span></a>
      <a class="vidro" href="/?salvos=1#estoque">${I.coracao}<b>Salve e compare</b><span>Toque no coração para guardar os carros que você gostou.</span><span class="circulo">${J.seta}</span></a>
      ${zapGeral ? `<a class="vidro" href="${esc(zapGeral)}" target="_blank" rel="noopener">${I.whats}<b>Atendimento no WhatsApp</b><span>${esc(e.horario || 'Fale direto com a equipe da loja.')}</span><span class="circulo">${J.seta}</span></a>` : ''}
    </div>
  </div></section>`;

  // ---- Troca: passos (é uma sequência de verdade) + formulário ----
  const troca = `<section class="troca" id="troca" aria-labelledby="titulo-troca"><div class="faixa troca-cartao">
    <div class="troca-texto">
      ${titulo2('Venda ou troque seu carro', 'h2', ' id="titulo-troca"')}
      <ol class="passos">
        <li><b>Conte qual é o carro</b><span>Modelo, ano e quilometragem.</span></li>
        <li><b>A loja avalia</b><span>Com base na FIPE e no estado do veículo.</span></li>
        <li><b>Você recebe a proposta</b><span>No WhatsApp, para vender ou usar como entrada.</span></li>
      </ol>
    </div>
    <form class="troca-form" data-troca novalidate>
      <label class="largo">Marca e modelo<input name="t_modelo" required maxlength="60" placeholder="Ex.: Fiat Uno Way 1.0"></label>
      <label>Ano<input name="t_ano" required inputmode="numeric" maxlength="9" placeholder="2017/2018"></label>
      <label>Quilometragem<input name="t_km" inputmode="numeric" maxlength="9" placeholder="85.000"></label>
      <label class="largo">Está quitado?<select name="t_quitado"><option>Sim, quitado</option><option>Ainda está financiado</option></select></label>
      <button type="submit" class="btn largo">${I.troca}Pedir avaliação</button>
    </form>
  </div></section>`;

  // ---- Dúvidas ----
  const duvidas: [string, string][] = [
    ['Como funciona o financiamento?', `Abra o veículo, escolha a entrada e o número de parcelas no simulador e toque em "Quero esta simulação". A loja faz a análise de crédito com o banco e responde pelo WhatsApp. A simulação usa juros de referência de ${taxa.toLocaleString('pt-BR')}% ao mês; o valor final depende da aprovação.`],
    ['Posso dar meu carro como parte do pagamento?', 'Sim. Preencha a avaliação acima ou toque em "Dar meu carro na troca" na página do veículo. A loja responde com uma proposta.'],
    ['Como agendo uma visita?', `Na página do veículo, toque em "Agendar visita" e escolha o dia e o período.${e.horario ? ` Horário da loja: ${e.horario}.` : ''}${enderecoLoja(e) ? ` Endereço: ${enderecoLoja(e)}.` : ''}`],
    ['O que significa "abaixo da FIPE"?', 'A tabela FIPE é a referência de preço médio de veículos no Brasil. Quando o preço anunciado está abaixo dela, mostramos a diferença no anúncio.'],
    ['Os preços podem mudar?', 'Os preços anunciados são à vista e sujeitos à disponibilidade. Confirme com a loja antes de fechar negócio.'],
  ];
  const faq = `<section class="duvidas" id="duvidas" aria-labelledby="t-duv"><div class="faixa duvidas-grade">
    ${titulo2('Ficou alguma dúvida?', 'h2', ' id="t-duv"')}
    <div class="acordeao">${duvidas.map(([p, r], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(p)}<span class="mais" aria-hidden="true">${J.mais}</span></summary><p>${esc(r)}</p></details>`).join('')}</div>
  </div></section>`;

  const corpo = `${capaHtml}${estoque}${!filtrando && pagina === 1 ? vantagens + troca + faq + faixaChamada(e, `Encontrou o seu? Fale com a ${loja}`, 'Tire dúvidas, peça mais fotos ou combine uma visita. A equipe responde pelo WhatsApp.') : ''}`;
  return layout(ctx, req, e, {
    titulo: `${loja}: ${titulo}`, descricao: `${qtd} veículo${qtd === 1 ? '' : 's'} à venda na ${loja}${e.municipio ? ' em ' + e.municipio : ''}. Fotos, preços, simulação de financiamento e avaliação do seu carro pelo WhatsApp.`,
    imagem: capa?.foto ? `/fotos-publicas/${capa.foto}` : lista[0]?.foto ? `/fotos-publicas/${lista[0].foto}` : urlLogo(e) || undefined,
    canonico: pagina > 1 || filtrando ? link({}).replace('#estoque', '') : '/', corpo, classe: 'pg-inicio',
    jsonLd: { '@context': 'https://schema.org', '@type': 'AutoDealer', name: loja, telephone: e.whatsapp || e.telefone || undefined, address: enderecoLoja(e) || undefined, openingHours: e.horario || undefined },
  });
}

/** Mostrador que compara o preço com a FIPE (só aparece quando o preço está abaixo). */
function mostradorFipe(v: Linha): string {
  const f = abaixoFipe(v);
  if (!f) return '';
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

async function detalhe(ctx: Ctx, req: Req, e: Linha, id: number, res: ServerResponse): Promise<string | null> {
  const v = ctx.b.one(`SELECT v.* FROM veiculos v WHERE v.id = ? AND ${SITUACAO_PUBLICA}`, [id]);
  if (!v) return null;
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
  const ficha: [string, string][] = ([
    ['Ano', `${v.ano_fab}/${v.ano_mod}`], ['Quilometragem', km(v.km)], ['Câmbio', NOMES_CAMBIO[v.cambio] ?? cap(v.cambio)],
    ['Combustível', NOMES_COMB[v.combustivel] ?? cap(v.combustivel)], ['Cor', cap(v.cor)], ['Portas', v.portas ? String(v.portas) : ''],
    ['Motor', v.potencia || v.cilindrada || ''], ['Final da placa', /\d/.test(final) ? final : ''], ['Condição', v.condicao === 'novo' ? '0 km' : 'Seminovo'],
  ] as [string, string][]).filter(([, val]) => val);
  const outros = ctx.b.all(`SELECT ${COLUNAS_CARTAO} FROM veiculos v WHERE ${SITUACAO_PUBLICA} AND v.id <> ? ORDER BY abs(v.preco_venda - ?) LIMIT 3`, [id, v.preco_venda]);
  const taxa = Number(e.catalogo_taxa_mes ?? 1.99);
  const entradaPct = Number(e.catalogo_entrada_pct ?? 30);
  const veiculoTxt = `${titulo} ${v.ano_fab}/${v.ano_mod}`;
  const simulador = v.mostrar_preco && v.preco_venda > 0 ? `
    <section class="intensa simulador" id="simular" aria-labelledby="t-sim" data-simulador data-preco="${v.preco_venda}" data-taxa="${taxa}">
      <div class="sim-grade">
        <div class="sim-controles">
          <h2 class="titulo-duplo claro" id="t-sim">Simule o financiamento<span>do seu jeito</span></h2>
          <label class="sim-entrada"><span>Entrada <output data-entrada-valor>${reais(v.preco_venda * entradaPct / 100)}</output></span>
            <input type="range" min="0" max="90" step="5" value="${entradaPct}" data-entrada aria-label="Percentual de entrada"><small><span data-entrada-pct>${entradaPct}</span>% do valor do veículo</small></label>
          <fieldset class="sim-prazos"><legend>Em quantas vezes</legend>
            ${[24, 36, 48, 60].map((n) => `<label><input type="radio" name="prazo" value="${n}"${n === 48 ? ' checked' : ''}><span>${n}x</span></label>`).join('')}
          </fieldset>
        </div>
        <div class="vidro sim-resultado" aria-live="polite">
          <span>Parcelas estimadas de</span><b data-parcela>—</b><small data-sim-resumo></small>
          <button type="button" class="btn-claro" data-abrir="financiamento" data-veiculo="${v.id}" data-veiculo-nome="${esc(veiculoTxt)}">Quero esta simulação</button>
          <p class="sim-nota">Estimativa com juros de ${taxa.toLocaleString('pt-BR')}% ao mês. O valor final depende da análise de crédito do banco.</p>
        </div>
      </div>
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
        <p class="ano">${v.ano_fab}/${v.ano_mod}</p>
        <h1 class="titulo-duplo">${esc(nome)}${v.versao ? `<span>${esc(cap(v.versao))}</span>` : ''}</h1>
        <ul class="dados"><li>${esc(km(v.km))}</li><li>${esc(NOMES_CAMBIO[v.cambio] ?? cap(v.cambio))}</li><li>${esc(NOMES_COMB[v.combustivel] ?? cap(v.combustivel))}</li>${v.cor ? `<li>${esc(cap(v.cor))}</li>` : ''}</ul>
        <p class="preco grande ${v.mostrar_preco ? '' : 'consulte'}">${preco}</p>
        ${mostradorFipe(v)}
        <div class="resumo-acoes">
          ${zap ? `<a class="btn-zap largo" href="${esc(zap)}" target="_blank" rel="noopener">${I.whats}<span>Tenho interesse</span></a>` : ''}
          <div class="duas-acoes">
            <button type="button" class="btn-sec" data-abrir="visita" data-veiculo="${v.id}" data-veiculo-nome="${esc(veiculoTxt)}">${I.calendario}Agendar visita</button>
            <button type="button" class="btn-sec" data-abrir="troca" data-veiculo="${v.id}" data-veiculo-nome="${esc(veiculoTxt)}">${I.troca}Dar na troca</button>
          </div>
          <div class="resumo-mini">
            <button type="button" class="btn-mini favoritar" data-favoritar="${v.id}" aria-pressed="false">${I.coracao}<span>Salvar</span></button>
            <button type="button" class="btn-mini" data-compartilhar data-titulo="${esc(titulo)}" data-url="${esc(url)}">${I.compartilhar}<span>Compartilhar</span></button>
          </div>
        </div>
        <p class="loja-info">${esc(loja)}${e.municipio ? ` em ${esc(e.municipio)}/${esc(e.uf)}` : ''}${e.horario ? `<br>${esc(e.horario)}` : ''}</p>
      </aside>
    </div>
  </div>
  ${simulador}
  <div class="faixa detalhe-baixo">
    <section class="bloco"><h2 class="titulo-duplo">Ficha técnica</h2><dl class="ficha">${ficha.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl></section>
    ${v.descricao_catalogo || opcionais.length ? `<section class="bloco">
      ${v.descricao_catalogo ? `<h2 class="titulo-duplo">Sobre este veículo</h2><p class="texto">${esc(v.descricao_catalogo)}</p>` : ''}
      ${opcionais.length ? `<h3 class="sub">Itens e opcionais</h3><ul class="opcionais">${opcionais.map((o) => `<li>${esc(o.charAt(0).toUpperCase() + o.slice(1))}</li>`).join('')}</ul>` : ''}
    </section>` : ''}
    ${outros.length ? `<section class="outros">${titulo2('Na mesma faixa de preço')}<div class="grade">${outros.map(cartao).join('')}</div></section>` : ''}
  </div>
  ${faixaChamada(e, 'Gostou deste? Fale com a loja agora', `Peça mais fotos, um vídeo ou combine um test drive do ${nome}.`)}`;
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

async function enviarArquivo(res: ServerResponse, arquivo: string, cache: string): Promise<boolean> {
  const tipo = TIPOS_IMG[extname(arquivo).toLowerCase()];
  if (!tipo) return false;
  try {
    await trazerDaNuvem(arquivo);
    const s = await stat(arquivo);
    if (!s.isFile()) return false;
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': cache, 'Content-Length': String(s.size), 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.end(await readFile(arquivo));
    return true;
  } catch {
    return false;
  }
}

/** Pedidos do site: 6 por hora por endereço de internet. */
const limiteContato = new Limitador(6, 60 * 60_000, 60 * 60_000);

/** Versão dos arquivos do site pelo conteúdo: muda o endereço a cada atualização, e o navegador não usa a cópia antiga. */
const versaoSite = { css: '1', js: '1' };
function lerVersoes(pastaSite?: string) {
  if (!pastaSite) return;
  for (const k of ['css', 'js'] as const) {
    try { versaoSite[k] = createHash('sha256').update(readFileSync(join(pastaSite, `catalogo.${k}`))).digest('hex').slice(0, 10); } catch { /* fica a padrão */ }
  }
}

export function registrarCatalogo(app: App, b: Banco, op: { pastaFotos: string; pastaArquivos: string; caminhoAdmin: string; urlPublica?: string; pastaSite?: string }): void {
  lerVersoes(op.pastaSite);
  const ctx: Ctx = { b, pastaFotos: op.pastaFotos, pastaArquivos: op.pastaArquivos, urlPublica: op.urlPublica };

  // ---- Pedidos feitos no catálogo (visita, troca, financiamento) ----
  app.post('/api/site/contato', (req) => {
    const c = req.corpo;
    if (texto(c.site)) return { ok: true }; // armadilha para robôs: campo invisível preenchido
    const espera = limiteContato.bloqueado(req.ip);
    if (espera) falhar('Recebemos vários pedidos seus. Fale direto pelo WhatsApp da loja.', 429);
    const tipo = TIPOS_CONTATO.includes(c.tipo) ? c.tipo : falhar('Pedido inválido.');
    const nome = texto(c.nome).replace(/\s+/g, ' ').slice(0, 80);
    if (nome.length < 2) falhar('Informe seu nome.');
    const telefone = soDigitos(c.telefone);
    if (telefone.length < 10 || telefone.length > 13) falhar('Informe o WhatsApp com DDD.');
    const veiculoId = numero(c.veiculo_id);
    const veiculo = veiculoId ? b.one(`SELECT v.id FROM veiculos v WHERE v.id = ? AND ${SITUACAO_PUBLICA}`, [veiculoId]) : undefined;
    const dados: Record<string, string> = {};
    for (const [k, val] of Object.entries(c.dados ?? {})) {
      if (/^[a-z_]{1,20}$/.test(k) && Object.keys(dados).length < 12) dados[k] = texto(val).slice(0, 120);
    }
    limiteContato.registrar(req.ip);
    const id = b.inserir('contatos_site', {
      tipo, nome, telefone, veiculo_id: veiculo?.id ?? null, mensagem: texto(c.mensagem).slice(0, 1000), dados: JSON.stringify(dados), ip: req.ip,
    });
    return { ok: true, id };
  }, { publica: true });

  app.get('/api/site/contatos', (req) => {
    const status = req.query.get('status');
    return b.all(
      `SELECT c.*, v.marca, v.modelo, v.ano_mod, v.placa, u.nome AS atendido_por_nome FROM contatos_site c
       LEFT JOIN veiculos v ON v.id = c.veiculo_id LEFT JOIN usuarios u ON u.id = c.atendido_por
       ${status === 'novo' || status === 'atendido' ? 'WHERE c.status = ?' : ''} ORDER BY c.status = 'novo' DESC, c.id DESC LIMIT 300`,
      status === 'novo' || status === 'atendido' ? [status] : []);
  });
  app.post('/api/site/contatos/:id/atendido', (req) => {
    const id = Number(req.params.id);
    const atendido = req.corpo.atendido !== false;
    b.run('UPDATE contatos_site SET status = ?, atendido_por = ? WHERE id = ?', [atendido ? 'atendido' : 'novo', atendido ? req.usuario!.id : null, id]);
    auditar(b, req.usuario!.id, atendido ? 'atender' : 'reabrir', 'contatos_site', id);
    return { ok: true };
  });

  const html = (res: ServerResponse, status: number, corpo: string) => {
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
      if (c === '/') { html(res, 200, await inicio(ctx, req, e)); return true; }
      const m = /^\/veiculo\/(\d+)(?:-[a-z0-9-]*)?$/.exec(c);
      if (m) {
        const r = await detalhe(ctx, req, e, Number(m[1]), res);
        if (r === '') return true;
        if (r) { html(res, 200, r); return true; }
        html(res, 404, layout(ctx, req, e, { titulo: `Veículo não disponível | ${nomeLoja(e)}`, descricao: '', canonico: '/', corpo: `<div class="faixa vazio pagina-vazia"><h1>Este veículo já foi vendido</h1><p>Veja os outros veículos da loja ou peça para a loja procurar um parecido.</p><a class="btn" href="/#estoque">Ver veículos disponíveis</a></div>` }));
        return true;
      }
      const f = /^\/fotos-publicas\/([\w-]+\.(?:jpg|jpeg|png|webp))$/i.exec(c);
      if (f) {
        const ok = b.one(`SELECT 1 FROM veiculo_fotos fo JOIN veiculos v ON v.id = fo.veiculo_id WHERE fo.arquivo = ? AND ${SITUACAO_PUBLICA}`, [f[1]]);
        if (ok && (await enviarArquivo(res, join(op.pastaFotos, f[1]), 'public, max-age=86400'))) return true;
        res.writeHead(404); res.end(); return true;
      }
      if (c === '/marca/logo') {
        if (e.logo && /^[\w.-]+$/.test(e.logo) && (await enviarArquivo(res, join(op.pastaArquivos, e.logo), 'public, max-age=3600'))) return true;
        res.writeHead(404); res.end(); return true;
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
