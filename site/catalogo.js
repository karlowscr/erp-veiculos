// Catálogo público: galeria, favoritos, simulador de financiamento e pedidos pelo WhatsApp.
(function () {
  'use strict';
  var corpo = document.body;
  var zap = corpo.dataset.whats || '';
  var loja = corpo.dataset.loja || 'a loja';
  var moeda = function (v) { return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); };
  var guardar = {
    ler: function () { try { return JSON.parse(localStorage.getItem('salvos') || '[]').filter(Number.isInteger); } catch (e) { return []; } },
    gravar: function (l) { try { localStorage.setItem('salvos', JSON.stringify(l.slice(0, 40))); } catch (e) { /* navegação privada */ } },
  };

  // ---- Favoritos ----
  function marcarFavoritos() {
    var l = guardar.ler();
    document.querySelectorAll('[data-favoritar]').forEach(function (b) {
      var on = l.indexOf(Number(b.dataset.favoritar)) >= 0;
      b.setAttribute('aria-pressed', String(on));
      var t = b.querySelector('span');
      if (t) t.textContent = on ? 'Salvo' : 'Salvar';
    });
    var link = document.querySelector('[data-salvos]');
    if (link) {
      link.hidden = !l.length;
      link.href = '/?salvos=1&ids=' + l.join(',') + '#estoque';
      link.querySelector('[data-salvos-qtd]').textContent = l.length;
    }
  }
  function alternarSalvo(id) {
    var l = guardar.ler();
    var i = l.indexOf(id);
    if (i >= 0) l.splice(i, 1); else l.unshift(id);
    guardar.gravar(l);
    marcarFavoritos();
  }
  // Ao salvar um carro, o cliente pode deixar o WhatsApp para a loja dar retorno.
  var contatoSalvo = function () { try { var c = JSON.parse(localStorage.getItem('contato') || '{}'); return localStorage.getItem('salvos_contato') === '1' && c.nome && c.telefone ? c : null; } catch (e) { return null; } };
  var avisarLoja = function (c, id, nome) {
    return fetch('/api/site/contato', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'interesse', nome: c.nome, telefone: c.telefone, site: c.site || '', veiculo_id: id, mensagem: 'Salvou o ' + nome + ' no site e quer retorno.', dados: { salvou: 'sim' } }),
    });
  };
  var js = document.getElementById('janela-salvar');
  var fs = document.getElementById('form-salvar');
  var salvarPendente = null;
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-favoritar]');
    if (!b) return;
    ev.preventDefault();
    var id = Number(b.dataset.favoritar);
    var nome = b.dataset.nome || 'veículo';
    var jaSalvo = guardar.ler().indexOf(id) >= 0;
    if (jaSalvo) { alternarSalvo(id); return; }
    var c = contatoSalvo();
    if (c) { alternarSalvo(id); avisarLoja(c, id, nome).catch(function () {}); return; }
    var pulou = false;
    try { pulou = sessionStorage.getItem('salvar_sem_contato') === '1'; } catch (e) { /* sem storage */ }
    if (pulou || !js || typeof js.showModal !== 'function') { alternarSalvo(id); return; }
    salvarPendente = { id: id, nome: nome };
    fs.reset();
    fs.querySelector('.erro').hidden = true;
    js.querySelector('[data-salvar-carro]').textContent = nome;
    try { var p = JSON.parse(localStorage.getItem('contato') || '{}'); if (p.nome) fs.nome.value = p.nome; if (p.telefone) fs.telefone.value = p.telefone; } catch (e) { /* sem storage */ }
    js.showModal();
    (fs.nome.value ? fs.querySelector('button[type=submit]') : fs.nome).focus();
  });
  if (js) {
    js.addEventListener('click', function (e) { if (e.target === js) js.close(); });
    js.querySelector('[data-so-salvar]').addEventListener('click', function () {
      try { sessionStorage.setItem('salvar_sem_contato', '1'); } catch (e) { /* sem storage */ }
      if (salvarPendente) alternarSalvo(salvarPendente.id);
      js.close();
    });
    fs.addEventListener('submit', function (e) {
      e.preventDefault();
      var erro = fs.querySelector('.erro');
      if (!fs.reportValidity() || !salvarPendente) return;
      var d = Object.fromEntries(new FormData(fs));
      var botao = fs.querySelector('button[type=submit]');
      botao.disabled = true;
      avisarLoja(d, salvarPendente.id, salvarPendente.nome).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (r) {
        botao.disabled = false;
        if (!r.ok) { erro.textContent = r.j.erro || 'Não foi possível enviar.'; erro.hidden = false; return; }
        try { localStorage.setItem('contato', JSON.stringify({ nome: d.nome, telefone: d.telefone })); localStorage.setItem('salvos_contato', '1'); } catch (er) { /* sem storage */ }
        alternarSalvo(salvarPendente.id);
        js.querySelector('#js-titulo').textContent = 'Carro salvo!';
        js.querySelector('.janela-sub').textContent = 'A ' + loja + ' recebeu seu contato e vai falar com você pelo WhatsApp.';
        fs.hidden = true;
        setTimeout(function () { if (js.open) js.close(); fs.hidden = false; js.querySelector('#js-titulo').textContent = 'Salvar este carro'; }, 2400);
      }).catch(function () {
        botao.disabled = false;
        erro.textContent = 'Sem conexão. Tente de novo.';
        erro.hidden = false;
      });
    });
  }
  marcarFavoritos();

  // ---- Galeria (arrastar no celular, setas, miniaturas, tela cheia) ----
  var g = document.querySelector('[data-galeria]');
  if (g) {
    var palco = g.querySelector('.palco');
    var fotos = palco.querySelectorAll('img');
    var cont = g.querySelector('.contador');
    var minis = g.querySelectorAll('[data-foto]');
    var atual = 0;
    var ir = function (i) {
      if (!fotos.length) return;
      atual = (i + fotos.length) % fotos.length;
      palco.scrollTo({ left: palco.clientWidth * atual, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    var marcar = function () {
      var i = Math.round(palco.scrollLeft / Math.max(1, palco.clientWidth));
      atual = i;
      if (cont) cont.textContent = (i + 1) + '/' + fotos.length;
      minis.forEach(function (m, j) { m.classList.toggle('ativa', j === i); });
    };
    var t;
    palco.addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(marcar, 60); }, { passive: true });
    var telaCheia = function (on) {
      g.classList.toggle('tela-cheia', on);
      document.documentElement.classList.toggle('travado', on);
      setTimeout(function () { ir(atual); }, 30);
    };
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ir],[data-foto],[data-ampliar]');
      if (b && b.dataset.ir) ir(atual + Number(b.dataset.ir));
      else if (b && b.hasAttribute('data-ampliar')) telaCheia(!g.classList.contains('tela-cheia'));
      else if (b) ir(Number(b.dataset.foto));
      else if (e.target.tagName === 'IMG' && e.target.closest('.palco')) telaCheia(!g.classList.contains('tela-cheia'));
    });
    document.addEventListener('keydown', function (e) {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowRight') ir(atual + 1);
      if (e.key === 'ArrowLeft') ir(atual - 1);
      if (e.key === 'Escape' && g.classList.contains('tela-cheia')) telaCheia(false);
    });
    marcar();
  }

  var simAtual = null; // simulador removido; pedidos antigos de financiamento continuam aceitos

  // ---- Pedidos (visita, troca, financiamento) ----
  var janela = document.getElementById('janela');
  var form = document.getElementById('form-contato');
  var TEXTOS = {
    visita: ['Agendar visita', 'Escolha o melhor dia. A loja confirma pelo WhatsApp.'],
    troca: ['Avaliar meu carro na troca', 'Conte qual carro você quer dar na troca.'],
    financiamento: ['Quero esta simulação', 'A loja faz a análise de crédito e responde pelo WhatsApp.'],
    interesse: ['Tenho interesse', ''],
  };
  var CAMPOS_TROCA = '<label>Seu carro (marca e modelo)<input name="t_modelo" required maxlength="60" placeholder="Ex.: Fiat Uno Way 1.0"></label>' +
    '<div class="duas"><label>Ano<input name="t_ano" required inputmode="numeric" maxlength="9" placeholder="2017/2018"></label><label>Quilometragem<input name="t_km" inputmode="numeric" maxlength="9" placeholder="85.000"></label></div>';
  var hoje = new Date();
  var dataMin = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // ---- Agenda de visitas (dias e horários livres vêm prontos do servidor) ----
  var AGENDA = [];
  try { AGENDA = JSON.parse((document.getElementById('agenda-dados') || {}).textContent || '[]'); } catch (e) { AGENDA = []; }
  var SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var dataBr = function (iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); };
  var descreverHorario = function (s) { var d = AGENDA.filter(function (x) { return x.data === s.dia; })[0]; return (d ? SEMANA_LONGA[d.semana] + ', ' : '') + dataBr(s.dia) + ' às ' + s.hora; };
  function montarAgenda(el, aoEscolher) {
    var abertos = AGENDA.filter(function (d) { return d.aberto; });
    if (!abertos.length) { el.innerHTML = '<p class="agenda-vazia">Não há horários livres nos próximos dias. Fale com a loja pelo WhatsApp para combinar.</p>'; return; }
    var diaSel = AGENDA.indexOf(abertos[0]);
    var hora = null;
    var desenhar = function () {
      var d = AGENDA[diaSel];
      var livres = d.horarios.filter(function (h) { return h.livre; }).length;
      el.innerHTML = '<div class="agenda-dias" role="group" aria-label="Dia da visita">' + AGENDA.map(function (x, i) {
        var dt = x.data;
        return '<button type="button" class="agenda-dia" data-dia="' + i + '" aria-pressed="' + (i === diaSel) + '"' + (x.aberto ? '' : ' disabled') + '>' +
          '<small>' + SEMANA[x.semana] + '</small><b>' + Number(dt.slice(8, 10)) + '</b><small>' + (x.aberto ? MESES[Number(dt.slice(5, 7)) - 1] : x.fechado ? 'fechado' : 'esgotado') + '</small></button>';
      }).join('') + '</div>' +
        '<p class="agenda-titulo"><b>' + SEMANA_LONGA[d.semana].charAt(0).toUpperCase() + SEMANA_LONGA[d.semana].slice(1) + ', ' + Number(d.data.slice(8, 10)) + ' de ' + MESES[Number(d.data.slice(5, 7)) - 1] + '</b><span>' + (livres ? livres + ' horário' + (livres === 1 ? '' : 's') + ' livre' + (livres === 1 ? '' : 's') : 'Lotado') + '</span></p>' +
        '<div class="agenda-horas" role="group" aria-label="Horário">' + d.horarios.map(function (h) {
          return '<button type="button" class="agenda-hora" data-hora="' + h.hora + '" aria-pressed="' + (h.hora === hora) + '"' + (h.livre ? '' : ' disabled title="Já reservado"') + '>' + h.hora + '</button>';
        }).join('') + '</div>';
    };
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.dia) { diaSel = Number(b.dataset.dia); hora = null; desenhar(); aoEscolher(null); el.querySelector('[aria-pressed=true]').scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      else if (b.dataset.hora) { hora = b.dataset.hora; desenhar(); aoEscolher({ dia: AGENDA[diaSel].data, hora: hora }); }
    });
    desenhar();
  }
  var paginaAgenda = document.querySelector('[data-agenda-pagina]');
  if (paginaAgenda) {
    var botaoAgendar = document.querySelector('[data-agendar]');
    var escolhido = null;
    montarAgenda(paginaAgenda, function (s) {
      escolhido = s;
      botaoAgendar.disabled = !s;
      botaoAgendar.querySelector('span').textContent = s ? 'Agendar ' + descreverHorario(s) : 'Escolha um horário';
    });
    botaoAgendar.addEventListener('click', function () {
      if (!escolhido) return;
      var carro = document.querySelector('input[name=visita_carro]:checked');
      abrir('visita', { agenda: escolhido, veiculo: carro && carro.value ? carro.value : '', nome: carro && carro.value ? carro.dataset.nome : '' });
    });
  }
  var contexto = {};

  function abrir(tipo, dados) {
    if (!janela || typeof janela.showModal !== 'function') return;
    contexto = dados || {};
    form.reset();
    form.tipo.value = tipo;
    form.veiculo_id.value = contexto.veiculo || '';
    janela.querySelector('#janela-titulo').textContent = TEXTOS[tipo][0];
    janela.querySelector('.janela-sub').textContent = (contexto.nome ? contexto.nome + '. ' : '') + TEXTOS[tipo][1];
    var extra = form.querySelector('.extra');
    extra.innerHTML = tipo === 'troca' && !contexto.troca ? CAMPOS_TROCA : '';
    if (tipo === 'visita') {
      extra.innerHTML = '<input type="hidden" name="v_dia"><input type="hidden" name="v_hora">' +
        (contexto.agenda ? '<p class="agenda-escolhido">' + descreverHorario(contexto.agenda) + '</p>' : '<div class="agenda agenda-mini"></div>');
      var marcar = function (s) { form.v_dia.value = s ? s.dia : ''; form.v_hora.value = s ? s.hora : ''; };
      if (contexto.agenda) marcar(contexto.agenda);
      else montarAgenda(extra.querySelector('.agenda'), marcar);
    }
    form.querySelector('.erro').hidden = true;
    try { var p = JSON.parse(localStorage.getItem('contato') || '{}'); if (p.nome) form.nome.value = p.nome; if (p.telefone) form.telefone.value = p.telefone; } catch (e) { /* sem storage */ }
    janela.showModal();
    (form.querySelector('.extra input:not([type=hidden])') || (form.nome.value ? form.querySelector('button[type=submit]') : form.nome)).focus();
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-abrir]');
    if (!b) return;
    abrir(b.dataset.abrir, { veiculo: b.dataset.veiculo, nome: b.dataset.veiculoNome });
  });
  if (janela) janela.addEventListener('click', function (e) { if (e.target === janela) janela.close(); });

  var formTroca = document.querySelector('[data-troca]');
  if (formTroca) formTroca.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!formTroca.reportValidity()) return;
    var d = Object.fromEntries(new FormData(formTroca));
    abrir('troca', { troca: d });
  });

  function mensagem(tipo, d) {
    var v = contexto.nome ? ' o ' + contexto.nome : '';
    var linhas = ['Olá! Sou ' + d.nome + '.'];
    if (tipo === 'visita') linhas.push('Quero agendar uma visita para ver' + (v || ' os veículos') + ' na ' + descreverHorario({ dia: d.v_dia, hora: d.v_hora }) + '.');
    if (tipo === 'troca') {
      var t = contexto.troca || d;
      linhas.push((contexto.nome ? 'Tenho interesse no ' + contexto.nome + ' e quero dar meu carro na troca: ' : 'Quero uma avaliação do meu carro: ') +
        t.t_modelo + ', ' + t.t_ano + (t.t_km ? ', ' + t.t_km + ' km' : '') + (t.t_quitado ? ' (' + t.t_quitado.toLowerCase() + ')' : '') + '.');
    }
    if (tipo === 'financiamento' && simAtual) linhas.push('Quero financiar' + v + ': entrada de ' + simAtual.entrada + ' e ' + simAtual.prazo + ' de cerca de ' + simAtual.parcela + '.');
    linhas.push(location.href.split('#')[0]);
    return linhas.join('\n');
  }

  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var erro = form.querySelector('.erro');
    if (!form.reportValidity()) return;
    var d = Object.fromEntries(new FormData(form));
    var tipo = d.tipo;
    if (tipo === 'visita' && !d.v_hora) { erro.textContent = 'Escolha o dia e o horário da visita.'; erro.hidden = false; return; }
    var extra = {};
    ['t_modelo', 't_ano', 't_km', 't_quitado', 'v_dia', 'v_hora'].forEach(function (k) { var x = (contexto.troca && contexto.troca[k]) || d[k]; if (x) extra[k] = x; });
    if (tipo === 'financiamento' && simAtual) Object.keys(simAtual).forEach(function (k) { extra[k] = simAtual[k]; });
    var texto = mensagem(tipo, Object.assign({}, d, extra));
    try { localStorage.setItem('contato', JSON.stringify({ nome: d.nome, telefone: d.telefone })); } catch (er) { /* sem storage */ }
    // Abre o WhatsApp já (bloqueadores de pop-up não deixam abrir depois de esperar o servidor)
    if (zap) window.open('https://wa.me/' + zap + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
    var botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    fetch('/api/site/contato', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: tipo, nome: d.nome, telefone: d.telefone, site: d.site, veiculo_id: d.veiculo_id || null, mensagem: texto, dados: extra }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (r) {
      botao.disabled = false;
      if (!r.ok) { erro.textContent = r.j.erro || 'Não foi possível enviar.'; erro.hidden = false; return; }
      janela.querySelector('#janela-titulo').textContent = 'Pedido enviado';
      janela.querySelector('.janela-sub').textContent = 'A ' + loja + ' recebeu seu pedido' + (zap ? ' e a conversa foi aberta no WhatsApp' : '') + '.';
      setTimeout(function () { if (janela.open) janela.close(); }, 2600);
      if (formTroca) formTroca.reset();
    }).catch(function () {
      botao.disabled = false;
      erro.textContent = 'Sem conexão. Tente de novo ou chame a loja pelo WhatsApp.';
      erro.hidden = false;
    });
  });

  // ---- Busca: listas mudam na hora ----
  var busca = document.querySelector('.busca-linha');
  if (busca) busca.querySelectorAll('select').forEach(function (s) { s.addEventListener('change', function () { busca.submit(); }); });

  // ---- Compartilhar ----
  var c = document.querySelector('[data-compartilhar]');
  if (c) c.addEventListener('click', function () {
    var dados = { title: c.dataset.titulo, url: c.dataset.url };
    if (navigator.share) navigator.share(dados).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(dados.url).then(function () { c.querySelector('span').textContent = 'Link copiado'; });
  });

  // ---- Números que contam até o valor quando aparecem ----
  var nums = document.querySelectorAll('[data-contar]');
  var calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (nums.length && 'IntersectionObserver' in window && !calmo) {
    var fmt = function (el, v) {
      var casas = Number(el.dataset.casas || 0);
      el.textContent = (el.dataset.prefixo || '') + v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + (el.dataset.sufixo || '');
    };
    nums.forEach(function (el) { fmt(el, 0); });
    var obs = new IntersectionObserver(function (itens) {
      itens.forEach(function (it) {
        if (!it.isIntersecting) return;
        obs.unobserve(it.target);
        var el = it.target, alvo = Number(el.dataset.contar), t0 = performance.now(), dur = 1400;
        var passo = function (t) {
          var x = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - x, 3);
          var casas = Number(el.dataset.casas || 0), f = Math.pow(10, casas);
          fmt(el, Math.round(alvo * e * f) / f);
          if (x < 1) requestAnimationFrame(passo);
        };
        requestAnimationFrame(passo);
      });
    }, { threshold: 0.6 });
    nums.forEach(function (el) { obs.observe(el); });
  }

  // ======================= Mural: compartilhar a foto =======================
  var fotoMural = document.querySelector('[data-foto-mural]');
  var compartilharFoto = document.querySelector('[data-foto-compartilhar]');
  if (fotoMural && compartilharFoto) {
    var arquivoFoto = null;
    // Baixa a foto antes, para o compartilhamento abrir na hora do toque
    fetch(fotoMural.dataset.fotoMural).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
      if (b) arquivoFoto = new File([b], (fotoMural.dataset.nome || 'cliente').replace(/[^\p{L}\p{N} -]/gu, '') + ' - cliente ' + loja + '.' + (b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'), { type: b.type });
    }).catch(function () {});
    compartilharFoto.addEventListener('click', function () {
      var texto = fotoMural.dataset.nome + ' é cliente ' + loja + '! ' + fotoMural.dataset.url;
      if (arquivoFoto && navigator.canShare && navigator.canShare({ files: [arquivoFoto] })) {
        navigator.share({ files: [arquivoFoto], title: 'Cliente ' + loja, text: texto }).catch(function () {});
      } else if (navigator.share) {
        navigator.share({ title: 'Cliente ' + loja, text: texto, url: fotoMural.dataset.url }).catch(function () {});
      } else {
        var a = document.createElement('a'); a.href = fotoMural.dataset.fotoMural; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
      }
    });
  }
  var copiar = document.querySelector('[data-copiar-link]');
  if (copiar) copiar.addEventListener('click', function () {
    if (navigator.clipboard) navigator.clipboard.writeText(copiar.dataset.copiarLink).then(function () { copiar.querySelector('span').textContent = 'Link copiado'; });
  });
})();
