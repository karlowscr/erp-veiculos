import { api, sessao, ehAdmin } from '../api.js';
import { html, montar, $, acoes, campos, aoEnviar, modal, aviso, confirmar, cabecalhoPagina, iniciais, lerForm, rotulo, vazio } from '../ui.js';
import { icone } from '../icones.js';

interface Modulo { id: string; nome: string; acoes: { id: string; nome: string; dica?: string }[] }
interface Modelo { nome: string; permissoes: string[] }

const CARGOS: [string, string][] = [['vendedor', 'Vendedor'], ['financeiro', 'Financeiro'], ['gerente', 'Gerente']];
const quando = (s: string | null) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca');

export async function render(el: HTMLElement, params: string[]) {
  const aba = params[0] === 'atividades' ? 'atividades' : 'lista';
  const abas = html`<nav class="abas"><a href="#/usuarios" ${aba === 'lista' ? 'aria-current' : ''}>Usuários</a><a href="#/usuarios/atividades" ${aba === 'atividades' ? 'aria-current' : ''}>Registro de atividades</a></nav>`;
  if (aba === 'atividades') return atividades(el, abas);
  const [lista, ref] = await Promise.all([api.get('/api/usuarios'), api.get('/api/usuarios/permissoes')]);
  const modulos: Modulo[] = ref.modulos;
  const total = modulos.reduce((n, m) => n + m.acoes.length, 0);
  montar(el, html`
  ${cabecalhoPagina('Usuários e permissões', 'Crie acessos para a equipe e escolha o que cada pessoa pode fazer', html`<button data-acao="novo">${icone('mais')}Novo usuário</button>`)}
  ${abas}
  ${lista.length ? html`<div class="grade-cartoes">${lista.map((u: any) => html`
    <article class="cartao usuario-cartao ${u.ativo ? '' : 'inativo'}">
      <div class="cartao-topo"><span class="avatar grande">${iniciais(u.nome)}</span>
        <div class="cartao-titulo"><b>${u.nome}${u.id === sessao.usuario!.id ? html` <span class="mudo">(você)</span>` : ''}</b><small>${u.email}</small></div></div>
      <div class="selos">
        ${u.admin ? html`<span class="selo laranja">Administrador</span>` : html`<span class="selo neutro">${rotulo(u.perfil)}</span>`}
        ${!u.ativo ? html`<span class="selo vermelho">Desativado</span>` : ''}
        ${u.bloqueado ? html`<span class="selo vermelho">Bloqueado por tentativas</span>` : ''}
        ${u.dois_fatores ? html`<span class="selo verde">${icone('cadeado', 12)}2 etapas</span>` : ''}
      </div>
      <ul class="info">
        <li>${icone('escudo', 16)}${u.admin ? 'Acesso total' : html`${u.permissoes.length} de ${total} permissões`}</li>
        <li>${icone('relogio', 16)}Último acesso: ${quando(u.ultimo_acesso)}</li>
      </ul>
      <footer class="cartao-acoes">
        <button class="cresce" data-acao="editar" data-id="${u.id}">${icone('lapis', 16)}Editar e permissões</button>
        ${u.bloqueado ? html`<button class="sec" data-acao="desbloquear" data-id="${u.id}">Desbloquear</button>` : ''}
        ${u.id !== sessao.usuario!.id ? html`<button class="icone-btn" data-acao="sessoes" data-id="${u.id}" title="Desconectar de todos os aparelhos" aria-label="Desconectar ${u.nome}">${icone('sair')}</button>
          <button class="icone-btn ${u.ativo ? 'perigo' : ''}" data-acao="ativo" data-id="${u.id}" data-ativo="${u.ativo ? 1 : 0}" title="${u.ativo ? 'Desativar' : 'Reativar'}" aria-label="${u.ativo ? 'Desativar' : 'Reativar'} ${u.nome}">${icone(u.ativo ? 'x' : 'ok')}</button>` : ''}
      </footer>
    </article>`)}</div>` : vazio('Nenhum usuário.')}
  <p class="mudo pequeno">Quem for desativado ou tiver as permissões alteradas é desconectado na hora. Cada login, alteração e exclusão fica no Registro de atividades.</p>`);
  const recarregar = () => render(el, params);
  acoes(el, {
    novo: () => editor(undefined, modulos, ref.modelos, recarregar),
    editar: (b) => editor(lista.find((u: any) => String(u.id) === b.dataset.id), modulos, ref.modelos, recarregar),
    desbloquear: async (b) => { await api.put(`/api/usuarios/${b.dataset.id}`, { desbloquear: true }); aviso('Usuário desbloqueado.'); recarregar(); },
    sessoes: async (b) => {
      if (!(await confirmar('Desconectar este usuário de todos os aparelhos? Ele precisará entrar de novo.', 'Desconectar'))) return;
      const r = await api.post(`/api/usuarios/${b.dataset.id}/encerrar-sessoes`);
      aviso(r.encerradas ? `${r.encerradas} sessão(ões) encerrada(s).` : 'Não havia sessões abertas.');
    },
    ativo: async (b) => {
      const ativo = b.dataset.ativo === '1';
      if (ativo && !(await confirmar('Desativar este usuário? Ele perde o acesso imediatamente (o histórico é mantido).', 'Desativar'))) return;
      await api.put(`/api/usuarios/${b.dataset.id}`, { ativo: !ativo });
      aviso(ativo ? 'Usuário desativado.' : 'Usuário reativado.');
      recarregar();
    },
  });
}

function editor(u: any | undefined, modulos: Modulo[], modelos: Record<string, Modelo>, aoTerminar: () => void) {
  const novo = !u;
  const atuais = new Set<string>(u ? u.permissoes : modelos.vendedor.permissoes);
  const souAdmin = ehAdmin();
  const matriz = html`<div class="matriz-perm">${modulos.map((m) => html`
    <fieldset class="perm-modulo" data-modulo="${m.id}"><legend><label class="check"><input type="checkbox" data-todos="${m.id}"> <b>${m.nome}</b></label></legend>
      ${m.acoes.map((a) => html`<label class="check" ${a.dica ? html`title="${a.dica}"` : ''}><input type="checkbox" data-perm="${m.id}.${a.id}" ${atuais.has(`${m.id}.${a.id}`) ? 'checked' : ''}> ${a.nome}${a.dica ? html`<small>${a.dica}</small>` : ''}</label>`)}
    </fieldset>`)}</div>`;
  const mod = modal(novo ? 'Novo usuário' : `Editar ${u.nome}`, html`
  <form id="f-u">
    <div class="grade-form">${campos([
      { nome: 'nome', rotulo: 'Nome', obrigatorio: true, largura: 2 },
      { nome: 'email', rotulo: 'E-mail (login)', tipo: 'email', obrigatorio: true, largura: 2, attrs: 'autocomplete="off"' },
      { nome: 'perfil', rotulo: 'Cargo', tipo: 'select', opcoes: CARGOS, largura: 1 },
      { nome: 'comissao_pct', rotulo: 'Comissão (%)', tipo: 'numero', largura: 1, dica: 'Vazio usa a padrão.' },
      { nome: 'senha', rotulo: novo ? 'Senha inicial' : 'Nova senha (opcional)', tipo: 'senha', obrigatorio: novo, largura: 2, attrs: 'minlength="8" autocomplete="new-password"', dica: '8+ caracteres, com letras e números.' },
    ], u ? { ...u, perfil: u.admin ? 'gerente' : u.perfil } : { perfil: 'vendedor' })}</div>
    ${souAdmin ? html`<label class="check destaque-check"><input type="checkbox" name="admin" ${u?.admin ? 'checked' : ''}> <b>Administrador</b> — acesso total, inclusive criar usuários e alterar configurações</label>` : ''}
    ${u?.dois_fatores && souAdmin ? html`<label class="check"><input type="checkbox" name="remover_2fa"> Remover a verificação em duas etapas (se a pessoa perdeu o celular)</label>` : ''}
    <div class="perm-cab"><h3>O que esta pessoa pode fazer</h3>
      <div class="botoes"><span class="mudo pequeno">Começar de um modelo:</span>${Object.entries(modelos).map(([k, m]) => html`<button type="button" class="sec pequeno" data-modelo="${k}">${m.nome}</button>`)}
        <button type="button" class="sec pequeno" data-modelo="">Nenhuma</button></div></div>
    <div id="area-perm">${matriz}</div>
    <div class="acoes-form"><button type="button" class="sec" data-fechar>Cancelar</button><button type="submit">${novo ? 'Criar usuário' : 'Salvar'}</button></div>
  </form>`, { largo: true });
  const f = $<HTMLFormElement>('#f-u', mod.el);
  const marcar = (lista: string[]) => {
    const s = new Set(lista);
    f.querySelectorAll<HTMLInputElement>('[data-perm]').forEach((c) => (c.checked = s.has(c.dataset.perm!)));
    sincronizarTodos();
  };
  const sincronizarTodos = () => f.querySelectorAll<HTMLInputElement>('[data-todos]').forEach((t) => {
    const cs = [...f.querySelectorAll<HTMLInputElement>(`[data-modulo="${t.dataset.todos}"] [data-perm]`)];
    t.checked = cs.every((c) => c.checked);
    t.indeterminate = !t.checked && cs.some((c) => c.checked);
  });
  const adminChk = f.querySelector<HTMLInputElement>('input[name=admin]');
  const atualizarAdmin = () => {
    const ligado = !!adminChk?.checked;
    $('#area-perm', mod.el).classList.toggle('desligado', ligado);
    f.querySelectorAll<HTMLInputElement>('[data-perm],[data-todos],[data-modelo]').forEach((c) => (c.disabled = ligado));
  };
  adminChk?.addEventListener('change', atualizarAdmin);
  f.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.todos) f.querySelectorAll<HTMLInputElement>(`[data-modulo="${t.dataset.todos}"] [data-perm]`).forEach((c) => (c.checked = t.checked));
    // "ver" desmarcado num módulo tira as demais ações que dependem de ver a tela
    sincronizarTodos();
  });
  f.querySelectorAll<HTMLButtonElement>('[data-modelo]').forEach((b) => b.addEventListener('click', () => {
    marcar(b.dataset.modelo ? modelos[b.dataset.modelo].permissoes : []);
    if (b.dataset.modelo && CARGOS.some(([k]) => k === b.dataset.modelo)) (f.elements.namedItem('perfil') as HTMLSelectElement).value = b.dataset.modelo;
  }));
  sincronizarTodos();
  atualizarAdmin();
  aoEnviar(f, async () => {
    const d = lerForm(f);
    const corpo: Record<string, unknown> = {
      nome: d.nome, email: d.email, perfil: d.perfil, comissao_pct: d.comissao_pct,
      permissoes: [...f.querySelectorAll<HTMLInputElement>('[data-perm]:checked')].map((c) => c.dataset.perm),
    };
    if (adminChk) corpo.admin = adminChk.checked;
    if (d.senha) corpo.senha = d.senha;
    if (d.remover_2fa) corpo.remover_2fa = true;
    if (novo) await api.post('/api/usuarios', corpo);
    else await api.put(`/api/usuarios/${u.id}`, corpo);
    mod.fechar();
    aviso(novo ? 'Usuário criado. Passe o e-mail, a senha e o endereço da área da loja para a pessoa.' : 'Usuário salvo.');
    aoTerminar();
  });
}

const ACOES: Record<string, string> = {
  login: 'Entrou no sistema', login_falhou: 'Errou a senha', login_bloqueado: 'Bloqueado por tentativas', setup: 'Configurou o sistema',
  criar: 'Criou', alterar: 'Alterou', excluir: 'Excluiu', trocar_senha: 'Trocou a senha', '2fa_ativar': 'Ativou duas etapas', '2fa_desativar': 'Desativou duas etapas',
  encerrar_sessoes: 'Desconectou sessões', publicar: 'Publicou no catálogo', despublicar: 'Tirou do catálogo', ler_documento: 'Leu documento de veículo',
  entrada: 'Deu entrada no estoque', compra: 'Registrou compra', venda: 'Registrou venda', consignacao: 'Registrou consignação', cancelar: 'Cancelou',
  pagamento: 'Registrou pagamento', estorno: 'Estornou', baixar: 'Baixou conta', estornar: 'Estornou conta', custo: 'Lançou custo', excluir_custo: 'Excluiu custo',
  assinar: 'Colheu assinatura', logo: 'Trocou a logo', importar: 'Importou dados',
};
const ENTIDADES: Record<string, string> = {
  usuarios: 'usuário', veiculos: 'veículo', pessoas: 'cliente', negociacoes: 'negociação', titulos: 'conta', contratos: 'contrato', cobrancas: 'cobrança',
  carnes: 'carnê', documentos: 'documento', empresa: 'configurações', nfes: 'nota fiscal', comissoes: 'comissões', perfis_fiscais: 'regra fiscal',
};

async function atividades(el: HTMLElement, abas: unknown) {
  const lista = await api.get('/api/auditoria');
  montar(el, html`
  ${cabecalhoPagina('Usuários e permissões', 'Últimas 300 ações registradas no sistema')}
  ${abas as any}
  <div class="tabela-rolagem"><table class="tabela compacta"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhes</th></tr></thead>
  <tbody>${lista.map((a: any) => {
    let det = '';
    try { const d = JSON.parse(a.detalhes ?? 'null'); if (d) det = Object.entries(d).filter(([k]) => k !== 'permissoes').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); } catch { /* texto */ }
    const alerta = ['login_falhou', 'login_bloqueado', 'excluir'].includes(a.acao);
    return html`<tr class="${alerta ? 'linha-alerta' : ''}"><td>${quando(a.criado_em)}</td><td>${a.usuario_nome ?? '—'}</td>
      <td>${ACOES[a.acao] ?? a.acao} ${ENTIDADES[a.entidade] ?? a.entidade}${a.entidade_id ? ` #${a.entidade_id}` : ''}</td><td class="mudo pequeno">${det.slice(0, 160)}</td></tr>`;
  })}</tbody></table></div>`);
}
