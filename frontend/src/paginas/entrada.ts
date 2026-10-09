import { api, pode } from '../api.js';
import { icone } from '../icones.js';
import { html, montar, $, campos, aviso, moeda, arquivoParaEnvio, lerForm, mostrarErro, cabecalhoPagina, type Campo } from '../ui.js';
import { camposVeiculo, extrairDadosVeiculo } from './veiculos.js';

/**
 * Entrada de veículo pelo celular: foto do documento (CRV verde ou CRLV-e branco),
 * leitura automática dos dados, FIPE, valores e fotos — tudo numa tela.
 */
interface Fipe { fipe_codigo?: string; fipe_modelo?: string; fipe_valor?: number | null; fipe_referencia?: string; candidatos?: any[]; escolha?: any }

const SEM_PRECO = new Set(['preco_venda', 'preco_minimo', 'obs', 'ncm']);
const camposDoc = (): Campo[] => camposVeiculo().filter((c) => !SEM_PRECO.has(c.nome));

export async function render(el: HTMLElement) {
  const estado: { documento?: string; fipe?: Fipe; fotos: File[]; lendo: boolean; criado?: number; enviadas: number } = { fotos: [], lendo: false, enviadas: 0 };
  const podeComprar = pode('negociacoes.comprar');
  const podeConsignar = pode('negociacoes.consignar');
  const origemPadrao = podeComprar ? 'compra' : podeConsignar ? 'consignacao' : 'estoque';
  montar(el, html`
  ${cabecalhoPagina('Entrada de veículo', 'Fotografe o documento, confira os dados, informe os valores e as fotos', html`<a class="botao sec" href="#/veiculos">${icone('voltar', 16)}Voltar</a>`)}
  <div class="entrada-veiculo">
  <section class="bloco passo" id="p-doc">
    <h2><span class="num">1</span>Documento do veículo</h2>
    <p class="mudo">CRV verde, CRLV antigo ou o CRLV-e branco (papel ou PDF baixado do app Carteira Digital de Trânsito). Foto de frente, sem reflexo, com o documento inteiro.</p>
    <div class="botoes-grandes">
      <label class="botao grande">${icone('camera', 22)}<span>Fotografar documento</span><input type="file" accept="image/*" capture="environment" data-doc hidden></label>
      <label class="botao sec grande">${icone('upload', 22)}<span>Enviar foto ou PDF</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-doc hidden></label>
    </div>
    <div id="leitura" aria-live="polite"></div>
  </section>

  <form id="f-entrada" novalidate>
  <section class="bloco passo">
    <h2><span class="num">2</span>Dados do veículo</h2>
    <div class="grade-form">${campos(camposDoc(), { condicao: 'usado', tipo: 'automovel', combustivel: 'flex', cambio: 'manual' })}</div>
    <details class="dados-novo"><summary>NCM (fiscal)</summary><div class="grade-form">${campos([{ nome: 'ncm', rotulo: 'NCM', largura: 2, dica: 'Ex.: 87032310 (1.5 a 3.0 gasolina/flex). Confirme com o contador.' }], { ncm: '87032310' })}</div></details>
  </section>

  <section class="bloco passo">
    <h2><span class="num">3</span>Tabela FIPE</h2>
    <div id="fipe" class="fipe-caixa"><p class="mudo">Preencha marca, modelo e ano (ou leia o documento) e toque em consultar.</p></div>
    <button type="button" class="sec" data-fipe>${icone('busca', 16)}Consultar FIPE</button>
  </section>

  <section class="bloco passo">
    <h2><span class="num">4</span>Como entrou e valores</h2>
    <div class="segmentos largo" role="radiogroup" aria-label="Como o veículo entrou">
      ${podeComprar ? html`<label><input type="radio" name="origem" value="compra" ${origemPadrao === 'compra' ? 'checked' : ''}><span>Compra</span></label>` : ''}
      ${podeConsignar ? html`<label><input type="radio" name="origem" value="consignacao" ${origemPadrao === 'consignacao' ? 'checked' : ''}><span>Consignação</span></label>` : ''}
      <label><input type="radio" name="origem" value="estoque" ${origemPadrao === 'estoque' ? 'checked' : ''}><span>Só cadastrar</span></label>
    </div>
    <p class="mudo pequeno" id="dica-origem"></p>
    <div class="grade-form" id="g-dono">${campos([
      { nome: 'dono_nome', rotulo: 'Proprietário (de quem a loja recebeu)', largura: 2 },
      { nome: 'dono_doc', rotulo: 'CPF/CNPJ do proprietário', largura: 1, attrs: 'inputmode="numeric"' },
      { nome: 'dono_telefone', rotulo: 'Telefone', largura: 1, attrs: 'inputmode="tel"' },
    ])}</div>
    <div class="grade-form">${campos([
      { nome: 'custo', rotulo: 'Quanto a loja pagou', tipo: 'moeda', largura: 1, attrs: 'data-calc' },
      { nome: 'forma_pagamento', rotulo: 'Pagamento ao dono', tipo: 'select', opcoes: [['pix', 'Pix (já pago)'], ['transferencia', 'Transferência (já pago)'], ['dinheiro', 'Dinheiro (já pago)'], ['', 'A pagar (lança no financeiro)']], largura: 1 },
      { nome: 'preco_venda', rotulo: 'Preço de venda (anúncio)', tipo: 'moeda', largura: 1, attrs: 'data-calc' },
      { nome: 'preco_minimo', rotulo: 'Preço mínimo', tipo: 'moeda', largura: 1, dica: 'Abaixo disso só quem tem permissão vende.' },
    ], { forma_pagamento: 'pix' })}</div>
    <div id="margem" class="margem-caixa" aria-live="polite"></div>
  </section>

  <section class="bloco passo">
    <h2><span class="num">5</span>Fotos para o anúncio</h2>
    <div class="botoes-grandes">
      <label class="botao sec grande">${icone('camera', 22)}<span>Tirar fotos</span><input type="file" accept="image/*" capture="environment" multiple data-fotos hidden></label>
      <label class="botao sec grande">${icone('imagem', 22)}<span>Escolher da galeria</span><input type="file" accept="image/*" multiple data-fotos hidden></label>
    </div>
    <div class="fotos previas" id="previas"></div>
    ${pode('veiculos.publicar') ? html`<label class="check destaque-check"><input type="checkbox" name="publicar" checked> Publicar no catálogo do site assim que salvar (precisa de pelo menos 1 foto)</label>` : ''}
    <div class="grade-form">${campos([{ nome: 'descricao_catalogo', rotulo: 'Texto do anúncio (opcional)', tipo: 'area', largura: 4, attrs: 'rows="3" maxlength="3000" placeholder="Único dono, revisado, pneus novos…"' }])}</div>
  </section>

  <div class="acoes-form fixo"><a class="botao sec" href="#/veiculos">Cancelar</a><button type="submit">${icone('ok', 16)}Salvar veículo</button></div>
  </form></div>`);

  const f = $<HTMLFormElement>('#f-entrada', el);
  const campo = (n: string) => f.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement | null;
  const set = (n: string, v: unknown) => { const c = campo(n); if (c && v !== undefined && v !== null && v !== '') c.value = String(v); };
  const valor = (n: string) => Number((campo(n)?.value || '0').replace(',', '.')) || 0;

  // ---- 1. Leitura do documento ----
  el.querySelectorAll<HTMLInputElement>('[data-doc]').forEach((inp) => inp.addEventListener('change', async () => {
    const arq = inp.files?.[0];
    inp.value = '';
    if (!arq || estado.lendo) return;
    const caixa = $('#leitura', el);
    estado.lendo = true;
    caixa.innerHTML = html`<div class="lendo"><span class="girando"></span>Lendo o documento… isso leva alguns segundos.</div>`.s;
    try {
      const r = await api.post('/api/veiculos/ler-documento', { arquivo: await arquivoParaEnvio(arq, 2200) });
      estado.documento = r.documento;
      const d = r.dados;
      for (const k of ['placa', 'renavam', 'chassi', 'marca', 'modelo', 'versao', 'ano_fab', 'ano_mod', 'cor', 'combustivel', 'motor', 'potencia', 'cilindrada']) set(k, d[k]);
      if (d.tipo_veiculo) set('tipo', d.tipo_veiculo);
      set('dono_nome', d.proprietario_nome);
      set('dono_doc', d.proprietario_doc);
      caixa.innerHTML = html`
        <div class="leitura-ok">${icone('ok', 18)}<div><b>${d.tipo_documento ?? 'Documento'} lido: ${d.marca} ${d.modelo} ${d.ano_fab ?? ''}/${d.ano_mod ?? ''}${d.placa ? ' — ' + d.placa : ''}</b>
          <small>Confira os campos abaixo antes de salvar.</small></div></div>
        ${r.avisos.length ? html`<ul class="avisos-leitura">${r.avisos.map((a: string) => html`<li>${icone('alerta', 15)}${a}</li>`)}</ul>` : ''}
        ${r.existente ? html`<p class="alerta-caixa">Este chassi já está cadastrado: <a href="#/veiculos/${r.existente.id}">${r.existente.marca} ${r.existente.modelo} ${r.existente.placa}</a> (${r.existente.situacao}).${['estoque', 'reservado'].includes(r.existente.situacao) ? ' Ele já está no estoque.' : ' Salvar vai reaproveitar o cadastro (recompra).'}</p>` : ''}
        ${r.proprietario ? html`<p class="mudo pequeno">O proprietário já é cliente: ${r.proprietario.nome}.</p>` : ''}`.s;
      consultarFipe();
    } catch (e) {
      caixa.innerHTML = html`<p class="alerta-caixa">${(e as Error).message}</p>`.s;
    } finally {
      estado.lendo = false;
    }
  }));

  // ---- 3. FIPE ----
  const mostrarFipe = (fp: Fipe) => {
    const cx = $('#fipe', el);
    if (!fp.fipe_valor) {
      cx.innerHTML = html`<p class="alerta-caixa">Não achei este modelo na FIPE automaticamente. Confira marca, modelo e ano, ou consulte no site da FIPE.</p>`.s;
      return;
    }
    cx.innerHTML = html`<div class="fipe-valor"><span>Valor FIPE</span><b>${moeda(fp.fipe_valor)}</b><small>${fp.fipe_modelo} · código ${fp.fipe_codigo} · ${fp.fipe_referencia}</small></div>
      ${fp.candidatos && fp.candidatos.length > 1 ? html`<label class="campo"><span>Não é esta versão? Escolha:</span><select data-cand>${fp.candidatos.map((c: any, i: number) => html`<option value="${i}">${c.modelo_nome} — ${c.ano_nome}</option>`)}</select></label>` : ''}`.s;
    cx.querySelector<HTMLSelectElement>('[data-cand]')?.addEventListener('change', async (e) => {
      const c = fp.candidatos![Number((e.target as HTMLSelectElement).value)];
      try {
        const p = await api.get(`/api/fipe/preco?tipo=${fp.escolha.tipo}&marca=${c.marca}&modelo=${c.modelo}&ano=${encodeURIComponent(c.ano)}`);
        estado.fipe = { ...fp, fipe_valor: p.valor, fipe_codigo: p.CodigoFipe, fipe_modelo: `${p.Marca} ${p.Modelo} ${p.AnoModelo} ${p.Combustivel}`, fipe_referencia: p.MesReferencia };
        const sel = (e.target as HTMLSelectElement).value;
        mostrarFipe(estado.fipe);
        const s2 = $('#fipe', el).querySelector<HTMLSelectElement>('[data-cand]');
        if (s2) s2.value = sel;
        calcular();
      } catch (er) { mostrarErro(er); }
    });
  };
  async function consultarFipe() {
    const d = lerForm(f);
    if (!d.modelo || !d.ano_mod) return aviso('Preencha modelo e ano modelo para consultar a FIPE.', 'erro');
    $('#fipe', el).innerHTML = html`<div class="lendo"><span class="girando"></span>Consultando a FIPE…</div>`.s;
    try {
      const q = new URLSearchParams({ marca: d.marca, modelo: d.modelo, versao: d.versao, ano: d.ano_mod, combustivel: d.combustivel, tipo_veiculo: d.tipo });
      const fp = await api.get(`/api/fipe/buscar?${q}`);
      estado.fipe = fp;
      mostrarFipe(fp);
      calcular();
    } catch (e) {
      $('#fipe', el).innerHTML = html`<p class="alerta-caixa">${(e as Error).message}</p>`.s;
    }
  }
  el.querySelector('[data-fipe]')!.addEventListener('click', consultarFipe);

  // ---- 4. Origem e margem ----
  const atualizarOrigem = () => {
    const o = (f.querySelector('input[name=origem]:checked') as HTMLInputElement)?.value ?? 'estoque';
    $('#g-dono', el).hidden = o === 'estoque';
    (campo('forma_pagamento') as HTMLElement).closest('.campo')!.toggleAttribute('hidden', o !== 'compra');
    const rotuloCusto = (campo('custo') as HTMLElement).closest('.campo')!.querySelector('label')!;
    rotuloCusto.textContent = o === 'consignacao' ? 'Valor líquido combinado com o dono' : 'Quanto a loja pagou';
    $('#dica-origem', el).textContent = o === 'compra' ? 'Registra a compra, cadastra o antigo dono e lança o pagamento no financeiro.'
      : o === 'consignacao' ? 'O veículo continua do dono; na venda o sistema calcula o repasse.' : 'Só coloca o veículo no estoque (já era da loja). O valor pago entra como custo.';
    calcular();
  };
  const calcular = () => {
    const custo = valor('custo'), venda = valor('preco_venda');
    const fipe = estado.fipe?.fipe_valor ?? 0;
    const partes: string[] = [];
    if (custo && venda) {
      const m = venda - custo;
      partes.push(html`<div><span>Margem prevista</span><b class="${m < 0 ? 'neg' : ''}">${moeda(m)}</b><small>${Math.round((m / custo) * 100)}% sobre o custo</small></div>`.s);
    }
    if (fipe && custo) partes.push(html`<div><span>Custo × FIPE</span><b>${Math.round((custo / fipe) * 100)}%</b><small>pagou ${moeda(custo)} de ${moeda(fipe)}</small></div>`.s);
    if (fipe && venda) partes.push(html`<div><span>Anúncio × FIPE</span><b>${Math.round((venda / fipe) * 100)}%</b><small>${venda > fipe ? 'acima' : 'abaixo'} da FIPE em ${moeda(Math.abs(venda - fipe))}</small></div>`.s);
    $('#margem', el).innerHTML = partes.join('');
  };
  f.addEventListener('input', (e) => { if ((e.target as HTMLElement).hasAttribute('data-calc')) calcular(); });
  f.querySelectorAll('input[name=origem]').forEach((r) => r.addEventListener('change', atualizarOrigem));
  atualizarOrigem();

  // ---- 5. Fotos ----
  const desenharPrevias = () => {
    $('#previas', el).innerHTML = estado.fotos.map((arq, i) => html`<figure><img src="${URL.createObjectURL(arq)}" alt="Foto ${i + 1}">${i === 0 ? html`<span class="capa">Capa</span>` : ''}
      <button type="button" class="link" data-rem-foto="${i}">Remover</button>${i ? html`<button type="button" class="link" data-capa="${i}">Usar como capa</button>` : ''}</figure>`.s).join('');
  };
  el.querySelectorAll<HTMLInputElement>('[data-fotos]').forEach((inp) => inp.addEventListener('change', () => {
    estado.fotos.push(...[...(inp.files ?? [])].filter((a) => a.type.startsWith('image/')));
    inp.value = '';
    desenharPrevias();
  }));
  $('#previas', el).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rem-foto],[data-capa]');
    if (!b) return;
    const i = Number(b.dataset.remFoto ?? b.dataset.capa);
    const [arq] = estado.fotos.splice(i, 1);
    if (b.dataset.capa) estado.fotos.unshift(arq);
    desenharPrevias();
  });

  // ---- Salvar ----
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = f.querySelector<HTMLButtonElement>('button[type=submit]')!;
    if (btn.disabled) return;
    const d = lerForm(f);
    const origem = (f.querySelector('input[name=origem]:checked') as HTMLInputElement)?.value ?? 'estoque';
    const { dono_nome, dono_doc, dono_telefone, custo, forma_pagamento, preco_venda, preco_minimo, publicar, descricao_catalogo, ...resto } = d;
    delete (resto as any).origem;
    const veiculo = extrairDadosVeiculo(resto);
    btn.disabled = true;
    const original = btn.innerHTML;
    try {
      btn.textContent = 'Salvando…';
      // Se a internet cair no meio do envio das fotos, tentar de novo continua de onde parou
      if (!estado.criado) {
        const novo = await api.post('/api/veiculos/entrada', {
          origem, veiculo, custo, preco_venda, preco_minimo, forma_pagamento, documento: estado.documento, descricao_catalogo,
          proprietario: { nome: dono_nome, cpf_cnpj: dono_doc, telefone: dono_telefone }, fipe: estado.fipe?.fipe_valor ? estado.fipe : undefined,
        });
        estado.criado = novo.id;
      }
      const r = { id: estado.criado! };
      for (let i = estado.enviadas; i < estado.fotos.length; i++) {
        btn.textContent = `Enviando fotos ${i + 1}/${estado.fotos.length}…`;
        await api.post(`/api/veiculos/${r.id}/fotos`, { imagem: await arquivoParaEnvio(estado.fotos[i], 1600) });
        estado.enviadas = i + 1;
      }
      if (publicar && estado.fotos.length) await api.post(`/api/veiculos/${r.id}/catalogo`, { publicado: true });
      aviso(`Veículo cadastrado${publicar && estado.fotos.length ? ' e publicado no catálogo' : ''}.`);
      location.hash = `#/veiculos/${r.id}`;
    } catch (e) {
      mostrarErro(e);
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
}
