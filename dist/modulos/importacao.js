/**
 * Importação dos dados do sistema anterior (exportações CSV do Base44):
 * clientes, contratos, parcelamentos (cobranças), carnês, lançamentos
 * financeiros e configurações. Pode ser repetida: registros já importados
 * (pelo id de origem) são ignorados.
 */
import { join } from 'node:path';
import { falhar, numero, r2 } from '../util/comum.js';
import { lerCsv } from '../util/csv.js';
import { docValido, limparDoc, soDigitos } from '../util/validacao.js';
import { baixarImagem } from '../util/arquivos.js';
import { auditar } from './auth.js';
import { modeloContrato } from './contratos.js';
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const NOMES_UF = { CEARA: 'CE', 'CEARÁ': 'CE', PIAUI: 'PI', 'PIAUÍ': 'PI', 'RIO GRANDE DO NORTE': 'RN', PARAIBA: 'PB', 'PARAÍBA': 'PB', PERNAMBUCO: 'PE', MARANHAO: 'MA', 'MARANHÃO': 'MA', BAHIA: 'BA', 'SAO PAULO': 'SP', 'SÃO PAULO': 'SP' };
const uf = (s) => {
    const t = (s ?? '').trim().toUpperCase();
    return UFS.includes(t) ? t : NOMES_UF[t] ?? '';
};
const t = (s) => String(s ?? '').trim();
const data10 = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s ?? '') ? s.slice(0, 10) : '');
const dataHora = (s) => (s ? s.replace('T', ' ').slice(0, 19) : undefined);
function identificar(cab) {
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
export class Importador {
    b;
    pastaArquivos;
    mapaClientes = new Map();
    constructor(b, pastaArquivos) {
        this.b = b;
        this.pastaArquivos = pastaArquivos;
        for (const p of b.all('SELECT id, origem_id FROM pessoas WHERE origem_id IS NOT NULL'))
            this.mapaClientes.set(p.origem_id, p.id);
    }
    pessoaPor(origemId, doc) {
        if (origemId && this.mapaClientes.has(origemId))
            return this.mapaClientes.get(origemId);
        const d = limparDoc(doc);
        if (d) {
            const p = this.b.one('SELECT id FROM pessoas WHERE cpf_cnpj = ?', [d]);
            if (p)
                return p.id;
        }
        return null;
    }
    async importar(arquivos) {
        const lidos = arquivos.map((a) => {
            const linhas = lerCsv(a.conteudo);
            const cab = Object.keys(linhas[0] ?? {});
            return { ...a, linhas, tipo: linhas.length ? identificar(cab) : 'vazio' };
        });
        // Ordem que respeita as dependências; arquivos repetidos (mesmo conteúdo) entram uma vez
        const ordem = ['configuracoes', 'clientes', 'contratos', 'cobrancas', 'carnes', 'financeiro', 'veiculos', 'desconhecido', 'vazio'];
        lidos.sort((a, z) => ordem.indexOf(a.tipo) - ordem.indexOf(z.tipo));
        const vistos = new Set();
        const rel = [];
        for (const a of lidos) {
            const r = { arquivo: a.nome, tipo: a.tipo, lidos: a.linhas.length, importados: 0, ignorados: 0, avisos: [] };
            rel.push(r);
            if (vistos.has(a.conteudo)) {
                r.avisos.push('Arquivo repetido: já importado nesta mesma leva.');
                r.ignorados = r.lidos;
                continue;
            }
            vistos.add(a.conteudo);
            switch (a.tipo) {
                case 'vazio':
                    r.avisos.push('Arquivo vazio, nada para importar.');
                    break;
                case 'configuracoes':
                    this.configuracoes(a.linhas, r);
                    break;
                case 'clientes':
                    this.clientes(a.linhas, r);
                    break;
                case 'contratos':
                    this.contratos(a.linhas, r);
                    break;
                case 'cobrancas':
                    this.cobrancas(a.linhas, r);
                    break;
                case 'carnes':
                    await this.carnes(a.linhas, r);
                    break;
                case 'financeiro':
                    this.financeiro(a.linhas, r);
                    break;
                case 'veiculos':
                    r.avisos.push('Importação de veículos não é automática: cadastre-os por Registrar compra, para gerar o custo e a nota de entrada.');
                    r.ignorados = r.lidos;
                    break;
                default:
                    r.avisos.push('Formato de arquivo não reconhecido.');
                    r.ignorados = r.lidos;
            }
        }
        return rel;
    }
    configuracoes(linhas, r) {
        const e = this.b.one('SELECT * FROM empresa WHERE id = 1');
        for (const l of linhas) {
            if (l.key === 'store_name' && l.value && (!e.nome_fantasia || !e.razao_social)) {
                this.b.atualizar('empresa', 1, { nome_fantasia: e.nome_fantasia || l.value, razao_social: e.razao_social || l.value });
                r.importados++;
            }
            else if (l.key === 'whatsapp' && l.value && !e.whatsapp) {
                this.b.atualizar('empresa', 1, { whatsapp: soDigitos(l.value) });
                r.importados++;
            }
            else
                r.ignorados++;
        }
    }
    clientes(linhas, r) {
        this.b.tx(() => {
            for (const l of linhas) {
                const nome = t(l.name);
                if (!nome) {
                    r.ignorados++;
                    continue;
                }
                if (l.id && this.mapaClientes.has(l.id)) {
                    r.ignorados++;
                    continue;
                }
                const docBruto = limparDoc(l.cpf);
                const doc = docBruto && docValido(docBruto) ? docBruto : '';
                let obs = t(l.notes);
                if (docBruto && !doc) {
                    obs = [obs, `CPF/CNPJ do sistema anterior não confere: ${t(l.cpf)}`].filter(Boolean).join('\n');
                    r.avisos.push(`${nome}: CPF "${t(l.cpf)}" inválido; importado sem documento (anotado nas observações).`);
                }
                const existente = doc ? this.b.one('SELECT id FROM pessoas WHERE cpf_cnpj = ?', [doc]) : undefined;
                if (existente) {
                    this.mapaClientes.set(l.id, existente.id);
                    this.b.run('UPDATE pessoas SET origem_id = COALESCE(origem_id, ?) WHERE id = ?', [l.id, existente.id]);
                    r.ignorados++;
                    continue;
                }
                const id = this.b.inserir('pessoas', {
                    tipo: doc.length === 14 ? 'PJ' : 'PF', cpf_cnpj: doc || null, nome, telefone: soDigitos(l.phone), email: t(l.email).toLowerCase(),
                    logradouro: t(l.address), municipio: t(l.city), uf: uf(l.state), obs, cliente: 1, origem_id: l.id || null, criado_em: dataHora(l.created_date),
                });
                if (l.id)
                    this.mapaClientes.set(l.id, id);
                r.importados++;
            }
        });
    }
    contratos(linhas, r) {
        const mVenda = modeloContrato(this.b, 'venda'), mCompra = modeloContrato(this.b, 'compra');
        this.b.tx(() => {
            for (const l of linhas) {
                if (this.b.one('SELECT 1 FROM contratos WHERE origem_id = ? OR numero = ?', [l.id, t(l.number)])) {
                    r.ignorados++;
                    continue;
                }
                const tipo = l.contract_type === 'compra' || t(l.number).startsWith('CC') ? 'compra' : 'venda';
                const m = tipo === 'venda' ? mVenda : mCompra;
                const numeroC = t(l.number) || `${tipo === 'venda' ? 'CV' : 'CC'}-I${l.id.slice(-6)}`;
                const valor = r2(numero(l.amount));
                if (!valor)
                    r.avisos.push(`${numeroC} (${t(l.buyerName)}): valor zerado no sistema anterior.`);
                this.b.inserir('contratos', {
                    numero: numeroC, tipo, data: data10(l.date) || data10(l.created_date), cidade: t(l.city) || m.cidade,
                    pessoa_id: this.pessoaPor(l.client_id, l.buyerCPF), cliente_nome: t(l.buyerName) || 'Não informado',
                    cliente_doc: limparDoc(l.buyerCPF), cliente_rg: t(l.buyerRG), cliente_endereco: t(l.buyerAddress), cliente_telefone: soDigitos(l.buyerPhone),
                    loja_doc: limparDoc(l.sellerDoc) || m.loja_doc, loja_endereco: t(l.sellerAddress) || m.loja_endereco,
                    veiculo_marca: t(l.vehicleBrand), veiculo_modelo: t(l.vehicleModel), veiculo_ano: t(l.vehicleYear), veiculo_cor: t(l.vehicleColor),
                    veiculo_placa: limparDoc(l.vehiclePlate), veiculo_chassi: limparDoc(l.vehicleChassis), veiculo_km: soDigitos(l.km_atual),
                    valor, forma_pagamento: t(l.paymentMethod).replace(/^'/, ''), clausulas: t(l.clauses) || m.clausulas,
                    garantia_texto: t(l.warranty_text), obs: t(l.notes),
                    assinado_em: l.signed_at ? new Date(l.signed_at).toISOString() : null,
                    origem_id: l.id || null, criado_em: dataHora(l.created_date),
                });
                if (l.signature_url)
                    r.avisos.push(`${numeroC}: a imagem da assinatura do sistema anterior não foi copiada.`);
                r.importados++;
            }
        });
    }
    cobrancas(linhas, r) {
        this.b.tx(() => {
            for (const l of linhas) {
                if (this.b.one('SELECT 1 FROM cobrancas WHERE origem_id = ?', [l.id])) {
                    r.ignorados++;
                    continue;
                }
                const total = Math.max(1, Math.round(numero(l.total_installments, 1)));
                const pagas = Math.min(total, Math.max(0, Math.round(numero(l.paid_installments))));
                const valorParcela = r2(numero(l.installment_value));
                const primeiro = data10(l.start_date) || data10(l.created_date);
                if (!valorParcela || !primeiro) {
                    r.ignorados++;
                    r.avisos.push(`${t(l.client_name)}: sem valor ou data de início; não importado.`);
                    continue;
                }
                this.b.inserir('cobrancas', {
                    pessoa_id: this.pessoaPor(l.client_id, ''), cliente_nome: t(l.client_name), cliente_telefone: soDigitos(l.client_phone),
                    descricao: t(l.description) || 'Parcelamento', veiculo_info: t(l.vehicle_info),
                    valor_total: r2(numero(l.total_amount)) || r2(valorParcela * total), valor_parcela: valorParcela, total_parcelas: total,
                    parcelas_pagas: pagas, dia_vencimento: Number(primeiro.slice(8, 10)), primeiro_vencimento: primeiro, obs: t(l.notes),
                    origem_id: l.id || null, criado_em: dataHora(l.created_date),
                });
                r.importados++;
            }
        });
    }
    async carnes(linhas, r) {
        const pasta = join(this.pastaArquivos, 'carnes');
        for (const l of linhas) {
            if (this.b.one('SELECT 1 FROM carnes WHERE origem_id = ?', [l.id])) {
                r.ignorados++;
                continue;
            }
            let qr = '';
            if (l.pix_qr_code_url) {
                const arq = await baixarImagem(l.pix_qr_code_url, pasta, 'qr');
                qr = arq ? 'carnes/' + arq : l.pix_qr_code_url;
                if (!arq)
                    r.avisos.push(`${t(l.client_name)}: não foi possível baixar a imagem do QR Pix; ficou o link do sistema anterior.`);
            }
            // A primeira logo encontrada vira a logo da loja, se ainda não houver uma
            const e = this.b.one('SELECT logo FROM empresa WHERE id = 1');
            if (!e.logo && l.logo_url) {
                const logo = await baixarImagem(l.logo_url, this.pastaArquivos, 'logo');
                if (logo) {
                    this.b.atualizar('empresa', 1, { logo });
                    r.avisos.push('Logo da loja copiada do sistema anterior.');
                }
            }
            const total = Math.max(1, Math.round(numero(l.total_installments, 1)));
            const valorParcela = r2(numero(l.installment_value)) || r2(numero(l.total_amount) / total);
            const primeiro = data10(l.start_date) || data10(l.created_date);
            const doc = limparDoc(l.client_cpf);
            this.b.inserir('carnes', {
                pessoa_id: this.pessoaPor('', doc), cliente_nome: t(l.client_name), cliente_doc: /^0+$/.test(doc) ? '' : doc,
                cliente_nascimento: data10(l.client_birth_date), cliente_endereco: t(l.client_address),
                veiculo_tipo: ['moto', 'carro'].includes(l.vehicle_type) ? l.vehicle_type : 'carro', veiculo_marca: t(l.vehicle_brand),
                veiculo_modelo: t(l.vehicle_model), veiculo_placa: limparDoc(l.vehicle_plate), veiculo_chassi: limparDoc(l.vehicle_chassis),
                descricao: t(l.description), total_parcelas: total, valor_parcela: valorParcela, valor_total: r2(valorParcela * total),
                dia_vencimento: Number(primeiro.slice(8, 10)) || Math.round(numero(l.due_day, 1)), primeiro_vencimento: primeiro,
                forma_pagamento: ['pix', 'boleto', 'dinheiro', 'transferencia'].includes(l.payment_method) ? l.payment_method : 'pix',
                chave_pix: t(l.pix_key), qr_pix: qr, obs: t(l.notes), origem_id: l.id || null, criado_em: dataHora(l.created_date),
            });
            r.importados++;
        }
    }
    financeiro(linhas, r) {
        this.b.tx(() => {
            for (const l of linhas) {
                if (this.b.one('SELECT 1 FROM titulos WHERE origem_id = ?', [l.id])) {
                    r.ignorados++;
                    continue;
                }
                const valor = r2(numero(l.amount));
                const data = data10(l.date) || data10(l.created_date);
                if (!valor || !data) {
                    r.ignorados++;
                    continue;
                }
                const receita = /receita|entrada|income/i.test(l.type);
                this.b.inserir('titulos', {
                    tipo: receita ? 'receber' : 'pagar', descricao: [t(l.name), t(l.description)].filter(Boolean).join(' — ') || 'Lançamento importado',
                    categoria: (t(l.category) || 'outros').toLowerCase(), valor, vencimento: data, status: 'pago', pago_em: data, valor_pago: valor,
                    origem_id: l.id || null, criado_em: dataHora(l.created_date),
                });
                r.importados++;
            }
        });
    }
}
export function registrarImportacao(app, b, pastaArquivos) {
    app.post('/api/importar', async (req) => {
        const arquivos = Array.isArray(req.corpo.arquivos) ? req.corpo.arquivos : [];
        if (!arquivos.length)
            falhar('Selecione os arquivos CSV exportados do sistema anterior.');
        const lista = arquivos.map((a) => ({ nome: String(a.nome ?? 'arquivo.csv'), conteudo: String(a.conteudo ?? '') }));
        const rel = await new Importador(b, pastaArquivos).importar(lista);
        auditar(b, req.usuario.id, 'importar', 'importacao', undefined, rel.map((r) => ({ arquivo: r.arquivo, importados: r.importados })));
        return rel;
    });
}
