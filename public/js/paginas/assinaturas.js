import { api } from '../api.js';
import { html, montar, $, acoes, modal, aviso, moeda, data, dataHora, cabecalhoPagina, segmentos, vazio, abrirImpressao, doc } from '../ui.js';
import { icone } from '../icones.js';
import { quadroAssinatura } from '../assinatura.js';
import { cartaoContrato } from './contratos.js';
export async function render(el) {
    const f = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const tipo = f.get('tipo') ?? '';
    const abrirId = f.get('id');
    const lista = await api.get(`/api/contratos?tipo=${tipo}`);
    const pend = lista.filter((c) => !c.assinado_em);
    const ass = lista.filter((c) => c.assinado_em);
    const rodapePendente = (c) => html `<button data-acao="assinar" data-id="${c.id}">${icone('caneta', 16)}Assinar</button>
    <button class="icone-btn" data-acao="ver" data-id="${c.id}" title="Ler o contrato" aria-label="Ler o contrato ${c.numero}">${icone('impressora')}</button>`;
    const rodapeAssinado = (c) => html `<span class="assinado-em">${icone('ok', 16)}${dataHora(c.assinado_em)}</span><span class="espaco"></span>
    <button class="icone-btn" data-acao="ver" data-id="${c.id}" title="Abrir contrato assinado" aria-label="Abrir contrato ${c.numero}">${icone('impressora')}</button>`;
    montar(el, html `
  ${cabecalhoPagina('Assinatura digital de contratos', `${pend.length} pendente${pend.length === 1 ? '' : 's'} e ${ass.length} assinado${ass.length === 1 ? '' : 's'}`, segmentos('tipo', [['', 'Todos'], ['venda', 'Venda'], ['compra', 'Compra']], tipo))}
  <section class="secao">
    <h2 class="titulo-secao"><span class="ponto laranja"></span>Aguardando assinatura (${pend.length})</h2>
    ${pend.length ? html `<div class="grade-cartoes">${pend.map((c) => cartaoContrato(c, rodapePendente(c)))}</div>`
        : vazio('Nenhum contrato aguardando assinatura.')}
  </section>
  ${ass.length ? html `<section class="secao"><h2 class="titulo-secao"><span class="ponto verde"></span>Assinados (${ass.length})</h2>
    <div class="grade-cartoes">${ass.map((c) => cartaoContrato(c, rodapeAssinado(c)))}</div></section>` : ''}`);
    el.querySelectorAll('[data-seg="tipo"]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/assinaturas?tipo=${b.dataset.valor}`)));
    acoes(el, {
        assinar: (b) => telaAssinatura(Number(b.dataset.id), () => render(el)),
        ver: (b) => abrirImpressao(`/api/contratos/${b.dataset.id}/imprimir`),
    });
    if (abrirId) {
        history.replaceState(null, '', '#/assinaturas');
        telaAssinatura(Number(abrirId), () => render(el));
    }
}
/** Tela de assinatura: pensada para o cliente assinar no celular ou tablet da loja. */
async function telaAssinatura(id, aoTerminar) {
    const c = await api.get(`/api/contratos/${id}`);
    if (c.assinado_em)
        return aviso('Este contrato já foi assinado.');
    const papel = c.tipo === 'venda' ? 'comprador' : 'vendedor';
    const m = modal(`Assinar contrato ${c.numero}`, html `
  <div class="assinar">
    <dl class="resumo-contrato">
      <div><dt>${papel === 'comprador' ? 'Comprador' : 'Vendedor'}</dt><dd>${c.cliente_nome}${c.cliente_doc ? html `<small>CPF/CNPJ ${doc(c.cliente_doc)}</small>` : ''}</dd></div>
      <div><dt>Veículo</dt><dd>${[c.veiculo_marca, c.veiculo_modelo, c.veiculo_ano].filter(Boolean).join(' ')}<small>${c.veiculo_placa ? 'Placa ' + c.veiculo_placa : ''}</small></dd></div>
      <div><dt>Valor</dt><dd class="valor">${moeda(c.valor)}<small>${data(c.data)}</small></dd></div>
    </dl>
    <button type="button" class="sec" data-ler>${icone('arquivo', 16)}Ler o contrato completo</button>
    <label class="check aceite"><input type="checkbox" id="aceite"> Eu, ${c.cliente_nome}, li e concordo com todas as cláusulas deste contrato.</label>
    <div class="quadro"><canvas id="quadro" aria-label="Quadro de assinatura: assine com o dedo, caneta ou mouse"></canvas><span class="linha-ass">Assine acima da linha</span></div>
    <div class="acoes-form"><button type="button" class="sec" data-limpar>Limpar</button><span class="espaco"></span>
      <button type="button" class="sec" data-fechar>Cancelar</button><button type="button" data-confirmar disabled>${icone('check', 16)}Confirmar assinatura</button></div>
    <p class="mudo pequeno">A assinatura fica registrada com data, hora, endereço IP e um código que comprova o conteúdo assinado.</p>
  </div>`, { largo: true });
    m.el.classList.add('modal-assinatura');
    const btn = m.el.querySelector('[data-confirmar]');
    const aceite = $('#aceite', m.el);
    let quadro;
    const atualizar = () => { btn.disabled = !quadro || quadro.vazio() || !aceite.checked; };
    quadro = quadroAssinatura($('#quadro', m.el), atualizar);
    aceite.addEventListener('change', atualizar);
    m.el.querySelector('[data-limpar]').addEventListener('click', () => { quadro.limpar(); atualizar(); });
    m.el.querySelector('[data-ler]').addEventListener('click', () => abrirImpressao(`/api/contratos/${id}/imprimir`));
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            await api.post(`/api/contratos/${id}/assinar`, { assinatura: quadro.png(), aceite: aceite.checked });
            m.fechar();
            aviso('Contrato assinado.');
            window.dispatchEvent(new Event('contadores'));
            aoTerminar();
        }
        catch (e) {
            aviso(e.message, 'erro');
            atualizar();
        }
    });
}
