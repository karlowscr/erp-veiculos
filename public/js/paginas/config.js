import { api, pode } from '../api.js';
import { html, montar, $, acoes, campos, aoEnviar, modal, aviso, confirmar, data, buscarCep, lerArquivoBase64, arquivoParaEnvio, cabecalhoPagina, UFS } from '../ui.js';
import { icone } from '../icones.js';
import { quadroAssinatura } from '../assinatura.js';
/** Seção de configuração em cartão, com ícone, título e descrição. */
const secao = (ic, cor, titulo, sub, corpo) => html `<section class="bloco secao-config">
  <header class="secao-cab"><span class="tile ${cor}">${icone(ic)}</span><div><h2>${titulo}</h2><p>${sub}</p></div></header>${corpo}</section>`;
export async function render(el, params) {
    const aba = params[0] || 'loja';
    const lista = [
        ['loja', 'Loja e documentos'], ['catalogo', 'Catálogo do site'], ['nfe', 'Nota fiscal e RENAVE'], ['fiscal', 'Regras fiscais'],
        ...(pode('config.editar') ? [['importar', 'Importar dados']] : []),
    ];
    const abas = html `<nav class="abas" aria-label="Seções das configurações">${lista.map(([k, t]) => html `<a href="#/config/${k}" ${k === aba ? 'aria-current' : ''}>${t}</a>`)}</nav>`;
    const topo = html `${cabecalhoPagina('Configurações', 'Dados da loja, catálogo, documentos e nota fiscal')}${abas}`;
    if (aba === 'fiscal')
        return fiscal(el, topo);
    if (aba === 'nfe')
        return notaFiscal(el, topo);
    if (aba === 'catalogo')
        return catalogo(el, topo);
    if (aba === 'importar' && pode('config.editar'))
        return importar(el, topo);
    return loja(el, topo);
}
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const AGENDA_PADRAO = {
    dias: [{ aberto: false, inicio: '08:00', fim: '12:00' }, ...[1, 2, 3, 4, 5].map(() => ({ aberto: true, inicio: '08:00', fim: '18:00' })), { aberto: true, inicio: '08:00', fim: '12:00' }],
    intervalo: 60, capacidade: 1, fechados: [],
};
async function catalogo(el, topo) {
    const e = await api.get('/api/empresa');
    let agenda = AGENDA_PADRAO;
    try {
        if (e.agenda)
            agenda = { ...AGENDA_PADRAO, ...JSON.parse(e.agenda) };
    }
    catch { /* padrão */ }
    const admin = pode('config.editar');
    const site = location.origin + '/';
    montar(el, html `${topo}
  <div class="coluna-config">
  ${secao('olho', 'verde', 'Endereços', 'O catálogo é público; a área da loja só abre pelo endereço secreto', html `
    <dl class="enderecos"><div><dt>Catálogo para clientes</dt><dd><a href="${site}" target="_blank" rel="noopener">${site}</a></dd></div>
    <div><dt>Área da loja (não divulgue)</dt><dd><code>${location.origin + location.pathname}</code></dd></div></dl>
    <p class="mudo pequeno">O catálogo não tem nenhum link para a área da loja. Salve o endereço da área da loja nos favoritos de cada funcionário.</p>`)}
  <form id="f-cat">
    ${secao('loja', 'laranja', 'Aparência do catálogo', 'Textos e contatos mostrados aos clientes', html `<div class="grade-form">${campos([
        { nome: 'catalogo_titulo', rotulo: 'Título da página inicial', largura: 4, attrs: 'maxlength="120" placeholder="Seminovos revisados em Ocara e região"' },
        { nome: 'catalogo_sobre', rotulo: 'Texto de apresentação', tipo: 'area', largura: 4, attrs: 'rows="3" maxlength="2000"' },
        { nome: 'horario', rotulo: 'Horário de atendimento', largura: 2, attrs: 'placeholder="Seg a sex 8h às 18h · Sáb 8h às 12h"' },
        { nome: 'instagram', rotulo: 'Instagram', largura: 2, attrs: 'placeholder="@sualoja"' },
    ], e)}</div>
    <p class="mudo pequeno">WhatsApp, endereço e logo vêm da aba "Loja e documentos". Para um veículo aparecer, abra-o em Veículos e marque "Publicar no catálogo".</p>`)}
    ${secao('olho', 'laranja', 'Cores do site', 'Valem para o catálogo e para os destaques deste painel', html `
      <div class="cores-prontas" role="group" aria-label="Combinações prontas">
        ${CORES_PRONTAS.map(([nome, marca, faixa]) => html `<button type="button" class="cor-pronta" data-marca="${marca}" data-faixa="${faixa}" title="${nome}"><span style="background:${marca}"></span><span style="background:${faixa}"></span><b>${nome}</b></button>`)}
      </div>
      <div class="cores-grade">
        <label class="cor-campo"><span>Cor principal</span><small>Botões, preços, destaques</small><input type="color" name="cor_marca" value="${e.cor_marca || '#f26b1d'}"></label>
        <label class="cor-campo"><span>Faixas de destaque</span><small>Topo do site, simulador e chamadas</small><input type="color" name="cor_faixa" value="${e.cor_faixa || '#3d1405'}" ${e.cor_faixa ? '' : 'disabled'}>
          <span class="check"><input type="checkbox" data-auto="cor_faixa" ${e.cor_faixa ? '' : 'checked'}> Automática (a partir da principal)</span></label>
        <label class="cor-campo"><span>Fundo</span><small>Precisa ser uma cor clara</small><input type="color" name="cor_fundo" value="${e.cor_fundo || '#ffffff'}" ${e.cor_fundo ? '' : 'disabled'}>
          <span class="check"><input type="checkbox" data-auto="cor_fundo" ${e.cor_fundo ? '' : 'checked'}> Branco</span></label>
      </div>
      <div class="previa-cores" aria-hidden="true">
        <div class="previa-faixa"><b>Seminovos revisados</b><span>na sua cidade</span><i class="previa-vidro">R$ 64.900</i></div>
        <div class="previa-claro"><b>Estoque completo</b><span class="previa-botao">Buscar</span><span class="previa-selo">Chegou agora</span></div>
      </div>
      <p class="mudo pequeno">As cores novas aparecem no catálogo em até 1 minuto depois de salvar.</p>`)}
    ${secao('calendario', 'verde', 'Horários de visita', 'O cliente vê no site os dias e horários livres e já escolhe o dele', html `
      <div class="agenda-config">
        ${agenda.dias.map((d, i) => html `<div class="agenda-linha">
          <label class="check"><input type="checkbox" name="ag_aberto_${i}" ${d.aberto ? 'checked' : ''}> <b>${DIAS_SEMANA[i]}</b></label>
          <input type="time" name="ag_inicio_${i}" value="${d.inicio}" aria-label="${DIAS_SEMANA[i]}: abre às" step="1800">
          <span class="mudo">até</span>
          <input type="time" name="ag_fim_${i}" value="${d.fim}" aria-label="${DIAS_SEMANA[i]}: fecha às" step="1800">
        </div>`)}
      </div>
      <div class="grade-form">${campos([
        { nome: 'ag_intervalo', rotulo: 'Duração de cada visita', tipo: 'select', largura: 2, opcoes: [['30', '30 minutos'], ['60', '1 hora'], ['90', '1h30'], ['120', '2 horas']] },
        { nome: 'ag_capacidade', rotulo: 'Clientes no mesmo horário', tipo: 'numero', largura: 2, attrs: 'min="1" max="10" step="1"' },
    ], { ag_intervalo: String(agenda.intervalo), ag_capacidade: agenda.capacidade })}</div>
      <div class="agenda-fechados">
        <p><b>Dias sem atendimento</b> <span class="mudo">(feriados, folgas)</span></p>
        <div class="linha-add"><input type="date" id="ag_novo_fechado" min="${new Date().toISOString().slice(0, 10)}"><button type="button" class="sec" data-acao="add-fechado">Adicionar</button></div>
        <div class="chips-fechados" id="ag_fechados"></div>
      </div>
      <p class="mudo pequeno">Horários que um cliente já pediu pelo site ficam como reservados. Atenda os pedidos em "Contatos do site".</p>`)}
    ${admin ? html `<div class="acoes-form fixo"><button type="submit">Salvar catálogo</button></div>` : ''}
  </form></div>`);
    const f = $('#f-cat', el);
    // Datas fechadas (lista editável)
    const fechados = new Set(agenda.fechados);
    const desenharFechados = () => {
        $('#ag_fechados', el).innerHTML = [...fechados].sort().map((d) => html `<span class="chip-fechado">${d.split('-').reverse().join('/')}${admin ? html `<button type="button" data-acao="rem-fechado" data-data="${d}" aria-label="Remover ${d}">×</button>` : ''}</span>`.s).join('') || '<span class="mudo pequeno">Nenhum</span>';
    };
    desenharFechados();
    acoes(f, {
        'add-fechado': () => { const i = $('#ag_novo_fechado', el); if (i.value) {
            fechados.add(i.value);
            i.value = '';
            desenharFechados();
        } },
        'rem-fechado': (b) => { fechados.delete(b.dataset.data); desenharFechados(); },
    });
    if (!admin)
        f.querySelectorAll('input, select, textarea').forEach((i) => (i.disabled = true));
    // Cores: "automática" limpa o campo (o site calcula a partir da cor principal); prévia ao vivo
    const previa = f.querySelector('.previa-cores');
    const atualizarPrevia = () => {
        if (!previa)
            return;
        const v = (n) => { const i = f.querySelector(`input[name=${n}]`); return i.disabled ? '' : i.value; };
        const marca = v('cor_marca') || '#f26b1d';
        previa.style.setProperty('--p-marca', marca);
        previa.style.setProperty('--p-faixa', v('cor_faixa') || `color-mix(in oklab, ${marca} 34%, #160600)`);
        previa.style.setProperty('--p-fundo', v('cor_fundo') || '#ffffff');
    };
    f.querySelectorAll('[data-auto]').forEach((ch) => ch.addEventListener('change', () => {
        f.querySelector(`input[name=${ch.dataset.auto}]`).disabled = ch.checked || !admin;
        atualizarPrevia();
    }));
    f.querySelectorAll('.cor-pronta').forEach((b) => b.addEventListener('click', () => {
        if (!admin)
            return;
        f.querySelector('input[name=cor_marca]').value = b.dataset.marca;
        const faixa = f.querySelector('input[name=cor_faixa]');
        faixa.value = b.dataset.faixa;
        faixa.disabled = false;
        f.querySelector('[data-auto=cor_faixa]').checked = false;
        atualizarPrevia();
    }));
    f.addEventListener('input', atualizarPrevia);
    atualizarPrevia();
    aoEnviar(f, async (d) => {
        for (const n of ['cor_faixa', 'cor_fundo'])
            if (f.querySelector(`[data-auto=${n}]`).checked)
                d[n] = '';
        d.agenda = {
            dias: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ aberto: !!d[`ag_aberto_${i}`], inicio: d[`ag_inicio_${i}`], fim: d[`ag_fim_${i}`] })),
            intervalo: Number(d.ag_intervalo), capacidade: Number(d.ag_capacidade), fechados: [...fechados],
        };
        for (const k of Object.keys(d))
            if (k.startsWith('ag_'))
                delete d[k];
        await api.put('/api/empresa', d);
        aviso('Catálogo salvo.');
        window.dispatchEvent(new Event('loja-alterada'));
    });
}
/** Combinações prontas: [nome, cor principal, cor das faixas]. */
const CORES_PRONTAS = [
    ['Laranja', '#f26b1d', '#3d1405'], ['Vermelho', '#e0262d', '#3b0709'], ['Azul', '#1d6ff2', '#071a3d'],
    ['Verde', '#16a35a', '#05301a'], ['Roxo', '#8a2be2', '#22083f'], ['Dourado', '#d49a1a', '#2e1f05'], ['Grafite', '#3a4250', '#12161c'],
];
async function loja(el, topo) {
    const e = await api.get('/api/empresa');
    const admin = pode('config.editar');
    const vals = { ...e, crt: String(e.crt) };
    montar(el, html `${topo}
  <div class="coluna-config">
  <form id="f-loja">
    ${secao('loja', 'laranja', 'Informações da loja', 'Aparecem no cabeçalho de contratos, carnês, garantias e notas', html `<div class="grade-form">${campos([
        { nome: 'nome_fantasia', rotulo: 'Nome da loja', obrigatorio: true, largura: 2 },
        { nome: 'razao_social', rotulo: 'Razão social', obrigatorio: true, largura: 2 },
        { nome: 'cnpj', rotulo: 'CNPJ', largura: 2, attrs: 'placeholder="00.000.000/0000-00"' },
        { nome: 'telefone', rotulo: 'Telefone', largura: 2, attrs: 'placeholder="(00) 0000-0000" inputmode="tel"' },
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', largura: 2 },
        { nome: 'cep', rotulo: 'CEP', largura: 1, attrs: 'data-cep inputmode="numeric"' },
        { nome: 'uf', rotulo: 'UF', tipo: 'select', opcoes: UFS, largura: 1 },
        { nome: 'logradouro', rotulo: 'Rua', largura: 2 },
        { nome: 'numero', rotulo: 'Número', largura: 1 },
        { nome: 'bairro', rotulo: 'Bairro', largura: 1 },
        { nome: 'municipio', rotulo: 'Cidade', largura: 2 },
        { nome: 'complemento', rotulo: 'Complemento', largura: 2 },
        { nome: 'cod_municipio', rotulo: 'Código IBGE da cidade', largura: 2, dica: 'Preenchido pelo CEP. Necessário para a NF-e.' },
    ], vals)}</div>`)}

    ${secao('mensagem', 'verde', 'WhatsApp da empresa', 'Usado nas mensagens de cobrança e no rodapé dos carnês', html `<div class="grade-form">
      ${campos([{ nome: 'whatsapp', rotulo: 'Número com código do país e DDD', largura: 4, attrs: 'inputmode="tel" placeholder="5585999999999"', dica: 'Ex.: 5585999999999 (55 = Brasil, depois DDD e número)' }], vals)}
      <p class="l4 link-gerado" id="link-whats"></p></div>`)}

    ${secao('qr', 'azul', 'Pix', 'Chave padrão dos carnês: cada parcela sai com QR Code no valor certo', html `<div class="grade-form">
      ${campos([{ nome: 'chave_pix', rotulo: 'Chave Pix da loja', largura: 4, dica: 'CNPJ, CPF, e-mail, telefone com +55 ou chave aleatória' }], vals)}</div>`)}

    ${secao('arquivo', 'laranja', 'Contratos e garantia', 'Textos usados em todo contrato novo (cada contrato pode ser ajustado)', html `<div class="grade-form">${campos([
        { nome: 'cidade_contrato', rotulo: 'Cidade que aparece no contrato', largura: 2, dica: 'Vazio usa a cidade da loja.' },
        { nome: 'clausulas_venda', rotulo: 'Cláusulas do contrato de venda', tipo: 'area', largura: 4, attrs: 'rows="9"' },
        { nome: 'clausulas_compra', rotulo: 'Cláusulas do contrato de compra', tipo: 'area', largura: 4, attrs: 'rows="7"' },
        { nome: 'garantia_texto', rotulo: 'Termo de garantia padrão', tipo: 'area', largura: 4, attrs: 'rows="5"', dica: '{LOJA} é trocado pela razão social. Deixe vazio se a loja não dá garantia.' },
    ], vals)}</div>`)}
    ${admin ? html `<div class="acoes-form fixo"><button type="submit">Salvar configurações</button></div>` : html `<p class="mudo">Você pode ver, mas não alterar estas configurações.</p>`}
  </form>

  ${secao('upload', 'laranja', 'Logo da loja', 'Aparece no menu e no cabeçalho de contratos, carnês, garantias e extratos', html `
    <div class="logo-area"><div class="logo-previa">${e.logo ? html `<img src="/marca/logo?v=${e.logo.slice(0, 24)}" alt="Logo atual">` : icone('loja', 34)}</div>
    <div>${admin ? html `<label class="botao sec">${icone('upload', 16)}Enviar logo<input type="file" id="f_logo" accept="image/png,image/jpeg,image/webp" hidden></label>
      ${e.logo ? html `<button class="sec perigo" data-acao="remover-logo">Remover</button>` : ''}` : ''}<p class="mudo pequeno">PNG ou JPG. Fica melhor com fundo transparente (PNG).</p></div></div>`)}

  ${secao('caneta', 'azul', 'Assinatura do representante da loja', 'Vai impressa em todos os contratos e termos de garantia', html `
    ${e.assinatura_loja ? html `<div class="assinatura-atual"><img src="${e.assinatura_loja}" alt="Assinatura atual da loja"></div>` : html `<p class="mudo">Nenhuma assinatura cadastrada: os contratos saem com a linha em branco para assinar à mão.</p>`}
    ${admin ? html `<div class="botoes"><button class="sec" data-acao="assinar-loja">${icone('caneta', 16)}${e.assinatura_loja ? 'Trocar assinatura' : 'Cadastrar assinatura'}</button>
      ${e.assinatura_loja ? html `<button class="sec perigo" data-acao="remover-ass">Remover</button>` : ''}</div>` : ''}`)}
  </div>`);
    const f = $('#f-loja', el);
    f.querySelector('[data-cep]').addEventListener('blur', () => buscarCep(f));
    const whats = $('#f_whatsapp', el);
    const mostrarLink = () => {
        const d = whats.value.replace(/\D/g, '');
        $('#link-whats', el).innerHTML = d.length >= 12 ? html `${icone('mensagem', 16)}Link gerado: <a href="https://wa.me/${d}" target="_blank" rel="noopener">wa.me/${d}</a>`.s : '';
    };
    whats.addEventListener('input', mostrarLink);
    mostrarLink();
    if (!admin)
        f.querySelectorAll('input, select, textarea').forEach((i) => (i.disabled = true));
    aoEnviar(f, async (d) => {
        await api.put('/api/empresa', d);
        aviso('Configurações salvas.');
        window.dispatchEvent(new Event('loja-alterada'));
    });
    $('#f_logo', el)?.addEventListener('change', async (ev) => {
        const arq = ev.target.files?.[0];
        if (!arq)
            return;
        await api.post('/api/empresa/logo', { imagem: await arquivoParaEnvio(arq, 800) });
        aviso('Logo atualizada.');
        window.dispatchEvent(new Event('loja-alterada'));
        loja(el, topo);
    });
    acoes(el, {
        'remover-logo': async () => {
            if (!(await confirmar('Remover a logo da loja?', 'Remover')))
                return;
            await api.del('/api/empresa/logo');
            window.dispatchEvent(new Event('loja-alterada'));
            loja(el, topo);
        },
        'remover-ass': async () => {
            if (!(await confirmar('Remover a assinatura da loja? Os contratos voltam a sair com a linha em branco.', 'Remover')))
                return;
            await api.post('/api/empresa/assinatura', { assinatura: '' });
            loja(el, topo);
        },
        'assinar-loja': () => {
            const m = modal('Assinatura do representante da loja', html `<div class="assinar">
        <div class="quadro"><canvas id="q-loja" aria-label="Quadro de assinatura"></canvas><span class="linha-ass">Assine acima da linha</span></div>
        <div class="acoes-form"><button type="button" class="sec" data-limpar>Limpar</button><span class="espaco"></span><button type="button" class="sec" data-fechar>Cancelar</button><button type="button" data-salvar disabled>Salvar assinatura</button></div></div>`, { largo: true });
            const btn = m.el.querySelector('[data-salvar]');
            let q;
            q = quadroAssinatura($('#q-loja', m.el), () => { btn.disabled = !q || q.vazio(); });
            m.el.querySelector('[data-limpar]').addEventListener('click', () => q.limpar());
            btn.addEventListener('click', async () => {
                await api.post('/api/empresa/assinatura', { assinatura: q.png() });
                m.fechar();
                aviso('Assinatura da loja salva.');
                loja(el, topo);
            });
        },
    });
}
async function notaFiscal(el, topo) {
    const e = await api.get('/api/empresa');
    const admin = pode('config.editar');
    const vals = { ...e, crt: String(e.crt), nfe_ambiente: String(e.nfe_ambiente) };
    montar(el, html `${topo}
  <div class="coluna-config">
  ${secao('cadeado', 'laranja', 'Certificado digital A1', 'Necessário para emitir NF-e e para o RENAVE', html `
    ${e.cert_configurado ? html `<p class="cert-ok">${icone('ok', 18)}<span><b>${e.cert_titular}</b><br>Válido até ${data(e.cert_validade)}</span></p>` : html `<p class="alerta-caixa">Nenhum certificado enviado.</p>`}
    ${admin ? html `<div class="linha-form"><input type="file" id="cert-arq" accept=".pfx,.p12" aria-label="Arquivo do certificado"><input type="password" id="cert-senha" placeholder="Senha do certificado" aria-label="Senha do certificado" autocomplete="off"><button type="button" class="sec" data-acao="cert">${icone('upload', 16)}Enviar certificado</button></div>` : ''}`)}
  <form id="f-nfe">
    ${secao('nota', 'azul', 'Nota fiscal eletrônica', 'Dados fiscais da empresa e numeração', html `
      ${e.nfe_simulado ? html `<p class="alerta-caixa">O servidor está com NFE_SIMULADO=1: em homologação as notas vão para uma SEFAZ simulada.</p>` : ''}
      <div class="grade-form">${campos([
        { nome: 'ie', rotulo: 'Inscrição estadual', obrigatorio: true, largura: 2 },
        { nome: 'crt', rotulo: 'Regime tributário', tipo: 'select', opcoes: [['1', 'Simples Nacional'], ['2', 'Simples (excesso de sublimite)'], ['3', 'Regime normal'], ['4', 'MEI']], largura: 2 },
        { nome: 'nfe_ambiente', rotulo: 'Ambiente', tipo: 'select', opcoes: [['2', 'Homologação (testes, sem valor fiscal)'], ['1', 'Produção']], largura: 2 },
        { nome: 'nfe_serie', rotulo: 'Série', tipo: 'numero', largura: 1 },
        { nome: 'nfe_proximo_numero', rotulo: 'Próximo número', tipo: 'numero', largura: 1 },
        { nome: 'ibscbs_ativo', rotulo: 'Informar IBS/CBS (Reforma Tributária) nas notas', tipo: 'check', largura: 4 },
        { nome: 'resp_tec_cnpj', rotulo: 'Responsável técnico: CNPJ', largura: 1 },
        { nome: 'resp_tec_contato', rotulo: 'Contato', largura: 1 },
        { nome: 'resp_tec_email', rotulo: 'E-mail', largura: 1 },
        { nome: 'resp_tec_fone', rotulo: 'Telefone', largura: 1 },
    ], vals)}</div>`)}
    ${secao('escudo', 'verde', 'RENAVE e comissões', 'Integração com o estoque eletrônico e comissão padrão dos vendedores', html `<div class="grade-form">${campos([
        { nome: 'renave_modo', rotulo: 'RENAVE', tipo: 'select', opcoes: [['simulado', 'Simulado (sem envio)'], ['homologacao', 'Homologação Serpro'], ['producao', 'Produção']], largura: 1 },
        { nome: 'renave_url_base', rotulo: 'URL do RENAVE (fornecida pelo Serpro)', largura: 2 },
        { nome: 'comissao_padrao_pct', rotulo: 'Comissão padrão (%)', tipo: 'numero', largura: 1 },
    ], vals)}</div>`)}
    ${admin ? html `<div class="acoes-form fixo"><button type="submit">Salvar configurações</button></div>` : ''}
  </form></div>`);
    const f = $('#f-nfe', el);
    if (!admin)
        f.querySelectorAll('input, select, textarea').forEach((i) => (i.disabled = true));
    aoEnviar(f, async (d) => {
        if (d.nfe_ambiente === '1' && e.nfe_ambiente === 2) {
            if (!(await confirmar('Mudar para produção? A partir daí as notas emitidas têm valor fiscal e precisam ser canceladas se emitidas por engano.', 'Usar produção')))
                return;
            d.confirmar_producao = true;
        }
        await api.put('/api/empresa', d);
        aviso('Configurações salvas.');
    });
    acoes(el, {
        cert: async (btn) => {
            const arq = $('#cert-arq', el).files?.[0];
            if (!arq)
                return aviso('Selecione o arquivo .pfx.', 'erro');
            if (btn.hasAttribute('disabled'))
                return;
            btn.setAttribute('disabled', '');
            try {
                const r = await api.post('/api/empresa/certificado', { arquivo: await lerArquivoBase64(arq), senha: $('#cert-senha', el).value });
                aviso(`Certificado de ${r.titular} instalado.${r.aviso ? ' ' + r.aviso : ''}`, r.aviso ? 'erro' : 'ok');
                notaFiscal(el, topo);
            }
            finally {
                btn.removeAttribute('disabled');
            }
        },
    });
}
/** Mesma ordem e identificação usadas no servidor (importacao.ts). */
const ORDEM_IMPORTACAO = ['configuracoes', 'clientes', 'contratos', 'cobrancas', 'carnes', 'financeiro', 'veiculos', 'desconhecido'];
function tipoCsv(conteudo) {
    const primeira = (dividirRegistros(conteudo.replace(/^\uFEFF/, ''))[0] ?? '');
    const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
    const cab = primeira.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const tem = (...c) => c.every((x) => cab.includes(x));
    if (tem('key', 'value'))
        return 'configuracoes';
    if (tem('buyerName') || tem('contract_type'))
        return 'contratos';
    if (tem('paid_installments', 'due_day'))
        return 'cobrancas';
    if (tem('installment_value', 'client_name') && (tem('pix_key') || tem('vehicle_plate')))
        return 'carnes';
    if (tem('amount', 'type') && (tem('category') || tem('date')))
        return 'financeiro';
    if (tem('cpf', 'name'))
        return 'clientes';
    if (cab.some((c) => /plate|chassis|placa|chassi/i.test(c)))
        return 'veiculos';
    return 'desconhecido';
}
/** Separa os registros de um CSV respeitando quebras de linha dentro de aspas. */
function dividirRegistros(texto) {
    const out = [];
    let aspas = false;
    let inicio = 0;
    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        if (c === '"')
            aspas = !aspas;
        else if (c === '\n' && !aspas) {
            const reg = texto.slice(inicio, i).replace(/\r$/, '');
            if (reg.trim())
                out.push(reg);
            inicio = i + 1;
        }
    }
    const resto = texto.slice(inicio).replace(/\r$/, '');
    if (resto.trim())
        out.push(resto);
    return out;
}
/** Divide o CSV em blocos de N registros, repetindo o cabeçalho em cada bloco. */
function dividirCsv(conteudo, n) {
    const regs = dividirRegistros(conteudo.replace(/^\uFEFF/, ''));
    if (regs.length <= n + 1)
        return [conteudo];
    const [cab, ...linhas] = regs;
    const blocos = [];
    for (let i = 0; i < linhas.length; i += n)
        blocos.push([cab, ...linhas.slice(i, i + n)].join('\n'));
    return blocos;
}
async function importar(el, topo) {
    montar(el, html `${topo}
  <div class="coluna-config">
  ${secao('importar', 'laranja', 'Importar dados do sistema anterior', 'Clientes, contratos, cobranças, carnês, lançamentos financeiros e configurações', html `
    <p>Selecione de uma vez todos os arquivos <b>.csv</b> exportados do sistema antigo. O sistema reconhece cada arquivo pelo conteúdo e liga contratos e cobranças aos clientes.</p>
    <p class="mudo pequeno">Pode importar de novo sem medo: o que já foi importado é ignorado.</p>
    <label class="soltar">${icone('upload', 22)}<span>Escolher arquivos CSV</span><input type="file" id="f_csv" accept=".csv,text/csv" multiple></label>
    <ul class="lista-arquivos" id="arqs"></ul>
    <div class="acoes-form"><button type="button" data-importar disabled>${icone('importar', 16)}Importar</button></div>
    <div id="relatorio"></div>`)}
  </div>`);
    const input = $('#f_csv', el);
    const btn = el.querySelector('[data-importar]');
    input.addEventListener('change', () => {
        const fs = [...(input.files ?? [])];
        $('#arqs', el).innerHTML = fs.map((f) => html `<li>${icone('arquivo', 16)}${f.name} <span class="mudo">${Math.ceil(f.size / 1024)} KB</span></li>`.s).join('');
        btn.disabled = !fs.length;
    });
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Importando…';
        try {
            const arquivos = await Promise.all([...(input.files ?? [])].map(async (f) => ({ nome: f.name, conteudo: await f.text() })));
            // Envia em partes (cada arquivo em blocos de linhas), na ordem certa:
            // assim nenhum envio fica grande ou demorado demais para o servidor.
            arquivos.sort((a, z) => ORDEM_IMPORTACAO.indexOf(tipoCsv(a.conteudo)) - ORDEM_IMPORTACAO.indexOf(tipoCsv(z.conteudo)));
            const partes = arquivos.flatMap((a) => dividirCsv(a.conteudo, 300).map((conteudo) => ({ nome: a.nome, conteudo })));
            const porArquivo = new Map();
            let feitas = 0;
            for (const parte of partes) {
                btn.textContent = `Importando… ${Math.round((feitas / partes.length) * 100)}%`;
                const [r] = await api.post('/api/importar', { arquivos: [parte] });
                feitas++;
                const atual = porArquivo.get(parte.nome);
                if (!atual)
                    porArquivo.set(parte.nome, r);
                else {
                    atual.lidos += r.lidos;
                    atual.importados += r.importados;
                    atual.ignorados += r.ignorados;
                    for (const a of r.avisos)
                        if (!atual.avisos.includes(a))
                            atual.avisos.push(a);
                }
            }
            const rel = [...porArquivo.values()];
            const nomes = { clientes: 'Clientes', contratos: 'Contratos', cobrancas: 'Cobranças', carnes: 'Carnês', financeiro: 'Financeiro', configuracoes: 'Configurações', veiculos: 'Veículos', vazio: 'Vazio', desconhecido: 'Não reconhecido' };
            $('#relatorio', el).innerHTML = html `<h3>Resultado</h3><table class="tabela compacta"><thead><tr><th>Arquivo</th><th>Conteúdo</th><th class="n">Linhas</th><th class="n">Importados</th><th class="n">Ignorados</th></tr></thead>
        <tbody>${rel.map((r) => html `<tr><td>${r.arquivo}</td><td>${nomes[r.tipo] ?? r.tipo}</td><td class="n">${r.lidos}</td><td class="n"><b>${r.importados}</b></td><td class="n">${r.ignorados}</td></tr>
          ${r.avisos.length ? html `<tr class="avisos-import"><td colspan="5"><ul>${r.avisos.map((a) => html `<li>${a}</li>`)}</ul></td></tr>` : ''}`)}</tbody></table>`.s;
            aviso('Importação concluída.');
            window.dispatchEvent(new Event('loja-alterada'));
            window.dispatchEvent(new Event('contadores'));
        }
        catch (e) {
            aviso(e.message, 'erro');
        }
        finally {
            btn.disabled = false;
            btn.innerHTML = html `${icone('importar', 16)}Importar`.s;
        }
    });
}
async function fiscal(el, topo) {
    const perfis = await api.get('/api/perfis-fiscais');
    montar(el, html `
  ${topo}
  <p class="alerta-caixa">Os valores iniciais são um ponto de partida comum para revenda no Simples Nacional. Confira cada regra com o contador antes de emitir em produção. No regime normal, troque o CSOSN por CST (ex.: 20 com redução de base para veículo usado, conforme a legislação do estado).</p>
  <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Operação</th><th>Tipo</th><th>CFOP no estado</th><th>CFOP fora</th><th>CST/CSOSN</th><th class="n">ICMS %</th><th class="n">Redução BC %</th><th></th></tr></thead>
  <tbody>${perfis.map((p) => html `<tr><td><b>${p.descricao}</b><br><small>${p.natureza}</small></td><td>${p.tipo_nf ? 'Saída' : 'Entrada'}</td><td>${p.cfop_interno}</td><td>${p.cfop_interestadual}</td><td>${p.cst_icms}</td><td class="n">${p.aliq_icms}</td><td class="n">${p.red_bc_pct}</td>
  <td>${pode('config.editar') ? html `<button class="link" data-acao="editar" data-id="${p.id}">Editar</button>` : ''}</td></tr>`)}</tbody></table></div>`);
    acoes(el, {
        editar: (b) => {
            const p = perfis.find((x) => String(x.id) === b.dataset.id);
            const m = modal(`Regra: ${p.descricao}`, html `<form id="f-perf"><div class="grade-form">${campos([
                { nome: 'descricao', rotulo: 'Descrição', largura: 2 }, { nome: 'natureza', rotulo: 'Natureza da operação (na nota)', largura: 2 },
                { nome: 'cfop_interno', rotulo: 'CFOP dentro do estado', largura: 1 }, { nome: 'cfop_interestadual', rotulo: 'CFOP para outro estado', largura: 1 },
                { nome: 'origem', rotulo: 'Origem da mercadoria', tipo: 'select', opcoes: [['0', '0 Nacional'], ['1', '1 Importação direta'], ['2', '2 Estrangeira adquirida no mercado interno'], ['3', '3 Nacional com mais de 40% importado']], largura: 2 },
                { nome: 'cst_icms', rotulo: 'CST (regime normal) ou CSOSN (Simples)', largura: 1 }, { nome: 'aliq_icms', rotulo: 'Alíquota ICMS %', tipo: 'numero', largura: 1 },
                { nome: 'red_bc_pct', rotulo: 'Redução da base %', tipo: 'numero', largura: 1 },
                { nome: 'cst_pis', rotulo: 'CST PIS', largura: 1 }, { nome: 'aliq_pis', rotulo: 'PIS %', tipo: 'numero', largura: 1 },
                { nome: 'cst_cofins', rotulo: 'CST COFINS', largura: 1 }, { nome: 'aliq_cofins', rotulo: 'COFINS %', tipo: 'numero', largura: 1 },
                { nome: 'cst_ibscbs', rotulo: 'CST IBS/CBS', largura: 1 }, { nome: 'cclass_trib', rotulo: 'cClassTrib', largura: 1 },
                { nome: 'aliq_ibs_uf', rotulo: 'IBS estadual %', tipo: 'numero', largura: 1 }, { nome: 'aliq_ibs_mun', rotulo: 'IBS municipal %', tipo: 'numero', largura: 1 }, { nome: 'aliq_cbs', rotulo: 'CBS %', tipo: 'numero', largura: 1 },
                { nome: 'info_complementar', rotulo: 'Texto extra nas informações complementares', tipo: 'area', largura: 4 },
            ], { ...p, origem: String(p.origem) })}</div><div class="acoes-form"><button type="button" class="sec" data-fechar>Voltar</button><button type="submit">Salvar regra</button></div></form>`, { largo: true });
            aoEnviar($('#f-perf', m.el), async (d) => { await api.put(`/api/perfis-fiscais/${p.id}`, d); m.fechar(); aviso('Regra salva.'); fiscal(el, topo); });
        },
    });
}
