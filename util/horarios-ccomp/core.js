/* ==========================================================================
   core.js — lógica pura (sem DOM): constantes, conflitos, regras de movimento
   e normalização de dados. Pode ser testada em Node (module.exports).
   ========================================================================== */
(function (root) {
  'use strict';

  const DIAS = [
    { id: 'seg', nome: 'Segunda', abrev: 'Seg' },
    { id: 'ter', nome: 'Terça', abrev: 'Ter' },
    { id: 'qua', nome: 'Quarta', abrev: 'Qua' },
    { id: 'qui', nome: 'Quinta', abrev: 'Qui' },
    { id: 'sex', nome: 'Sexta', abrev: 'Sex' },
    { id: 'sab', nome: 'Sábado', abrev: 'Sáb' },
  ];

  const TURNOS = [
    { id: 'manha', nome: 'Manhã', horario: '08:00 – 11:40' },
    { id: 'tarde', nome: 'Tarde', horario: '14:00 – 17:40' },
    { id: 'noite', nome: 'Noite', horario: '19:00 – 22:40' },
  ];

  const PERIODOS = [1, 2, 3, 4, 5, 6, 7, 8];

  const clonar = (x) => JSON.parse(JSON.stringify(x));

  function novoId(prefixo) {
    return (
      (prefixo || 'x') + '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  const porId = (lista, id) => lista.find((x) => x.id === id) || null;
  const nomeDia = (id) => (DIAS.find((d) => d.id === id) || {}).nome || id;
  const nomeTurno = (id) => (TURNOS.find((t) => t.id === id) || {}).nome || id;

  function periodoDaAula(estado, aula) {
    const d = porId(estado.disciplinas, aula.disciplinaId);
    return d ? d.periodo : null;
  }

  /* --------------------------------------------------------------------------
     Conflitos
     Resultado:
       porAula[aulaId] = { professor: [{professorId, aulaIds}], sala: {salaId, aulaIds} | null }
       lista = [{ tipo: 'professor'|'sala', recursoId, dia, turno, aulaIds }]
     Regras: mesmo dia + mesmo turno (em QUALQUER período do curso).
       - professor: o mesmo professor em 2+ aulas
       - sala: a mesma sala em 2+ aulas (sala indefinida nunca conflita)
     -------------------------------------------------------------------------- */
  function detectarConflitos(estado) {
    const porAula = {};
    const lista = [];
    const slots = new Map();

    for (const a of estado.aulas) {
      const k = a.dia + '|' + a.turno;
      if (!slots.has(k)) slots.set(k, []);
      slots.get(k).push(a);
    }

    const garantir = (id) =>
      porAula[id] || (porAula[id] = { professor: [], sala: null });

    for (const [k, aulas] of slots) {
      if (aulas.length < 2) continue;
      const [dia, turno] = k.split('|');

      const profs = new Map();
      const salas = new Map();
      for (const a of aulas) {
        for (const pid of new Set(a.professorIds || [])) {
          if (!profs.has(pid)) profs.set(pid, []);
          profs.get(pid).push(a.id);
        }
        if (a.salaId) {
          if (!salas.has(a.salaId)) salas.set(a.salaId, []);
          salas.get(a.salaId).push(a.id);
        }
      }

      for (const [pid, ids] of profs) {
        if (ids.length < 2) continue;
        lista.push({ tipo: 'professor', recursoId: pid, dia, turno, aulaIds: ids });
        for (const id of ids) garantir(id).professor.push({ professorId: pid, aulaIds: ids });
      }
      for (const [sid, ids] of salas) {
        if (ids.length < 2) continue;
        lista.push({ tipo: 'sala', recursoId: sid, dia, turno, aulaIds: ids });
        for (const id of ids) garantir(id).sala = { salaId: sid, aulaIds: ids };
      }
    }
    return { porAula, lista };
  }

  function rotuloAula(estado, aula) {
    const d = porId(estado.disciplinas, aula.disciplinaId);
    return d ? '«' + d.curto + '» (' + d.periodo + 'º período)' : '«?»';
  }

  /* Descreve, em texto, os conflitos de uma aula (para tooltip/painel). */
  function descreverConflitos(estado, conflitos, aula) {
    const c = conflitos.porAula[aula.id];
    if (!c) return [];
    const out = [];
    const outras = (ids) =>
      ids
        .filter((i) => i !== aula.id)
        .map((i) => porId(estado.aulas, i))
        .filter(Boolean)
        .map((x) => rotuloAula(estado, x))
        .join(', ');
    for (const cp of c.professor) {
      const p = porId(estado.professores, cp.professorId);
      out.push({
        tipo: 'professor',
        texto: 'Conflito de professor: ' + (p ? p.nome : '?') + ' também leciona ' + outras(cp.aulaIds) + ' neste mesmo horário.',
      });
    }
    if (c.sala) {
      const s = porId(estado.salas, c.sala.salaId);
      out.push({
        tipo: 'sala',
        texto: 'Conflito de sala: ' + (s ? s.curto + ' (' + s.nome + ')' : '?') + ' também é usada por ' + outras(c.sala.aulaIds) + ' neste mesmo horário.',
      });
    }
    return out;
  }

  /* --------------------------------------------------------------------------
     Movimento: sempre dentro do mesmo período do curso; por padrão só entre os
     três turnos (mesmo dia). Com opcoes.outroDia também pode trocar de dia.
     -------------------------------------------------------------------------- */
  function podeMover(estado, aula, destino, opcoes) {
    const d = porId(estado.disciplinas, aula.disciplinaId);
    if (!d) return false;
    if (destino.periodo !== d.periodo) return false;
    if (!TURNOS.some((t) => t.id === destino.turno)) return false;
    if (!DIAS.some((x) => x.id === destino.dia)) return false;
    if (!(opcoes && opcoes.outroDia) && destino.dia !== aula.dia) return false;
    return true;
  }

  /* --------------------------------------------------------------------------
     Normalização (carga do localStorage e importação de JSON)
     -------------------------------------------------------------------------- */
  const txt = (v) => (v == null ? '' : String(v)).trim();

  function normalizarEstado(raw) {
    const avisos = [];
    if (!raw || typeof raw !== 'object') return { estado: null, avisos: ['Formato inválido.'] };

    const unicos = (lista, prefixo) => {
      const vistos = new Set();
      return lista.map((x) => {
        let id = txt(x.id);
        if (!id || vistos.has(id)) id = novoId(prefixo);
        vistos.add(id);
        return Object.assign({}, x, { id });
      });
    };
    const arr = (v) => (Array.isArray(v) ? v : []);

    const professores = unicos(arr(raw.professores), 'p')
      .map((p) => ({ id: p.id, nome: txt(p.nome), curto: txt(p.curto) }))
      .filter((p) => p.nome && p.curto);

    const salas = unicos(arr(raw.salas), 's')
      .map((s) => {
        const q = s.quantidade === '' || s.quantidade == null ? null : Number(s.quantidade);
        return {
          id: s.id, nome: txt(s.nome), curto: txt(s.curto),
          quantidade: Number.isFinite(q) && q >= 0 ? Math.round(q) : null,
        };
      })
      .filter((s) => s.nome && s.curto);

    const disciplinas = unicos(arr(raw.disciplinas), 'd')
      .map((d) => ({ id: d.id, nome: txt(d.nome), periodo: Math.round(Number(d.periodo)), curto: txt(d.curto) }))
      .filter((d) => d.nome && d.curto && d.periodo >= 1 && d.periodo <= 8);

    const idsP = new Set(professores.map((p) => p.id));
    const idsS = new Set(salas.map((s) => s.id));
    const idsD = new Set(disciplinas.map((d) => d.id));

    let descartadas = 0;
    const aulas = unicos(arr(raw.aulas), 'a')
      .map((a) => ({
        id: a.id,
        disciplinaId: a.disciplinaId,
        professorIds: [...new Set(arr(a.professorIds))].filter((i) => idsP.has(i)),
        salaId: idsS.has(a.salaId) ? a.salaId : null,
        dia: a.dia,
        turno: a.turno,
      }))
      .filter((a) => {
        const ok = idsD.has(a.disciplinaId) && DIAS.some((d) => d.id === a.dia) && TURNOS.some((t) => t.id === a.turno);
        if (!ok) descartadas++;
        return ok;
      });
    if (descartadas) avisos.push(descartadas + ' aula(s) inválida(s) descartada(s).');

    const cfg = raw.config && typeof raw.config === 'object' ? raw.config : {};
    const config = {
      // título vazio é permitido (o usuário pode limpá-lo); só ausente recebe o padrão
      titulo: cfg.titulo == null ? 'DISTRIBUIÇÃO DE HORÁRIO' : txt(cfg.titulo),
      subtitulo: txt(cfg.subtitulo),
      coordenador: txt(cfg.coordenador),
      cargo: txt(cfg.cargo),
      unidade: txt(cfg.unidade),
    };

    return { estado: { versao: 1, config, professores, salas, disciplinas, aulas }, avisos };
  }

  function estadoVazio() {
    return {
      versao: 1,
      config: { titulo: 'DISTRIBUIÇÃO DE HORÁRIO', subtitulo: '', coordenador: '', cargo: '', unidade: '' },
      professores: [], salas: [], disciplinas: [], aulas: [],
    };
  }

  /* --------------------------------------------------------------------------
     Arquivo de horário (JSON). Os dados ficam no topo do objeto (compatível com o
     arquivo da 1ª versão do programa), mais metadados e o log.
     -------------------------------------------------------------------------- */
  const FORMATO = 'horario-ccomp';

  function paraArquivo(nome, estado, log) {
    return {
      formato: FORMATO,
      schema: 2,
      nome: nome || '',
      salvoEm: new Date().toISOString(),
      config: estado.config,
      professores: estado.professores,
      salas: estado.salas,
      disciplinas: estado.disciplinas,
      aulas: estado.aulas,
      log: log || [],
    };
  }

  function limparLog(lista) {
    if (!Array.isArray(lista)) return [];
    return lista
      .filter((e) => e && typeof e.texto === 'string' && e.texto)
      .map((e) => ({
        ts: typeof e.ts === 'string' && !isNaN(Date.parse(e.ts)) ? e.ts : new Date().toISOString(),
        tipo: txt(e.tipo),
        texto: e.texto,
      }))
      .slice(-1000);
  }

  /* Valida e converte o conteúdo de um arquivo. Retorna {erro} ou {estado, nome, log, avisos}. */
  function lerArquivo(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { erro: 'O arquivo não tem o formato de um horário.' };
    if (raw.formato && raw.formato !== FORMATO) return { erro: 'Este arquivo é de outro formato (“' + raw.formato + '”).' };
    const temListas = ['professores', 'salas', 'disciplinas', 'aulas'].some((k) => Array.isArray(raw[k]));
    if (!temListas) return { erro: 'O arquivo não contém dados de horário (professores, salas, disciplinas, aulas).' };
    const r = normalizarEstado(raw);
    if (!r.estado) return { erro: 'Não foi possível interpretar o arquivo.' };
    return { estado: r.estado, avisos: r.avisos, nome: txt(raw.nome), log: limparLog(raw.log) };
  }

  /* --------------------------------------------------------------------------
     Diff entre dois estados → mensagens para o log de alterações.
     Nomes curtos vêm entre «…» (a interface os destaca em negrito).
     -------------------------------------------------------------------------- */
  function diffEstados(antes, depois) {
    const out = [];
    // nomes curtos como "Daniel M." terminam em ponto: evita "Daniel M.." no fim da frase
    const add = (tipo, texto) => out.push({ tipo, texto: texto.replace(/\.»\.$/, '.»') });
    const q = (s) => '«' + s + '»';
    const achar = (campo, id) => porId(depois[campo], id) || porId(antes[campo], id);
    const dCurto = (id) => { const d = achar('disciplinas', id); return q(d ? d.curto : '?'); };
    const pCurtos = (ids) => ids.map((i) => { const p = achar('professores', i); return q(p ? p.curto : '?'); }).join(' / ');
    const sCurto = (id) => { const s = achar('salas', id); return q(s ? s.curto : '?'); };
    const slot = (a) => nomeDia(a.dia) + ', ' + nomeTurno(a.turno).toLowerCase();
    const vazio = (s) => (s ? s : '(vazio)');

    /* cabeçalho / título */
    const rot = { titulo: 'Título', subtitulo: 'Subtítulo', coordenador: 'Coordenador', cargo: 'Cargo', unidade: 'Unidade' };
    for (const k of Object.keys(rot)) {
      const a = (antes.config && antes.config[k]) || '';
      const b = (depois.config && depois.config[k]) || '';
      if (a !== b) add('titulo', rot[k] + ' alterado de “' + vazio(a) + '” para “' + vazio(b) + '”.');
    }

    /* cadastros */
    const idsDepois = (campo) => new Set(depois[campo].map((x) => x.id));
    const idsAntes = (campo) => new Set(antes[campo].map((x) => x.id));

    // professores
    for (const p of depois.professores) {
      const o = porId(antes.professores, p.id);
      if (!o) add('cadastro', 'Professor ' + q(p.curto) + ' (' + p.nome + ') cadastrado.');
      else {
        if (o.nome !== p.nome) add('cadastro', 'Professor ' + q(p.curto) + ': nome alterado de “' + o.nome + '” para “' + p.nome + '”.');
        if (o.curto !== p.curto) add('cadastro', 'Nome curto do professor alterado de ' + q(o.curto) + ' para ' + q(p.curto) + '.');
      }
    }
    for (const o of antes.professores) {
      if (idsDepois('professores').has(o.id)) continue;
      const n = antes.aulas.filter((a) => a.professorIds.includes(o.id)).length;
      add('cadastro', 'Professor ' + q(o.curto) + ' (' + o.nome + ') excluído' + (n ? '; retirado de ' + n + ' aula(s)' : '') + '.');
    }

    // salas
    for (const s of depois.salas) {
      const o = porId(antes.salas, s.id);
      if (!o) add('cadastro', 'Sala ' + q(s.curto) + ' (' + s.nome + ') cadastrada.');
      else {
        if (o.nome !== s.nome) add('cadastro', 'Sala ' + q(s.curto) + ': nome alterado de “' + o.nome + '” para “' + s.nome + '”.');
        if (o.curto !== s.curto) add('cadastro', 'Nome curto da sala alterado de ' + q(o.curto) + ' para ' + q(s.curto) + '.');
        if (o.quantidade !== s.quantidade) add('cadastro', 'Quantidade da sala ' + q(s.curto) + ' alterada de ' + (o.quantidade == null ? '(vazio)' : o.quantidade) + ' para ' + (s.quantidade == null ? '(vazio)' : s.quantidade) + '.');
      }
    }
    for (const o of antes.salas) {
      if (idsDepois('salas').has(o.id)) continue;
      const n = antes.aulas.filter((a) => a.salaId === o.id).length;
      add('cadastro', 'Sala ' + q(o.curto) + ' (' + o.nome + ') excluída' + (n ? '; ' + n + ' aula(s) ficaram com sala a definir' : '') + '.');
    }

    // disciplinas
    for (const d of depois.disciplinas) {
      const o = porId(antes.disciplinas, d.id);
      if (!o) add('cadastro', 'Disciplina ' + q(d.curto) + ' (' + d.nome + ', ' + d.periodo + 'º período) cadastrada.');
      else {
        if (o.nome !== d.nome) add('cadastro', 'Disciplina ' + q(d.curto) + ': nome alterado de “' + o.nome + '” para “' + d.nome + '”.');
        if (o.curto !== d.curto) add('cadastro', 'Nome curto da disciplina alterado de ' + q(o.curto) + ' para ' + q(d.curto) + '.');
        if (o.periodo !== d.periodo) add('cadastro', 'Disciplina ' + q(d.curto) + ' passou do ' + o.periodo + 'º para o ' + d.periodo + 'º período.');
      }
    }
    const discRemovidas = new Set();
    for (const o of antes.disciplinas) {
      if (idsDepois('disciplinas').has(o.id)) continue;
      discRemovidas.add(o.id);
      const n = antes.aulas.filter((a) => a.disciplinaId === o.id).length;
      add('cadastro', 'Disciplina ' + q(o.curto) + ' (' + o.nome + ') excluída' + (n ? '; ' + n + ' aula(s) removida(s) do horário' : '') + '.');
    }

    /* aulas */
    const aulasAntes = new Map(antes.aulas.map((a) => [a.id, a]));
    const aulasDepois = new Map(depois.aulas.map((a) => [a.id, a]));

    for (const a of depois.aulas) {
      const o = aulasAntes.get(a.id);
      if (!o) {
        const det = [];
        if (a.salaId) det.push('sala ' + sCurto(a.salaId));
        if (a.professorIds.length) det.push('professor(es) ' + pCurtos(a.professorIds));
        add('aula', 'Aula da disciplina ' + dCurto(a.disciplinaId) + ' adicionada em ' + slot(a) + (det.length ? ' (' + det.join(', ') + ')' : '') + '.');
        continue;
      }
      const D = dCurto(a.disciplinaId);
      if (o.disciplinaId !== a.disciplinaId) {
        add('aula', 'A aula de ' + slot(o) + ' passou da disciplina ' + dCurto(o.disciplinaId) + ' para ' + D + '.');
      }
      if (o.dia !== a.dia || o.turno !== a.turno) {
        add('horario', 'Disciplina ' + D + ' passou do horário ' + slot(o) + ' para ' + slot(a) + '.');
      }
      // sala (ignora o caso em que a sala antiga simplesmente foi excluída do cadastro)
      const salaAntiga = o.salaId && idsDepois('salas').has(o.salaId) ? o.salaId : null;
      if (salaAntiga !== a.salaId) {
        const de = salaAntiga ? 'da sala ' + sCurto(salaAntiga) : 'de sala a definir';
        const para = a.salaId ? 'para a sala ' + sCurto(a.salaId) : 'para sala a definir';
        add('sala', 'Disciplina ' + D + ' (' + slot(a) + ') passou ' + de + ' ' + para + '.');
      }
      // professores (ignora os que foram excluídos do cadastro)
      const profAntigos = o.professorIds.filter((i) => idsDepois('professores').has(i));
      const igual = profAntigos.length === a.professorIds.length && profAntigos.every((i) => a.professorIds.includes(i));
      if (!igual) {
        let t;
        if (profAntigos.length && a.professorIds.length) t = 'atribuída a ' + pCurtos(profAntigos) + ', agora passou para ' + pCurtos(a.professorIds);
        else if (a.professorIds.length) t = 'sem docente definido, agora passou para ' + pCurtos(a.professorIds);
        else t = 'atribuída a ' + pCurtos(profAntigos) + ', agora ficou com docente a definir';
        add('professor', 'Disciplina ' + D + ' (' + slot(a) + ') ' + t + '.');
      }
    }
    for (const o of antes.aulas) {
      if (aulasDepois.has(o.id) || discRemovidas.has(o.disciplinaId)) continue;
      add('aula', 'Aula da disciplina ' + dCurto(o.disciplinaId) + ' (' + slot(o) + ') removida.');
    }
    return out;
  }

  const api = {
    DIAS, TURNOS, PERIODOS,
    clonar, novoId, porId, nomeDia, nomeTurno,
    periodoDaAula, detectarConflitos, descreverConflitos, rotuloAula,
    podeMover, normalizarEstado, estadoVazio,
    paraArquivo, lerArquivo, limparLog, diffEstados,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
