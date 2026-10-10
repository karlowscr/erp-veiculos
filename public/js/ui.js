/** Utilitários de interface: HTML seguro, formatação, formulários, modal e avisos. */
export class Html {
    s;
    constructor(s) {
        this.s = s;
    }
    toString() { return this.s; }
}
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function valor(v) {
    if (v instanceof Html)
        return v.s;
    if (Array.isArray(v))
        return v.map(valor).join('');
    if (v === false || v === null || v === undefined)
        return '';
    return esc(v);
}
/** Template HTML que escapa tudo que é interpolado (exceto outros `html`). */
export function html(partes, ...vals) {
    let s = partes[0];
    vals.forEach((v, i) => (s += valor(v) + partes[i + 1]));
    return new Html(s);
}
export const cru = (s) => new Html(s);
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
export function montar(alvo, conteudo) {
    alvo.innerHTML = conteudo.s;
}
/** Liga cliques em elementos com data-acao="nome" a funções. */
export function acoes(raiz, mapa) {
    // Uma página pode se redesenhar várias vezes no mesmo elemento: troca o ouvinte anterior em vez de acumular
    const anterior = raiz._acoes;
    if (anterior)
        raiz.removeEventListener('click', anterior);
    const ouvinte = (ev) => {
        const el = ev.target.closest('[data-acao]');
        if (!el || !raiz.contains(el))
            return;
        const fn = mapa[el.dataset.acao];
        if (fn) {
            ev.preventDefault();
            Promise.resolve(fn(el, ev)).catch(mostrarErro);
        }
    };
    raiz._acoes = ouvinte;
    raiz.addEventListener('click', ouvinte);
}
// ---- Formatação ----
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (v) => BRL.format(Number(v ?? 0));
export const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');
export const data = (iso) => {
    const s = String(iso ?? '');
    if (!s)
        return '';
    const d = s.slice(0, 10).split('-');
    return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : s;
};
export const dataHora = (iso) => {
    const s = String(iso ?? '');
    if (!s)
        return '';
    const d = new Date(s.includes('T') || s.endsWith('Z') ? s : s.replace(' ', 'T') + 'Z');
    return isNaN(+d) ? s : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
export const hoje = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function doc(d) {
    const s = String(d ?? '');
    if (s.length === 11)
        return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    if (s.length === 14)
        return s.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    return s;
}
/** Placa no padrão Mercosul (ou antigo), elemento visual principal do sistema. */
export function placa(p, pequeno = false) {
    const s = String(p ?? '').toUpperCase();
    if (!s)
        return html `<span class="placa placa-vazia${pequeno ? ' p' : ''}" title="Sem placa">0 km</span>`;
    const fmt = /^[A-Z]{3}\d[A-Z]\d{2}$/.test(s) ? s : s.replace(/^([A-Z]{3})(\d{4})$/, '$1-$2');
    return html `<span class="placa${pequeno ? ' p' : ''}"><i>BRASIL</i>${fmt}</span>`;
}
const ROTULOS = {
    estoque: 'Em estoque', reservado: 'Reservado', vendido: 'Vendido', devolvido: 'Devolvido',
    compra: 'Compra', venda: 'Venda', consignacao: 'Consignação', devolucao_consignacao: 'Devolução de consignação',
    troca: 'Troca', montadora: 'Montadora',
    concluida: 'Concluída', cancelada: 'Cancelada', aberto: 'Em aberto', pago: 'Pago', cancelado: 'Cancelado', vencido: 'Vencido',
    pendente: 'Pendente', paga: 'Paga',
    assinada: 'Não transmitida', autorizada: 'Autorizada', rejeitada: 'Rejeitada', denegada: 'Denegada', erro: 'Falha no envio',
    em_estoque: 'No estoque RENAVE', saida: 'Saída registrada', nao_aplicavel: 'Não se aplica', sucesso: 'Sucesso',
    receber: 'A receber', pagar: 'A pagar',
    admin: 'Administrador', gerente: 'Gerente', vendedor: 'Vendedor', financeiro: 'Financeiro',
    dinheiro: 'Dinheiro', pix: 'PIX', cartao_debito: 'Cartão de débito', cartao_credito: 'Cartão de crédito', transferencia: 'Transferência',
    financiamento: 'Financiamento', boleto: 'Boleto', promissoria: 'Promissória', cheque: 'Cheque',
    em_dia: 'Em dia', quitado: 'Quitado', atrasado: 'Atrasado', assinado: 'Assinado', aguardando: 'Pendente',
};
export const rotulo = (k) => ROTULOS[String(k)] ?? String(k ?? '');
const TONS = {
    estoque: 'ok', autorizada: 'ok', pago: 'ok', paga: 'ok', concluida: 'ok', sucesso: 'ok', em_estoque: 'ok', saida: 'ok',
    reservado: 'aviso', aberto: 'aviso', pendente: 'aviso', assinada: 'aviso',
    rejeitada: 'erro', erro: 'erro', denegada: 'erro', vencido: 'erro', atrasado: 'erro',
    em_dia: 'ok', quitado: 'azul', assinado: 'ok', aguardando: 'aviso', compra: 'azul', ok: 'ok', azul: 'azul',
    cancelada: 'neutro', cancelado: 'neutro', devolvido: 'neutro', vendido: 'azul', nao_aplicavel: 'neutro',
};
export const selo = (status, texto) => html `<span class="selo ${TONS[String(status)] ?? 'neutro'}">${texto ?? rotulo(status)}</span>`;
// ---- Avisos e erros ----
export function aviso(msg, tipo = 'ok') {
    let area = $('#avisos');
    if (!area) {
        area = document.createElement('div');
        area.id = 'avisos';
        area.setAttribute('role', 'status');
        document.body.append(area);
    }
    const el = document.createElement('div');
    el.className = `aviso ${tipo}`;
    el.textContent = msg;
    area.append(el);
    setTimeout(() => el.remove(), tipo === 'erro' ? 8000 : 4000);
}
export const mostrarErro = (e) => aviso(e?.message ?? String(e), 'erro');
// ---- Modal ----
export function modal(titulo, corpo, op = {}) {
    const d = document.createElement('dialog');
    d.className = op.largo ? 'largo' : '';
    d.innerHTML = html `<header><h2>${titulo}</h2><button type="button" class="icone-btn" data-fechar aria-label="Fechar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></header><div class="corpo">${corpo}</div>`.s;
    document.body.append(d);
    const fechar = () => d.close();
    d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
    d.addEventListener('click', (e) => {
        if (e.target.closest('[data-fechar]'))
            fechar();
    });
    d.showModal();
    return { el: d, fechar };
}
export function confirmar(msg, textoBotao = 'Confirmar') {
    return new Promise((ok) => {
        const m = modal('Confirme', html `<p>${msg}</p><div class="acoes-form"><button class="sec" data-fechar>Voltar</button><button data-sim>${textoBotao}</button></div>`);
        m.el.querySelector('[data-sim]').addEventListener('click', () => { m.fechar(); ok(true); });
        m.el.addEventListener('close', () => ok(false));
    });
}
export function campos(lista, valores = {}) {
    return html `${lista.map((c) => {
        const v = valores[c.nome] ?? '';
        const id = 'f_' + c.nome;
        const req = c.obrigatorio ? cru(' required') : '';
        const extra = cru(c.attrs ? ' ' + c.attrs : '');
        let input;
        switch (c.tipo) {
            case 'select':
                input = html `<select id="${id}" name="${c.nome}"${req}${extra}>${(c.opcoes ?? []).map(([val, txt]) => html `<option value="${val}"${String(v) === val ? cru(' selected') : ''}>${txt}</option>`)}</select>`;
                break;
            case 'area':
                input = html `<textarea id="${id}" name="${c.nome}" rows="3"${req}${extra}>${v}</textarea>`;
                break;
            case 'check':
                return html `<label class="check l${c.largura ?? 2}"><input type="checkbox" name="${c.nome}"${v ? cru(' checked') : ''}${extra}> ${c.rotulo}</label>`;
            case 'arquivo':
                input = html `<input id="${id}" type="file" name="${c.nome}"${req}${extra}>`;
                break;
            default: {
                const tipo = c.tipo === 'moeda' || c.tipo === 'numero' ? 'number' : c.tipo === 'data' ? 'date' : c.tipo === 'email' ? 'email' : c.tipo === 'senha' ? 'password' : c.tipo === 'cor' ? 'color' : 'text';
                const passo = c.tipo === 'moeda' ? cru(' step="0.01" min="0" inputmode="decimal"') : c.tipo === 'numero' ? cru(' step="any"') : '';
                input = html `<input id="${id}" type="${tipo}" name="${c.nome}" value="${v}"${passo}${req}${extra}>`;
            }
        }
        return html `<div class="campo l${c.largura ?? 2}"><label for="${id}">${c.rotulo}${c.obrigatorio ? html `<span class="obr" aria-hidden="true">*</span>` : ''}</label>${input}${c.dica ? html `<small>${c.dica}</small>` : ''}</div>`;
    })}`;
}
/** Lê um formulário como objeto (checkbox vira boolean). */
export function lerForm(form) {
    const out = {};
    for (const el of [...form.elements]) {
        if (!el.name || el.type === 'file' || el.closest('[data-ignorar]'))
            continue;
        out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return out;
}
/** Envia o formulário chamando `fn`; trava o botão enquanto processa. */
export function aoEnviar(form, fn) {
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        if (btn?.disabled)
            return;
        if (btn)
            btn.disabled = true;
        try {
            await fn(lerForm(form));
        }
        catch (e) {
            mostrarErro(e);
        }
        finally {
            if (btn)
                btn.disabled = false;
        }
    });
}
export const lerArquivoBase64 = (f) => new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => erro(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(f);
});
/** Busca endereço pelo CEP (ViaCEP), preenchendo também o código IBGE do município. */
export async function buscarCep(form) {
    const cep = form.elements.namedItem('cep')?.value.replace(/\D/g, '');
    if (cep?.length !== 8)
        return;
    try {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const j = await r.json();
        if (j.erro)
            return aviso('CEP não encontrado.', 'erro');
        const set = (n, v) => {
            const el = form.elements.namedItem(n);
            if (el && v && !el.value)
                el.value = v;
        };
        set('logradouro', j.logradouro);
        set('bairro', j.bairro);
        set('municipio', j.localidade);
        set('uf', j.uf);
        const ibge = form.elements.namedItem('cod_municipio');
        if (ibge && j.ibge)
            ibge.value = j.ibge;
    }
    catch {
        /* sem internet: preenchimento manual */
    }
}
export const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').map((u) => [u, u]);
export function vazio(texto, acao) {
    return html `<div class="vazio"><p>${texto}</p>${acao ?? ''}</div>`;
}
// ---- Componentes de página ----
export function cabecalhoPagina(titulo, sub = '', acoesHtml = '') {
    return html `<header class="topo-pagina"><div><h1>${titulo}</h1>${sub ? html `<p class="sub">${sub}</p>` : ''}</div>${acoesHtml ? html `<div class="botoes">${acoesHtml}</div>` : ''}</header>`;
}
export const iniciais = (nome) => String(nome ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
export const primeiraLetra = (nome) => String(nome ?? '').trim().charAt(0).toUpperCase() || '?';
export function telefone(t) {
    const d = String(t ?? '').replace(/\D/g, '');
    if (d.length === 11)
        return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    if (d.length === 10)
        return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    return String(t ?? '');
}
/** Link do WhatsApp com mensagem pronta (número brasileiro sem DDI recebe 55). */
export function linkWhatsapp(tel, mensagem) {
    let d = String(tel ?? '').replace(/\D/g, '');
    if (d.length === 10 || d.length === 11)
        d = '55' + d;
    return `https://wa.me/${d}?text=${encodeURIComponent(mensagem)}`;
}
/** Botões segmentados (Todos / Venda / Compra). */
export function segmentos(nome, opcoes, atual) {
    return html `<div class="segmentos" role="group" aria-label="${nome}">${opcoes.map(([v, t]) => html `<button type="button" data-seg="${nome}" data-valor="${v}" aria-pressed="${v === atual ? 'true' : 'false'}">${t}</button>`)}</div>`;
}
export function somarMesesIso(iso, meses) {
    const [a, m, d] = iso.split('-').map(Number);
    const alvo = new Date(a, m - 1 + meses, 1);
    const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    alvo.setDate(Math.min(d, ultimo));
    return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(alvo.getDate()).padStart(2, '0')}`;
}
export const mesAno = (iso) => { const s = String(iso ?? ''); return s ? `${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
/** Abre um documento para impressão numa nova aba. */
export function abrirImpressao(url) {
    window.open(url, '_blank', 'noopener');
}
/** Pede um texto ao usuário num modal (substitui o prompt do navegador). */
export function pedirTexto(titulo, rotuloCampo, textoBotao = 'Confirmar', minimo = 5) {
    return new Promise((ok) => {
        let respondido = false;
        const m = modal(titulo, html `<form data-pedir><div class="grade-form">${campos([{ nome: 'texto', rotulo: rotuloCampo, tipo: 'area', obrigatorio: true, largura: 4, attrs: `minlength="${minimo}"` }])}</div>
      <div class="acoes-form"><button type="button" class="sec" data-fechar>Cancelar</button><button type="submit">${textoBotao}</button></div></form>`);
        const f = m.el.querySelector('[data-pedir]');
        f.addEventListener('submit', (e) => {
            e.preventDefault();
            respondido = true;
            const v = f.elements.namedItem('texto').value.trim();
            m.fechar();
            ok(v);
        });
        m.el.addEventListener('close', () => { if (!respondido)
            ok(null); });
    });
}
/** Reduz fotos grandes do celular (máx. 2000 px, JPEG) antes de enviar. PDFs passam direto. */
export async function arquivoParaEnvio(arq, maxLado = 2000) {
    if (!arq.type.startsWith('image/') || arq.type === 'image/gif')
        return lerArquivoBase64(arq);
    try {
        const bmp = await createImageBitmap(arq);
        const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
        if (escala === 1 && arq.size < 1.5 * 1024 * 1024)
            return lerArquivoBase64(arq);
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * escala);
        c.height = Math.round(bmp.height * escala);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        // PNG e WEBP podem ter fundo transparente: mantém a transparência (JPEG pintaria o fundo)
        if (arq.type === 'image/png' || arq.type === 'image/webp') {
            const webp = c.toDataURL('image/webp', 0.92);
            return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
        }
        return c.toDataURL('image/jpeg', 0.85);
    }
    catch {
        return lerArquivoBase64(arq);
    }
}
