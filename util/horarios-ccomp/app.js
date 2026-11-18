/* ==========================================================================
   app.js — interface do gerenciador de horários
   Depende de core.js (lógica pura). Não traz nenhum horário embutido: o usuário
   carrega um arquivo (.json) ou cria um horário vazio.
   Persistência: localStorage, chave "local.data" (versões + rascunho) e arquivos JSON.
   ========================================================================== */
(function () {
  'use strict';

  const { DIAS, TURNOS, PERIODOS, clonar, novoId, porId } = Core;
  const CHAVE = 'local.data';
  const CHAVE_UI = 'local.data.ui';

  /* ------------------------------------------------------------------ utils */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ptSort = (a, b) => a.localeCompare(b, 'pt-BR');

  /* ----------------------------------------------------------------- estado */
  /*
    Tudo é gravado em localStorage, chave "local.data":
      { schema: 2, versoes: [{ id, nome, criadaEm, salvaEm, dados, log }], atualId, rascunho }
    • versoes  — horários salvos pelo usuário (cada um leva o seu log);
    • atualId  — a versão exibida (marcada pelo usuário);
    • rascunho — alterações ainda NÃO salvas na versão atual (sobrevivem a recarregar a página).
  */
  const agora = () => new Date().toISOString();
  const nomeDoEstado = (e) => [e.config.titulo, e.config.subtitulo].filter(Boolean).join(' — ');
  const fmtDataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
  const fmtData = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  let storageOk = true;
  let store = carregarStore();
  let estado = Core.estadoVazio();   // dados de trabalho da versão atual
  let log = [];                      // log de trabalho da versão atual
  let baseDados = '';                // JSON dos dados como estão salvos na versão atual
  let baseLog = '';
  let conflitos = Core.detectarConflitos(estado);
  const historico = [];
  const ui = Object.assign({ periodo: 'todos', outroDia: false, sabado: false, logVisivel: false }, lerUi(), { vista: 'horario' });

  const versaoAtual = () => porId(store.versoes, store.atualId);
  const modificado = () => !!versaoAtual() && JSON.stringify(estado) !== baseDados;

  function carregarStore() {
    const vazio = { versoes: [], atualId: null, rascunho: null };
    let raw;
    try { raw = localStorage.getItem(CHAVE); } catch (e) { storageOk = false; return vazio; }
    if (!raw) return vazio;
    try {
      const obj = JSON.parse(raw);
      let versoes = [];
      let rascunho = null;
      if (obj && Array.isArray(obj.versoes)) {
        const vistos = new Set();
        versoes = obj.versoes.map((v) => {
          const r = v && Core.normalizarEstado(v.dados);
          if (!r || !r.estado) return null;
          let id = v.id ? String(v.id) : novoId('v');
          if (vistos.has(id)) id = novoId('v');
          vistos.add(id);
          return {
            id, nome: String(v.nome || nomeDoEstado(r.estado) || 'Horário'),
            criadaEm: v.criadaEm || agora(), salvaEm: v.salvaEm || agora(),
            dados: r.estado, log: Core.limparLog(v.log),
          };
        }).filter(Boolean);
        if (obj.rascunho && obj.rascunho.dados) {
          const r = Core.normalizarEstado(obj.rascunho.dados);
          if (r.estado) rascunho = { versaoId: String(obj.rascunho.versaoId), dados: r.estado, log: Core.limparLog(obj.rascunho.log) };
        }
      } else if (obj && (Array.isArray(obj.professores) || Array.isArray(obj.aulas))) {
        // migração: formato da 1ª versão do programa (um único horário, sem versões)
        const r = Core.normalizarEstado(obj);
        if (r.estado) {
          versoes = [{
            id: novoId('v'), nome: nomeDoEstado(r.estado) || 'Horário (migrado)', criadaEm: agora(), salvaEm: agora(), dados: r.estado,
            log: [{ ts: agora(), tipo: 'versao', texto: 'Horário migrado do armazenamento da versão anterior do programa.' }],
          }];
        }
      }
      const atualId = versoes.some((v) => v.id === obj.atualId) ? obj.atualId : (versoes[0] ? versoes[0].id : null);
      if (rascunho && rascunho.versaoId !== atualId) rascunho = null;
      return { versoes, atualId, rascunho };
    } catch (e) {
      return vazio;
    }
  }

  /* Coloca uma versão em exibição (com o rascunho dela, se houver). */
  function entrarNaVersao(id, rascunho) {
    const v = porId(store.versoes, id);
    store.atualId = id;
    baseDados = JSON.stringify(v.dados);
    baseLog = JSON.stringify(v.log);
    if (rascunho && rascunho.versaoId === id) { estado = clonar(rascunho.dados); log = clonar(rascunho.log); }
    else { estado = clonar(v.dados); log = clonar(v.log); }
    historico.length = 0;
  }

  function lerUi() {
    try { return JSON.parse(localStorage.getItem(CHAVE_UI)) || {}; } catch (e) { return {}; }
  }
  function salvarUi() {
    try {
      localStorage.setItem(CHAVE_UI, JSON.stringify({ periodo: ui.periodo, outroDia: ui.outroDia, sabado: ui.sabado, logVisivel: ui.logVisivel }));
    } catch (e) { /* preferências de tela: sem aviso */ }
  }

  /* Grava versões + rascunho no navegador. */
  function persistir() {
    const temRascunho = !!versaoAtual() && (JSON.stringify(estado) !== baseDados || JSON.stringify(log) !== baseLog);
    store.rascunho = temRascunho ? { versaoId: store.atualId, dados: estado, log } : null;
    try {
      localStorage.setItem(CHAVE, JSON.stringify({ schema: 2, versoes: store.versoes, atualId: store.atualId, rascunho: store.rascunho }));
      storageOk = true;
    } catch (e) { storageOk = false; }
    mostrarStatus(true);
  }
  function mostrarStatus(gravou) {
    const el = $('#statusSalvo');
    if (!storageOk) {
      el.textContent = '⚠ Armazenamento local indisponível: nada será mantido ao fechar a página';
      el.classList.add('erro');
      return;
    }
    el.classList.remove('erro');
    if (!gravou) { el.textContent = ''; return; }
    const h = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    el.textContent = '✓ Gravado neste navegador às ' + h;
  }

  function registrarLog(entradas, prefixo) {
    const ts = agora();
    entradas.forEach((e) => log.push({ ts, tipo: e.tipo, texto: (prefixo || '') + e.texto }));
    if (log.length > 1000) log.splice(0, log.length - 1000);
  }

  /* Toda alteração passa por aqui: guarda snapshot (desfazer), muda, registra no log, grava, redesenha. */
  function commit(mutar) {
    const antes = clonar(estado);
    historico.push(JSON.stringify(estado));
    if (historico.length > 100) historico.shift();
    mutar(estado);
    registrarLog(Core.diffEstados(antes, estado));
    persistir();
    atualizar();
  }
  function desfazer() {
    if (!historico.length) return;
    const antes = clonar(estado);
    estado = JSON.parse(historico.pop());
    registrarLog(Core.diffEstados(antes, estado), '↶ Desfeito — ');
    persistir();
    atualizar();
    toast('Alteração desfeita.');
  }

  /* ---------------------------------------------------------------- acessos */
  const disc = (id) => porId(estado.disciplinas, id);
  const prof = (id) => porId(estado.professores, id);
  const sala = (id) => porId(estado.salas, id);
  const turnoDe = (id) => TURNOS.find((t) => t.id === id);
  const diaDe = (id) => DIAS.find((d) => d.id === id);

  function aulasDaCelula(periodo, dia, turno) {
    return estado.aulas
      .filter((a) => a.dia === dia && a.turno === turno && Core.periodoDaAula(estado, a) === periodo)
      .sort((x, y) => ptSort(disc(x.disciplinaId).curto, disc(y.disciplinaId).curto));
  }

  function detalhesAula(a) {
    const d = disc(a.disciplinaId);
    const s = a.salaId ? sala(a.salaId) : null;
    const ps = a.professorIds.map(prof).filter(Boolean);
    const t = turnoDe(a.turno);
    return {
      titulo: d.nome + ' (' + d.curto + ')',
      sub: d.periodo + 'º período · ' + diaDe(a.dia).nome + ', ' + t.nome.toLowerCase() + ' (' + t.horario + ')',
      prof: ps.length ? ps.map((p) => p.nome).join(', ') : 'a definir',
      sala: s ? s.nome + ' (' + s.curto + ')' + (s.quantidade != null ? ' · ' + s.quantidade + ' lugares' : '') : 'a definir',
      conflitos: Core.descreverConflitos(estado, conflitos, a),
    };
  }

  /* ------------------------------------------------- documento (grade) HTML */
  function htmlAula(a, interativo) {
    const d = disc(a.disciplinaId);
    const s = a.salaId ? sala(a.salaId) : null;
    const ps = a.professorIds.map(prof).filter(Boolean);
    const c = conflitos.porAula[a.id];
    const temProf = !!(c && c.professor.length);
    const temSala = !!(c && c.sala);
    const cls = ['aula'];
    if (temProf && temSala) cls.push('conf-ambos');
    else if (temProf) cls.push('conf-prof');
    else if (temSala) cls.push('conf-sala');
    const alerta = temProf || temSala
      ? '<div class="a-alerta">⚠ conflito: ' + [temProf && 'professor', temSala && 'sala'].filter(Boolean).join(' + ') + '</div>'
      : '';
    const det = detalhesAula(a);
    const resumo = [det.titulo, det.sub, 'Professor(es): ' + det.prof, 'Sala: ' + det.sala]
      .concat(det.conflitos.map((x) => '⚠ ' + x.texto));

    const attrs = interativo
      ? ' data-aula="' + esc(a.id) + '" draggable="true" tabindex="0" role="button" aria-label="' + esc(resumo.join('. ')) + '"'
      : ' title="' + esc(resumo.join('\n')) + '"';

    return (
      '<div class="' + cls.join(' ') + '"' + attrs + '>' +
        '<div class="a-nome">' + esc(d.curto) + '</div>' +
        '<div class="a-sala">' + (s ? esc(s.curto) : '<span class="indef">Sala a definir</span>') + '</div>' +
        '<div class="a-prof">' + (ps.length ? ps.map((p) => esc(p.curto)).join(' / ') : '<span class="indef">Docente a definir</span>') + '</div>' +
        alerta +
      '</div>'
    );
  }

  function htmlPeriodo(p, interativo) {
    const temSabado = estado.aulas.some((a) => a.dia === 'sab' && Core.periodoDaAula(estado, a) === p);
    const dias = DIAS.filter((d) => d.id !== 'sab' || ui.sabado || temSabado);
    const colunas = dias.length + 1;

    const linhas = TURNOS.map((t) => {
      const celulas = dias.map((d) => {
        const blocos = aulasDaCelula(p, d.id, t.id).map((a) => htmlAula(a, interativo)).join('');
        const mais = interativo
          ? '<button type="button" class="add-aula" aria-label="Adicionar aula: ' + d.nome + ', ' + t.nome.toLowerCase() + '" title="Adicionar aula">+</button>'
          : '';
        return '<td class="celula" data-periodo="' + p + '" data-dia="' + d.id + '" data-turno="' + t.id + '">' + blocos + mais + '</td>';
      }).join('');
      return '<tr><td class="turno">' + esc(t.horario) + '</td>' + celulas + '</tr>';
    }).join('');

    return (
      '<div class="periodo" data-periodo="' + p + '"><table class="grade">' +
        '<thead>' +
          '<tr><th class="per-titulo" colspan="' + colunas + '">' + p + 'º PERÍODO</th></tr>' +
          '<tr><th class="dia">Horário</th>' + dias.map((d) => '<th class="dia">' + d.nome + '</th>').join('') + '</tr>' +
        '</thead><tbody>' + linhas + '</tbody></table></div>'
    );
  }

  function periodosVisiveis() {
    return ui.periodo === 'todos' ? PERIODOS.slice() : [Number(ui.periodo)];
  }

  function htmlDocumento(interativo) {
    const c = estado.config;
    // título e subtítulo: editáveis direto no documento (só na tela; na exportação/impressão são texto)
    const linhaCab = (k, rotulo) => interativo
      ? '<div class="cab-edit" contenteditable="true" spellcheck="false" role="textbox" aria-label="' + rotulo + ' do horário" data-campo="' + k + '" data-ph="' + rotulo + ' (clique para editar)" title="Clique para editar o ' + rotulo.toLowerCase() + '">' + esc(c[k]) + '</div>'
      : (c[k] ? '<div>' + esc(c[k]) + '</div>' : '');
    const cab = '<div class="doc-cab">' + linhaCab('titulo', 'Título') + linhaCab('subtitulo', 'Subtítulo') + '</div>';
    const rod = (c.coordenador || c.cargo || c.unidade)
      ? '<div class="doc-rodape">' +
          [c.coordenador, c.cargo, c.unidade].filter(Boolean).map((x) => '<div>' + esc(x) + '</div>').join('') +
        '</div>'
      : '';

    const ps = periodosVisiveis();
    const paginas = [];
    for (let i = 0; i < ps.length; i += 2) paginas.push(ps.slice(i, i + 2));

    return (
      '<div class="doc">' +
      paginas.map((par, i) =>
        '<div class="pagina">' +
          (i === 0 ? cab : '') +
          par.map((p) => htmlPeriodo(p, interativo)).join('') +
          (i === paginas.length - 1 ? rod : '') +
        '</div>'
      ).join('') +
      '</div>'
    );
  }

  /* ------------------------------------------------------------ renderização */
  function atualizar() {
    conflitos = Core.detectarConflitos(estado);
    renderTopo();
    renderVista();
  }

  function renderTopo() {
    const vazio = !store.versoes.length;
    document.body.classList.toggle('vazio', vazio);
    $('#boasVindas').hidden = !vazio;
    const v = versaoAtual();
    document.title = (v ? v.nome + ' — ' : '') + 'Horários CCOMP';
    $('#subtituloTopo').textContent = vazio ? 'Nenhum horário carregado' : (estado.config.subtitulo || estado.config.titulo || '');

    const n = conflitos.lista.length;
    const b = $('#btnConflitos');
    b.className = 'btn ' + (n ? 'tem-conf' : 'ok');
    b.textContent = n ? '⚠ ' + n + (n === 1 ? ' conflito' : ' conflitos') : '✓ Sem conflitos';
    $('#btnDesfazer').disabled = historico.length === 0;
    if (vazio) return;

    const mod = modificado();
    $('#selVersao').innerHTML = store.versoes.map((x) =>
      '<option value="' + esc(x.id) + '"' + (x.id === store.atualId ? ' selected' : '') + '>' + esc(x.nome) + (x.id === store.atualId && mod ? '   ● não salva' : '') + '</option>'
    ).join('');
    $('#indModificado').hidden = !mod;
    $('#btnSalvarVersao').disabled = !mod;
    $('#btnDescartar').hidden = !mod;
  }

  function renderVista() {
    if (!store.versoes.length) return;
    if (ui.vista === 'horario') renderHorario();
    else renderCrud(ui.vista);
  }

  function renderHorario() {
    $('#documento').innerHTML = htmlDocumento(true);
    renderLog();
  }

  /* log de alterações: abaixo do horário, oculto por padrão */
  const formatarLog = (t) => esc(t).replace(/«([^»]*)»/g, '<b>$1</b>');

  function renderLog() {
    const painel = $('#painelLog');
    const btn = $('#btnLog');
    btn.textContent = (ui.logVisivel ? '▾ Ocultar' : '▸ Mostrar') + ' log de alterações (' + log.length + ')';
    btn.setAttribute('aria-expanded', String(ui.logVisivel));
    painel.hidden = !ui.logVisivel;
    if (!ui.logVisivel) return;
    const v = versaoAtual();
    $('#logTitulo').textContent = 'Log de alterações' + (v ? ' — ' + v.nome : '');
    $('#logLista').innerHTML = log.length
      ? log.slice().reverse().map((e) =>
          '<li class="log-' + esc(e.tipo || 'outro') + '"><time datetime="' + esc(e.ts) + '">' + esc(fmtDataHora(e.ts)) + '</time><span>' + formatarLog(e.texto) + '</span></li>'
        ).join('')
      : '<li class="vazio">Nenhuma alteração registrada nesta versão.</li>';
  }

  function baixarLog() {
    const v = versaoAtual();
    const linhas = log.map((e) => '[' + fmtDataHora(e.ts) + '] ' + e.texto.replace(/[«»]/g, ''));
    baixar(linhas.join('\n') + '\n', 'log-' + slug(v ? v.nome : 'horario') + '.txt', 'text/plain;charset=utf-8');
    toast('Log exportado (' + linhas.length + ' registro(s)).');
  }

  function irParaVista(v) {
    ui.vista = v;
    $$('.abas button').forEach((b) => {
      const ativa = b.dataset.vista === v;
      b.classList.toggle('ativa', ativa);
      b.setAttribute('aria-selected', ativa);
    });
    $$('.vista').forEach((s) => s.classList.toggle('ativa', s.id === 'vista-' + v));
    renderVista();
  }

  /* --------------------------------------------- horário: arrastar e soltar */
  let arrastoId = null;
  const docEl = $('#documento');

  function limparArrasto() {
    arrastoId = null;
    document.body.classList.remove('arrastando');
    $$('.arrastando', docEl).forEach((e) => e.classList.remove('arrastando'));
    $$('.celula', docEl).forEach((c) => c.classList.remove('drop-ok', 'drop-no', 'drop-hover'));
  }

  /* Uma célula é destino válido? (mesmo período; por padrão só mudar de turno no mesmo dia) */
  function celulaValida(c) {
    const a = arrastoId && porId(estado.aulas, arrastoId);
    if (!a || !c) return false;
    return Core.podeMover(estado, a,
      { periodo: Number(c.dataset.periodo), dia: c.dataset.dia, turno: c.dataset.turno },
      { outroDia: ui.outroDia });
  }

  docEl.addEventListener('dragstart', (e) => {
    const el = e.target.closest && e.target.closest('.aula');
    if (!el) return;
    arrastoId = el.dataset.aula;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', arrastoId);
    esconderTip();
    // destinos válidos: marcados já, sem esperar (um arrasto rápido não pode perder o alvo)
    document.body.classList.add('arrastando');
    $$('.celula', docEl).forEach((c) => {
      const ok = celulaValida(c);
      c.classList.toggle('drop-ok', ok);
      c.classList.toggle('drop-no', !ok);
    });
    // só o bloco arrastado espera: se ficasse translúcido já aqui, a imagem do arrasto também ficaria
    setTimeout(() => { if (arrastoId) el.classList.add('arrastando'); }, 0);
  });

  docEl.addEventListener('dragover', (e) => {
    if (!arrastoId) return;
    const c = e.target.closest('.celula');
    if (!celulaValida(c)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!c.classList.contains('drop-hover')) {
      $$('.drop-hover', docEl).forEach((x) => x.classList.remove('drop-hover'));
      c.classList.add('drop-hover');
    }
  });

  docEl.addEventListener('drop', (e) => {
    if (!arrastoId) return;
    const c = e.target.closest('.celula');
    if (!celulaValida(c)) return;
    e.preventDefault();
    const id = arrastoId;
    limparArrasto();
    moverAula(id, c.dataset.dia, c.dataset.turno);
  });

  docEl.addEventListener('dragend', limparArrasto);

  function moverAula(id, dia, turno) {
    const a = porId(estado.aulas, id);
    if (!a || (a.dia === dia && a.turno === turno)) return;
    const nome = disc(a.disciplinaId).curto;
    commit((s) => {
      const x = porId(s.aulas, id);
      x.dia = dia;
      x.turno = turno;
    });
    const c = conflitos.porAula[id];
    let msg = '«' + nome + '» movida para ' + diaDe(dia).nome + ', ' + turnoDe(turno).nome.toLowerCase() + '.';
    let aviso = false;
    if (c && (c.sala || c.professor.length)) {
      aviso = true;
      msg += ' ⚠ Gera conflito de ' + [c.professor.length && 'professor', c.sala && 'sala'].filter(Boolean).join(' e ') + '.';
    }
    toast(msg, { acao: 'Desfazer', aoAcao: desfazer, tipo: aviso ? 'aviso' : '', ms: 6500 });
    destacar(id);
  }

  function destacar(id) {
    const el = $('[data-aula="' + id + '"]', docEl);
    if (!el) return;
    el.classList.add('piscar');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ---------------------------------------------------------------- tooltip */
  const tip = $('#tooltip');
  function mostrarTip(el, x, y) {
    const a = porId(estado.aulas, el.dataset.aula);
    if (!a) return;
    const d = detalhesAula(a);
    tip.innerHTML =
      '<strong>' + esc(d.titulo) + '</strong><div class="sub">' + esc(d.sub) + '</div>' +
      '<dl><dt>Professor(es)</dt><dd>' + esc(d.prof) + '</dd><dt>Sala</dt><dd>' + esc(d.sala) + '</dd></dl>' +
      d.conflitos.map((c) => '<div class="conf conf-' + c.tipo + '">⚠ ' + esc(c.texto) + '</div>').join('');
    tip.hidden = false;
    posicionarTip(x, y);
  }
  function posicionarTip(x, y) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let l = x + 16, t = y + 18;
    if (l + w > window.innerWidth - 8) l = Math.max(8, x - w - 16);
    if (t + h > window.innerHeight - 8) t = Math.max(8, y - h - 16);
    tip.style.left = l + 'px';
    tip.style.top = t + 'px';
  }
  function esconderTip() { tip.hidden = true; }

  docEl.addEventListener('mouseover', (e) => {
    if (arrastoId) return;
    const el = e.target.closest('.aula');
    if (el) mostrarTip(el, e.clientX, e.clientY);
  });
  docEl.addEventListener('mousemove', (e) => { if (!tip.hidden) posicionarTip(e.clientX, e.clientY); });
  docEl.addEventListener('mouseout', (e) => {
    const el = e.target.closest('.aula');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    esconderTip();
  });
  docEl.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('.aula');
    if (!el) return;
    const r = el.getBoundingClientRect();
    mostrarTip(el, r.left + 12, r.bottom - 4);
  });
  docEl.addEventListener('focusout', esconderTip);

  docEl.addEventListener('click', (e) => {
    const mais = e.target.closest('.add-aula');
    if (mais) {
      const c = mais.closest('.celula');
      abrirEditorAula({ periodo: Number(c.dataset.periodo), dia: c.dataset.dia, turno: c.dataset.turno });
      return;
    }
    const el = e.target.closest('.aula');
    if (el) { esconderTip(); abrirEditorAula({ id: el.dataset.aula }); }
  });
  docEl.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('aula')) {
      e.preventDefault();
      esconderTip();
      abrirEditorAula({ id: e.target.dataset.aula });
    }
  });

  /* ------------------------------------------------------- diálogos básicos */
  function abrirDialogo(dlg) {
    if (!dlg.open) dlg.showModal();
  }

  /* Diálogo com N botões; resolve com o "valor" do botão ('cancelar' se fechado com Esc). */
  function escolher({ titulo, mensagem, botoes }) {
    return new Promise((resolve) => {
      const dlg = $('#dlgConfirma');
      dlg.innerHTML =
        '<form method="dialog"><div class="dlg-cab">' + esc(titulo) + '</div>' +
        '<div class="dlg-corpo"><p style="margin:0">' + mensagem + '</p></div>' +
        '<div class="dlg-rod">' +
        botoes.map((b) => '<button class="btn ' + (b.cls || '') + '" value="' + b.valor + '" type="submit">' + esc(b.rotulo) + '</button>').join('') +
        '</div></form>';
      dlg.returnValue = '';
      dlg.onclose = () => resolve(dlg.returnValue || 'cancelar');
      dlg.showModal();
    });
  }

  function confirmar({ titulo, mensagem, ok, perigo }) {
    return escolher({
      titulo, mensagem,
      botoes: [
        { valor: 'cancelar', rotulo: 'Cancelar' },
        { valor: 'ok', rotulo: ok || 'Confirmar', cls: perigo ? 'btn-perigo' : 'btn-primario' },
      ],
    }).then((v) => v === 'ok');
  }

  /* Pede um texto; resolve com o texto ou null (cancelado). */
  function pedirTexto({ titulo, rotulo, valor, ok, validar }) {
    return new Promise((resolve) => {
      const dlg = $('#dlgTexto');
      dlg.innerHTML =
        '<form novalidate><div class="dlg-cab">' + esc(titulo) + '</div>' +
        '<div class="dlg-corpo"><label class="campo"><span>' + esc(rotulo) + '</span><input type="text" name="v" autocomplete="off"><span class="erro-campo"></span></label></div>' +
        '<div class="dlg-rod"><button type="button" class="btn" data-cancelar>Cancelar</button><button type="submit" class="btn btn-primario">' + esc(ok || 'OK') + '</button></div></form>';
      const f = $('form', dlg);
      let resultado = null;
      f.v.value = valor || '';
      $('[data-cancelar]', dlg).onclick = () => dlg.close();
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = f.v.value.trim();
        const erro = !v ? 'Informe um nome.' : (validar ? validar(v) : '');
        if (erro) { $('.erro-campo', f).textContent = erro; return; }
        resultado = v;
        dlg.close();
      });
      dlg.onclose = () => resolve(resultado);
      dlg.showModal();
      f.v.focus();
      f.v.select();
    });
  }

  function toast(msg, opc) {
    opc = opc || {};
    const el = document.createElement('div');
    el.className = 'toast ' + (opc.tipo || '');
    const sp = document.createElement('span');
    sp.textContent = msg;
    el.appendChild(sp);
    if (opc.acao) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = opc.acao;
      b.onclick = () => { opc.aoAcao(); el.remove(); };
      el.appendChild(b);
    }
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), opc.ms || 4500);
  }

  /* ---------------------------------------------------------- editor de aula */
  function abrirEditorAula(opc) {
    opc = opc || {};
    const existente = opc.id ? porId(estado.aulas, opc.id) : null;
    const base = existente || {
      id: '__novo__', disciplinaId: '', professorIds: [], salaId: null,
      dia: opc.dia || 'seg', turno: opc.turno || 'manha',
    };
    const soPeriodo = !existente && opc.periodo ? opc.periodo : null;
    const lista = estado.disciplinas.filter((d) => !soPeriodo || d.periodo === soPeriodo);
    if (!lista.length) {
      toast('Cadastre antes uma disciplina' + (soPeriodo ? ' do ' + soPeriodo + 'º período' : '') + ' na aba Disciplinas.', { tipo: 'aviso' });
      return;
    }

    const porPeriodo = {};
    lista.forEach((d) => (porPeriodo[d.periodo] = porPeriodo[d.periodo] || []).push(d));
    const optsDisc =
      '<option value="">Selecione…</option>' +
      Object.keys(porPeriodo).sort((a, b) => a - b).map((p) =>
        '<optgroup label="' + p + 'º período">' +
        porPeriodo[p].sort((a, b) => ptSort(a.nome, b.nome)).map((d) =>
          '<option value="' + esc(d.id) + '"' + (d.id === base.disciplinaId ? ' selected' : '') + '>' + esc(d.nome) + ' (' + esc(d.curto) + ')</option>'
        ).join('') + '</optgroup>'
      ).join('');

    const checks = estado.professores.slice().sort((a, b) => ptSort(a.nome, b.nome)).map((p) =>
      '<label><input type="checkbox" name="prof" value="' + esc(p.id) + '"' + (base.professorIds.includes(p.id) ? ' checked' : '') + '> ' + esc(p.nome) + '</label>'
    ).join('');

    const optsSala = '<option value="">— A definir —</option>' +
      estado.salas.slice().sort((a, b) => ptSort(a.curto, b.curto)).map((s) =>
        '<option value="' + esc(s.id) + '"' + (s.id === base.salaId ? ' selected' : '') + '>' + esc(s.curto) + ' · ' + esc(s.nome) + '</option>'
      ).join('');
    const optsDia = DIAS.map((d) => '<option value="' + d.id + '"' + (d.id === base.dia ? ' selected' : '') + '>' + d.nome + '</option>').join('');
    const optsTurno = TURNOS.map((t) => '<option value="' + t.id + '"' + (t.id === base.turno ? ' selected' : '') + '>' + t.nome + ' (' + t.horario + ')</option>').join('');

    const dlg = $('#dlgAula');
    dlg.innerHTML =
      '<form>' +
        '<div class="dlg-cab">' + (existente ? 'Editar aula' : 'Nova aula') + '</div>' +
        '<div class="dlg-corpo">' +
          '<label class="campo"><span>Disciplina' + (soPeriodo ? ' <small>(' + soPeriodo + 'º período)</small>' : '') + '</span><select name="disciplina" required>' + optsDisc + '</select></label>' +
          '<div class="campo"><span class="campo-rotulo">Professor(es) <small>— nenhum marcado = “docente a definir”</small></span><div class="lista-checks">' + (checks || '<span class="mudo">Nenhum professor cadastrado.</span>') + '</div></div>' +
          '<label class="campo"><span>Sala</span><select name="sala">' + optsSala + '</select></label>' +
          '<div class="grid2">' +
            '<label class="campo"><span>Dia</span><select name="dia">' + optsDia + '</select></label>' +
            '<label class="campo"><span>Turno</span><select name="turno">' + optsTurno + '</select></label>' +
          '</div>' +
          '<div id="previaConf" aria-live="polite"></div>' +
        '</div>' +
        '<div class="dlg-rod">' +
          (existente ? '<button type="button" class="btn btn-perigo esq" data-excluir>Excluir aula</button>' : '') +
          '<button type="button" class="btn" data-cancelar>Cancelar</button>' +
          '<button type="submit" class="btn btn-primario">Salvar</button>' +
        '</div>' +
      '</form>';

    const f = $('form', dlg);
    const ler = () => ({
      disciplinaId: f.disciplina.value,
      professorIds: $$('input[name=prof]:checked', f).map((i) => i.value),
      salaId: f.sala.value || null,
      dia: f.dia.value,
      turno: f.turno.value,
    });
    const previa = () => {
      const v = ler();
      const alvo = $('#previaConf', dlg);
      if (!v.disciplinaId) { alvo.innerHTML = ''; return; }
      const rascunho = Object.assign({ id: base.id }, v);
      const sim = Object.assign({}, estado, { aulas: estado.aulas.filter((a) => a.id !== base.id).concat([rascunho]) });
      const textos = Core.descreverConflitos(sim, Core.detectarConflitos(sim), rascunho);
      alvo.innerHTML = textos.length
        ? textos.map((t) => '<div class="aviso-conf ' + t.tipo + '">⚠ ' + esc(t.texto) + '</div>').join('')
        : '<div class="aviso-conf ok">Sem conflitos neste horário.</div>';
    };
    f.addEventListener('change', previa);
    previa();

    $('[data-cancelar]', dlg).onclick = () => dlg.close();
    const bExcluir = $('[data-excluir]', dlg);
    if (bExcluir) {
      bExcluir.onclick = async () => {
        const nome = disc(existente.disciplinaId).nome;
        if (await confirmar({ titulo: 'Excluir aula', mensagem: 'Remover esta aula de <b>' + esc(nome) + '</b> (' + esc(diaDe(existente.dia).nome) + ', ' + esc(turnoDe(existente.turno).nome.toLowerCase()) + ')?', ok: 'Excluir', perigo: true })) {
          dlg.close();
          commit((s) => { s.aulas = s.aulas.filter((a) => a.id !== existente.id); });
          toast('Aula excluída.', { acao: 'Desfazer', aoAcao: desfazer });
        }
      };
    }
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = ler();
      if (!v.disciplinaId) return;
      let idFinal = existente ? existente.id : novoId('a');
      commit((s) => {
        if (existente) Object.assign(porId(s.aulas, existente.id), v);
        else s.aulas.push(Object.assign({ id: idFinal }, v));
      });
      dlg.close();
      const c = conflitos.porAula[idFinal];
      if (c && (c.sala || c.professor.length)) toast('Aula salva, mas há conflito de ' + [c.professor.length && 'professor', c.sala && 'sala'].filter(Boolean).join(' e ') + '.', { tipo: 'aviso' });
      destacar(idFinal);
    });
    abrirDialogo(dlg);
  }

  /* -------------------------------------------------------- CRUD (3 tabelas) */
  const contaAulas = {
    professores: (i) => estado.aulas.filter((a) => a.professorIds.includes(i.id)).length,
    salas: (i) => estado.aulas.filter((a) => a.salaId === i.id).length,
    disciplinas: (i) => estado.aulas.filter((a) => a.disciplinaId === i.id).length,
  };

  const ENT = {
    professores: {
      titulo: 'Professores', singular: 'professor', prefixo: 'p',
      campos: [
        { k: 'nome', rotulo: 'Nome', tipo: 'text' },
        { k: 'curto', rotulo: 'Nome curto', tipo: 'text', dica: 'É o que aparece no horário. Ex.: George B.' },
      ],
      colunas: [
        { rotulo: 'Nome', v: (i) => esc(i.nome) },
        { rotulo: 'Nome curto', v: (i) => '<span class="etiqueta">' + esc(i.curto) + '</span>' },
        { rotulo: 'Aulas', cls: 'num', v: (i) => contaAulas.professores(i) },
      ],
      ordenar: (a, b) => ptSort(a.nome, b.nome),
      texto: (i) => i.nome + ' ' + i.curto,
    },
    salas: {
      titulo: 'Salas', singular: 'sala', prefixo: 's',
      campos: [
        { k: 'nome', rotulo: 'Nome', tipo: 'text', dica: 'Ex.: Bloco 3, Sala 110' },
        { k: 'curto', rotulo: 'Nome curto', tipo: 'text', dica: 'É o que aparece no horário. Ex.: B3-110' },
        { k: 'quantidade', rotulo: 'Quantidade (lugares)', tipo: 'number', opcional: true, dica: 'Opcional — o PDF original não informa a capacidade.' },
      ],
      colunas: [
        { rotulo: 'Nome', v: (i) => esc(i.nome) },
        { rotulo: 'Nome curto', v: (i) => '<span class="etiqueta">' + esc(i.curto) + '</span>' },
        { rotulo: 'Quantidade', cls: 'num', v: (i) => (i.quantidade == null ? '<span class="mudo">—</span>' : i.quantidade) },
        { rotulo: 'Aulas', cls: 'num', v: (i) => contaAulas.salas(i) },
      ],
      ordenar: (a, b) => ptSort(a.curto, b.curto),
      texto: (i) => i.nome + ' ' + i.curto,
    },
    disciplinas: {
      titulo: 'Disciplinas', singular: 'disciplina', prefixo: 'd',
      campos: [
        { k: 'nome', rotulo: 'Nome', tipo: 'text' },
        { k: 'periodo', rotulo: 'Período', tipo: 'periodo' },
        { k: 'curto', rotulo: 'Nome curto', tipo: 'text', dica: 'É o que aparece no horário. Ex.: ED I' },
      ],
      colunas: [
        { rotulo: 'Período', v: (i) => '<span class="etiqueta">' + i.periodo + 'º</span>' },
        { rotulo: 'Nome', v: (i) => esc(i.nome) },
        { rotulo: 'Nome curto', v: (i) => '<span class="etiqueta">' + esc(i.curto) + '</span>' },
        { rotulo: 'Aulas', cls: 'num', v: (i) => contaAulas.disciplinas(i) },
      ],
      ordenar: (a, b) => a.periodo - b.periodo || ptSort(a.nome, b.nome),
      texto: (i) => i.nome + ' ' + i.curto,
    },
  };
  const crudFiltro = { professores: { q: '' }, salas: { q: '' }, disciplinas: { q: '', periodo: '' } };

  function renderCrud(chave) {
    const E = ENT[chave];
    const el = $('#vista-' + chave);
    const f = crudFiltro[chave];
    const filtroPeriodo = chave === 'disciplinas'
      ? '<select data-f-periodo aria-label="Filtrar por período"><option value="">Todos os períodos</option>' +
        PERIODOS.map((p) => '<option value="' + p + '"' + (String(f.periodo) === String(p) ? ' selected' : '') + '>' + p + 'º período</option>').join('') + '</select>'
      : '';
    el.innerHTML =
      '<div class="crud-cab"><h2>' + E.titulo + ' <span class="mudo" data-total></span></h2>' + filtroPeriodo +
        '<input type="search" data-busca placeholder="Buscar…" aria-label="Buscar" value="' + esc(f.q) + '">' +
        '<button type="button" class="btn btn-primario" data-novo>+ Novo ' + E.singular + '</button></div>' +
      '<div class="tabela-wrap"><table class="tabela"><thead><tr>' +
        E.colunas.map((c) => '<th class="' + (c.cls || '') + '">' + c.rotulo + '</th>').join('') + '<th></th></tr></thead>' +
        '<tbody></tbody></table></div>';
    renderLinhas(chave);

    $('[data-busca]', el).oninput = (e) => { f.q = e.target.value; renderLinhas(chave); };
    const sp = $('[data-f-periodo]', el);
    if (sp) sp.onchange = (e) => { f.periodo = e.target.value; renderLinhas(chave); };
    $('[data-novo]', el).onclick = () => abrirEditorEntidade(chave, null);
  }

  function renderLinhas(chave) {
    const E = ENT[chave];
    const el = $('#vista-' + chave);
    const f = crudFiltro[chave];
    const q = norm(f.q);
    const itens = estado[chave]
      .filter((i) => !q || norm(E.texto(i)).includes(q))
      .filter((i) => chave !== 'disciplinas' || !f.periodo || String(i.periodo) === String(f.periodo))
      .sort(E.ordenar);
    $('[data-total]', el).textContent = '(' + itens.length + (itens.length !== estado[chave].length ? ' de ' + estado[chave].length : '') + ')';
    $('tbody', el).innerHTML = itens.length
      ? itens.map((i) =>
          '<tr>' + E.colunas.map((c) => '<td class="' + (c.cls || '') + '">' + c.v(i) + '</td>').join('') +
          '<td class="acoes"><button type="button" class="btn btn-peq" data-editar="' + esc(i.id) + '">Editar</button> ' +
          '<button type="button" class="btn btn-peq" data-excluir="' + esc(i.id) + '">Excluir</button></td></tr>'
        ).join('')
      : '<tr><td class="vazio" colspan="' + (E.colunas.length + 1) + '">Nenhum registro encontrado.</td></tr>';
    $$('[data-editar]', el).forEach((b) => (b.onclick = () => abrirEditorEntidade(chave, b.dataset.editar)));
    $$('[data-excluir]', el).forEach((b) => (b.onclick = () => excluirEntidade(chave, b.dataset.excluir)));
  }

  function validarEntidade(chave, v, idAtual) {
    const erros = {};
    if (!v.nome) erros.nome = 'Informe o nome.';
    if (!v.curto) erros.curto = 'Informe o nome curto.';
    const outros = estado[chave].filter((x) => x.id !== idAtual);
    if (v.nome && outros.some((x) => norm(x.nome) === norm(v.nome))) erros.nome = 'Já existe um registro com esse nome.';
    if (v.curto && outros.some((x) => norm(x.curto) === norm(v.curto))) erros.curto = 'Esse nome curto já está em uso.';
    if (chave === 'disciplinas' && !(Number.isInteger(v.periodo) && v.periodo >= 1 && v.periodo <= 8)) erros.periodo = 'Escolha um período de 1 a 8.';
    if (chave === 'salas' && v.quantidade !== null && !(Number.isInteger(v.quantidade) && v.quantidade >= 0)) erros.quantidade = 'Informe um inteiro ≥ 0 ou deixe em branco.';
    return erros;
  }

  function abrirEditorEntidade(chave, id) {
    const E = ENT[chave];
    const item = id ? porId(estado[chave], id) : null;
    const dlg = $('#dlgEntidade');
    const val = (k) => (item && item[k] != null ? item[k] : '');
    const campos = E.campos.map((c) => {
      let ctl;
      if (c.tipo === 'periodo') {
        ctl = '<select name="periodo">' + PERIODOS.map((p) => '<option value="' + p + '"' + (Number(val('periodo')) === p || (!item && p === (Number(crudFiltro.disciplinas.periodo) || 1)) ? ' selected' : '') + '>' + p + 'º período</option>').join('') + '</select>';
      } else if (c.tipo === 'number') {
        ctl = '<input type="number" name="' + c.k + '" min="0" step="1" value="' + esc(val(c.k)) + '">';
      } else {
        ctl = '<input type="text" name="' + c.k + '" value="' + esc(val(c.k)) + '" autocomplete="off">';
      }
      return '<label class="campo"><span>' + c.rotulo + (c.dica ? ' <small>— ' + esc(c.dica) + '</small>' : '') + '</span>' + ctl + '<span class="erro-campo" data-erro="' + c.k + '"></span></label>';
    }).join('');

    dlg.innerHTML =
      '<form novalidate><div class="dlg-cab">' + (item ? 'Editar ' : 'Novo ') + E.singular + '</div>' +
      '<div class="dlg-corpo">' + campos + '</div>' +
      '<div class="dlg-rod"><button type="button" class="btn" data-cancelar>Cancelar</button><button type="submit" class="btn btn-primario">Salvar</button></div></form>';
    const f = $('form', dlg);
    $('[data-cancelar]', dlg).onclick = () => dlg.close();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = { nome: f.nome.value.trim(), curto: f.curto.value.trim() };
      if (chave === 'disciplinas') v.periodo = Number(f.periodo.value);
      if (chave === 'salas') {
        const q = f.quantidade.value.trim();
        v.quantidade = q === '' ? null : Number(q);
      }
      const erros = validarEntidade(chave, v, item && item.id);
      $$('[data-erro]', f).forEach((s) => (s.textContent = erros[s.dataset.erro] || ''));
      const primeiro = Object.keys(erros)[0];
      if (primeiro) { f[primeiro].focus(); return; }
      commit((s) => {
        if (item) Object.assign(porId(s[chave], item.id), v);
        else s[chave].push(Object.assign({ id: novoId(E.prefixo) }, v));
      });
      dlg.close();
      toast(E.singular.charAt(0).toUpperCase() + E.singular.slice(1) + (item ? ' atualizado.' : ' cadastrado.'));
    });
    abrirDialogo(dlg);
    f.nome.focus();
  }

  async function excluirEntidade(chave, id) {
    const E = ENT[chave];
    const item = porId(estado[chave], id);
    const n = contaAulas[chave](item);
    let extra = '';
    if (n) {
      if (chave === 'professores') extra = ' Ele(a) aparece em <b>' + n + '</b> aula(s); elas ficarão como “docente a definir”.';
      if (chave === 'salas') extra = ' Ela é usada em <b>' + n + '</b> aula(s); elas ficarão como “sala a definir”.';
      if (chave === 'disciplinas') extra = ' As <b>' + n + '</b> aula(s) dessa disciplina também serão removidas do horário.';
    }
    const ok = await confirmar({
      titulo: 'Excluir ' + E.singular,
      mensagem: 'Excluir <b>' + esc(item.nome) + '</b>?' + extra,
      ok: 'Excluir', perigo: true,
    });
    if (!ok) return;
    commit((s) => {
      s[chave] = s[chave].filter((x) => x.id !== id);
      if (chave === 'professores') s.aulas.forEach((a) => (a.professorIds = a.professorIds.filter((p) => p !== id)));
      if (chave === 'salas') s.aulas.forEach((a) => { if (a.salaId === id) a.salaId = null; });
      if (chave === 'disciplinas') s.aulas = s.aulas.filter((a) => a.disciplinaId !== id);
    });
    toast('Registro excluído.', { acao: 'Desfazer', aoAcao: desfazer });
  }

  /* ---------------------------------------------------- painel de conflitos */
  function abrirConflitos() {
    const dlg = $('#dlgConflitos');
    const ordem = (g) => DIAS.findIndex((d) => d.id === g.dia) * 10 + TURNOS.findIndex((t) => t.id === g.turno);
    const itens = conflitos.lista.slice().sort((a, b) => ordem(a) - ordem(b)).map((g) => {
      const rec = g.tipo === 'sala' ? sala(g.recursoId) : prof(g.recursoId);
      const chips = g.aulaIds.map((id) => {
        const a = porId(estado.aulas, id);
        return '<button type="button" class="btn btn-peq" data-ir="' + esc(id) + '">' + esc(Core.rotuloAula(estado, a)) + '</button>';
      }).join('');
      return '<li><span class="tipo ' + g.tipo + '">' + (g.tipo === 'sala' ? 'Sala' : 'Professor') + '</span>' +
        '<strong>' + esc(rec ? (g.tipo === 'sala' ? rec.curto + ' · ' + rec.nome : rec.nome) : '?') + '</strong>' +
        ' — ' + diaDe(g.dia).nome + ', ' + turnoDe(g.turno).nome.toLowerCase() + ' (' + turnoDe(g.turno).horario + ')' +
        '<div class="chips">' + chips + '</div></li>';
    }).join('');
    dlg.innerHTML =
      '<form method="dialog"><div class="dlg-cab">Conflitos de horário</div><div class="dlg-corpo">' +
      (itens ? '<ul class="lista-conflitos">' + itens + '</ul><p class="mudo" style="margin:0">Clique numa aula para localizá-la na grade.</p>'
             : '<div class="aviso-conf ok">Nenhum conflito de sala ou de professor.</div>') +
      '</div><div class="dlg-rod"><button class="btn" type="submit">Fechar</button></div></form>';
    $$('[data-ir]', dlg).forEach((b) => (b.onclick = () => irParaAula(b.dataset.ir)));
    abrirDialogo(dlg);
  }

  function irParaAula(id) {
    $('#dlgConflitos').close();
    const a = porId(estado.aulas, id);
    if (!a) return;
    if (ui.periodo !== 'todos' && Number(ui.periodo) !== Core.periodoDaAula(estado, a)) {
      ui.periodo = 'todos';
      $('#filtroPeriodo').value = 'todos';
      salvarUi();
    }
    irParaVista('horario');
    destacar(id);
  }

  /* ----------------------------------------------- cabeçalho do documento */
  function abrirConfig() {
    const c = estado.config;
    const dlg = $('#dlgConfig');
    const campo = (k, r, dica) => '<label class="campo"><span>' + r + (dica ? ' <small>— ' + dica + '</small>' : '') + '</span><input type="text" name="' + k + '" value="' + esc(c[k]) + '"></label>';
    dlg.innerHTML =
      '<form><div class="dlg-cab">Cabeçalho do documento</div><div class="dlg-corpo">' +
      campo('titulo', 'Título') + campo('subtitulo', 'Subtítulo', 'curso e semestre') +
      campo('coordenador', 'Nome do coordenador') + campo('cargo', 'Cargo') + campo('unidade', 'Unidade') +
      '</div><div class="dlg-rod"><button type="button" class="btn" data-cancelar>Cancelar</button><button type="submit" class="btn btn-primario">Salvar</button></div></form>';
    $('[data-cancelar]', dlg).onclick = () => dlg.close();
    $('form', dlg).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const nv = {};
      ['titulo', 'subtitulo', 'coordenador', 'cargo', 'unidade'].forEach((k) => (nv[k] = f[k].value.trim()));
      commit((s) => Object.assign(s.config, nv));
      dlg.close();
    });
    abrirDialogo(dlg);
  }

  /* ------------------------------------------- impressão, HTML e JSON (dados) */
  function baixar(conteudo, nome, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function sufixoSemestre() {
    const m = (estado.config.subtitulo || '').match(/(\d{4})\s*\/\s*(\d)/);
    return m ? '-' + m[1] + '-' + m[2] : '';
  }

  function imprimir() {
    if (ui.vista !== 'horario') irParaVista('horario');
    const antes = document.title;
    document.title = 'horario-ccomp' + sufixoSemestre();
    esconderTip();
    try { window.print(); } finally { document.title = antes; }
  }

  function escopoTexto() {
    return ui.periodo === 'todos' ? 'todos os períodos' : ui.periodo + 'º período';
  }

  function exportarHtml() {
    const css = $('#css-documento').textContent;
    const titulo = [estado.config.titulo, estado.config.subtitulo].filter(Boolean).join(' — ') || 'Horário';
    const extra =
      'body{margin:0;background:#eef2f4;font-family:Arial,Helvetica,sans-serif}' +
      '.barra-export{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;padding:10px 16px;background:#fff;border-bottom:1px solid #ccd5da;font-size:13px}' +
      '.barra-export button{font:inherit;padding:6px 12px;border:1px solid #0b75a0;background:#0b75a0;color:#fff;border-radius:6px;cursor:pointer}' +
      '.sw{display:inline-block;width:14px;height:14px;border:1px solid rgba(0,0,0,.3);border-radius:3px;vertical-align:-2px;margin:0 4px 0 10px}' +
      '.folha{max-width:1240px;margin:16px auto;background:#fff;padding:22px;overflow-x:auto}.folha .doc{min-width:860px}' +
      '@media print{.barra-export{display:none}body{background:#fff}.folha{margin:0;padding:0;max-width:none;overflow:visible}.folha .doc{min-width:0}}';
    const html =
      '<!DOCTYPE html>\n<html lang="pt-BR"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(titulo) + '</title><style>' + css + extra + '</style></head><body>' +
      '<div class="barra-export"><button type="button" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>' +
      '<span><i class="sw" style="background:#ffa03a"></i>conflito de sala<i class="sw" style="background:#f25555"></i>conflito de professor' +
      ' &nbsp;·&nbsp; passe o mouse sobre um bloco para ver detalhes</span></div>' +
      '<main class="folha">' + htmlDocumento(false) + '</main></body></html>';
    baixar(html, 'horario-ccomp' + sufixoSemestre() + '.html', 'text/html;charset=utf-8');
    toast('HTML exportado (' + escopoTexto() + ').');
  }

  /* ------------------------------------------------------ versões e arquivos */
  const slug = (t) => norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'horario';

  function nomeUnico(base) {
    const nome = (base || '').trim() || 'Horário';
    const existe = (n) => store.versoes.some((v) => v.nome.toLowerCase() === n.toLowerCase());
    if (!existe(nome)) return nome;
    let i = 2;
    while (existe(nome + ' (' + i + ')')) i++;
    return nome + ' (' + i + ')';
  }

  function novaVersao(nome, dados, logIni) {
    const v = { id: novoId('v'), nome, criadaEm: agora(), salvaEm: agora(), dados, log: logIni };
    store.versoes.push(v);
    return v;
  }

  /* Antes de trocar/substituir o que está na tela: se há alterações não salvas, pergunta.
     Resolve true quando pode prosseguir. */
  async function resolverAlteracoes(destino) {
    if (!modificado()) return true;
    const v = versaoAtual();
    const r = await escolher({
      titulo: 'Alterações não salvas',
      mensagem: 'A versão <b>' + esc(v.nome) + '</b> tem alterações que ainda não foram salvas e você vai ' + esc(destino) + '. O que deseja fazer?',
      botoes: [
        { valor: 'cancelar', rotulo: 'Cancelar' },
        { valor: 'descartar', rotulo: 'Descartar alterações', cls: 'btn-perigo' },
        { valor: 'sobrepor', rotulo: 'Sobrepor “' + v.nome + '”' },
        { valor: 'nova', rotulo: 'Salvar como nova versão…', cls: 'btn-primario' },
      ],
    });
    if (r === 'descartar') return true;           // o rascunho é abandonado ao entrar em outra versão
    if (r === 'sobrepor') { salvarSobrepondo(); return true; }
    if (r === 'nova') return salvarComoNova();
    return false;
  }

  function salvarSobrepondo() {
    const v = versaoAtual();
    if (!v) return;
    log.push({ ts: agora(), tipo: 'versao', texto: 'Versão «' + v.nome + '» salva (sobrepondo o conteúdo anterior).' });
    v.dados = clonar(estado);
    v.log = clonar(log);
    v.salvaEm = agora();
    baseDados = JSON.stringify(v.dados);
    baseLog = JSON.stringify(v.log);
    persistir();
    atualizar();
    toast('Versão “' + v.nome + '” salva.');
  }

  /* Cria uma versão nova com o que está na tela; a versão anterior fica como estava. */
  async function salvarComoNova() {
    const atual = versaoAtual();
    const nome = await pedirTexto({
      titulo: 'Salvar como nova versão',
      rotulo: 'Nome da nova versão',
      valor: nomeUnico((atual ? atual.nome : 'Horário') + ' (nova versão)'),
      ok: 'Salvar',
      validar: (n) => (store.versoes.some((v) => v.nome.toLowerCase() === n.toLowerCase()) ? 'Já existe uma versão com esse nome.' : ''),
    });
    if (!nome) return false;
    log.push({ ts: agora(), tipo: 'versao', texto: 'Nova versão «' + nome + '» criada a partir de «' + (atual ? atual.nome : '—') + '».' });
    const nv = novaVersao(nome, clonar(estado), clonar(log));
    store.atualId = nv.id;
    baseDados = JSON.stringify(nv.dados);
    baseLog = JSON.stringify(nv.log);
    persistir();
    atualizar();
    toast('Versão “' + nome + '” criada e marcada como atual.');
    return true;
  }

  async function pedirSalvarVersao() {
    if (!modificado()) return;
    const v = versaoAtual();
    const r = await escolher({
      titulo: 'Salvar versão',
      mensagem: 'Sobrepor o conteúdo da versão <b>' + esc(v.nome) + '</b> com as alterações atuais? Para manter a versão anterior intacta, salve como nova versão.',
      botoes: [
        { valor: 'cancelar', rotulo: 'Cancelar' },
        { valor: 'nova', rotulo: 'Salvar como nova versão…' },
        { valor: 'sobrepor', rotulo: 'Sobrepor “' + v.nome + '”', cls: 'btn-primario' },
      ],
    });
    if (r === 'sobrepor') salvarSobrepondo();
    else if (r === 'nova') await salvarComoNova();
  }

  /* Marca outra versão como atual (e passa a exibi-la). */
  async function abrirVersao(id) {
    if (id === store.atualId) return true;
    if (!(await resolverAlteracoes('trocar de versão'))) return false;
    entrarNaVersao(id);
    persistir();
    atualizar();
    toast('Exibindo a versão “' + versaoAtual().nome + '”.');
    return true;
  }

  async function descartarAlteracoes() {
    if (!modificado()) return;
    const v = versaoAtual();
    const ok = await confirmar({
      titulo: 'Descartar alterações',
      mensagem: 'Voltar a versão <b>' + esc(v.nome) + '</b> ao último estado salvo? As alterações feitas desde então serão perdidas.',
      ok: 'Descartar', perigo: true,
    });
    if (!ok) return;
    estado = clonar(v.dados);
    log = clonar(v.log);
    historico.length = 0;
    persistir();
    atualizar();
    toast('Alterações descartadas.');
  }

  async function renomearVersao(id) {
    const v = porId(store.versoes, id);
    const nome = await pedirTexto({
      titulo: 'Renomear versão', rotulo: 'Nome da versão', valor: v.nome, ok: 'Renomear',
      validar: (n) => (store.versoes.some((x) => x.id !== id && x.nome.toLowerCase() === n.toLowerCase()) ? 'Já existe uma versão com esse nome.' : ''),
    });
    if (!nome) return;
    v.nome = nome;
    persistir();
    atualizar();
    montarVersoes();
  }

  async function excluirVersao(id) {
    const v = porId(store.versoes, id);
    const ehAtual = id === store.atualId;
    const ok = await confirmar({
      titulo: 'Excluir versão',
      mensagem: 'Excluir a versão <b>' + esc(v.nome) + '</b>? Esta ação não pode ser desfeita.' +
        (ehAtual && modificado() ? ' As alterações não salvas dela também serão perdidas.' : ''),
      ok: 'Excluir', perigo: true,
    });
    if (!ok) return;
    store.versoes = store.versoes.filter((x) => x.id !== id);
    if (ehAtual) {
      if (store.versoes.length) {
        const recente = store.versoes.slice().sort((a, b) => b.salvaEm.localeCompare(a.salvaEm))[0];
        entrarNaVersao(recente.id);
      } else {
        store.atualId = null; estado = Core.estadoVazio(); log = []; baseDados = ''; baseLog = ''; historico.length = 0;
      }
    }
    persistir();
    atualizar();
    if (!store.versoes.length) fecharVersoes(); else montarVersoes();
    toast('Versão excluída.');
  }

  /* Salva uma versão em arquivo JSON (a atual inclui o que está na tela). */
  function salvarEmArquivo(id) {
    const v = porId(store.versoes, id || store.atualId);
    if (!v) return;
    const ehAtual = v.id === store.atualId;
    const dados = ehAtual ? estado : v.dados;
    const lg = ehAtual ? log : v.log;
    const nomeArq = slug(v.nome) + '.json';
    baixar(JSON.stringify(Core.paraArquivo(v.nome, dados, lg), null, 2), nomeArq, 'application/json');
    toast('Arquivo “' + nomeArq + '” gerado' + (ehAtual && modificado() ? ' (inclui alterações ainda não salvas na versão).' : '.'), { ms: 5500 });
  }

  /* Carrega um arquivo de horário como NOVA versão e a exibe. */
  async function carregarArquivo(arquivo) {
    let r;
    try { r = Core.lerArquivo(JSON.parse(await arquivo.text())); }
    catch (e) { r = { erro: 'O arquivo não é um JSON válido.' }; }
    if (r.erro) { toast(r.erro, { tipo: 'aviso', ms: 7000 }); return; }
    if (!(await resolverAlteracoes('carregar outro horário'))) return;
    const nome = nomeUnico(r.nome || nomeDoEstado(r.estado) || arquivo.name.replace(/\.json$/i, ''));
    const lg = r.log.concat([{ ts: agora(), tipo: 'versao', texto: 'Horário carregado do arquivo «' + arquivo.name + '».' }]);
    const nv = novaVersao(nome, r.estado, lg);
    entrarNaVersao(nv.id);
    persistir();
    fecharVersoes();
    irParaVista('horario');
    atualizar();
    toast('Horário “' + nome + '” carregado: ' + r.estado.aulas.length + ' aulas, ' + r.estado.disciplinas.length + ' disciplinas.' + (r.avisos.length ? ' ' + r.avisos.join(' ') : ''), { ms: 6500 });
  }

  async function novoHorarioVazio() {
    if (!(await resolverAlteracoes('criar um horário vazio'))) return;
    const nv = novaVersao(nomeUnico('Novo horário'), Core.estadoVazio(), [{ ts: agora(), tipo: 'versao', texto: 'Horário vazio criado.' }]);
    entrarNaVersao(nv.id);
    persistir();
    fecharVersoes();
    irParaVista('horario');
    atualizar();
    toast('Horário vazio criado. Cadastre professores, salas e disciplinas.');
  }

  /* gerenciador de versões */
  function fecharVersoes() { const d = $('#dlgVersoes'); if (d.open) d.close(); }

  function montarVersoes() {
    const dlg = $('#dlgVersoes');
    if (!dlg.open) return;
    const mod = modificado();
    const itens = store.versoes.map((v) => {
      const atual = v.id === store.atualId;
      const id = esc(v.id);
      return '<li class="v-item' + (atual ? ' atual' : '') + '">' +
        '<div class="v-info"><div><strong>' + esc(v.nome) + '</strong>' +
          (atual ? ' <span class="etiqueta">★ Atual (exibida)</span>' : '') +
          (atual && mod ? ' <span class="mod">● alterações não salvas</span>' : '') + '</div>' +
          '<div class="mudo v-meta">Salva em ' + esc(fmtData(v.salvaEm)) + ' · ' + v.dados.aulas.length + ' aulas · ' + v.dados.disciplinas.length + ' disciplinas · ' + v.log.length + ' no log</div></div>' +
        '<div class="v-acoes">' +
          (atual ? '' : '<button type="button" class="btn btn-peq btn-primario" data-v-atual="' + id + '">Marcar como atual</button>') +
          '<button type="button" class="btn btn-peq" data-v-renomear="' + id + '">Renomear</button>' +
          '<button type="button" class="btn btn-peq" data-v-arquivo="' + id + '">⬇ Salvar em arquivo</button>' +
          '<button type="button" class="btn btn-peq" data-v-excluir="' + id + '">Excluir</button>' +
        '</div></li>';
    }).join('');
    dlg.innerHTML =
      '<form method="dialog"><div class="dlg-cab">Versões do horário</div><div class="dlg-corpo">' +
      '<ul class="lista-versoes">' + (itens || '<li class="mudo">Nenhuma versão.</li>') + '</ul>' +
      '<p class="mudo" style="margin:0;font-size:12.5px">A versão marcada como atual é a exibida no horário. As alterações ficam num rascunho até você salvá-las na versão ou numa nova versão.</p></div>' +
      '<div class="dlg-rod"><button type="button" class="btn esq" data-v-vazio>Novo horário vazio</button>' +
      '<button type="button" class="btn" data-v-carregar>⬆ Carregar de arquivo…</button>' +
      '<button class="btn btn-primario" type="submit">Fechar</button></div></form>';
    $$('[data-v-atual]', dlg).forEach((b) => (b.onclick = async () => { await abrirVersao(b.dataset.vAtual); montarVersoes(); }));
    $$('[data-v-renomear]', dlg).forEach((b) => (b.onclick = () => renomearVersao(b.dataset.vRenomear)));
    $$('[data-v-arquivo]', dlg).forEach((b) => (b.onclick = () => salvarEmArquivo(b.dataset.vArquivo)));
    $$('[data-v-excluir]', dlg).forEach((b) => (b.onclick = () => excluirVersao(b.dataset.vExcluir)));
    $('[data-v-vazio]', dlg).onclick = novoHorarioVazio;
    $('[data-v-carregar]', dlg).onclick = () => $('#arquivoJson').click();
  }

  function abrirVersoes() {
    const dlg = $('#dlgVersoes');
    if (!dlg.open) dlg.showModal();
    montarVersoes();
  }

  /* ------------------------------------------------------------ inicialização */
  function iniciar() {
    if (store.atualId) entrarNaVersao(store.atualId, store.rascunho);

    // filtro de período e opções da grade
    const sel = $('#filtroPeriodo');
    sel.innerHTML = '<option value="todos">Todos os períodos</option>' + PERIODOS.map((p) => '<option value="' + p + '">' + p + 'º período</option>').join('');
    sel.value = String(ui.periodo);
    if (sel.value !== String(ui.periodo)) { ui.periodo = 'todos'; sel.value = 'todos'; }
    sel.onchange = () => { ui.periodo = sel.value; salvarUi(); renderHorario(); };

    $('#chkOutroDia').checked = !!ui.outroDia;
    $('#chkOutroDia').onchange = (e) => { ui.outroDia = e.target.checked; salvarUi(); };
    $('#chkSabado').checked = !!ui.sabado;
    $('#chkSabado').onchange = (e) => { ui.sabado = e.target.checked; salvarUi(); renderHorario(); };
    $('#btnNovaAula').onclick = () => abrirEditorAula(ui.periodo !== 'todos' ? { periodo: Number(ui.periodo) } : {});

    // topo, abas
    $$('.abas button').forEach((b) => (b.onclick = () => irParaVista(b.dataset.vista)));
    $('#btnConflitos').onclick = abrirConflitos;
    $('#btnDesfazer').onclick = desfazer;
    $('#btnImprimir').onclick = imprimir;
    $('#btnExportarHtml').onclick = exportarHtml;

    // versões e arquivos
    $('#selVersao').onchange = async (e) => { if (!(await abrirVersao(e.target.value))) renderTopo(); };
    $('#btnSalvarVersao').onclick = pedirSalvarVersao;
    $('#btnSalvarComo').onclick = () => salvarComoNova();
    $('#btnDescartar').onclick = descartarAlteracoes;
    $('#btnSalvarArquivo').onclick = () => salvarEmArquivo();
    $('#btnCarregarArquivo').onclick = () => $('#arquivoJson').click();
    $('#btnBoasCarregar').onclick = () => $('#arquivoJson').click();
    $('#btnBoasVazio').onclick = novoHorarioVazio;
    $('#arquivoJson').onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) carregarArquivo(f);
    };

    // log
    $('#btnLog').onclick = () => { ui.logVisivel = !ui.logVisivel; salvarUi(); renderLog(); };
    $('#btnBaixarLog').onclick = baixarLog;

    // menu "Mais"
    const menu = $('#menuMais');
    $$('.menu-lista button', menu).forEach((b) => {
      b.onclick = () => {
        menu.open = false;
        if (b.dataset.acao === 'config') abrirConfig();
        else if (b.dataset.acao === 'versoes') abrirVersoes();
      };
    });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });

    // título e subtítulo editáveis direto no documento
    docEl.addEventListener('keydown', (e) => {
      const el = e.target.closest && e.target.closest('[data-campo]');
      if (!el) return;
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      else if (e.key === 'Escape') { el.textContent = estado.config[el.dataset.campo] || ''; el.blur(); }
    });
    docEl.addEventListener('focusout', (e) => {
      const el = e.target.closest && e.target.closest('[data-campo]');
      if (!el) return;
      const campo = el.dataset.campo;
      const novo = el.textContent.replace(/\s+/g, ' ').trim();
      if (novo !== (estado.config[campo] || '')) commit((st) => { st.config[campo] = novo; });
    });
    docEl.addEventListener('paste', (e) => {
      const el = e.target.closest && e.target.closest('[data-campo]');
      if (!el) return;
      e.preventDefault();
      const t = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, t);
    });

    // soltar um arquivo em qualquer lugar da página carrega o horário
    const temArquivos = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    document.addEventListener('dragover', (e) => { if (temArquivos(e)) { e.preventDefault(); document.body.classList.add('soltando'); } });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('soltando'); });
    document.addEventListener('drop', (e) => {
      if (!temArquivos(e)) return;
      e.preventDefault();
      document.body.classList.remove('soltando');
      const f = e.dataTransfer.files[0];
      if (f) carregarArquivo(f);
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        if ($$('dialog[open]').length) return;
        e.preventDefault();
        desfazer();
      }
    });

    irParaVista('horario');
    atualizar();
    mostrarStatus(false);
  }

  iniciar();
})();
