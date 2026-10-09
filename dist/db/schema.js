/**
 * Esquema do banco de dados. Cada item do array é uma migração aplicada
 * uma única vez, na ordem. Nunca altere uma migração já publicada:
 * acrescente uma nova no final.
 */
import { MODELOS } from '../http/permissoes.js';
/** Permissões dadas aos usuários que já existiam quando a migração 5 foi aplicada (cópia fixa). */
const PERMISSOES_INICIAIS = { gerente: MODELOS.gerente.permissoes, vendedor: MODELOS.vendedor.permissoes, financeiro: MODELOS.financeiro.permissoes };
export const MIGRACOES = [
    /* 1 — estrutura inicial */ `
  CREATE TABLE empresa (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cnpj TEXT NOT NULL DEFAULT '',
    razao_social TEXT NOT NULL DEFAULT '',
    nome_fantasia TEXT NOT NULL DEFAULT '',
    ie TEXT NOT NULL DEFAULT '',
    crt INTEGER NOT NULL DEFAULT 1,             -- 1 Simples Nacional, 2 Simples excesso, 3 Regime normal, 4 MEI
    logradouro TEXT NOT NULL DEFAULT '',
    numero TEXT NOT NULL DEFAULT '',
    complemento TEXT NOT NULL DEFAULT '',
    bairro TEXT NOT NULL DEFAULT '',
    cod_municipio TEXT NOT NULL DEFAULT '',      -- código IBGE (7 dígitos)
    municipio TEXT NOT NULL DEFAULT '',
    uf TEXT NOT NULL DEFAULT 'CE',
    cep TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    nfe_ambiente INTEGER NOT NULL DEFAULT 2,     -- 1 produção, 2 homologação
    nfe_serie INTEGER NOT NULL DEFAULT 1,
    nfe_proximo_numero INTEGER NOT NULL DEFAULT 1,
    cert_arquivo TEXT NOT NULL DEFAULT '',
    cert_senha TEXT NOT NULL DEFAULT '',
    cert_validade TEXT NOT NULL DEFAULT '',
    cert_titular TEXT NOT NULL DEFAULT '',
    resp_tec_cnpj TEXT NOT NULL DEFAULT '',
    resp_tec_contato TEXT NOT NULL DEFAULT '',
    resp_tec_email TEXT NOT NULL DEFAULT '',
    resp_tec_fone TEXT NOT NULL DEFAULT '',
    ibscbs_ativo INTEGER NOT NULL DEFAULT 0,
    renave_modo TEXT NOT NULL DEFAULT 'simulado', -- simulado | homologacao | producao
    renave_url_base TEXT NOT NULL DEFAULT '',
    comissao_padrao_pct REAL NOT NULL DEFAULT 1,
    consignacao_taxa_pct REAL NOT NULL DEFAULT 8
  );
  INSERT INTO empresa (id) VALUES (1);

  CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    senha_hash TEXT NOT NULL,
    perfil TEXT NOT NULL CHECK (perfil IN ('admin','gerente','vendedor','financeiro')),
    comissao_pct REAL,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessoes (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    expira_em TEXT NOT NULL
  );

  CREATE TABLE pessoas (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('PF','PJ')),
    cpf_cnpj TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    ie TEXT NOT NULL DEFAULT '',
    ind_ie_dest INTEGER NOT NULL DEFAULT 9,      -- 1 contribuinte, 2 isento, 9 não contribuinte
    rg TEXT NOT NULL DEFAULT '',
    nascimento TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    logradouro TEXT NOT NULL DEFAULT '',
    numero TEXT NOT NULL DEFAULT '',
    complemento TEXT NOT NULL DEFAULT '',
    bairro TEXT NOT NULL DEFAULT '',
    cod_municipio TEXT NOT NULL DEFAULT '',
    municipio TEXT NOT NULL DEFAULT '',
    uf TEXT NOT NULL DEFAULT '',
    cep TEXT NOT NULL DEFAULT '',
    cliente INTEGER NOT NULL DEFAULT 1,
    fornecedor INTEGER NOT NULL DEFAULT 0,
    obs TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE veiculos (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL DEFAULT 'automovel',      -- automovel | moto | caminhonete | caminhao | outro
    condicao TEXT NOT NULL DEFAULT 'usado' CHECK (condicao IN ('novo','usado')),
    marca TEXT NOT NULL,
    modelo TEXT NOT NULL,
    versao TEXT NOT NULL DEFAULT '',
    ano_fab INTEGER NOT NULL,
    ano_mod INTEGER NOT NULL,
    cor TEXT NOT NULL DEFAULT '',
    combustivel TEXT NOT NULL DEFAULT 'flex',
    cambio TEXT NOT NULL DEFAULT 'manual',
    placa TEXT NOT NULL DEFAULT '',
    chassi TEXT NOT NULL UNIQUE,
    renavam TEXT NOT NULL DEFAULT '',
    motor TEXT NOT NULL DEFAULT '',
    km INTEGER NOT NULL DEFAULT 0,
    portas INTEGER,
    potencia TEXT NOT NULL DEFAULT '',
    cilindrada TEXT NOT NULL DEFAULT '',
    ncm TEXT NOT NULL DEFAULT '87032310',
    cod_marca_modelo TEXT NOT NULL DEFAULT '',   -- código DENATRAN (para NF-e de veículo novo)
    cod_cor_denatran TEXT NOT NULL DEFAULT '',
    opcionais TEXT NOT NULL DEFAULT '',
    preco_compra REAL NOT NULL DEFAULT 0,
    preco_venda REAL NOT NULL DEFAULT 0,
    preco_minimo REAL NOT NULL DEFAULT 0,
    situacao TEXT NOT NULL DEFAULT 'estoque' CHECK (situacao IN ('estoque','reservado','vendido','devolvido')),
    origem TEXT NOT NULL DEFAULT 'compra' CHECK (origem IN ('compra','consignacao','troca','montadora')),
    proprietario_id INTEGER REFERENCES pessoas(id),  -- consignante (quando consignado)
    data_entrada TEXT NOT NULL DEFAULT (date('now')),
    data_saida TEXT,
    renave_status TEXT NOT NULL DEFAULT 'pendente',  -- pendente | em_estoque | saida | nao_aplicavel | erro
    renave_id TEXT NOT NULL DEFAULT '',
    obs TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_veiculos_situacao ON veiculos(situacao);
  CREATE INDEX ix_veiculos_placa ON veiculos(placa);

  CREATE TABLE veiculo_custos (
    id INTEGER PRIMARY KEY,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
    descricao TEXT NOT NULL,
    valor REAL NOT NULL,
    data TEXT NOT NULL DEFAULT (date('now')),
    titulo_id INTEGER REFERENCES titulos(id)
  );

  CREATE TABLE veiculo_fotos (
    id INTEGER PRIMARY KEY,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
    arquivo TEXT NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE negociacoes (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('compra','venda','consignacao','devolucao_consignacao')),
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id),
    pessoa_id INTEGER NOT NULL REFERENCES pessoas(id),
    vendedor_id INTEGER REFERENCES usuarios(id),
    data TEXT NOT NULL DEFAULT (date('now')),
    valor REAL NOT NULL,
    desconto REAL NOT NULL DEFAULT 0,
    valor_final REAL NOT NULL,
    troca_veiculo_id INTEGER REFERENCES veiculos(id),
    valor_troca REAL NOT NULL DEFAULT 0,
    km_entrega INTEGER,
    comissao_pct REAL NOT NULL DEFAULT 0,
    comissao_valor REAL NOT NULL DEFAULT 0,
    repasse_valor REAL NOT NULL DEFAULT 0,       -- valor devido ao consignante
    status TEXT NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida','cancelada')),
    obs TEXT NOT NULL DEFAULT '',
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_negociacoes_data ON negociacoes(data);

  CREATE TABLE negociacao_pagamentos (
    id INTEGER PRIMARY KEY,
    negociacao_id INTEGER NOT NULL REFERENCES negociacoes(id) ON DELETE CASCADE,
    forma TEXT NOT NULL,
    valor REAL NOT NULL,
    parcelas INTEGER NOT NULL DEFAULT 1,
    primeiro_vencimento TEXT,
    pessoa_id INTEGER REFERENCES pessoas(id)    -- ex.: banco do financiamento
  );

  CREATE TABLE titulos (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('receber','pagar')),
    descricao TEXT NOT NULL,
    categoria TEXT NOT NULL DEFAULT 'outros',
    pessoa_id INTEGER REFERENCES pessoas(id),
    negociacao_id INTEGER REFERENCES negociacoes(id),
    veiculo_id INTEGER REFERENCES veiculos(id),
    forma TEXT NOT NULL DEFAULT '',
    valor REAL NOT NULL,
    vencimento TEXT NOT NULL,
    parcela INTEGER NOT NULL DEFAULT 1,
    total_parcelas INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','pago','cancelado')),
    pago_em TEXT,
    valor_pago REAL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_titulos_venc ON titulos(status, vencimento);

  CREATE TABLE comissoes (
    id INTEGER PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    negociacao_id INTEGER NOT NULL REFERENCES negociacoes(id),
    valor REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','paga','cancelada')),
    pago_em TEXT,
    titulo_id INTEGER REFERENCES titulos(id)
  );

  CREATE TABLE perfis_fiscais (
    id INTEGER PRIMARY KEY,
    codigo TEXT NOT NULL UNIQUE,
    descricao TEXT NOT NULL,
    tipo_nf INTEGER NOT NULL,                    -- 0 entrada, 1 saída
    natureza TEXT NOT NULL,
    cfop_interno TEXT NOT NULL,
    cfop_interestadual TEXT NOT NULL,
    origem INTEGER NOT NULL DEFAULT 0,
    cst_icms TEXT NOT NULL,                      -- CST (regime normal) ou CSOSN (Simples)
    aliq_icms REAL NOT NULL DEFAULT 0,
    red_bc_pct REAL NOT NULL DEFAULT 0,
    cst_pis TEXT NOT NULL DEFAULT '99',
    aliq_pis REAL NOT NULL DEFAULT 0,
    cst_cofins TEXT NOT NULL DEFAULT '99',
    aliq_cofins REAL NOT NULL DEFAULT 0,
    cst_ibscbs TEXT NOT NULL DEFAULT '000',
    cclass_trib TEXT NOT NULL DEFAULT '000001',
    aliq_ibs_uf REAL NOT NULL DEFAULT 0.1,
    aliq_ibs_mun REAL NOT NULL DEFAULT 0,
    aliq_cbs REAL NOT NULL DEFAULT 0.9,
    info_complementar TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE nfes (
    id INTEGER PRIMARY KEY,
    negociacao_id INTEGER REFERENCES negociacoes(id),
    perfil_codigo TEXT NOT NULL,
    tipo_nf INTEGER NOT NULL,
    serie INTEGER NOT NULL,
    numero INTEGER NOT NULL,
    chave TEXT NOT NULL UNIQUE,
    ambiente INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'assinada'
      CHECK (status IN ('assinada','autorizada','rejeitada','denegada','cancelada','erro')),
    valor REAL NOT NULL,
    xml TEXT NOT NULL,                           -- NF-e assinada
    xml_proc TEXT,                               -- nfeProc (NF-e + protocolo) após autorização
    protocolo TEXT,
    cstat TEXT,
    xmotivo TEXT,
    emitida_em TEXT NOT NULL DEFAULT (datetime('now')),
    autorizada_em TEXT,
    criado_por INTEGER REFERENCES usuarios(id),
    UNIQUE (serie, numero, ambiente)
  );

  CREATE TABLE nfe_eventos (
    id INTEGER PRIMARY KEY,
    nfe_id INTEGER NOT NULL REFERENCES nfes(id),
    tipo TEXT NOT NULL,                          -- 110111 cancelamento | 110110 carta de correção
    sequencia INTEGER NOT NULL,
    texto TEXT NOT NULL,
    status TEXT NOT NULL,
    protocolo TEXT,
    cstat TEXT,
    xmotivo TEXT,
    xml TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE renave_operacoes (
    id INTEGER PRIMARY KEY,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id),
    negociacao_id INTEGER REFERENCES negociacoes(id),
    tipo TEXT NOT NULL,                          -- entrada | saida | cancelar_entrada | cancelar_saida | consulta
    modo TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sucesso','erro')),
    protocolo TEXT,
    mensagem TEXT,
    requisicao TEXT,
    resposta TEXT,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE auditoria (
    id INTEGER PRIMARY KEY,
    usuario_id INTEGER,
    acao TEXT NOT NULL,
    entidade TEXT NOT NULL,
    entidade_id INTEGER,
    detalhes TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
    /* 2 — perfis fiscais padrão (conferir com o contador antes de produção) */ `
  INSERT INTO perfis_fiscais (codigo, descricao, tipo_nf, natureza, cfop_interno, cfop_interestadual, cst_icms, aliq_icms, red_bc_pct, info_complementar) VALUES
  ('venda_usado', 'Venda de veículo usado (adquirido de terceiros)', 1, 'VENDA DE VEICULO USADO', '5102', '6102', '102', 0, 0, ''),
  ('venda_novo', 'Venda de veículo novo', 1, 'VENDA DE VEICULO NOVO', '5102', '6102', '102', 0, 0, ''),
  ('venda_consignado', 'Venda de veículo recebido em consignação', 1, 'VENDA DE VEICULO CONSIGNADO', '5115', '6115', '102', 0, 0, ''),
  ('compra_usado', 'Entrada: compra de veículo usado de pessoa física', 0, 'COMPRA DE VEICULO USADO', '1102', '2102', '102', 0, 0, ''),
  ('entrada_consignacao', 'Entrada: veículo recebido em consignação', 0, 'ENTRADA EM CONSIGNACAO', '1917', '2917', '400', 0, 0, ''),
  ('devolucao_consignacao', 'Devolução de veículo recebido em consignação', 1, 'DEVOLUCAO DE CONSIGNACAO', '5918', '6918', '400', 0, 0, '');
  `,
    /* 3 — dados técnicos de veículo novo (grupo veicProd da NF-e) */ `
  ALTER TABLE veiculos ADD COLUMN dados_novo TEXT NOT NULL DEFAULT '{}';
  `,
    /* 4 — contratos, assinatura, cobranças, carnês, documentos, importação */ `
  CREATE TABLE pessoas_nova (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('PF','PJ')),
    cpf_cnpj TEXT UNIQUE,
    nome TEXT NOT NULL,
    ie TEXT NOT NULL DEFAULT '',
    ind_ie_dest INTEGER NOT NULL DEFAULT 9,
    rg TEXT NOT NULL DEFAULT '',
    nascimento TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    logradouro TEXT NOT NULL DEFAULT '',
    numero TEXT NOT NULL DEFAULT '',
    complemento TEXT NOT NULL DEFAULT '',
    bairro TEXT NOT NULL DEFAULT '',
    cod_municipio TEXT NOT NULL DEFAULT '',
    municipio TEXT NOT NULL DEFAULT '',
    uf TEXT NOT NULL DEFAULT '',
    cep TEXT NOT NULL DEFAULT '',
    cliente INTEGER NOT NULL DEFAULT 1,
    fornecedor INTEGER NOT NULL DEFAULT 0,
    obs TEXT NOT NULL DEFAULT '',
    origem_id TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO pessoas_nova (id, tipo, cpf_cnpj, nome, ie, ind_ie_dest, rg, nascimento, email, telefone, logradouro, numero, complemento,
    bairro, cod_municipio, municipio, uf, cep, cliente, fornecedor, obs, criado_em)
  SELECT id, tipo, cpf_cnpj, nome, ie, ind_ie_dest, rg, nascimento, email, telefone, logradouro, numero, complemento,
    bairro, cod_municipio, municipio, uf, cep, cliente, fornecedor, obs, criado_em FROM pessoas;
  DROP TABLE pessoas;
  ALTER TABLE pessoas_nova RENAME TO pessoas;
  CREATE UNIQUE INDEX ux_pessoas_origem ON pessoas(origem_id);

  ALTER TABLE empresa ADD COLUMN whatsapp TEXT NOT NULL DEFAULT '';
  ALTER TABLE empresa ADD COLUMN chave_pix TEXT NOT NULL DEFAULT '';
  ALTER TABLE empresa ADD COLUMN logo TEXT NOT NULL DEFAULT '';
  ALTER TABLE empresa ADD COLUMN assinatura_loja TEXT NOT NULL DEFAULT '';
  ALTER TABLE empresa ADD COLUMN cidade_contrato TEXT NOT NULL DEFAULT '';
  ALTER TABLE empresa ADD COLUMN clausulas_venda TEXT NOT NULL DEFAULT '1. O VENDEDOR declara que o veículo descrito neste contrato é de sua legítima propriedade, livre e desembaraçado de quaisquer ônus, dívidas, multas ou restrições judiciais ou administrativas.

2. O COMPRADOR declara que recebeu o veículo em perfeitas condições de uso, tendo vistoriado e aprovado o estado geral do mesmo antes da assinatura deste instrumento.

3. A transferência de propriedade do veículo para o nome do COMPRADOR deverá ser providenciada no prazo de 30 (trinta) dias a contar da data de assinatura deste contrato, sendo de responsabilidade exclusiva do COMPRADOR os custos e providências de transferência.

4. O VENDEDOR não se responsabiliza por multas, débitos de IPVA, licenciamento ou quaisquer infrações cometidas após a data de assinatura deste contrato.

5. O pagamento deverá ser efetuado conforme acordado entre as partes, sendo este contrato válido somente após a quitação integral do valor pactuado.

6. Quaisquer vícios ou defeitos ocultos que venham a ser constatados após a entrega do veículo serão de responsabilidade do VENDEDOR pelo prazo de 90 (noventa) dias, conforme o Código de Defesa do Consumidor.

7. Este contrato é firmado em 2 (duas) vias de igual teor e forma, na presença de 2 (duas) testemunhas, obrigando-se as partes e seus sucessores ao fiel cumprimento do que aqui foi acordado.';
  ALTER TABLE empresa ADD COLUMN clausulas_compra TEXT NOT NULL DEFAULT '1. O VENDEDOR declara que o veículo descrito neste contrato é de sua legítima propriedade, livre e desembaraçado de quaisquer ônus, dívidas, multas ou restrições judiciais ou administrativas, responsabilizando-se por quaisquer débitos, multas ou infrações anteriores à data deste contrato.

2. O VENDEDOR entrega neste ato o veículo, o documento de transferência (ATPV-e) devidamente preenchido e as chaves, autorizando o COMPRADOR a providenciar a transferência de propriedade.

3. O COMPRADOR declara que vistoriou o veículo e o aceita no estado em que se encontra.

4. O pagamento será efetuado conforme a forma descrita neste contrato, dando o VENDEDOR plena quitação após o recebimento integral.

5. Este contrato é firmado em 2 (duas) vias de igual teor e forma, obrigando-se as partes e seus sucessores ao fiel cumprimento do que aqui foi acordado.';
  ALTER TABLE empresa ADD COLUMN garantia_texto TEXT NOT NULL DEFAULT 'A {LOJA} concede ao comprador acima identificado GARANTIA de 90 (noventa) dias ou 5.000 km (o que ocorrer primeiro), a contar da data de aquisição do veículo, limitada exclusivamente ao BLOCO DO MOTOR e CÂMBIO (marcha). Estão EXCLUÍDOS desta garantia: velas, cabos de vela, bobinas, filtros, correias, mangueiras, rolamentos, embreagem, sincronizadores, sistema elétrico, injeção eletrônica, radiador, bomba d''água e demais componentes não listados expressamente como cobertos.';

  ALTER TABLE titulos ADD COLUMN origem_id TEXT;
  CREATE UNIQUE INDEX ux_titulos_origem ON titulos(origem_id);

  CREATE TABLE contratos (
    id INTEGER PRIMARY KEY,
    numero TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL CHECK (tipo IN ('venda','compra')),
    data TEXT NOT NULL,
    cidade TEXT NOT NULL DEFAULT '',
    pessoa_id INTEGER REFERENCES pessoas(id),
    negociacao_id INTEGER REFERENCES negociacoes(id),
    veiculo_id INTEGER REFERENCES veiculos(id),
    cliente_nome TEXT NOT NULL,
    cliente_doc TEXT NOT NULL DEFAULT '',
    cliente_rg TEXT NOT NULL DEFAULT '',
    cliente_endereco TEXT NOT NULL DEFAULT '',
    cliente_telefone TEXT NOT NULL DEFAULT '',
    loja_doc TEXT NOT NULL DEFAULT '',
    loja_endereco TEXT NOT NULL DEFAULT '',
    veiculo_marca TEXT NOT NULL DEFAULT '',
    veiculo_modelo TEXT NOT NULL DEFAULT '',
    veiculo_ano TEXT NOT NULL DEFAULT '',
    veiculo_cor TEXT NOT NULL DEFAULT '',
    veiculo_placa TEXT NOT NULL DEFAULT '',
    veiculo_chassi TEXT NOT NULL DEFAULT '',
    veiculo_renavam TEXT NOT NULL DEFAULT '',
    veiculo_km TEXT NOT NULL DEFAULT '',
    valor REAL NOT NULL DEFAULT 0,
    forma_pagamento TEXT NOT NULL DEFAULT '',
    clausulas TEXT NOT NULL DEFAULT '',
    garantia_texto TEXT NOT NULL DEFAULT '',
    obs TEXT NOT NULL DEFAULT '',
    assinatura TEXT,
    assinado_em TEXT,
    assinatura_ip TEXT,
    assinatura_hash TEXT,
    origem_id TEXT UNIQUE,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_contratos_data ON contratos(data);

  CREATE TABLE cobrancas (
    id INTEGER PRIMARY KEY,
    pessoa_id INTEGER REFERENCES pessoas(id),
    negociacao_id INTEGER REFERENCES negociacoes(id),
    cliente_nome TEXT NOT NULL,
    cliente_telefone TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL,
    veiculo_info TEXT NOT NULL DEFAULT '',
    valor_total REAL NOT NULL,
    valor_parcela REAL NOT NULL,
    total_parcelas INTEGER NOT NULL,
    parcelas_pagas INTEGER NOT NULL DEFAULT 0,
    dia_vencimento INTEGER NOT NULL,
    primeiro_vencimento TEXT NOT NULL,
    obs TEXT NOT NULL DEFAULT '',
    origem_id TEXT UNIQUE,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE cobranca_pagamentos (
    id INTEGER PRIMARY KEY,
    cobranca_id INTEGER NOT NULL REFERENCES cobrancas(id) ON DELETE CASCADE,
    parcela INTEGER NOT NULL,
    valor REAL NOT NULL,
    data TEXT NOT NULL,
    forma TEXT NOT NULL DEFAULT '',
    titulo_id INTEGER REFERENCES titulos(id),
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE carnes (
    id INTEGER PRIMARY KEY,
    pessoa_id INTEGER REFERENCES pessoas(id),
    cobranca_id INTEGER REFERENCES cobrancas(id),
    cliente_nome TEXT NOT NULL,
    cliente_doc TEXT NOT NULL DEFAULT '',
    cliente_nascimento TEXT NOT NULL DEFAULT '',
    cliente_endereco TEXT NOT NULL DEFAULT '',
    veiculo_tipo TEXT NOT NULL DEFAULT 'carro',
    veiculo_marca TEXT NOT NULL DEFAULT '',
    veiculo_modelo TEXT NOT NULL DEFAULT '',
    veiculo_placa TEXT NOT NULL DEFAULT '',
    veiculo_chassi TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    total_parcelas INTEGER NOT NULL,
    valor_parcela REAL NOT NULL,
    valor_total REAL NOT NULL,
    dia_vencimento INTEGER NOT NULL,
    primeiro_vencimento TEXT NOT NULL,
    forma_pagamento TEXT NOT NULL DEFAULT 'pix',
    chave_pix TEXT NOT NULL DEFAULT '',
    qr_pix TEXT NOT NULL DEFAULT '',
    obs TEXT NOT NULL DEFAULT '',
    origem_id TEXT UNIQUE,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE documentos (
    id INTEGER PRIMARY KEY,
    pessoa_id INTEGER REFERENCES pessoas(id),
    tipo TEXT NOT NULL,
    nome TEXT NOT NULL,
    numero TEXT NOT NULL DEFAULT '',
    obs TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE documento_arquivos (
    id INTEGER PRIMARY KEY,
    documento_id INTEGER NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
    arquivo TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'image/jpeg',
    ordem INTEGER NOT NULL DEFAULT 0
  );
  `,
    /* 5 — permissões por usuário, segurança do login, catálogo público, FIPE e entrada pelo documento */ `
  ALTER TABLE usuarios ADD COLUMN permissoes TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE usuarios ADD COLUMN falhas_login INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE usuarios ADD COLUMN bloqueado_ate TEXT;
  ALTER TABLE usuarios ADD COLUMN ultimo_acesso TEXT;
  ALTER TABLE usuarios ADD COLUMN totp_segredo TEXT NOT NULL DEFAULT '';
  ALTER TABLE usuarios ADD COLUMN totp_ultimo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessoes ADD COLUMN criado_em TEXT;
  ALTER TABLE sessoes ADD COLUMN ip TEXT NOT NULL DEFAULT '';
  ALTER TABLE sessoes ADD COLUMN agente TEXT NOT NULL DEFAULT '';
  UPDATE usuarios SET permissoes = '${JSON.stringify(PERMISSOES_INICIAIS.gerente)}' WHERE perfil = 'gerente';
  UPDATE usuarios SET permissoes = '${JSON.stringify(PERMISSOES_INICIAIS.vendedor)}' WHERE perfil = 'vendedor';
  UPDATE usuarios SET permissoes = '${JSON.stringify(PERMISSOES_INICIAIS.financeiro)}' WHERE perfil = 'financeiro';

  ALTER TABLE veiculos ADD COLUMN publicado INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE veiculos ADD COLUMN destaque INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE veiculos ADD COLUMN descricao_catalogo TEXT NOT NULL DEFAULT '';
  ALTER TABLE veiculos ADD COLUMN fipe_codigo TEXT NOT NULL DEFAULT '';
  ALTER TABLE veiculos ADD COLUMN fipe_modelo TEXT NOT NULL DEFAULT '';
  ALTER TABLE veiculos ADD COLUMN fipe_valor REAL;
  ALTER TABLE veiculos ADD COLUMN fipe_referencia TEXT NOT NULL DEFAULT '';
  ALTER TABLE veiculos ADD COLUMN fipe_consultado_em TEXT;
  ALTER TABLE veiculos ADD COLUMN documento_arquivo TEXT NOT NULL DEFAULT '';
  ALTER TABLE veiculos ADD COLUMN mostrar_preco INTEGER NOT NULL DEFAULT 1;
  CREATE INDEX ix_veiculos_publicado ON veiculos(publicado, situacao);

  ALTER TABLE empresa ADD COLUMN instagram TEXT NOT NULL DEFAULT '';
  ALTER TABLE empresa ADD COLUMN horario TEXT NOT NULL DEFAULT '';
  ALTER TABLE empresa ADD COLUMN catalogo_titulo TEXT NOT NULL DEFAULT '';
  ALTER TABLE empresa ADD COLUMN catalogo_sobre TEXT NOT NULL DEFAULT '';
  ALTER TABLE empresa ADD COLUMN cor_marca TEXT NOT NULL DEFAULT '';

  CREATE TABLE fipe_cache (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE config_sistema (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_auditoria_data ON auditoria(criado_em);
  `,
    /* 6 — catálogo: simulador de financiamento e contatos vindos do site */ `
  ALTER TABLE empresa ADD COLUMN catalogo_taxa_mes REAL NOT NULL DEFAULT 1.99;
  ALTER TABLE empresa ADD COLUMN catalogo_entrada_pct REAL NOT NULL DEFAULT 30;
  CREATE TABLE contatos_site (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('interesse','visita','troca','financiamento')),
    nome TEXT NOT NULL,
    telefone TEXT NOT NULL,
    veiculo_id INTEGER REFERENCES veiculos(id) ON DELETE SET NULL,
    mensagem TEXT NOT NULL DEFAULT '',
    dados TEXT NOT NULL DEFAULT '{}',
    ip TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','atendido')),
    atendido_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_contatos_site ON contatos_site(status, criado_em);
  `,
];
