import { api, pode } from '../api.js';
import { icone } from '../icones.js';
import {
  html, montar, $, acoes, campos, aoEnviar, moeda, num, data, dataHora, placa, selo, rotulo, modal, confirmar, aviso,
  arquivoParaEnvio, vazio, cabecalhoPagina, segmentos, mostrarErro, type Campo,
} from '../ui.js';

export const camposVeiculo = (): Campo[] => [
  { nome: 'condicao', rotulo: 'Condição', tipo: 'select', opcoes: [['usado', 'Usado'], ['novo', 'Novo (0 km)']], largura: 1 },
  { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: [['automovel', 'Automóvel'], ['moto', 'Moto'], ['caminhonete', 'Caminhonete'], ['utilitario', 'Utilitário'], ['caminhao', 'Caminhão'], ['outro', 'Outro']], largura: 1 },
  { nome: 'marca', rotulo: 'Marca', obrigatorio: true, largura: 1 },
  { nome: 'modelo', rotulo: 'Modelo', obrigatorio: true, largura: 1 },
  { nome: 'versao', rotulo: 'Versão', largura: 2 },
  { nome: 'ano_fab', rotulo: 'Ano fabricação', tipo: 'numero', obrigatorio: true, largura: 1 },
  { nome: 'ano_mod', rotulo: 'Ano modelo', tipo: 'numero', obrigatorio: true, largura: 1 },
  { nome: 'placa', rotulo: 'Placa', largura: 1, attrs: 'maxlength="8" autocapitalize="characters" class="maiusc"' },
  { nome: 'renavam', rotulo: 'RENAVAM', largura: 1, attrs: 'inputmode="numeric" maxlength="11"' },
  { nome: 'chassi', rotulo: 'Chassi', obrigatorio: true, largura: 2, attrs: 'maxlength="17" autocapitalize="characters" class="maiusc"' },
  { nome: 'cor', rotulo: 'Cor', largura: 1 },
  { nome: 'km', rotulo: 'Quilometragem', tipo: 'numero', largura: 1 },
  { nome: 'combustivel', rotulo: 'Combustível', tipo: 'select', opcoes: [['flex', 'Flex'], ['gasolina', 'Gasolina'], ['etanol', 'Etanol'], ['diesel', 'Diesel'], ['hibrido', 'Híbrido'], ['eletrico', 'Elétrico'], ['gnv', 'GNV']], largura: 1 },
  { nome: 'cambio', rotulo: 'Câmbio', tipo: 'select', opcoes: [['manual', 'Manual'], ['automatico', 'Automático'], ['cvt', 'CVT'], ['automatizado', 'Automatizado']], largura: 1 },
  { nome: 'motor', rotulo: 'Nº do motor', largura: 1 },
  { nome: 'portas', rotulo: 'Portas', tipo: 'numero', largura: 1 },
  { nome: 'potencia', rotulo: 'Potência (cv)', largura: 1 },
  { nome: 'cilindrada', rotulo: 'Cilindrada (cc)', largura: 1 },
  { nome: 'ncm', rotulo: 'NCM', largura: 1, dica: 'Ex.: 87032310 (1.5 a 3.0 gasolina/flex). Confirme com o contador.' },
  { nome: 'opcionais', rotulo: 'Opcionais', tipo: 'area', largura: 3 },
  { nome: 'preco_venda', rotulo: 'Preço de venda anunciado', tipo: 'moeda', largura: 1 },
  { nome: 'preco_minimo', rotulo: 'Preço mínimo', tipo: 'moeda', largura: 1, dica: 'Abaixo disso só quem tem permissão vende.' },
  { nome: 'obs', rotulo: 'Observações internas', tipo: 'area', largura: 2 },
];

/** Dados técnicos exigidos na NF-e de venda de veículo 0 km (grupo veicProd). */
export const camposVeiculoNovo = (): Campo[] => [
  { nome: 'cod_marca_modelo', rotulo: 'Código marca/modelo DENATRAN', largura: 1 },
  { nome: 'cod_cor_denatran', rotulo: 'Código da cor DENATRAN', largura: 1 },
  { nome: 'n_cCor', rotulo: 'Código da cor (montadora)', largura: 1 },
  { nome: 'n_nSerie', rotulo: 'Nº de série', largura: 1 },
  { nome: 'n_pesoL', rotulo: 'Peso líquido (t)', largura: 1 },
  { nome: 'n_pesoB', rotulo: 'Peso bruto (t)', largura: 1 },
  { nome: 'n_CMT', rotulo: 'Capacidade máx. de tração (t)', largura: 1 },
  { nome: 'n_dist', rotulo: 'Distância entre eixos (mm)', largura: 1 },
  { nome: 'n_lota', rotulo: 'Lotação', largura: 1 },
  { nome: 'n_tpPint', rotulo: 'Tipo de pintura', largura: 1, dica: 'S sólida, M metálica, P perolizada' },
  { nome: 'n_tpVeic', rotulo: 'Tipo de veículo DENATRAN', largura: 1, dica: 'Ex.: 06 automóvel' },
  { nome: 'n_espVeic', rotulo: 'Espécie', largura: 1, dica: '1 passageiro, 2 carga…' },
  { nome: 'n_tpComb', rotulo: 'Combustível DENATRAN', largura: 1, dica: 'Vazio usa o padrão (flex = 16)' },
  { nome: 'n_tpOp', rotulo: 'Tipo de operação', tipo: 'select', opcoes: [['1', '1 Venda concessionária'], ['2', '2 Faturamento direto'], ['3', '3 Venda direta'], ['0', '0 Outros']], largura: 1 },
];

/** Separa os campos "n_*" do formulário no objeto dados_novo. */
export function extrairDadosVeiculo(d: Record<string, any>) {
  const novo: Record<string, string> = {};
  const veiculo: Record<string, any> = {};
  for (const [k, v] of Object.entries(d)) {
    if (k.startsWith('n_')) { if (v !== '') novo[k.slice(2)] = v; } else veiculo[k] = v;
  }
  veiculo.dados_novo = novo;
  return veiculo;
}

export function formVeiculoHtml(v: Record<string, any> = {}) {
  const novo = JSON.parse(v.dados_novo || '{}');
  const valsNovo = Object.fromEntries(Object.entries(novo).map(([k, val]) => ['n_' + k, val]));
  return html`<div class="grade-form">${campos(camposVeiculo(), { condicao: 'usado', ...v })}</div>
    <details class="dados-novo" ${v.condicao === 'novo' ? 'open' : ''}><summary>Dados técnicos para NF-e de veículo 0 km</summary>
      <div class="grade-form">${campos(camposVeiculoNovo(), { ...v, ...valsNovo })}</div></details>`;
}

export async function render(el: HTMLElement, params: string[]) {
  if (params[0] === 'entrada') return (await import('./entrada.js')).render(el);
  if (params[0]) return detalhe(el, Number(params[0]));
  const filtro = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const situacao = filtro.get('situacao') ?? 'estoque';
  const q = filtro.get('q') ?? '';
  const lista = await api.get(`/api/veiculos?situacao=${situacao === 'todos' ? '' : situacao}&q=${encodeURIComponent(q)}`);
  const verCusto = pode('veiculos.custos');
  const botoes = html`
    ${pode('negociacoes.consignar') ? html`<a class="botao sec" href="#/negociacoes/nova/consignacao">${icone('setas')}Consignação</a>` : ''}
    ${pode('negociacoes.comprar') ? html`<a class="botao sec" href="#/negociacoes/nova/compra">${icone('carrinho')}Registrar compra</a>` : ''}
    ${pode('veiculos.criar') ? html`<a class="botao" href="#/veiculos/entrada">${icone('camera')}Entrada pelo documento</a>` : ''}`;
  montar(el, html`
  ${cabecalhoPagina('Veículos', `${lista.length} veículo${lista.length === 1 ? '' : 's'}${situacao === 'estoque' ? ' no pátio' : ''}`, botoes)}
  <div class="filtros">
    <label class="busca">${icone('busca')}<input type="search" id="q" value="${q}" placeholder="Buscar por placa, chassi, modelo…" aria-label="Buscar veículos"></label>
    ${segmentos('situacao', [['estoque', 'Em estoque'], ['reservado', 'Reservados'], ['vendido', 'Vendidos'], ['todos', 'Todos']], situacao)}
  </div>
  ${lista.length ? html`<div class="grade-veiculos">${lista.map((v: any) => html`<a class="cartao-carro" href="#/veiculos/${v.id}">
    <div class="foto">${v.foto ? html`<img src="/fotos/${v.foto}" alt="" loading="lazy">` : html`<span class="sem-foto">${icone('carro', 42)}</span>`}
      ${placa(v.placa, true)}<span class="selos">${selo(v.situacao)}${v.publicado ? html`<span class="selo verde" title="Aparece no catálogo do site">No site</span>` : ''}</span></div>
    <div class="dados-carro">
      <b>${v.marca} ${v.modelo}</b><small>${[v.versao, `${v.ano_fab}/${v.ano_mod}`, v.cor, `${num(v.km)} km`].filter(Boolean).join(' • ')}</small>
      <div class="precos"><span class="valor">${moeda(v.preco_venda)}</span><span class="mudo">${v.dias_estoque} dia${v.dias_estoque === 1 ? '' : 's'}</span></div>
      <div class="rodape-carro"><span>${v.origem === 'consignacao' ? 'Consignado' : verCusto ? html`Custo ${moeda(v.custo_total)}` : ''}${v.fipe_valor ? html` <span class="mudo">· FIPE ${moeda(v.fipe_valor)}</span>` : ''}</span>${selo(v.renave_status === 'pendente' ? 'aguardando' : v.renave_status, v.renave_status === 'pendente' ? 'RENAVE pendente' : undefined)}</div>
    </div></a>`)}</div>`
    : vazio(q ? 'Nenhum veículo encontrado com essa busca.' : 'Nenhum veículo nesta situação.', pode('veiculos.criar') ? html`<a class="botao" href="#/veiculos/entrada">${icone('camera')}Entrada pelo documento</a>` : undefined)}`);
  const ir = (nq = q, ns = situacao) => (location.hash = `#/veiculos?situacao=${ns}&q=${encodeURIComponent(nq)}`);
  let tempo: number | undefined;
  $<HTMLInputElement>('#q', el).addEventListener('input', (e) => { clearTimeout(tempo); tempo = window.setTimeout(() => ir((e.target as HTMLInputElement).value), 350); });
  el.querySelectorAll<HTMLButtonElement>('[data-seg="situacao"]').forEach((b) => b.addEventListener('click', () => ir(q, b.dataset.valor)));
}

async function detalhe(el: HTMLElement, id: number) {
  const v = await api.get(`/api/veiculos/${id}`);
  const disponivel = ['estoque', 'reservado'].includes(v.situacao);
  const verCusto = pode('veiculos.custos') && v.custo_total !== undefined;
  const editar = pode('veiculos.editar');
  const margem = verCusto ? v.preco_venda - v.custo_total : 0;
  const fipePct = v.fipe_valor ? Math.round((v.preco_venda / v.fipe_valor) * 100) : 0;
  const temCompra = v.negociacoes.some((n: any) => ['compra', 'consignacao'].includes(n.tipo) && n.status === 'concluida');
  const qtdFotos = v.fotos.length;
  montar(el, html`
  <header class="topo-veiculo">
    <a href="#/veiculos" class="voltar">${icone('voltar', 16)}Veículos</a>
    <div class="titulo-veiculo">${placa(v.placa)}<div><h1>${v.marca} ${v.modelo} <span>${v.versao}</span></h1>
      <p>${v.ano_fab}/${v.ano_mod}, ${v.cor || 'cor não informada'}, ${num(v.km)} km. ${selo(v.situacao)} ${rotulo(v.origem)}${v.proprietario_nome ? html` de <b>${v.proprietario_nome}</b>` : ''}</p></div></div>
    <div class="botoes">
      ${disponivel && pode('negociacoes.vender') ? html`<a class="botao" href="#/negociacoes/nova/venda?veiculo=${v.id}">Vender</a>` : ''}
      ${v.situacao === 'estoque' && pode('veiculos.editar', 'negociacoes.vender') ? html`<button class="sec" data-acao="reservar">Reservar</button>` : ''}
      ${v.situacao === 'reservado' && pode('veiculos.editar', 'negociacoes.vender') ? html`<button class="sec" data-acao="liberar">Liberar reserva</button>` : ''}
      ${disponivel && v.origem === 'consignacao' && pode('negociacoes.consignar') ? html`<button class="sec" data-acao="devolver">Devolver ao proprietário</button>` : ''}
      ${v.documento_arquivo ? html`<a class="botao sec" href="/arquivos/documentos-veiculos/${v.documento_arquivo}" target="_blank" rel="noopener">${icone('arquivo', 16)}Documento</a>` : ''}
      ${pode('veiculos.excluir') && !temCompra && v.situacao !== 'vendido' ? html`<button class="icone-btn perigo" data-acao="excluir" title="Excluir veículo" aria-label="Excluir veículo">${icone('lixeira')}</button>` : ''}
    </div>
  </header>

  <section class="faixa-numeros">
    ${verCusto ? html`<div><span>Custo total</span><b>${moeda(v.custo_total)}</b><small>${v.origem === 'consignacao' ? 'consignado' : html`compra ${moeda(v.preco_compra)} + preparação ${moeda(v.custo_total - v.preco_compra)}`}</small></div>` : ''}
    <div><span>Preço anunciado</span><b>${moeda(v.preco_venda)}</b><small>mínimo ${moeda(v.preco_minimo)}</small></div>
    ${verCusto ? html`<div><span>Margem prevista</span><b class="${margem < 0 ? 'neg' : ''}">${v.origem === 'consignacao' ? 'ver repasse' : moeda(margem)}</b><small>${v.origem === 'consignacao' ? 'veículo consignado' : v.custo_total ? Math.round((margem / v.custo_total) * 100) + '% sobre o custo' : ''}</small></div>` : ''}
    <div class="fipe-num"><span>Tabela FIPE</span><b>${v.fipe_valor ? moeda(v.fipe_valor) : '—'}</b><small>${v.fipe_valor ? html`${v.fipe_referencia}${fipePct ? html` · anúncio a ${fipePct}% da FIPE` : ''}` : 'ainda não consultada'}</small></div>
    <div><span>Chassi</span><b class="mono">${v.chassi}</b><small>RENAVAM ${v.renavam || 'não informado'}</small></div>
  </section>

  <div class="grade-2">
    <section class="bloco">
      <h2>FIPE</h2>
      ${v.fipe_valor ? html`<div class="fipe-valor"><span>${v.fipe_modelo}</span><b>${moeda(v.fipe_valor)}</b><small>Código ${v.fipe_codigo} · referência ${v.fipe_referencia} · consultado em ${dataHora(v.fipe_consultado_em)}</small></div>`
        : html`<p class="mudo">Consulte para os vendedores verem o valor de referência.</p>`}
      <div id="fipe-cands"></div>
      ${pode('veiculos.editar', 'veiculos.criar') ? html`<div class="botoes"><button class="sec" data-acao="fipe">${icone('busca', 16)}${v.fipe_valor ? 'Atualizar FIPE' : 'Consultar FIPE'}</button></div>` : ''}
    </section>

    <section class="bloco">
      <h2>Catálogo do site</h2>
      ${v.publicado && disponivel ? html`<p class="cert-ok">${icone('ok', 18)}<span><b>Publicado.</b> Clientes veem este veículo no site.</span></p>` : html`<p class="mudo">${disponivel ? 'Não aparece no site.' : 'Vendidos saem do site automaticamente.'}</p>`}
      ${pode('veiculos.publicar') && disponivel ? html`<form id="f-cat">
        <label class="check"><input type="checkbox" name="publicado" ${v.publicado ? 'checked' : ''} ${qtdFotos ? '' : 'disabled'}> Publicar no catálogo${qtdFotos ? '' : ' (adicione fotos primeiro)'}</label>
        <label class="check"><input type="checkbox" name="destaque" ${v.destaque ? 'checked' : ''}> Destaque (aparece primeiro)</label>
        <label class="check"><input type="checkbox" name="mostrar_preco" ${v.mostrar_preco ? 'checked' : ''}> Mostrar o preço (senão aparece "Consulte")</label>
        <div class="grade-form">${campos([{ nome: 'descricao_catalogo', rotulo: 'Texto do anúncio', tipo: 'area', largura: 4, attrs: 'rows="3" maxlength="3000"' }], v)}</div>
        <div class="botoes"><button type="submit" class="sec">Salvar catálogo</button>${v.publicado ? html`<a class="botao sec" href="/veiculo/${v.id}" target="_blank" rel="noopener">${icone('olho', 16)}Ver no site</a>` : ''}</div>
      </form>` : ''}
    </section>
  </div>

  <section class="bloco">
    <h2>Fotos <small class="mudo">${qtdFotos ? `${qtdFotos} foto${qtdFotos === 1 ? '' : 's'} · a primeira é a capa do anúncio` : ''}</small></h2>
    <div class="fotos">${v.fotos.map((f: any, i: number) => html`<figure><img src="/fotos/${f.arquivo}" alt="Foto ${i + 1} do ${v.modelo}" loading="lazy">${i === 0 ? html`<span class="capa">Capa</span>` : ''}
      ${editar && disponivel ? html`<div class="foto-acoes">${i > 0 ? html`<button class="icone-btn" data-acao="mover" data-i="${i}" data-dir="-1" title="Mover para a esquerda" aria-label="Mover foto para a esquerda">‹</button>` : ''}${i > 0 ? html`<button class="link" data-acao="capa" data-i="${i}">Capa</button>` : ''}${i < qtdFotos - 1 ? html`<button class="icone-btn" data-acao="mover" data-i="${i}" data-dir="1" title="Mover para a direita" aria-label="Mover foto para a direita">›</button>` : ''}</div>` : ''}
      ${pode('veiculos.excluir') && disponivel ? html`<button class="link perigo" data-acao="rem-foto" data-id="${f.id}">Remover</button>` : ''}</figure>`)}
      ${editar && disponivel ? html`<label class="enviar-foto">${icone('camera', 22)}Adicionar fotos<input type="file" accept="image/*" multiple id="in-fotos" hidden></label>` : ''}</div>
  </section>

  <div class="grade-2">
    ${verCusto ? html`<section class="bloco">
      <h2>Custos de preparação</h2>
      ${v.custos.length ? html`<table class="tabela compacta"><tbody>${v.custos.map((c: any) => html`<tr><td>${data(c.data)}</td><td>${c.descricao}</td><td class="n">${moeda(c.valor)}</td><td class="n">${disponivel ? html`<button class="link" data-acao="rem-custo" data-id="${c.id}">Remover</button>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="mudo">Nenhum custo lançado.</p>`}
      ${disponivel ? html`<form id="f-custo" class="linha-form">
        <input name="descricao" placeholder="Ex.: polimento, pneus, revisão" required aria-label="Descrição do custo">
        <input name="valor" type="number" step="0.01" min="0.01" placeholder="Valor" required aria-label="Valor">
        <label class="check"><input type="checkbox" name="gerar_conta_pagar" checked> Gerar conta a pagar</label>
        <button type="submit" class="sec">Lançar custo</button></form>` : ''}
    </section>` : ''}

    ${pode('renave.ver') ? html`<section class="bloco">
      <h2>RENAVE</h2>
      <p>${selo(v.renave_status)} ${v.renave_id ? html`<small>Estoque nº ${v.renave_id}</small>` : ''}</p>
      <div class="botoes">
        ${disponivel && ['pendente', 'erro'].includes(v.renave_status) && pode('renave.operar') ? html`<button data-acao="renave-entrada">Registrar entrada</button>` : ''}
        ${['em_estoque', 'saida'].includes(v.renave_status) && pode('renave.cancelar') ? html`<button class="sec" data-acao="renave-cancelar">Cancelar ${v.renave_status === 'saida' ? 'saída' : 'entrada'}</button>` : ''}
        <button class="sec" data-acao="renave-consultar">Consultar</button>
      </div>
      ${v.renave.length ? html`<ul class="historico">${v.renave.map((o: any) => html`<li>${selo(o.status)} <b>${o.tipo.replace('_', ' ')}</b> ${o.mensagem}<small>${dataHora(o.criado_em)}${o.protocolo ? ', protocolo ' + o.protocolo : ''}</small></li>`)}</ul>` : ''}
    </section>` : ''}
  </div>

  ${pode('negociacoes.ver') ? html`<section class="bloco">
    <h2>Histórico</h2>
    ${v.negociacoes.length ? html`<table class="tabela compacta"><tbody>${v.negociacoes.map((n: any) => html`<tr data-acao="neg" data-id="${n.id}"><td>${data(n.data)}</td><td>${rotulo(n.tipo)}</td><td>${n.pessoa_nome}</td><td class="n">${n.valor_final === null ? '—' : moeda(n.valor_final)}</td><td>${selo(n.status)}</td></tr>`)}</tbody></table>` : html`<p class="mudo">Sem negociações.</p>`}
  </section>` : ''}

  <section class="bloco">
    <h2>Dados do veículo</h2>
    ${v.situacao === 'vendido' ? html`<p class="mudo">Veículo vendido: só as observações podem ser alteradas, para não divergir da nota fiscal.</p>` : ''}
    <form id="f-veiculo">${formVeiculoHtml(v)}
      ${verCusto && !temCompra && v.situacao !== 'vendido' ? html`<div class="grade-form">${campos([{ nome: 'preco_compra', rotulo: 'Valor pago pelo veículo', tipo: 'moeda', largura: 1, dica: 'Entrada sem negociação de compra.' }], v)}</div>` : ''}
      ${editar ? html`<div class="acoes-form"><button type="submit">Salvar alterações</button></div>` : ''}</form>
  </section>`);

  const recarregar = () => detalhe(el, id);
  const fv = $<HTMLFormElement>('#f-veiculo', el);
  if (!editar) fv.querySelectorAll('input, select, textarea').forEach((i) => ((i as HTMLInputElement).disabled = true));
  aoEnviar(fv, async (d) => {
    await api.put(`/api/veiculos/${id}`, extrairDadosVeiculo(d));
    aviso('Veículo salvo.');
    recarregar();
  });
  const fc = el.querySelector<HTMLFormElement>('#f-custo');
  if (fc) aoEnviar(fc, async (d) => {
    await api.post(`/api/veiculos/${id}/custos`, d);
    aviso('Custo lançado.');
    recarregar();
  });
  const fcat = el.querySelector<HTMLFormElement>('#f-cat');
  if (fcat) aoEnviar(fcat, async (d) => {
    await api.post(`/api/veiculos/${id}/catalogo`, d);
    aviso(d.publicado ? 'Publicado no catálogo.' : 'Catálogo atualizado.');
    recarregar();
  });
  el.querySelector<HTMLInputElement>('#in-fotos')?.addEventListener('change', async (e) => {
    const arqs = [...((e.target as HTMLInputElement).files ?? [])].filter((a) => a.type.startsWith('image/'));
    const rot = el.querySelector('.enviar-foto')!;
    try {
      for (let i = 0; i < arqs.length; i++) {
        rot.firstChild!.nextSibling!.textContent = `Enviando ${i + 1}/${arqs.length}…`;
        await api.post(`/api/veiculos/${id}/fotos`, { imagem: await arquivoParaEnvio(arqs[i], 1600) });
      }
      aviso(`${arqs.length} foto(s) adicionada(s).`);
    } catch (er) { mostrarErro(er); }
    recarregar();
  });
  const reordenar = async (ids: number[]) => { await api.put(`/api/veiculos/${id}/fotos/ordem`, { ids }); recarregar(); };
  const idsFotos = () => v.fotos.map((f: any) => f.id as number);
  acoes(el, {
    reservar: async () => { await api.post(`/api/veiculos/${id}/reserva`, { reservar: true }); aviso('Veículo reservado.'); recarregar(); },
    liberar: async () => { await api.post(`/api/veiculos/${id}/reserva`, { reservar: false }); aviso('Reserva liberada.'); recarregar(); },
    devolver: async () => {
      if (!(await confirmar('Registrar a devolução deste veículo ao proprietário? Ele sai do estoque.', 'Devolver'))) return;
      const r = await api.post('/api/negociacoes/devolucao-consignacao', { veiculo_id: id });
      aviso('Devolução registrada. Emita a NF-e de devolução na negociação.');
      location.hash = `#/negociacoes/${r.id}`;
    },
    excluir: async () => {
      if (!(await confirmar(`Excluir o ${v.marca} ${v.modelo} ${v.placa} do sistema, com fotos e custos? Isso não pode ser desfeito.`, 'Excluir veículo'))) return;
      await api.del(`/api/veiculos/${id}`);
      aviso('Veículo excluído.');
      location.hash = '#/veiculos';
    },
    fipe: async (b) => {
      b.setAttribute('disabled', '');
      try {
        const r = await api.post(`/api/veiculos/${id}/fipe`);
        if (!r.encontrado) { aviso('Não encontrei este modelo na FIPE. Confira marca, modelo, versão e ano nos dados do veículo.', 'erro'); return; }
        aviso(`FIPE: ${moeda(r.fipe_valor)} (${r.fipe_modelo}).`);
        if (r.candidatos?.length > 1) {
          await recarregar();
          const cx = el.querySelector('#fipe-cands');
          if (!cx) return;
          cx.innerHTML = html`<label class="campo"><span>Não é esta versão? Escolha:</span><select id="sel-fipe">${r.candidatos.map((c: any, i: number) => html`<option value="${i}">${c.modelo_nome} — ${c.ano_nome}</option>`)}</select></label>`.s;
          cx.querySelector('select')!.addEventListener('change', async (e) => {
            const c = r.candidatos[Number((e.target as HTMLSelectElement).value)];
            await api.post(`/api/veiculos/${id}/fipe`, { tipo: r.escolha.tipo, marca: c.marca, modelo: String(c.modelo), ano: c.ano });
            aviso('FIPE atualizada.');
            recarregar();
          });
          return;
        }
        recarregar();
      } finally { b.removeAttribute('disabled'); }
    },
    mover: (b) => {
      const ids = idsFotos(); const i = Number(b.dataset.i); const j = i + Number(b.dataset.dir);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return reordenar(ids);
    },
    capa: (b) => { const ids = idsFotos(); const [x] = ids.splice(Number(b.dataset.i), 1); ids.unshift(x); return reordenar(ids); },
    'rem-custo': async (t) => {
      if (!(await confirmar('Remover este custo? A conta a pagar vinculada será cancelada.', 'Remover'))) return;
      await api.del(`/api/veiculos/${id}/custos/${t.dataset.id}`); recarregar();
    },
    'rem-foto': async (t) => {
      if (!(await confirmar('Remover esta foto?', 'Remover'))) return;
      await api.del(`/api/veiculos/${id}/fotos/${t.dataset.id}`); recarregar();
    },
    neg: (t) => (location.hash = `#/negociacoes/${t.dataset.id}`),
    'renave-entrada': () => {
      const m = modal('Registrar entrada no RENAVE', html`<form id="f-ren">
        <p>A entrada usa a NF-e de entrada autorizada da compra ou consignação. Se a nota foi emitida fora do sistema, informe a chave.</p>
        <div class="grade-form">${campos([
          { nome: 'km', rotulo: 'Quilometragem no hodômetro', tipo: 'numero', obrigatorio: true, largura: 2 },
          { nome: 'numero_atpve', rotulo: 'Nº da ATPV-e (se houver)', largura: 2 },
          { nome: 'chave_nfe', rotulo: 'Chave da NF-e de entrada (opcional)', largura: 4 },
        ], { km: v.km })}</div>
        <div class="acoes-form"><button class="sec" type="button" data-fechar>Voltar</button><button type="submit">Registrar entrada</button></div></form>`);
      aoEnviar($('#f-ren', m.el), async (d) => {
        const r = await api.post(`/api/veiculos/${id}/renave/entrada`, d);
        m.fechar(); aviso(r.mensagem); recarregar();
      });
    },
    'renave-cancelar': () => {
      const m = modal('Cancelar no RENAVE', html`<form id="f-renc"><div class="grade-form">${campos([{ nome: 'motivo', rotulo: 'Motivo', tipo: 'area', obrigatorio: true, largura: 4 }])}</div>
        <div class="acoes-form"><button class="sec" type="button" data-fechar>Voltar</button><button type="submit" class="perigo">Cancelar registro</button></div></form>`);
      aoEnviar($('#f-renc', m.el), async (d) => {
        const r = await api.post(`/api/veiculos/${id}/renave/cancelar`, d);
        m.fechar(); aviso(r.mensagem); recarregar();
      });
    },
    'renave-consultar': async () => { const r = await api.post(`/api/veiculos/${id}/renave/consultar`); aviso(r.mensagem, r.ok ? 'ok' : 'erro'); recarregar(); },
  });
}

// ---------- Leitura do documento (CRV / CRLV) reutilizada em venda com troca, compra e consignação ----------

export interface LeituraDocumento { documento: string; dados: Record<string, any>; avisos: string[]; existente?: any; proprietario?: any }

/** Botões para fotografar ou enviar o documento + área do resultado. */
export function leitorDocumentoHtml(titulo = 'Ler o documento pela foto') {
  return html`<div class="leitor-doc" data-leitor>
    <p class="leitor-titulo">${icone('camera', 18)}<b>${titulo}</b><span class="mudo">CRV, CRLV ou CRLV-e (foto ou PDF). Os dados abaixo são preenchidos sozinhos.</span></p>
    <div class="botoes-grandes">
      <label class="botao grande">${icone('camera', 20)}<span>Fotografar documento</span><input type="file" accept="image/*" capture="environment" data-doc hidden></label>
      <label class="botao sec grande">${icone('upload', 20)}<span>Enviar foto ou PDF</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-doc hidden></label>
    </div>
    <div class="leitor-resultado" aria-live="polite"></div>
  </div>`;
}

/**
 * Liga o leitor: ao ler, preenche os campos do veículo dentro de `escopo`
 * e chama `aoLer` com o arquivo guardado (para anexar ao cadastro depois).
 */
export function ligarLeitorDocumento(raiz: HTMLElement, escopo: HTMLElement, aoLer: (l: LeituraDocumento) => void) {
  const caixa = raiz.querySelector<HTMLElement>('.leitor-resultado')!;
  let lendo = false;
  const set = (n: string, v: unknown) => {
    const c = escopo.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${n}"]`);
    if (c && v !== undefined && v !== null && v !== '') c.value = String(v);
  };
  raiz.querySelectorAll<HTMLInputElement>('[data-doc]').forEach((inp) => inp.addEventListener('change', async () => {
    const arq = inp.files?.[0];
    inp.value = '';
    if (!arq || lendo) return;
    lendo = true;
    caixa.innerHTML = html`<div class="lendo"><span class="girando"></span>Lendo o documento… isso leva alguns segundos.</div>`.s;
    try {
      const r: LeituraDocumento = await api.post('/api/veiculos/ler-documento', { arquivo: await arquivoParaEnvio(arq, 2200) });
      const d = r.dados;
      for (const k of ['placa', 'renavam', 'chassi', 'marca', 'modelo', 'versao', 'ano_fab', 'ano_mod', 'cor', 'combustivel', 'motor', 'potencia', 'cilindrada']) set(k, d[k]);
      if (d.tipo_veiculo) set('tipo', d.tipo_veiculo);
      set('condicao', 'usado');
      caixa.innerHTML = html`
        <div class="leitura-ok">${icone('ok', 18)}<div><b>${d.tipo_documento ?? 'Documento'} lido: ${d.marca ?? ''} ${d.modelo ?? ''} ${d.ano_fab ?? ''}/${d.ano_mod ?? ''}${d.placa ? ' — ' + d.placa : ''}</b>
          <small>${d.proprietario_nome ? `Proprietário no documento: ${d.proprietario_nome}${d.proprietario_doc ? ` (${d.proprietario_doc})` : ''}. ` : ''}Confira os campos antes de concluir. A imagem fica anexada ao cadastro do veículo.</small></div></div>
        ${r.avisos?.length ? html`<ul class="avisos-leitura">${r.avisos.map((a: string) => html`<li>${icone('alerta', 15)}${a}</li>`)}</ul>` : ''}
        ${r.existente ? html`<p class="alerta-caixa">Este chassi já está cadastrado: <a href="#/veiculos/${r.existente.id}">${r.existente.marca} ${r.existente.modelo} ${r.existente.placa}</a> (${rotulo(r.existente.situacao)}).</p>` : ''}`.s;
      aoLer(r);
    } catch (e) {
      caixa.innerHTML = html`<p class="alerta-caixa">${(e as Error).message}</p>`.s;
    } finally {
      lendo = false;
    }
  }));
}

/**
 * Emite a NF-e de uma negociação logo depois de registrá-la. Não bloqueia:
 * se faltar certificado, endereço etc., avisa e a nota pode ser emitida depois.
 */
export async function emitirNotaAgora(negociacaoId: number, descricao: string): Promise<string> {
  try {
    const r = await api.post(`/api/negociacoes/${negociacaoId}/nfe`, {});
    return r.status === 'autorizada' ? `NF-e ${descricao} nº ${r.numero} autorizada.` : `NF-e ${descricao}: ${rotulo(r.status)}${r.xmotivo ? ' — ' + r.xmotivo : ''}. Confira na negociação.`;
  } catch (e) {
    return `NF-e ${descricao} não emitida: ${(e as Error).message} Emita depois pela negociação.`;
  }
}
