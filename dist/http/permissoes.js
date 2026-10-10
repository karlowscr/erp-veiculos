/**
 * Permissões por usuário. O administrador marca, para cada usuário, o que ele
 * pode fazer em cada área do sistema. Toda rota da API está nesta tabela: se
 * alguém criar uma rota nova e esquecer de declarar a permissão, o servidor
 * não sobe (ver `exigirCobertura`). Assim nada fica aberto por descuido.
 */
export const MODULOS = [
    { id: 'veiculos', nome: 'Veículos', acoes: [
            { id: 'ver', nome: 'Ver estoque' },
            { id: 'criar', nome: 'Cadastrar veículo', dica: 'Entrada pelo documento e compra rápida' },
            { id: 'editar', nome: 'Editar dados, fotos e preço' },
            { id: 'excluir', nome: 'Excluir veículo e fotos' },
            { id: 'custos', nome: 'Ver e lançar custos', dica: 'Sem esta permissão, o custo e a margem ficam ocultos' },
            { id: 'publicar', nome: 'Publicar no catálogo' },
        ] },
    { id: 'negociacoes', nome: 'Negociações', acoes: [
            { id: 'ver', nome: 'Ver negociações' },
            { id: 'ver_todas', nome: 'Ver vendas de outros vendedores' },
            { id: 'vender', nome: 'Registrar venda' },
            { id: 'comprar', nome: 'Registrar compra' },
            { id: 'consignar', nome: 'Consignação e devolução' },
            { id: 'abaixo_minimo', nome: 'Vender abaixo do preço mínimo' },
            { id: 'cancelar', nome: 'Cancelar negociação' },
        ] },
    { id: 'site', nome: 'Site (catálogo)', acoes: [
            { id: 'contatos', nome: 'Ver e atender contatos do site', dica: 'Pedidos de visita, troca e financiamento feitos no catálogo' },
            { id: 'mural', nome: 'Gerenciar o mural dos clientes', dica: 'Publicar, editar e excluir fotos do mural' },
        ] },
    { id: 'contratos', nome: 'Contratos', acoes: [
            { id: 'ver', nome: 'Ver e imprimir' },
            { id: 'criar', nome: 'Criar' },
            { id: 'editar', nome: 'Editar' },
            { id: 'assinar', nome: 'Colher assinatura do cliente' },
            { id: 'excluir', nome: 'Excluir e remover assinatura' },
        ] },
    { id: 'clientes', nome: 'Clientes', acoes: [
            { id: 'ver', nome: 'Ver' }, { id: 'criar', nome: 'Adicionar' }, { id: 'editar', nome: 'Editar' }, { id: 'excluir', nome: 'Excluir' },
        ] },
    { id: 'documentos', nome: 'Documentos', acoes: [
            { id: 'ver', nome: 'Ver' }, { id: 'criar', nome: 'Adicionar' }, { id: 'editar', nome: 'Editar' }, { id: 'excluir', nome: 'Excluir' },
        ] },
    { id: 'cobrancas', nome: 'Cobranças', acoes: [
            { id: 'ver', nome: 'Ver e imprimir' }, { id: 'criar', nome: 'Criar' },
            { id: 'editar', nome: 'Editar e registrar pagamento' }, { id: 'excluir', nome: 'Excluir e estornar pagamento' },
        ] },
    { id: 'carnes', nome: 'Carnês', acoes: [
            { id: 'ver', nome: 'Ver e imprimir' }, { id: 'criar', nome: 'Criar' }, { id: 'editar', nome: 'Editar' }, { id: 'excluir', nome: 'Excluir' },
        ] },
    { id: 'financeiro', nome: 'Financeiro', acoes: [
            { id: 'ver', nome: 'Ver contas e resumo' }, { id: 'lancar', nome: 'Lançar conta' },
            { id: 'baixar', nome: 'Registrar pagamento/recebimento' }, { id: 'estornar', nome: 'Estornar e cancelar' },
        ] },
    { id: 'comissoes', nome: 'Comissões', acoes: [
            { id: 'ver_todas', nome: 'Ver comissões de todos', dica: 'Sem esta permissão, cada um vê só as próprias' },
            { id: 'pagar', nome: 'Pagar comissões' },
        ] },
    { id: 'notas', nome: 'Notas fiscais', acoes: [
            { id: 'ver', nome: 'Ver, DANFE e XML' }, { id: 'emitir', nome: 'Emitir e carta de correção' }, { id: 'cancelar', nome: 'Cancelar nota' },
        ] },
    { id: 'renave', nome: 'RENAVE', acoes: [
            { id: 'ver', nome: 'Ver e consultar' }, { id: 'operar', nome: 'Registrar entrada e saída' }, { id: 'cancelar', nome: 'Cancelar registro' },
        ] },
    { id: 'config', nome: 'Configurações', acoes: [
            { id: 'ver', nome: 'Ver configurações e regras fiscais' },
            { id: 'editar', nome: 'Alterar loja, certificado, logo e importar dados' },
        ] },
    { id: 'usuarios', nome: 'Usuários', acoes: [
            { id: 'gerenciar', nome: 'Criar usuários e definir permissões', dica: 'Dê só a quem é de total confiança' },
        ] },
];
export const TODAS = MODULOS.flatMap((m) => m.acoes.map((a) => `${m.id}.${a.id}`));
const VALIDAS = new Set(TODAS);
export const permissaoValida = (p) => VALIDAS.has(p);
/** Modelos para preencher rápido; o administrador ajusta depois, item por item. */
export const MODELOS = {
    gerente: { nome: 'Gerente', permissoes: TODAS.filter((p) => !['usuarios.gerenciar', 'config.editar'].includes(p)) },
    vendedor: { nome: 'Vendedor', permissoes: [
            'veiculos.ver', 'negociacoes.ver', 'negociacoes.vender', 'negociacoes.consignar', 'site.contatos',
            'contratos.ver', 'contratos.criar', 'contratos.editar', 'contratos.assinar',
            'clientes.ver', 'clientes.criar', 'clientes.editar', 'documentos.ver', 'documentos.criar', 'carnes.ver', 'carnes.criar',
        ] },
    financeiro: { nome: 'Financeiro', permissoes: [
            'veiculos.ver', 'veiculos.custos', 'negociacoes.ver', 'negociacoes.ver_todas', 'contratos.ver',
            'financeiro.ver', 'financeiro.lancar', 'financeiro.baixar', 'financeiro.estornar', 'comissoes.ver_todas', 'comissoes.pagar',
            'cobrancas.ver', 'cobrancas.criar', 'cobrancas.editar', 'carnes.ver', 'carnes.criar', 'carnes.editar',
            'clientes.ver', 'clientes.criar', 'clientes.editar', 'documentos.ver', 'documentos.criar', 'documentos.editar',
            'notas.ver', 'notas.emitir', 'renave.ver', 'renave.operar', 'config.ver',
        ] },
};
const SELECIONAR_CLIENTE = ['clientes.ver', 'negociacoes.vender', 'negociacoes.comprar', 'negociacoes.consignar', 'contratos.criar', 'contratos.editar', 'cobrancas.criar', 'cobrancas.editar', 'carnes.criar', 'carnes.editar', 'documentos.criar', 'documentos.editar'];
const SELECIONAR_VEICULO = ['veiculos.ver', 'negociacoes.vender', 'contratos.criar', 'contratos.editar', 'carnes.criar', 'carnes.editar'];
export const ROTAS = {
    'GET /api/me': 'livre',
    'POST /api/me/senha': 'livre',
    'POST /api/me/2fa/iniciar': 'livre',
    'POST /api/me/2fa/ativar': 'livre',
    'POST /api/me/2fa/desativar': 'livre',
    'GET /api/painel': 'livre',
    'GET /api/contadores': 'livre',
    'GET /api/empresa': 'livre',
    'GET /api/usuarios/vendedores': 'livre',
    'GET /api/comissoes': 'livre',
    'GET /api/usuarios': 'usuarios.gerenciar',
    'GET /api/usuarios/permissoes': 'usuarios.gerenciar',
    'POST /api/usuarios': 'usuarios.gerenciar',
    'PUT /api/usuarios/:id': 'usuarios.gerenciar',
    'POST /api/usuarios/:id/encerrar-sessoes': 'usuarios.gerenciar',
    'GET /api/auditoria': 'usuarios.gerenciar',
    'GET /api/site/contatos': 'site.contatos',
    'GET /api/mural': 'site.mural',
    'POST /api/mural': 'site.mural',
    'PUT /api/mural/:id': 'site.mural',
    'DELETE /api/mural/:id': 'site.mural',
    'POST /api/site/contatos/:id/atendido': 'site.contatos',
    'GET /api/pessoas': SELECIONAR_CLIENTE,
    'GET /api/pessoas/:id': SELECIONAR_CLIENTE,
    'POST /api/pessoas': 'clientes.criar',
    'PUT /api/pessoas/:id': 'clientes.editar',
    'DELETE /api/pessoas/:id': 'clientes.excluir',
    'GET /api/veiculos': SELECIONAR_VEICULO,
    'GET /api/veiculos/:id': SELECIONAR_VEICULO,
    'PUT /api/veiculos/:id': 'veiculos.editar',
    'DELETE /api/veiculos/:id': 'veiculos.excluir',
    'POST /api/veiculos/:id/reserva': ['veiculos.editar', 'negociacoes.vender'],
    'POST /api/veiculos/:id/custos': 'veiculos.custos',
    'DELETE /api/veiculos/:id/custos/:custoId': 'veiculos.custos',
    'POST /api/veiculos/:id/fotos': 'veiculos.editar',
    'PUT /api/veiculos/:id/fotos/ordem': 'veiculos.editar',
    'DELETE /api/veiculos/:id/fotos/:fotoId': 'veiculos.excluir',
    'POST /api/veiculos/:id/catalogo': 'veiculos.publicar',
    'POST /api/veiculos/:id/fipe': ['veiculos.editar', 'veiculos.criar'],
    'POST /api/veiculos/ler-documento': 'veiculos.criar',
    'POST /api/veiculos/entrada': 'veiculos.criar',
    'GET /api/fipe/marcas': SELECIONAR_VEICULO,
    'GET /api/fipe/modelos': SELECIONAR_VEICULO,
    'GET /api/fipe/anos': SELECIONAR_VEICULO,
    'GET /api/fipe/preco': SELECIONAR_VEICULO,
    'GET /api/fipe/buscar': SELECIONAR_VEICULO,
    'GET /api/negociacoes': 'negociacoes.ver',
    'GET /api/negociacoes/:id': 'negociacoes.ver',
    'POST /api/negociacoes/compra': 'negociacoes.comprar',
    'POST /api/negociacoes/consignacao': 'negociacoes.consignar',
    'POST /api/negociacoes/venda': 'negociacoes.vender',
    'POST /api/negociacoes/devolucao-consignacao': 'negociacoes.consignar',
    'POST /api/negociacoes/:id/cancelar': 'negociacoes.cancelar',
    'POST /api/negociacoes/:id/contrato': 'contratos.criar',
    'GET /api/contratos/modelo': ['contratos.criar', 'contratos.editar'],
    'GET /api/contratos': ['contratos.ver', 'contratos.assinar'],
    'GET /api/contratos/:id': ['contratos.ver', 'contratos.assinar'],
    'POST /api/contratos': 'contratos.criar',
    'PUT /api/contratos/:id': 'contratos.editar',
    'DELETE /api/contratos/:id': 'contratos.excluir',
    'POST /api/contratos/:id/assinar': 'contratos.assinar',
    'POST /api/contratos/:id/remover-assinatura': 'contratos.excluir',
    'GET /api/contratos/:id/imprimir': ['contratos.ver', 'contratos.assinar'],
    'GET /api/contratos/:id/garantia': ['contratos.ver', 'contratos.assinar'],
    'GET /api/documentos/tipos': ['documentos.ver', 'documentos.criar'],
    'GET /api/documentos': 'documentos.ver',
    'GET /api/documentos/:id': 'documentos.ver',
    'POST /api/documentos': 'documentos.criar',
    'PUT /api/documentos/:id': 'documentos.editar',
    'DELETE /api/documentos/:id': 'documentos.excluir',
    'GET /api/cobrancas': 'cobrancas.ver',
    'GET /api/cobrancas/relatorio': 'cobrancas.ver',
    'GET /api/cobrancas/:id': 'cobrancas.ver',
    'GET /api/cobrancas/:id/imprimir': 'cobrancas.ver',
    'POST /api/cobrancas': 'cobrancas.criar',
    'PUT /api/cobrancas/:id': 'cobrancas.editar',
    'POST /api/cobrancas/:id/pagar': 'cobrancas.editar',
    'POST /api/cobrancas/:id/estornar': 'cobrancas.excluir',
    'DELETE /api/cobrancas/:id': 'cobrancas.excluir',
    'GET /api/cobrancas/:id/recibo/:pagamentoId': 'cobrancas.ver',
    'GET /api/carnes': 'carnes.ver',
    'GET /api/carnes/:id': 'carnes.ver',
    'GET /api/carnes/:id/imprimir': 'carnes.ver',
    'POST /api/carnes': 'carnes.criar',
    'PUT /api/carnes/:id': 'carnes.editar',
    'DELETE /api/carnes/:id': 'carnes.excluir',
    'GET /api/titulos': 'financeiro.ver',
    'POST /api/titulos': 'financeiro.lancar',
    'POST /api/titulos/:id/baixar': 'financeiro.baixar',
    'POST /api/titulos/:id/estornar': 'financeiro.estornar',
    'POST /api/titulos/:id/cancelar': 'financeiro.estornar',
    'GET /api/titulos/:id/recibo': ['financeiro.ver', 'cobrancas.ver'],
    'GET /api/financeiro/resumo': 'financeiro.ver',
    'POST /api/comissoes/pagar': 'comissoes.pagar',
    'PUT /api/empresa': 'config.editar',
    'POST /api/empresa/certificado': 'config.editar',
    'POST /api/empresa/logo': 'config.editar',
    'DELETE /api/empresa/logo': 'config.editar',
    'POST /api/empresa/assinatura': 'config.editar',
    'GET /api/perfis-fiscais': 'config.ver',
    'PUT /api/perfis-fiscais/:id': 'config.editar',
    'POST /api/importar': 'config.editar',
    'GET /api/nfes': 'notas.ver',
    'GET /api/nfes/:id': 'notas.ver',
    'GET /api/negociacoes/:id/nfe/previa': 'notas.emitir',
    'POST /api/negociacoes/:id/nfe': 'notas.emitir',
    'POST /api/nfes/:id/transmitir': 'notas.emitir',
    'POST /api/nfes/:id/consultar': 'notas.ver',
    'POST /api/nfes/:id/cancelar': 'notas.cancelar',
    'POST /api/nfes/:id/carta-correcao': 'notas.emitir',
    'GET /api/nfes/:id/xml': 'notas.ver',
    'GET /api/nfes/:id/eventos/:eid/xml': 'notas.ver',
    'GET /api/nfes/:id/danfe': 'notas.ver',
    'GET /api/sefaz/status': 'notas.ver',
    'GET /api/renave/operacoes': 'renave.ver',
    'GET /api/renave/pendencias': 'renave.ver',
    'POST /api/veiculos/:id/renave/entrada': 'renave.operar',
    'POST /api/negociacoes/:id/renave/saida': 'renave.operar',
    'POST /api/veiculos/:id/renave/cancelar': 'renave.cancelar',
    'POST /api/veiculos/:id/renave/consultar': 'renave.ver',
};
for (const [rota, regra] of Object.entries(ROTAS)) {
    for (const p of regra === 'livre' ? [] : Array.isArray(regra) ? regra : [regra]) {
        if (!VALIDAS.has(p))
            throw new Error(`Permissão desconhecida "${p}" na rota ${rota}`);
    }
}
export function regraDaRota(metodo, padrao) {
    return ROTAS[`${metodo} ${padrao}`];
}
export function tem(u, ...perms) {
    if (!u)
        return false;
    if (u.admin)
        return true;
    return perms.some((p) => u.permissoes.has(p));
}
export function autorizado(u, regra) {
    if (regra === 'livre')
        return true;
    return tem(u, ...(Array.isArray(regra) ? regra : [regra]));
}
/** Converte o texto guardado no banco em conjunto de permissões válidas. */
export function lerPermissoes(json) {
    try {
        const lista = JSON.parse(json || '[]');
        return new Set((Array.isArray(lista) ? lista : []).filter((p) => typeof p === 'string' && VALIDAS.has(p)));
    }
    catch {
        return new Set();
    }
}
