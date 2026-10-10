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

  // ======================= Mural dos clientes =======================
  var hexRgb = function (h) { h = String(h || '').replace('#', ''); return h.length === 6 ? [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }) : [242, 107, 29]; };
  var misturar = function (a, b, t) { var x = hexRgb(a), y = hexRgb(b); return 'rgb(' + x.map(function (v, i) { return Math.round(v * t + y[i] * (1 - t)); }).join(',') + ')'; };
  var CORES = (function () {
    var marca = corpo.dataset.marca || '#f26b1d';
    var faixa = corpo.dataset.faixa;
    return {
      marca: marca,
      brasa: faixa ? 'rgb(' + hexRgb(faixa).join(',') + ')' : misturar(marca, '#160600', 0.34),
      brasa2: faixa ? misturar(faixa, marca, 0.72) : misturar(marca, '#2b0c02', 0.72),
      brilho: misturar(marca, '#ffe9d6', 0.45),
    };
  })();

  // ---- Envio da foto pelo cliente ----
  var jm = document.getElementById('janela-mural');
  var fm = document.getElementById('form-mural');
  var fotoEscolhida = null;
  var previa = fm && fm.querySelector('[data-previa]');
  var previaVazia = previa ? previa.innerHTML : '';
  function abrirMural() {
    if (!jm || typeof jm.showModal !== 'function') return;
    fm.reset();
    fotoEscolhida = null;
    previa.innerHTML = previaVazia;
    fm.hidden = false;
    jm.querySelector('#jm-titulo').textContent = 'Sua foto no mural';
    fm.dataset.inicio = String(Date.now());
    fm.querySelector('.erro').hidden = true;
    try { var p = JSON.parse(localStorage.getItem('contato') || '{}'); if (p.nome) fm.nome.value = p.nome; if (p.telefone) fm.telefone.value = p.telefone; } catch (e) { /* sem storage */ }
    jm.showModal();
  }
  document.addEventListener('click', function (ev) { if (ev.target.closest('[data-enviar-foto]')) { ev.preventDefault(); abrirMural(); } });
  if (jm) jm.addEventListener('click', function (e) { if (e.target === jm) jm.close(); });

  /** Reduz para no máximo 1600 px e converte em JPEG (isso também apaga os dados de localização da foto). */
  function reduzirFoto(arq) {
    return createImageBitmap(arq).then(function (bmp) {
      var esc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * esc); c.height = Math.round(bmp.height * esc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.86);
    });
  }
  if (fm) {
    fm.foto.addEventListener('change', function () {
      var arq = fm.foto.files && fm.foto.files[0];
      var erro = fm.querySelector('.erro');
      erro.hidden = true;
      if (!arq) return;
      if (arq.size > 25 * 1024 * 1024) { erro.textContent = 'Foto muito grande. Escolha outra.'; erro.hidden = false; return; }
      previa.innerHTML = '<span class="mural-vazio"><b>Preparando a foto…</b></span>';
      reduzirFoto(arq).then(function (url) {
        fotoEscolhida = url;
        var selo = document.querySelector('.mural-selo');
        previa.innerHTML = '<span class="mural-quadro"><img src="' + url + '" alt="Prévia da sua foto"></span><small>Toque para trocar a foto</small>';
        var q = previa.querySelector('.mural-quadro');
        q.insertAdjacentHTML('beforeend', seloHtml());
      }).catch(function () {
        previa.innerHTML = previaVazia;
        erro.textContent = 'Não foi possível abrir esta foto. Envie em JPG ou PNG.';
        erro.hidden = false;
      });
    });
    fm.addEventListener('submit', function (e) {
      e.preventDefault();
      var erro = fm.querySelector('.erro');
      erro.hidden = true;
      if (!fotoEscolhida) { erro.textContent = 'Escolha a foto.'; erro.hidden = false; return; }
      if (!fm.reportValidity()) return;
      var d = Object.fromEntries(new FormData(fm));
      var botao = fm.querySelector('button[type=submit]');
      botao.disabled = true;
      try { localStorage.setItem('contato', JSON.stringify({ nome: d.nome, telefone: d.telefone })); } catch (er) { /* sem storage */ }
      fetch('/api/site/mural', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imagem: fotoEscolhida, nome: d.nome, telefone: d.telefone, veiculo: d.veiculo, cidade: d.cidade, instagram: d.instagram, mensagem: d.mensagem, autorizo: !!d.autorizo, site: d.site, inicio: Number(fm.dataset.inicio) }),
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (r) {
        botao.disabled = false;
        if (!r.ok) { erro.textContent = r.j.erro || 'Não foi possível enviar.'; erro.hidden = false; return; }
        fm.hidden = true;
        jm.querySelector('#jm-titulo').textContent = 'Foto recebida!';
        jm.querySelector('.janela-sub').textContent = 'Obrigado! Sua foto aparece no mural assim que a ' + loja + ' aprovar.';
      }).catch(function () {
        botao.disabled = false;
        erro.textContent = 'Sem conexão. Tente de novo.';
        erro.hidden = false;
      });
    });
  }
  function seloHtml() {
    var logo = corpo.dataset.logo, insta = corpo.dataset.insta;
    var t = function (s) { var x = document.createElement('span'); x.textContent = s; return x.innerHTML; };
    return '<span class="mural-selo"><span class="mural-logo">' + (logo ? '<img src="' + t(logo) + '" alt="">' : t(loja.charAt(0))) + '</span>' +
      '<span class="mural-selo-txt"><b>Sou cliente ' + t(loja) + '</b><span>Venha ser também</span></span></span>' +
      (insta ? '<span class="mural-insta">@' + t(insta) + '</span>' : '');
  }

  // ---- Imagem para compartilhar (formato story 1080×1920, com o selo da loja) ----
  function carregar(src) {
    return new Promise(function (ok, erro) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = erro; i.src = src; });
  }
  function caixa(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  }
  function cobrir(ctx, img, x, y, w, h) {
    var esc = Math.max(w / img.width, h / img.height);
    var dw = img.width * esc, dh = img.height * esc;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function caber(ctx, texto, peso, tam, max) {
    do { ctx.font = peso + ' ' + tam + "px 'Bricolage Grotesque', system-ui, sans-serif"; tam -= 2; } while (ctx.measureText(texto).width > max && tam > 20);
  }
  function gerarArte(foto, nome, detalhes) {
    var fontes = document.fonts ? Promise.all([document.fonts.load("300 66px 'Bricolage Grotesque'"), document.fonts.load("500 40px 'Bricolage Grotesque'")]).catch(function () {}) : Promise.resolve();
    var logoSrc = corpo.dataset.logo;
    return Promise.all([carregar(foto), logoSrc ? carregar(logoSrc).catch(function () { return null; }) : null, fontes]).then(function (r) {
      var img = r[0], logo = r[1];
      var W = 1080, H = 1920;
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var ctx = c.getContext('2d');
      // Fundo em brasa com brilho
      var g = ctx.createLinearGradient(0, 0, W * 0.3, H);
      g.addColorStop(0, CORES.brasa2); g.addColorStop(0.65, CORES.brasa); g.addColorStop(1, CORES.brasa);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var rg = ctx.createRadialGradient(W / 2, H * 0.78, 0, W / 2, H * 0.78, W * 0.75);
      rg.addColorStop(0, CORES.marca); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.75; ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
      // Cabeçalho: logo + nome da loja
      ctx.save(); caixa(ctx, 72, 70, 96, 96, 48); ctx.fillStyle = logo ? 'rgba(255,255,255,.92)' : CORES.marca; ctx.fill(); ctx.clip();
      if (logo) { var e2 = Math.min(76 / logo.width, 76 / logo.height); ctx.drawImage(logo, 120 - logo.width * e2 / 2, 118 - logo.height * e2 / 2, logo.width * e2, logo.height * e2); }
      else { ctx.fillStyle = '#fff'; ctx.font = "700 48px 'Bricolage Grotesque', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(loja.charAt(0), 120, 120); }
      ctx.restore();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      caber(ctx, loja, 500, 46, 760); ctx.fillText(loja, 196, 120);
      // Foto em cartão arredondado
      var fx = 60, fy = 220, fw = 960, fh = 1240;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 30; caixa(ctx, fx, fy, fw, fh, 56); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
      ctx.save(); caixa(ctx, fx, fy, fw, fh, 56); ctx.clip(); cobrir(ctx, img, fx, fy, fw, fh);
      var sombra = ctx.createLinearGradient(0, fy + fh * 0.55, 0, fy + fh); sombra.addColorStop(0, 'rgba(0,0,0,0)'); sombra.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.fillStyle = sombra; ctx.fillRect(fx, fy, fw, fh); ctx.restore();
      // Etiqueta com o nome do cliente
      var etiqueta = nome + (detalhes ? ', ' + detalhes : '');
      caber(ctx, etiqueta, 500, 34, 780);
      var lw = ctx.measureText(etiqueta).width + 56;
      ctx.save(); caixa(ctx, 96, 256, lw, 72, 36); ctx.fillStyle = 'rgba(20,10,5,.45)'; ctx.fill(); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.fillText(etiqueta, 124, 293);
      // Selo de vidro "Sou cliente"
      var bx = 96, by = 1300, bw = 888, bh = 220;
      ctx.save(); caixa(ctx, bx, by, bw, bh, 48); ctx.clip();
      if ('filter' in ctx) { ctx.filter = 'blur(26px)'; cobrir(ctx, img, fx, fy, fw, fh); ctx.filter = 'none'; }
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(bx, by, bw, bh);
      var tom = ctx.createLinearGradient(0, by, 0, by + bh); tom.addColorStop(0, 'rgba(0,0,0,0)'); tom.addColorStop(1, 'rgba(0,0,0,.18)'); ctx.fillStyle = tom; ctx.fillRect(bx, by, bw, bh);
      ctx.restore();
      ctx.save(); caixa(ctx, bx + 1, by + 1, bw - 2, bh - 2, 47); ctx.strokeStyle = 'rgba(255,255,255,.38)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#fff'; caber(ctx, 'Sou cliente ' + loja, 300, 68, bw - 96); ctx.fillText('Sou cliente ' + loja, bx + 48, by + 74);
      ctx.fillStyle = CORES.brilho; caber(ctx, 'Venha ser também', 300, 68, bw - 96); ctx.fillText('Venha ser também', bx + 48, by + 152);
      // Instagram da loja
      var insta = corpo.dataset.insta;
      if (insta) {
        var txt = '@' + insta;
        ctx.font = "400 44px 'Bricolage Grotesque', system-ui, sans-serif";
        var tw = ctx.measureText(txt).width, ix = (W - (tw + 76)) / 2, iy = 1650;
        ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
        caixa(ctx, ix, iy - 28, 56, 56, 16); ctx.stroke();
        ctx.beginPath(); ctx.arc(ix + 28, iy, 13, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(ix + 43, iy - 15, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(txt, ix + 76, iy + 2);
      }
      // Endereço do site
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = "400 32px 'Bricolage Grotesque', system-ui, sans-serif";
      ctx.fillText(corpo.dataset.site || location.host, W / 2, 1830);
      return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.9); });
    });
  }

  var arte = document.querySelector('[data-arte]');
  if (arte) {
    var arteBlob = null;
    var arquivoNome = 'sou-cliente-' + loja.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-') + '.jpg';
    gerarArte(arte.dataset.foto, arte.dataset.nome, arte.dataset.detalhes).then(function (blob) {
      if (!blob) return;
      arteBlob = blob;
      arte.innerHTML = '<img class="arte-img" src="' + URL.createObjectURL(blob) + '" alt="Imagem para compartilhar: ' + arte.dataset.nome + ', cliente ' + loja + '">';
    }).catch(function () { /* fica a foto com o selo em HTML */ });
    var baixar = function () {
      if (!arteBlob) return;
      var a = document.createElement('a'); a.href = URL.createObjectURL(arteBlob); a.download = arquivoNome; document.body.appendChild(a); a.click(); a.remove();
    };
    var compartilhar = document.querySelector('[data-arte-compartilhar]');
    if (compartilhar) compartilhar.addEventListener('click', function () {
      var texto = 'Sou cliente ' + loja + '! Venha ser também: ' + arte.dataset.url;
      if (arteBlob) {
        var f = new File([arteBlob], arquivoNome, { type: 'image/jpeg' });
        var dados = { files: [f], title: 'Sou cliente ' + loja, text: texto };
        if (navigator.canShare && navigator.canShare(dados)) { navigator.share(dados).catch(function () {}); return; }
      }
      if (navigator.share) { navigator.share({ title: 'Sou cliente ' + loja, text: texto, url: arte.dataset.url }).catch(function () {}); return; }
      baixar();
    });
    var b2 = document.querySelector('[data-arte-baixar]');
    if (b2) b2.addEventListener('click', baixar);
  }
  var copiar = document.querySelector('[data-copiar-link]');
  if (copiar) copiar.addEventListener('click', function () {
    if (navigator.clipboard) navigator.clipboard.writeText(copiar.dataset.copiarLink).then(function () { copiar.querySelector('span').textContent = 'Link copiado'; });
  });
})();
