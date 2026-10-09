import { tem } from '../http/permissoes.js';
import { falhar, texto, numero, r2, hoje, somarMeses, parcelar } from '../util/comum.js';
import { validarVeiculo, custoTotal } from './veiculos.js';
import { auditar } from './auth.js';
/** Formas que entram no caixa na hora (título já nasce pago). */
const A_VISTA = ['dinheiro', 'pix', 'cartao_debito', 'transferencia'];
const FORMAS = [...A_VISTA, 'cartao_credito', 'financiamento', 'boleto', 'promissoria', 'cheque'];
function lerPagamentos(lista, data) {
    if (!Array.isArray(lista))
        return [];
    return lista.map((p) => {
        const forma = texto(p.forma);
        if (!FORMAS.includes(forma))
            falhar(`Forma de pagamento inválida: ${forma || '(vazia)'}.`);
        const valor = r2(numero(p.valor));
        if (valor <= 0)
            falhar('Valor de pagamento deve ser maior que zero.');
        const parcelas = Math.max(1, Math.min(120, Math.round(numero(p.parcelas, 1))));
        const padraoVenc = A_VISTA.includes(forma) ? data : somarMeses(data, 1);
        return { forma, valor, parcelas, primeiro_vencimento: texto(p.primeiro_vencimento) || padraoVenc, pessoa_id: p.pessoa_id ? numero(p.pessoa_id) : null };
    });
}
/** Gera os títulos (a receber ou a pagar) de cada forma de pagamento. */
function gerarTitulos(b, tipo, negId, pessoaId, veiculoId, descricao, categoria, pags, data) {
    for (const p of pags) {
        const valores = parcelar(p.valor, p.parcelas);
        valores.forEach((valor, i) => {
            const pago = A_VISTA.includes(p.forma);
            b.inserir('titulos', {
                tipo, descricao: p.parcelas > 1 ? `${descricao} (${i + 1}/${p.parcelas})` : descricao, categoria,
                pessoa_id: p.pessoa_id ?? pessoaId, negociacao_id: negId, veiculo_id: veiculoId, forma: p.forma, valor,
                vencimento: somarMeses(p.primeiro_vencimento, i), parcela: i + 1, total_parcelas: p.parcelas,
                status: pago ? 'pago' : 'aberto', pago_em: pago ? data : null, valor_pago: pago ? valor : null,
            });
        });
    }
}
function exigirPessoa(b, id) {
    return b.one('SELECT * FROM pessoas WHERE id = ?', [numero(id)]) ?? falhar('Selecione uma pessoa cadastrada.');
}
const rotulo = (v) => `${v.marca} ${v.modelo} ${v.ano_fab}/${v.ano_mod}${v.placa ? ' ' + v.placa : ''}`;
/** Cadastra um veículo que está entrando no estoque. */
export function inserirVeiculo(b, dados, extra) {
    const v = validarVeiculo(dados);
    const existente = b.one('SELECT id, situacao FROM veiculos WHERE chassi = ?', [v.chassi]);
    if (existente) {
        // Recompra de um veículo que já passou pela loja: reaproveita o cadastro
        if (existente.situacao === 'estoque' || existente.situacao === 'reservado')
            falhar('Este chassi já está no estoque.');
        b.atualizar('veiculos', existente.id, { ...v, ...extra, situacao: 'estoque', data_saida: null, renave_status: 'pendente', renave_id: '' });
        return existente.id;
    }
    return b.inserir('veiculos', { ...v, ...extra, situacao: 'estoque' });
}
export function comprar(b, u, c) {
    const pessoa = exigirPessoa(b, c.pessoa_id);
    const valor = r2(numero(c.valor));
    if (valor <= 0)
        falhar('Informe o valor da compra.');
    const data = texto(c.data) || hoje();
    const pags = lerPagamentos(c.pagamentos, data);
    const totalPags = r2(pags.reduce((s, p) => s + p.valor, 0));
    if (pags.length && totalPags !== valor)
        falhar(`A soma dos pagamentos (R$ ${totalPags.toFixed(2)}) difere do valor da compra.`);
    return b.tx(() => {
        const veiculoId = inserirVeiculo(b, c.veiculo ?? {}, {
            origem: c.veiculo?.condicao === 'novo' ? 'montadora' : 'compra', preco_compra: valor, data_entrada: data, proprietario_id: null,
        });
        const v = b.one('SELECT * FROM veiculos WHERE id = ?', [veiculoId]);
        const negId = b.inserir('negociacoes', {
            tipo: 'compra', veiculo_id: veiculoId, pessoa_id: pessoa.id, data, valor, valor_final: valor,
            km_entrega: v.km, obs: texto(c.obs), criado_por: u.id,
        });
        for (const p of pags)
            b.inserir('negociacao_pagamentos', { negociacao_id: negId, ...p });
        if (pags.length) {
            gerarTitulos(b, 'pagar', negId, pessoa.id, veiculoId, `Compra ${rotulo(v)}`, 'compra_veiculo', pags, data);
        }
        else {
            b.inserir('titulos', {
                tipo: 'pagar', descricao: `Compra ${rotulo(v)}`, categoria: 'compra_veiculo', pessoa_id: pessoa.id,
                negociacao_id: negId, veiculo_id: veiculoId, valor, vencimento: data,
            });
        }
        auditar(b, u.id, 'compra', 'negociacoes', negId);
        return negId;
    });
}
export function consignar(b, u, c) {
    const pessoa = exigirPessoa(b, c.pessoa_id);
    const valor = r2(numero(c.valor_repasse));
    if (valor <= 0)
        falhar('Informe o valor líquido combinado com o proprietário.');
    const data = texto(c.data) || hoje();
    return b.tx(() => {
        const veiculoId = inserirVeiculo(b, c.veiculo ?? {}, { origem: 'consignacao', preco_compra: 0, proprietario_id: pessoa.id, data_entrada: data });
        const negId = b.inserir('negociacoes', {
            tipo: 'consignacao', veiculo_id: veiculoId, pessoa_id: pessoa.id, data, valor, valor_final: valor,
            repasse_valor: valor, km_entrega: numero(c.veiculo?.km), obs: texto(c.obs), criado_por: u.id,
        });
        auditar(b, u.id, 'consignacao', 'negociacoes', negId);
        return negId;
    });
}
export function devolverConsignacao(b, u, c) {
    const v = b.one('SELECT * FROM veiculos WHERE id = ?', [numero(c.veiculo_id)]) ?? falhar('Veículo não encontrado.');
    if (v.origem !== 'consignacao')
        falhar('Este veículo não é consignado.');
    if (!['estoque', 'reservado'].includes(v.situacao))
        falhar('Veículo não está no estoque.');
    const data = texto(c.data) || hoje();
    return b.tx(() => {
        const negId = b.inserir('negociacoes', {
            tipo: 'devolucao_consignacao', veiculo_id: v.id, pessoa_id: v.proprietario_id, data, valor: 0, valor_final: 0,
            km_entrega: numero(c.km, v.km), obs: texto(c.obs), criado_por: u.id,
        });
        b.run("UPDATE veiculos SET situacao = 'devolvido', data_saida = ? WHERE id = ?", [data, v.id]);
        auditar(b, u.id, 'devolucao_consignacao', 'negociacoes', negId);
        return negId;
    });
}
export function vender(b, u, c) {
    const v = b.one('SELECT * FROM veiculos WHERE id = ?', [numero(c.veiculo_id)]) ?? falhar('Selecione o veículo.');
    if (!['estoque', 'reservado'].includes(v.situacao))
        falhar('Este veículo não está disponível para venda.');
    const cliente = exigirPessoa(b, c.pessoa_id);
    const data = texto(c.data) || hoje();
    const valor = r2(numero(c.valor));
    const desconto = r2(numero(c.desconto));
    if (valor <= 0)
        falhar('Informe o valor de venda.');
    if (desconto < 0 || desconto >= valor)
        falhar('Desconto inválido.');
    const valorFinal = r2(valor - desconto);
    const vendedorId = c.vendedor_id ? numero(c.vendedor_id) : u.id;
    const vendedor = b.one('SELECT * FROM usuarios WHERE id = ? AND ativo = 1', [vendedorId]) ?? falhar('Vendedor inválido.');
    const empresa = b.one('SELECT * FROM empresa WHERE id = 1');
    // Abaixo do preço mínimo só gerente/admin autoriza
    if (v.preco_minimo > 0 && valorFinal < v.preco_minimo && !tem(u, 'negociacoes.abaixo_minimo')) {
        falhar(`Valor abaixo do preço mínimo (R$ ${v.preco_minimo.toFixed(2)}). Peça a um gerente para registrar a venda.`);
    }
    const troca = c.troca && c.troca.veiculo ? c.troca : null;
    const valorTroca = troca ? r2(numero(troca.valor)) : 0;
    if (troca && valorTroca <= 0)
        falhar('Informe o valor de avaliação do veículo na troca.');
    if (valorTroca > valorFinal)
        falhar('O valor da troca não pode ser maior que o valor da venda.');
    const pags = lerPagamentos(c.pagamentos, data);
    const totalPags = r2(pags.reduce((s, p) => s + p.valor, 0));
    if (r2(totalPags + valorTroca) !== valorFinal) {
        falhar(`Pagamentos (R$ ${totalPags.toFixed(2)}) + troca (R$ ${valorTroca.toFixed(2)}) devem somar o valor final (R$ ${valorFinal.toFixed(2)}).`);
    }
    for (const p of pags)
        if (p.forma === 'financiamento' && !p.pessoa_id)
            falhar('No financiamento, selecione o banco/financeira (cadastrado como pessoa jurídica).');
    const comissaoPct = c.comissao_pct !== undefined && c.comissao_pct !== '' ? numero(c.comissao_pct) : (vendedor.comissao_pct ?? empresa.comissao_padrao_pct);
    const comissaoValor = r2(valorFinal * comissaoPct / 100);
    let repasse = 0;
    if (v.origem === 'consignacao') {
        const acordo = b.one("SELECT repasse_valor FROM negociacoes WHERE veiculo_id = ? AND tipo = 'consignacao' AND status = 'concluida' ORDER BY id DESC LIMIT 1", [v.id]);
        repasse = c.repasse_valor !== undefined && c.repasse_valor !== '' ? r2(numero(c.repasse_valor)) : (acordo?.repasse_valor ?? 0);
        if (repasse <= 0)
            falhar('Informe o valor de repasse ao proprietário do veículo consignado.');
    }
    return b.tx(() => {
        let trocaId = null;
        if (troca) {
            trocaId = inserirVeiculo(b, troca.veiculo, { origem: 'troca', preco_compra: valorTroca, data_entrada: data, proprietario_id: null });
            const vt = b.one('SELECT * FROM veiculos WHERE id = ?', [trocaId]);
            // A troca é registrada como uma compra quitada pelo abatimento na venda
            const negTroca = b.inserir('negociacoes', {
                tipo: 'compra', veiculo_id: trocaId, pessoa_id: cliente.id, data, valor: valorTroca, valor_final: valorTroca,
                km_entrega: vt.km, obs: `Recebido na troca da venda do veículo ${rotulo(v)}`, criado_por: u.id,
            });
            b.inserir('negociacao_pagamentos', { negociacao_id: negTroca, forma: 'troca', valor: valorTroca, parcelas: 1, primeiro_vencimento: data });
        }
        const negId = b.inserir('negociacoes', {
            tipo: 'venda', veiculo_id: v.id, pessoa_id: cliente.id, vendedor_id: vendedor.id, data, valor, desconto,
            valor_final: valorFinal, troca_veiculo_id: trocaId, valor_troca: valorTroca, km_entrega: numero(c.km_entrega, v.km),
            comissao_pct: comissaoPct, comissao_valor: comissaoValor, repasse_valor: repasse, obs: texto(c.obs), criado_por: u.id,
        });
        for (const p of pags)
            b.inserir('negociacao_pagamentos', { negociacao_id: negId, ...p });
        if (troca)
            b.inserir('negociacao_pagamentos', { negociacao_id: negId, forma: 'troca', valor: valorTroca, parcelas: 1, primeiro_vencimento: data });
        gerarTitulos(b, 'receber', negId, cliente.id, v.id, `Venda ${rotulo(v)}`, 'venda_veiculo', pags, data);
        if (repasse > 0) {
            b.inserir('titulos', {
                tipo: 'pagar', descricao: `Repasse consignação ${rotulo(v)}`, categoria: 'repasse_consignacao',
                pessoa_id: v.proprietario_id, negociacao_id: negId, veiculo_id: v.id, valor: repasse,
                vencimento: texto(c.repasse_vencimento) || data,
            });
        }
        if (comissaoValor > 0)
            b.inserir('comissoes', { usuario_id: vendedor.id, negociacao_id: negId, valor: comissaoValor });
        b.run("UPDATE veiculos SET situacao = 'vendido', data_saida = ?, km = ? WHERE id = ?", [data, numero(c.km_entrega, v.km), v.id]);
        auditar(b, u.id, 'venda', 'negociacoes', negId, { valorFinal });
        return negId;
    });
}
export function cancelarNegociacao(b, u, id, motivo) {
    const n = b.one('SELECT * FROM negociacoes WHERE id = ?', [id]) ?? falhar('Negociação não encontrada.', 404);
    if (n.status === 'cancelada')
        falhar('Negociação já cancelada.');
    if (!motivo || motivo.length < 5)
        falhar('Informe o motivo do cancelamento.');
    const nfe = b.one("SELECT numero FROM nfes WHERE negociacao_id = ? AND status = 'autorizada'", [id]);
    if (nfe)
        falhar(`Cancele antes a NF-e nº ${nfe.numero} desta negociação.`);
    const pagos = b.one("SELECT COUNT(*) AS q FROM titulos WHERE negociacao_id = ? AND status = 'pago' AND forma NOT IN ('dinheiro','pix','cartao_debito','transferencia')", [id]);
    if (pagos.q > 0)
        falhar('Há títulos já baixados nesta negociação. Estorne-os no financeiro antes de cancelar.');
    const v = b.one('SELECT * FROM veiculos WHERE id = ?', [n.veiculo_id]);
    b.tx(() => {
        if (n.tipo === 'venda') {
            if (v.renave_status === 'saida')
                falhar('A saída deste veículo já foi registrada no RENAVE. Cancele a saída no RENAVE antes.');
            if (n.troca_veiculo_id) {
                const vt = b.one('SELECT * FROM veiculos WHERE id = ?', [n.troca_veiculo_id]);
                if (!['estoque', 'reservado'].includes(vt.situacao))
                    falhar('O veículo recebido na troca já foi vendido; não é possível cancelar automaticamente.');
                if (vt.renave_status === 'em_estoque')
                    falhar('O veículo da troca já deu entrada no RENAVE. Cancele essa entrada antes.');
                const negTroca = b.one("SELECT id FROM negociacoes WHERE veiculo_id = ? AND tipo = 'compra' AND status = 'concluida' ORDER BY id DESC LIMIT 1", [vt.id]);
                if (negTroca)
                    b.run("UPDATE negociacoes SET status = 'cancelada', obs = obs || ? WHERE id = ?", [` | Cancelada junto com a venda ${id}`, negTroca.id]);
                b.run("UPDATE veiculos SET situacao = 'devolvido', data_saida = ? WHERE id = ?", [hoje(), vt.id]);
            }
            b.run("UPDATE veiculos SET situacao = 'estoque', data_saida = NULL WHERE id = ?", [v.id]);
            const comPaga = b.one("SELECT 1 FROM comissoes WHERE negociacao_id = ? AND status = 'paga'", [id]);
            if (comPaga)
                falhar('A comissão desta venda já foi paga. Estorne a comissão antes.');
            b.run("UPDATE comissoes SET status = 'cancelada' WHERE negociacao_id = ?", [id]);
        }
        else if (n.tipo === 'compra' || n.tipo === 'consignacao') {
            if (!['estoque', 'reservado'].includes(v.situacao))
                falhar('O veículo já saiu do estoque; não é possível cancelar a entrada.');
            if (v.renave_status === 'em_estoque')
                falhar('O veículo já deu entrada no RENAVE. Cancele essa entrada antes.');
            b.run("UPDATE veiculos SET situacao = 'devolvido', data_saida = ? WHERE id = ?", [hoje(), v.id]);
        }
        else if (n.tipo === 'devolucao_consignacao') {
            b.run("UPDATE veiculos SET situacao = 'estoque', data_saida = NULL WHERE id = ?", [v.id]);
        }
        // Títulos à vista que nasceram pagos são estornados junto
        b.run("UPDATE titulos SET status = 'cancelado' WHERE negociacao_id = ? AND status IN ('aberto','pago')", [id]);
        b.run("UPDATE negociacoes SET status = 'cancelada', obs = obs || ? WHERE id = ?", [` | Cancelada: ${motivo}`, id]);
        auditar(b, u.id, 'cancelar', 'negociacoes', id, { motivo });
    });
}
export function registrarNegociacoes(app, b) {
    app.get('/api/negociacoes', (req) => {
        const where = [];
        const p = [];
        const tipo = req.query.get('tipo');
        if (tipo) {
            where.push('n.tipo = ?');
            p.push(tipo);
        }
        const de = req.query.get('de'), ate = req.query.get('ate');
        if (de) {
            where.push('n.data >= ?');
            p.push(de);
        }
        if (ate) {
            where.push('n.data <= ?');
            p.push(ate);
        }
        if (!tem(req.usuario, 'negociacoes.ver_todas')) {
            where.push("(n.vendedor_id = ? OR n.tipo <> 'venda')");
            p.push(req.usuario.id);
        }
        return b.all(`SELECT n.id, n.tipo, n.data, n.valor_final, n.status, n.comissao_valor, v.marca, v.modelo, v.placa, v.ano_mod,
              p.nome AS pessoa_nome, u.nome AS vendedor_nome,
              (SELECT status FROM nfes WHERE negociacao_id = n.id ORDER BY id DESC LIMIT 1) AS nfe_status
       FROM negociacoes n JOIN veiculos v ON v.id = n.veiculo_id JOIN pessoas p ON p.id = n.pessoa_id
       LEFT JOIN usuarios u ON u.id = n.vendedor_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY n.data DESC, n.id DESC LIMIT 500`, p);
    });
    app.get('/api/negociacoes/:id', (req) => {
        const id = Number(req.params.id);
        const n = b.one(`SELECT n.*, p.nome AS pessoa_nome, p.cpf_cnpj AS pessoa_doc, u.nome AS vendedor_nome FROM negociacoes n
       JOIN pessoas p ON p.id = n.pessoa_id LEFT JOIN usuarios u ON u.id = n.vendedor_id WHERE n.id = ?`, [id]) ?? falhar('Negociação não encontrada.', 404);
        const veiculo = b.one('SELECT * FROM veiculos WHERE id = ?', [n.veiculo_id]);
        const custo = custoTotal(b, n.veiculo_id);
        const resultado = n.tipo === 'venda'
            ? r2(n.valor_final - (veiculo.origem === 'consignacao' ? n.repasse_valor + custo : custo) - n.comissao_valor)
            : null;
        return {
            ...n, veiculo,
            troca: n.troca_veiculo_id ? b.one('SELECT id, marca, modelo, placa, ano_mod FROM veiculos WHERE id = ?', [n.troca_veiculo_id]) : null,
            pagamentos: b.all('SELECT * FROM negociacao_pagamentos WHERE negociacao_id = ?', [id]),
            titulos: b.all('SELECT * FROM titulos WHERE negociacao_id = ? ORDER BY tipo, vencimento', [id]),
            nfes: b.all('SELECT id, numero, serie, chave, status, cstat, xmotivo, tipo_nf, perfil_codigo, emitida_em FROM nfes WHERE negociacao_id = ? ORDER BY id', [id]),
            custo_veiculo: custo, resultado,
        };
    });
    app.post('/api/negociacoes/compra', (req) => ({ id: comprar(b, req.usuario, req.corpo) }));
    app.post('/api/negociacoes/consignacao', (req) => ({ id: consignar(b, req.usuario, req.corpo) }));
    app.post('/api/negociacoes/venda', (req) => ({ id: vender(b, req.usuario, req.corpo) }));
    app.post('/api/negociacoes/devolucao-consignacao', (req) => ({ id: devolverConsignacao(b, req.usuario, req.corpo) }));
    app.post('/api/negociacoes/:id/cancelar', (req) => {
        cancelarNegociacao(b, req.usuario, Number(req.params.id), texto(req.corpo.motivo));
        return { ok: true };
    });
}
