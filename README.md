# Pátio ERP: sistema para loja de veículos

ERP em TypeScript para revenda de veículos: estoque, compra, venda, troca, consignação, financeiro, comissões, emissão de NF-e direto na SEFAZ e integração com o RENAVE.

Roda só com o Node.js. O sistema não usa nenhuma biblioteca externa em produção: o banco é o SQLite que vem no Node e a assinatura digital usa a criptografia do próprio Node.

## O que o sistema faz

- **Catálogo público (site da loja).** O endereço principal (`/`) mostra os veículos publicados, com busca, filtros, galeria de fotos, ficha técnica e botão de WhatsApp com a mensagem pronta. Abre rápido no celular e aparece com foto ao compartilhar no WhatsApp. Custo, placa completa e qualquer link para a área da loja nunca aparecem.
  - Na página de cada veículo: galeria em tela cheia, comparação com a FIPE (aparece só quando o preço está abaixo dela), simulador de financiamento (juros e entrada sugerida em Configurações › Catálogo do site), agendar visita, oferecer o carro na troca, salvar favoritos e compartilhar.
  - Os pedidos de visita, troca e financiamento chegam em **Contatos do site**, na área da loja, e a conversa abre no WhatsApp com tudo preenchido.
  - Para ver o catálogo com veículos de exemplo: `npm run demo` (coloca 3 veículos de demonstração). Para tirar: `npm run demo -- remover`.
- **Área da loja em endereço secreto.** O sistema interno abre só em `https://seusite/painel-xxxxxxxxxx/` (o endereço aparece ao iniciar o servidor e em Configurações > Catálogo do site). Não há botão de login no catálogo.
- **Entrada de veículo pelo celular.** Foto do documento (CRV verde, CRLV ou CRLV-e branco, inclusive o PDF da Carteira Digital de Trânsito): o sistema lê placa, RENAVAM, chassi, marca, modelo, ano, cor, combustível e o dono, confere os dígitos e avisa o que precisa de revisão (inclusive alienação fiduciária). Na mesma tela: FIPE, quanto a loja pagou, preço de venda, margem, fotos e publicação no catálogo.
- **Tabela FIPE.** Consulta automática pelos dados do documento, com opção de escolher outra versão. O valor fica no veículo para os vendedores consultarem.
- **Veículos.** Cadastro completo com chassi, RENAVAM e placa validados, inclusive no padrão Mercosul. Também guarda:
  - custos de preparação, que podem gerar conta a pagar;
  - fotos (ordem e capa do anúncio), reserva, dias no pátio e margem prevista;
  - a imagem do documento lido.
- **Negociações:**
  - compra, com uma ou várias formas de pagamento;
  - venda, com desconto, troca (o veículo da troca entra no estoque sozinho) e financiamento com o banco como devedor;
  - consignação, com valor de repasse ao proprietário, e devolução de consignado;
  - preço mínimo: abaixo dele, só gerente vende;
  - cancelamento seguro: o sistema exige cancelar antes a NF-e e o RENAVE.
- **Financeiro.**
  - Contas a pagar e a receber, parcelamento, baixa e estorno.
  - Resumo do período por categoria.
  - Comissões por vendedor, com pagamento em lote.
- **NF-e modelo 55, leiaute 4.00:**
  - emissão direta na SEFAZ (no Ceará, pela SVRS) com o certificado A1;
  - autorização, consulta, cancelamento e carta de correção;
  - DANFE para imprimir ou salvar em PDF e download do XML;
  - notas de compra (entrada), venda, venda de consignado, entrada em consignação e devolução de consignação (com a nota de entrada referenciada);
  - grupo de veículo novo (`veicProd`) para 0 km;
  - grupo IBS/CBS da Reforma Tributária, opcional.
- **RENAVE.**
  - Entrada no estoque, saída por venda, cancelamentos e consulta.
  - Modo simulado para usar enquanto o credenciamento não sai.
- **Contratos.** Contrato de compra e de venda com número próprio (CV-/CC-), valor por extenso, cláusulas e termo de garantia configuráveis. Pode ser gerado a partir de uma venda em Negociações. Sai pronto para imprimir ou salvar em PDF, com a logo da loja.
- **Assinatura digital.** O cliente assina na tela do celular ou tablet da loja. Ficam registrados data, hora, IP e um código SHA-256 do conteúdo; depois de assinado, o contrato não pode mais ser alterado (só o gerente remove a assinatura, com motivo registrado). A assinatura do representante da loja é cadastrada uma vez e sai em todos os contratos.
- **Cobranças.** Parcelamentos próprios da loja com situação calculada (em dia, atrasado, quitado), dias de atraso, mensagem pronta de cobrança no WhatsApp, baixa de parcelas (lançada no Financeiro), estorno, extrato e relatório para imprimir.
- **Carnês.** Carnê com uma folha por parcela, canhoto e QR Code Pix no valor exato de cada parcela. Pode criar a cobrança junto, para acompanhar os pagamentos.
- **Documentos.** CNH, RG, CRLV e outros, com fotos tiradas pelo celular (reduzidas automaticamente) ou PDF, ligados ao cliente.
- **Usuários e permissões.** O administrador cria os usuários e marca, item por item, o que cada um pode fazer em cada área (por exemplo: adicionar cliente sim, excluir não; ver o estoque sem ver o custo). Há modelos prontos (gerente, vendedor, financeiro) para começar. Alterou permissão ou desativou: a pessoa é desconectada na hora. Todo login, alteração e exclusão fica no Registro de atividades.
- **Logo da loja em tudo:** contratos, garantias, carnês, extratos, recibos, comprovantes de pagamento e DANFE.
- **Recibos.** Recibo (conta recebida) e comprovante (conta paga) com valor por extenso, em duas vias, a partir do Financeiro ou logo depois de baixar uma parcela em Cobranças.

## Como o código foi verificado

- **Testes automáticos (`npm test`):** 35 testes, incluindo um fluxo de ponta a ponta pela API. Ele cobre:
  - primeiro acesso, cadastros e compra;
  - NF-e de entrada e entrada no RENAVE;
  - venda com troca e financiamento, NF-e de venda e saída no RENAVE;
  - carta de correção e cancelamentos na ordem certa;
  - consignação e devolução, financeiro, comissões e permissões por perfil;
  - permissões por usuário, bloqueio de login, proteção contra pedidos de outros sites, cabeçalhos de segurança, catálogo público (sem custo, placa ou link do painel) e entrada pelo documento.
- **Schema oficial:** os XMLs gerados (NF-e, lote de envio, cancelamento e carta de correção) foram validados contra os schemas oficiais da NF-e 4.00. Isso vale para o pacote PL_009 e para o PL_010, da Reforma Tributária.
- **Assinatura digital:** foi conferida de forma independente, com outra biblioteca de canonicalização XML e o OpenSSL.
- **O que ainda não foi feito:** nada foi transmitido para a SEFAZ real nem para o RENAVE real, porque isso exige o certificado e o credenciamento da loja. Esses são os próximos passos (veja abaixo).

## Requisitos

- **Node.js 22.13 ou mais novo.** Recomendado: a versão LTS atual em https://nodejs.org. Não é preciso instalar mais nada: o certificado `.pfx` é lido pelo próprio sistema, inclusive os exportados pelo Windows.

## Instalação

```bash
npm install        # instala só o compilador TypeScript (desenvolvimento)
npm run build      # compila o servidor e a interface
npm start          # catálogo em http://localhost:3000
```

Ao iniciar, o servidor mostra os dois endereços:

```
Catálogo público:  http://localhost:3000/
Área da loja:      http://localhost:3000/painel-k3j9x2q7ab/
```

Abra o endereço da área da loja: no primeiro acesso ele pede para criar o administrador. Guarde esse endereço nos favoritos. Para escolher um endereço próprio, defina `ADMIN_PATH` (ex.: `ADMIN_PATH=gestao-cr-2026`).

### Leitura automática do documento

A leitura da foto do documento usa a API da Anthropic (Claude). Crie uma chave em https://console.anthropic.com e defina `ANTHROPIC_API_KEY` no servidor. Cada leitura custa poucos centavos de dólar. Sem a chave, a tela de entrada funciona normalmente com digitação manual. O modelo padrão é `claude-sonnet-5-5` (troque com `ANTHROPIC_MODELO`).

### Testar sem certificado (modo simulado)

Para treinar a equipe ou experimentar o fluxo completo antes de ter o certificado, ligue a SEFAZ simulada. Ela só funciona em homologação e as notas não têm valor nenhum:

```bash
# Linux/macOS
NFE_SIMULADO=1 npm start
# Windows (PowerShell)
$env:NFE_SIMULADO="1"; npm start
```

O RENAVE já começa em modo simulado (Configurações > Empresa e NF-e).

## Trazendo os dados do sistema anterior

Em **Configurações > Importar dados**, selecione de uma vez todos os arquivos `.csv` exportados do sistema antigo (Client, Contract, Installment, Carnet, FinancialTransaction, AppSettings). O sistema reconhece cada arquivo pelo conteúdo e:

- importa os clientes (CPF inválido fica anotado nas observações, sem bloquear);
- liga contratos e cobranças aos clientes;
- baixa a logo da loja e as imagens de QR Pix dos carnês, quando o link ainda estiver no ar;
- mostra um relatório do que entrou e do que precisa de atenção.

Pode repetir a importação: o que já foi importado é ignorado. As imagens de documentos e assinaturas antigas não vêm nas exportações CSV.

## Colocando a NF-e em produção

1. **Dados da empresa.** Em Configurações > Empresa e NF-e, preencha CNPJ, inscrição estadual, regime tributário e endereço com o código IBGE do município. O CEP preenche o código sozinho.
2. **Certificado.** Envie o certificado A1 (`.pfx`) com a senha. A senha fica cifrada no banco.
3. **Regras fiscais.** Em Configurações > Regras fiscais, **revise cada regra com o contador.** Os valores iniciais são um ponto de partida comum para revenda no Simples Nacional:

   | Operação | CFOP | CSOSN |
   |---|---|---|
   | Venda de usado | 5102 | 102 |
   | Venda de consignado | 5115 | — |
   | Compra de usado | 1102 | — |
   | Entrada em consignação | 1917 | — |
   | Devolução de consignação | 5918 | — |

   No regime normal, troque o CSOSN por CST. Por exemplo: CST 20 com a redução de base de cálculo do veículo usado prevista na legislação do estado.
4. **Testes em homologação.** Emita algumas notas com o ambiente em **Homologação** (o padrão) e sem `NFE_SIMULADO`. Nesse ambiente o destinatário sai como "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO", como a SEFAZ exige.
5. **Produção.** Quando estiver tudo certo, mude para **Produção** e ajuste a série e o próximo número, se a loja já emitia em outro sistema.

**Se a conexão com a SEFAZ falhar por certificado** (mensagem com "issuer certificate"):

1. Baixe a cadeia de certificados ICP-Brasil.
2. Aponte a variável `SEFAZ_CA_FILE` (ou `NODE_EXTRA_CA_CERTS`) para o arquivo.

**Outros estados:** o sistema já traz os endereços da SVRS, que atende o CE e mais 15 UFs. Para estados com autorizador próprio, defina `SEFAZ_URLS` com um JSON `{"1": {...}, "2": {...}}`. As chaves são `autorizacao`, `retAutorizacao`, `consulta`, `status` e `evento`.

## Colocando o RENAVE em produção

1. **Credenciamento no DETRAN-CE.** A loja se cadastra no sistema Credencia do Serpro (https://credencia.estaleiro.serpro.gov.br), escolhendo o serviço RENAVE. O DETRAN aprova o credenciamento.
2. **Contratação.** Contrate o RENAVE na Loja Serpro (https://loja.serpro.gov.br/renave) e informe o certificado digital da empresa. O Serpro entrega o **Manual de Integração RENAVE-WS**, com os endereços e o formato exato das mensagens.
3. **Configuração no sistema.** Em Configurações, mude o RENAVE para Homologação, informe a URL base e defina a variável `RENAVE_ENDPOINTS` com os caminhos do manual. Exemplo de formato (os caminhos reais vêm do manual):
   ```bash
   RENAVE_ENDPOINTS='{"entrada":"...","saida":".../{id}/...","cancelarEntrada":".../{id}","cancelarSaida":".../{id}","consultar":".../{chassi}"}'
   ```
4. **Ajuste das mensagens.** Confira os nomes dos campos em `src/renave/cliente.ts` (métodos `payloadEntrada` e `payloadSaida`) com o manual. A tradução está isolada ali de propósito: o restante do sistema não muda.

O RENAVE exige a NF-e autorizada: a de entrada para registrar o veículo no estoque e a de venda para registrar a saída. O sistema confere isso antes de enviar.

## Backup

Tudo fica na pasta `data/`. Copie a pasta inteira regularmente. Ela contém:

| Arquivo ou pasta | Conteúdo |
|---|---|
| `erp.db` | O banco de dados |
| `.segredo` | A chave que cifra a senha do certificado |
| `certificados/` | O certificado digital |
| `fotos/` | As fotos dos veículos |
| `arquivos/` | Logo da loja, documentos dos clientes e dos veículos e imagens dos carnês |

Sem o `.segredo`, o sistema funciona, mas o certificado precisa ser reenviado. Outra opção é definir `APP_SEGREDO` no ambiente.

## Colocar no ar (produção, com HTTPS)

O site vai ser aberto por clientes, então **use sempre HTTPS**. O caminho mais simples é um servidor Linux (VPS) com o **Caddy** na frente: ele tira e renova sozinho o certificado SSL gratuito (Let's Encrypt).

1. Aponte o domínio (ex.: `crveiculos.com.br` e `www.crveiculos.com.br`) para o IP do servidor no painel do registro do domínio.
2. Instale o Node.js 22+ e o Caddy (https://caddyserver.com/docs/install).
3. Copie o sistema para `/opt/erp-veiculos`, rode `npm install && npm run build`.
4. Use o `Caddyfile` que vem no projeto (troque o domínio) em `/etc/caddy/Caddyfile` e `sudo systemctl reload caddy`.
5. Crie o serviço do sistema (`deploy/erp-veiculos.service`, já com as variáveis de produção) e ligue-o:
   ```bash
   sudo cp deploy/erp-veiculos.service /etc/systemd/system/
   sudo systemctl enable --now erp-veiculos
   journalctl -u erp-veiculos -n 20   # mostra o endereço da área da loja
   ```
6. Teste em https://www.ssllabs.com/ssltest/ (deve dar nota A) e https://securityheaders.com.

Sem proxy, o próprio sistema também serve HTTPS: defina `TLS_CERT` e `TLS_KEY` com os arquivos do certificado (ex.: do Certbot). Ele abre a porta 443, redireciona a 80 para HTTPS e recarrega o certificado renovado sozinho.

### O que o sistema faz pela segurança

- **Área da loja escondida:** só abre no endereço secreto, não é indexada pelo Google e não tem link no catálogo.
- **Senhas:** guardadas com scrypt; exige letras e números; 5 erros bloqueiam o usuário por 15 minutos e 15 erros bloqueiam o IP. O administrador desbloqueia em Usuários.
- **Verificação em duas etapas** (Google Authenticator, Authy etc.) em Minha conta. Recomendada para o administrador.
- **Sessão:** cookie `HttpOnly`, `SameSite=Strict` e `Secure` no HTTPS; no banco fica só o hash do token; expira em 12 horas; trocar a senha desconecta os outros aparelhos.
- **Permissões conferidas no servidor** em todas as rotas (o servidor nem sobe se alguma rota nova ficar sem permissão declarada).
- **Proteção contra pedidos de outros sites (CSRF)**, política de conteúdo (CSP) que só aceita scripts do próprio site, proteção contra o site ser aberto dentro de outro, HSTS no HTTPS.
- **Arquivos enviados** conferidos pelo conteúdo (uma página disfarçada de foto é recusada), com limite de tamanho por tipo de envio; fotos e documentos internos só abrem logado; o catálogo só mostra fotos de veículos publicados.
- **Erros** não mostram detalhes internos em produção (só um código para o suporte achar no log).
- **Backup:** veja abaixo. Faça cópia diária da pasta `data/` para fora do servidor.

Variáveis de ambiente:

| Variável | Para quê |
|---|---|
| `PORTA` / `HOST` | Porta e endereço (padrão 3000 / 0.0.0.0) |
| `PASTA_DADOS` | Onde ficam banco, certificado e fotos (padrão `./data`) |
| `NFE_SIMULADO=1` | SEFAZ simulada (só homologação) |
| `OPENSSL_BIN` | Opcional: OpenSSL para certificados com algoritmo incomum (o normal é ler sem ele) |
| `SEFAZ_CA_FILE` | Cadeia ICP-Brasil para a conexão com a SEFAZ |
| `SEFAZ_URLS` | Endereços de autorizadores fora da SVRS |
| `RENAVE_ENDPOINTS` | Caminhos dos serviços do RENAVE (do manual Serpro) |
| `APP_SEGREDO` | Chave para cifrar segredos (no lugar de `data/.segredo`) |
| `COOKIE_SEGURO=1` | Força o cookie só por HTTPS (automático quando o acesso é HTTPS) |
| `NODE_ENV=production` | Modo produção: recusa pedidos de outros sites e esconde detalhes de erros |
| `URL_PUBLICA` | Endereço do site, ex.: `https://www.crveiculos.com.br` (links do catálogo e conferência de origem) |
| `CONFIAR_PROXY=1` | Use quando houver Caddy/Nginx na frente (lê o IP real e o HTTPS do proxy) |
| `ADMIN_PATH` | Endereço secreto da área da loja (padrão: gerado e guardado no banco) |
| `TLS_CERT` / `TLS_KEY` | HTTPS direto no Node (sem proxy) |
| `PORTA_HTTP` | Porta do redirecionamento para HTTPS (padrão 80; `0` desliga) |
| `ANTHROPIC_API_KEY` | Liga a leitura automática do documento do veículo |
| `ANTHROPIC_MODELO` | Modelo usado na leitura (padrão `claude-sonnet-5-5`) |
| `FIPE_URL` | API da FIPE (padrão Parallelum) |

Para recuperar o acesso de administrador pela linha de comando (também desbloqueia, remove a verificação em duas etapas e mostra o endereço da área da loja):

```bash
npm run criar-admin -- "Nome" email@loja.com.br NovaSenhaForte
```

## Na nuvem: Vercel + Supabase

O sistema também roda na Vercel com os dados no Supabase:

- **Banco:** PostgreSQL do Supabase (variável `POSTGRES_URL`). Na primeira vez o sistema cria todas as tabelas sozinho e liga o RLS em todas, para a API pública do Supabase não expor nada.
- **Arquivos** (fotos, documentos, logo, certificado A1, QR do Pix): bucket privado `erp-arquivos` no Supabase Storage (variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`).
- Essas variáveis são criadas pela integração Supabase da Vercel (aba *Storage* do projeto). Além delas: `APP_SEGREDO` (chave que cifra a senha do certificado; não trocar depois de enviar o certificado), `ADMIN_PATH` (endereço secreto do painel), `DEMO_EMAIL`/`DEMO_SENHA` (primeiro administrador). Com `SEM_VEICULOS_EXEMPLO=1` o catálogo começa vazio.
- A importação de CSV (Configurações → Importar dados) envia cada arquivo em blocos de 300 linhas, para respeitar o limite de tamanho e de tempo da Vercel.
- O mesmo código também roda num servidor próprio com PostgreSQL: defina `BANCO_URL=postgres://...`. Sem ela, usa o SQLite em `data/erp.db`.
- Ao criar uma migração nova em `src/db/schema.ts`, escreva também a versão PostgreSQL em `MIGRACOES_PG`.

## Limitações desta versão

- **Não implementado:**
  - contingência da NF-e (SVC/EPEC), inutilização de numeração, NFC-e e MDF-e;
  - entrada de veículo 0 km no RENAVE, que segue o fluxo de concessionária/montadora;
  - envio da NF-e por e-mail ao cliente (o XML e o DANFE podem ser baixados).
- **Opcional e a confirmar:** o grupo IBS/CBS segue o schema PL_010 e vem desligado por padrão. A SEFAZ adiou a rejeição de notas sem esse grupo. Confirme com o contador antes de ligar.
- **DANFE simplificado:** é gerado em HTML para imprimir ou salvar em PDF pelo navegador. Ele segue o leiaute usual, mas sem todos os detalhes do Manual de Orientação.
- **Banco de dados:** o SQLite atende bem uma loja. O acesso ao banco está isolado em `src/db/database.ts` para facilitar uma troca por PostgreSQL no futuro.

## Estrutura

```
src/
  server.ts, aplicacao.ts     inicialização
  http/app.ts                 servidor HTTP, rotas, sessão, arquivos estáticos
  db/                         banco SQLite e migrações
  modulos/                    regras de negócio e rotas da API
  fiscal/                     NF-e: XML, chave, assinatura, SEFAZ, DANFE, simulador
  renave/                     cliente RENAVE (simulado e HTTP)
  tests/                      testes automáticos
frontend/src/                 interface (TypeScript), compilada para public/js
public/                       área da loja: index.html e estilos
site/                         catálogo público e páginas de impressão (CSS/JS)
deploy/, Caddyfile            exemplos para colocar no ar com HTTPS
```
