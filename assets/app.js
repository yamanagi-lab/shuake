/* P5R主明文本收录 —— 页面逻辑
   不依赖任何库，放到 GitHub Pages 即可运行。正文格式见 content/README.md。 */
(() => {
  'use strict';

  const AKECHI = ['明智吾郎', '爽やかな少年', '爽朗的少年'];
  const ARCANA = '正義';
  // 读到这些章节末尾时，右下角弹出成就（键 = 目录里的章节编号）
  const ACHIEVEMENTS = {
    'coop9-10': { title: 'For My Justice', desc: '正义协助关系达到MAX', icon: 'assets/achv-justice.png' },
  };
  const SITE = 'P5R主明文本收录';
  const WEEKDAY_EN = {
    '月曜日': 'MONDAY', '火曜日': 'TUESDAY', '水曜日': 'WEDNESDAY', '木曜日': 'THURSDAY',
    '金曜日': 'FRIDAY', '土曜日': 'SATURDAY', '日曜日': 'SUNDAY',
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('shuake:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('shuake:' + k, JSON.stringify(v)); } catch { /* 隐私模式等情况下忽略 */ } },
  };

  const prefs = {
    mode: store.get('mode', 'pair'),
    notes: store.get('notes', true),
    allopts: store.get('allopts', false),
    size: store.get('size', 'm'),
    theme: store.get('theme', 'auto'),
  };
  const savePref = (k, v) => { prefs[k] = v; store.set(k, v); };

  /* ================= 解析 ================= */

  const KANA = /[ぁ-ゖァ-ヺヽ-ヿ]/;
  const SPEAKER = /^([^\s\-－—―–（(「『“>＞※][^：:]{0,13})[：:]\s*(.*)$/;
  const DASH = /^[-－—―–]\s*/;
  const DIR = /^(?:[（(][^（）()]*[）)]\s*)+$/;   // 整行都在括号里才算舞台说明，如「（55：！）」「（明智拿枪）（55：！？）」
  const KINDS = {
    '对照': 'pair', '對照': 'pair', '逐行': 'lines', '选项': 'choice', '選項': 'choice',
    'SNS': 'sns', 'sns': 'sns', '注': 'note', '小结': 'summary', '碎碎念': 'aside',
  };

  const sentence = s => { const text = s.replace(DASH, '').trim(); return { text, dir: DIR.test(text) }; };
  const isJa = line => { const m = line.match(SPEAKER); return KANA.test(m && m[2] ? m[2] : line); };
  const isAkechi = name => !!name && AKECHI.some(n => name.includes(n));

  // 一组同语言的行 → 发言列表。「名字：」开始新发言，其余行接在当前发言后面。
  function parseTurns(lines) {
    const turns = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const sp = DASH.test(line) ? null : line.match(SPEAKER);
      if (sp) {
        cur = { who: sp[1].trim(), lines: [] };
        turns.push(cur);
        if (sp[2].trim()) cur.lines.push(sentence(sp[2]));
      } else {
        if (!cur) { cur = { who: null, lines: [] }; turns.push(cur); }
        cur.lines.push(sentence(line));
      }
    }
    return turns;
  }

  function zipTurns(ja, zh) {
    const empty = { who: null, lines: [] };
    return Array.from({ length: Math.max(ja.length, zh.length) }, (_, i) => {
      const a = ja[i] || empty, b = zh[i] || empty;
      return { whoJa: a.who || b.who, whoZh: b.who || a.who, ja: a.lines, zh: b.lines };
    });
  }

  function pairToTurn(ja, zh) {
    return zipTurns(ja ? parseTurns([ja]) : [], zh ? parseTurns([zh]) : [])[0];
  }

  // 日中逐行交替（或「日文 | 中文」写在同一行）→ 发言列表；※ 开头是短注释。
  function parseLinePairs(lines) {
    const out = [];
    let pend = null;
    const flush = () => { if (pend) { out.push(pairToTurn(pend, null)); pend = null; } };
    for (const line of lines) {
      if (line.startsWith('※')) { flush(); out.push({ note: line.slice(1).trim() }); continue; }
      if (line.includes('|')) {
        flush();
        const [a, ...b] = line.split('|');
        out.push(pairToTurn(a.trim(), b.join('|').trim()));
        continue;
      }
      if (isJa(line)) { flush(); pend = line; }
      else if (pend) { out.push(pairToTurn(pend, line)); pend = null; }
      else out.push(pairToTurn(null, line));
    }
    flush();
    return out;
  }

  function parseOption(line) {
    const body = line.replace(/^[>＞]\s*/, '');
    let parts = body.split('|').map(s => s.trim());
    if (parts.length === 1) {
      const m = body.match(/^(.*?)　+(.*)$/);
      parts = m ? [m[1], m[2]] : [body, ''];
    }
    let zh = parts[1] || '';
    let pts = null;
    const tail = /[（(]\s*(\d+|无)\s*🎶?\s*[）)]\s*$/;
    const mt = zh.match(tail);
    if (mt) { zh = zh.replace(tail, '').trim(); pts = mt[1] === '无' ? 0 : +mt[1]; }
    const mp = (parts[2] || '').match(/\d+|无/);
    if (mp) pts = mp[0] === '无' ? 0 : +mp[0];
    return { ja: parts[0], zh, pts, raw: [] };
  }

  function parseChapter(src) {
    const blocks = [];
    let cur = null;
    const open = (type, arg) => { cur = { type, arg, ja: [], zh: [], raw: [], side: 'ja' }; blocks.push(cur); };
    for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
      const d = raw.match(/^::\s*(\S+)\s*(.*)$/);
      if (d) {
        if (d[1] === '译' || d[1] === '譯') {
          if (cur && cur.type === 'pair') cur.side = 'zh';
          else console.warn('「::译」前面需要先有「::对照」');
          continue;
        }
        if (!KINDS[d[1]]) console.warn('未知的段落类型：' + d[1]);
        open(KINDS[d[1]] || 'lines', d[2].trim());
        continue;
      }
      if (!cur) { if (!raw.trim()) continue; open('lines', ''); }
      if (cur.type === 'pair') cur[cur.side].push(raw); else cur.raw.push(raw);
    }
    return blocks.map(finishBlock);
  }

  function finishBlock(b) {
    const lines = b.raw.map(l => l.trim()).filter(Boolean);
    switch (b.type) {
      case 'pair': {
        const ja = parseTurns(b.ja), zh = parseTurns(b.zh);
        if (ja.length !== zh.length) console.warn(`对照段落的发言数不一致：日文 ${ja.length}，中文 ${zh.length}`, b.ja[0], b.zh[0]);
        return { type: 'pair', turns: zipTurns(ja, zh) };
      }
      case 'choice': {
        const intro = [], options = [];
        for (const l of lines) {
          if (/^[>＞]/.test(l)) options.push(parseOption(l));
          else (options.length ? options[options.length - 1].raw : intro).push(l);
        }
        return {
          type: 'choice', title: b.arg, intro: parseLinePairs(intro),
          options: options.map(o => ({ ja: o.ja, zh: o.zh, pts: o.pts, resp: parseLinePairs(o.raw) })),
        };
      }
      case 'sns':
        return {
          type: 'sns', from: b.arg || '明智吾郎',
          msgs: lines.map(l => {
            if (/^[（(]/.test(l)) {
              const [a, ...b] = l.split('|');
              const zh = b.join('|').trim();
              return zh || !KANA.test(a) ? { dir: true, ja: zh ? a.trim() : '', zh: zh || a.trim() } : { dir: true, ja: a.trim(), zh: '' };
            }
            const me = /^55\s*[：:]/.test(l);
            const body = me ? l.replace(/^55\s*[：:]\s*/, '') : l.replace(DASH, '');
            const [ja, ...zh] = body.split('|');
            return { me, ja: ja.trim(), zh: zh.join('|').trim() };
          }),
        };
      case 'note':
        return { type: 'note', paras: lines };
      case 'summary':
        return { type: 'summary', turns: parseLinePairs(lines) };
      case 'aside':
        return {
          type: 'aside', title: b.arg,
          items: lines.map(l => {
            if (/^\d+[.．、]\s*/.test(l)) return { kind: 'num', text: l.replace(/^\d+[.．、]\s*/, '') };
            if (/^[>＞]\s*/.test(l)) return { kind: 'quote', text: l.replace(/^[>＞]\s*/, '') };
            return { kind: 'p', text: l };
          }),
        };
      default:
        return { type: 'lines', turns: parseLinePairs(lines) };
    }
  }


  /* ================= 数据 ================= */

  let TOC = [];
  const chapters = new Map();

  async function fetchText(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`读取 ${path} 失败（${res.status}）`);
    return res.text();
  }

  async function loadToc() {
    const text = await fetchText('content/toc.txt');
    // 「@三学期」以下的章节归入三学期日历，其余是二学期 coop 路线
    let term = 'coop';
    TOC = [];
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.trim();
      if (!l || l.startsWith('#')) continue;
      if (l.startsWith('@')) { term = l.slice(1).trim() === '三学期' ? 's3' : 'coop'; continue; }
      const [id, date, weekday, time, title, place, icon, file, weather, deco] = l.split('|').map(s => (s || '').trim());
      TOC.push({ id, date, weekday, time, title, place, icon, file, weather, deco, term });
    }
  }

  async function loadChapter(meta) {
    if (!chapters.has(meta.id)) {
      chapters.set(meta.id, fetchText('content/' + encodeURIComponent(meta.file))
        .then(src => ({ meta, blocks: parseChapter(src) }))
        .catch(err => { chapters.delete(meta.id); throw err; }));
    }
    return chapters.get(meta.id);
  }
  const loadAll = () => Promise.all(TOC.filter(c => c.file).map(loadChapter));

  /* ================= 剪报拼贴字 ================= */

  const LATIN_FONTS = [
    '"Arial Black", "Helvetica Neue", Arial, sans-serif',
    'Georgia, "Times New Roman", serif',
    '"Courier New", Courier, monospace',
    'Impact, "Arial Narrow", sans-serif',
    'Didot, "Bodoni 72", "Bodoni MT", serif',
    'Futura, "Century Gothic", "Trebuchet MS", sans-serif',
  ];
  const CJK_FONTS = ['var(--sans-ja)', 'var(--serif-ja)'];
  const VARIANTS = ['v-ink', 'v-paper', 'v-red', 'v-out', 'v-ink', 'v-ink-red'];

  function hash(str) {
    let h = 2166136261;
    for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function tiles(text, seed, n, variant) {
    return [...text].map((c, i) => {
      if (c === ' ') return '<span class="tile-gap"> </span>';
      const h = hash(seed + i + c);
      const cjk = /[　-鿿＀-￯]/.test(c);
      const font = cjk ? CJK_FONTS[(h >>> 3) % CJK_FONTS.length] : LATIN_FONTS[(h >>> 3) % LATIN_FONTS.length];
      const r = ((h >>> 7) % 13) - 6;
      const y = (((h >>> 11) % 7) - 3) * 0.02;
      const ts = 0.86 + ((h >>> 14) % 5) * 0.07;
      const v = variant || VARIANTS[h % VARIANTS.length];
      return `<span class="tile ${v}" style='--i:${n.i++};--r:${r}deg;--y:${y.toFixed(2)}em;--ts:${ts.toFixed(2)};font-family:${font};font-weight:${cjk ? 800 : 700}'>${esc(c)}</span>`;
    }).join('');
  }

  const mixCase = s => s.replace(/(?!^)[IA]/g, c => c.toLowerCase());
  const shortDate = meta => meta.date ? meta.date.replace('.', '/') : '';
  // 三学期的章节没有标题，用「12/24（土）」代替
  const titleOf = c => c.title || `${shortDate(c)}（${(c.weekday || '').charAt(0)}）`;
  const WEATHER = { '晴': '\u2600\uFE0E', '曇': '\u2601\uFE0E', '雨': '\u2602\uFE0E', '雪': '\u2744\uFE0E' };
  // 游戏里通用的配色：周六青色、周日红色
  const dayTone = weekday => (/^土/.test(weekday || '') ? 'sat' : /^日/.test(weekday || '') ? 'sun' : '');

  // 正月的梅花装饰（toc.txt 最后一栏写「梅」）
  const PLUM = (() => {
    const petals = [0, 72, 144, 216, 288].map(a => {
      const r = a * Math.PI / 180;
      return `<circle cx="${(6 * Math.sin(r)).toFixed(2)}" cy="${(-6 * Math.cos(r)).toFixed(2)}" r="5.4"/>`;
    }).join('');
    const dots = [0, 60, 120, 180, 240, 300].map(a => {
      const r = a * Math.PI / 180;
      return `<circle cx="${(2.3 * Math.sin(r)).toFixed(2)}" cy="${(-2.3 * Math.cos(r)).toFixed(2)}" r=".75"/>`;
    }).join('');
    return `<svg class="plum" viewBox="-12.5 -12.5 25 25" aria-hidden="true"><g fill="#F6A9BA" stroke="#fff" stroke-width="1">${petals}</g><circle r="3.4" fill="#fff"/><g fill="#C8102E">${dots}</g></svg>`;
  })();
  const PLUM_TRAIL = '<span class="plum-trail" aria-hidden="true">' + Array.from({ length: 7 }, (_, i) => `<i style="--n:${i}"></i>`).join('') + '</span>';

  function stampHTML(meta, withTitle = true) {
    const n = { i: 0 };
    const seed = meta.id;
    let html = '';
    if (meta.date) {
      const en = WEEKDAY_EN[meta.weekday] || '';
      const k = (meta.weekday || '').charAt(0);
      const tone = dayTone(meta.weekday);
      const plum = meta.deco === '梅';
      html += `<span class="stamp-row big">${plum ? PLUM : ''}${tiles(shortDate(meta), seed + 'd', n)}</span>`;
      html += '<span class="stamp-sub"><span class="stamp-row mid">';
      if (en) html += `<span class="tile ${tone === 'sat' ? 'v-ink-teal' : tone === 'sun' ? 'v-ink-red' : 'v-ink'} band" style='--i:${n.i++};--r:-4deg;font-family:"Arial Black", Impact, sans-serif;font-weight:900'>${mixCase(en)}</span>`;
      if (k) html += tiles(k, seed + 'k', n, tone === 'sat' ? 'v-teal' : 'v-red');
      if (meta.weather) html += `<span class="tile v-paper wx" style='--i:${n.i++};--r:8deg' title="${esc(meta.weather)}">${WEATHER[meta.weather] || esc(meta.weather)}</span>`;
      if (plum) html += PLUM;
      html += `</span><span class="stamp-row mid">${plum ? PLUM_TRAIL : ''}${tiles(meta.time || '', seed + 't', n)}</span></span>`;
    }
    if (meta.title && (withTitle || !meta.date)) {
      html += `<span class="stamp-row title">${tiles(meta.title.replace(/^coop/i, 'COOP'), seed + 'T', n)}</span>`;
    }
    return html;
  }

  /* ================= 渲染：正文 ================= */

  const rankOf = title => { const m = title.match(/coop\s*([\d０-９&＆]+)/i); return m ? m[1] : ''; };

  function lnHTML(s, lang, peek) {
    const cls = 'ln' + (s.dir ? ' dir' : '') + (peek ? ' peek' : '');
    return `<p class="${cls}"${lang ? ` lang="${lang}"` : ''}>${esc(s.text)}</p>`;
  }

  function whoHTML(t) {
    const ja = t.whoJa || t.whoZh, zh = t.whoZh || t.whoJa;
    return `<button type="button" class="who" aria-haspopup="menu"${ja === zh ? ' data-same' : ''}><span lang="ja">${esc(ja)}</span><span lang="zh-CN">${esc(zh)}</span></button>`;
  }

  // 日中逐句配对。只出现在一侧的舞台说明（如「（进入战斗）」）单独占一行，不打乱其余句子的对应。
  function alignLines(ja, zh) {
    if (ja.filter(s => !s.dir).length !== zh.filter(s => !s.dir).length) return null;
    const rows = [];
    let i = 0, j = 0;
    while (i < ja.length || j < zh.length) {
      const a = ja[i], b = zh[j];
      if (a && b && a.dir === b.dir) { rows.push([a, b]); i++; j++; }
      else if (a && a.dir) { rows.push([a, null]); i++; }
      else if (b && b.dir) { rows.push([null, b]); j++; }
      else { rows.push([a || null, b || null]); i++; j++; }
    }
    return rows;
  }

  const EMPTY = { ja: '<span class="ln-empty" lang="ja" aria-hidden="true"></span>', zh: '<span class="ln-empty" lang="zh-CN" aria-hidden="true"></span>' };

  function bodyHTML(t) {
    const rows = alignLines(t.ja, t.zh);
    if (rows) {
      return rows.map(([a, b]) => `<div class="row">${a ? lnHTML(a, 'ja', !!b) : EMPTY.ja}${b ? lnHTML(b, 'zh-CN') : EMPTY.zh}</div>`).join('');
    }
    // 实在对不上时，日文和中文各成一组，悬停时两组一起高亮
    const grp = (arr, lang, peek) => arr.length
      ? `<div class="grp${peek ? ' peek' : ''}" lang="${lang}">${arr.map(s => lnHTML(s, null)).join('')}</div>` : '';
    return `<div class="row">${grp(t.ja, 'ja', t.zh.length > 0)}${grp(t.zh, 'zh-CN', false)}</div>`;
  }

  function termify(p) {
    const m = p.match(/^(.{1,32}?)[：:]([\s\S]*)$/);
    if (m && !/[，。,]/.test(m[1])) {
      return `<dfn${KANA.test(m[1]) ? ' lang="ja" class="keep"' : ''}>${esc(m[1])}</dfn>：${esc(m[2])}`;
    }
    return esc(p);
  }

  const inoteHTML = text =>
    `<div class="inote"><span class="note-mark" aria-hidden="true">注</span><p><span class="visually-hidden">注释：</span>${termify(text)}</p></div>`;

  function turnHTML(t, id, ctx) {
    if (t.note) return inoteHTML(t.note);
    const named = t.whoJa || t.whoZh;
    const allDir = [...t.ja, ...t.zh].every(s => s.dir);
    const speaker = named || (allDir ? null : ctx.last);
    if (named) ctx.last = named;
    const cls = ['turn'];
    if (isAkechi(speaker)) cls.push('is-akechi');
    if (speaker === '55') cls.push('is-55');
    return `<div class="${cls.join(' ')}" id="${id}">${named ? whoHTML(t) : ''}<div class="turn-body">${bodyHTML(t)}</div></div>`;
  }

  function ptsHTML(n) {
    if (n == null) return '';
    if (n === 0) return '<span class="pts zero">无♪<span class="visually-hidden">（好感度不变）</span></span>';
    return `<span class="pts">${'♪'.repeat(n)}<span class="visually-hidden">（好感度 +${n}）</span></span>`;
  }

  function choiceHTML(b, id, ctx) {
    const tag = b.title.replace(/^[（(]|[）)]$/g, '');
    const hasResp = b.options.some(o => o.resp.length);
    const intro = b.intro.map((t, k) => turnHTML(t, `${id}-i${k}`, ctx)).join('');
    const opts = b.options.map((o, j) => {
      const resp = o.resp.length
        ? `<div class="opt-resp">${o.resp.map((t, k) => turnHTML(t, `${id}-${j}-${k}`, ctx)).join('')}</div>` : '';
      const zh = o.zh ? `<span lang="zh-CN">${esc(o.zh)}</span>` : '';
      return `<li class="opt"><p class="opt-line"><button type="button" class="opt-box" aria-pressed="false"><span lang="ja"${o.zh ? ' class="peek"' : ''}>${esc(o.ja)}</span>${zh}</button>${ptsHTML(o.pts)}</p>${resp}</li>`;
    }).join('');
    const head = `55 的选项${tag ? `<span class="choice-tag">${esc(tag)}</span>` : ''}${hasResp ? '<span class="choice-hint">点击选项查看差分</span>' : ''}`;
    return `<section class="choice${hasResp ? ' collapsed' : ''}" id="${id}" aria-label="55 的选项"><p class="choice-head">${head}</p>${intro}<ol class="opts">${opts}</ol></section>`;
  }

  const SNS_TILT = [-1.1, .8, -.5, 1.2, -.8, .5];
  const SNS_LOGO = [['S', 'v-paper', -7], ['N', 'v-ink', 5], ['S', 'v-paper', -3]]
    .map(([c, v, r], i) => `<span class="tile ${v}" style="--r:${r}deg;--i:${i}">${c}</span>`).join('');

  function snsHTML(b, id) {
    const msgs = b.msgs.map((m, k) => m.dir
      ? `<div class="msg-dir">${m.ja ? `<p lang="ja"${m.zh ? ' class="peek"' : ''}>${esc(m.ja)}</p>` : ''}${m.zh ? `<p lang="zh-CN"${m.ja ? '' : ' class="keep"'}>${esc(m.zh)}</p>` : ''}</div>`
      :
      `<div class="msg${m.me ? ' me' : ''}" style="--i:${k};--rot:${SNS_TILT[k % SNS_TILT.length]}deg"><span class="msg-shape" aria-hidden="true"></span><p lang="ja"${m.zh ? ' class="peek"' : ''}>${esc(m.ja)}</p>${m.zh ? `<p lang="zh-CN">${esc(m.zh)}</p>` : ''}</div>`).join('');
    return `<section class="sns${motionOK() ? ' anim' : ''}" id="${id}" aria-label="SNS 消息"><p class="sns-head"><span class="sns-logo" aria-hidden="true">${SNS_LOGO}</span><span class="visually-hidden">SNS：</span><span class="sns-from">${esc(b.from)}</span></p><div class="sns-log">${msgs}</div></section>`;
  }

  function summaryHTML(b, id, ctx) {
    const rows = b.turns.map((t, k) => turnHTML(t, `${id}-${k}`, { last: null })).join('');
    const numeric = /^\d+$/.test(ctx.rank);
    const anim = numeric && motionOK();
    let rank = '';
    if (ctx.rank) {
      rank = `<span class="sum-rank"><small lang="ja" class="keep">ランク</small><span class="rank-num">${anim ? `<span class="r-old" aria-hidden="true">${+ctx.rank - 1}</span>` : ''}<span class="r-new">${esc(ctx.rank)}</span></span></span>`;
    }
    const up = ctx.rank ? '<span class="rankup keep" lang="ja">ランクアップ</span>' : '';
    return `<section class="summary${anim ? ' anim' : ''}" id="${id}" aria-label="coop 小结">${up}<div class="sum-band"><span class="sum-arcana keep" lang="ja">${ARCANA}</span>${rank}</div><div class="sum-text">${rows}</div></section>`;
  }

  function noteHTML(b, id) {
    return `<aside class="note" id="${id}"><span class="note-mark" aria-hidden="true">注</span><div class="note-body"><span class="visually-hidden">注释：</span>${b.paras.map(p => `<p>${termify(p)}</p>`).join('')}</div></aside>`;
  }

  function asideHTML(b, id) {
    const m = b.title.match(/^(.*?)[（(](.*)[）)]$/);
    const title = m ? m[1] : (b.title || '碎碎念');
    const sub = m ? m[2] : '';
    let html = '', inList = false, inQuote = false;
    const closeQuote = () => { if (inQuote) { html += '</blockquote>'; inQuote = false; } };
    for (const it of b.items) {
      if (it.kind === 'quote') {
        if (!inQuote) { html += '<blockquote>'; inQuote = true; }
        html += `<p>${esc(it.text)}</p>`;
        continue;
      }
      closeQuote();
      if (it.kind === 'num') {
        html += inList ? '</li><li>' : '<ol><li>';
        inList = true;
        html += `<p>${esc(it.text)}</p>`;
      } else {
        if (inList) { html += '</li></ol>'; inList = false; }
        html += `<p>${esc(it.text)}</p>`;
      }
    }
    closeQuote();
    if (inList) html += '</li></ol>';
    return `<details class="aside" id="${id}"><summary><span class="aside-title">${esc(title)}</span>${sub ? `<span class="aside-sub">${esc(sub)}</span>` : ''}</summary><div class="aside-body">${html}</div></details>`;
  }

  function renderBlocks(ch) {
    const ctx = { last: null, rank: rankOf(ch.meta.title) };
    return ch.blocks.map((b, i) => {
      const id = 'b' + i;
      switch (b.type) {
        case 'choice': return choiceHTML(b, id, ctx);
        case 'sns': return snsHTML(b, id);
        case 'note': return noteHTML(b, id);
        case 'summary': return summaryHTML(b, id, ctx);
        case 'aside': return asideHTML(b, id);
        default: return `<div class="turns" id="${id}">${b.turns.map((t, j) => turnHTML(t, `${id}-${j}`, ctx)).join('')}</div>`;
      }
    }).join('');
  }

  /* ================= 页面生命周期 ================= */

  let cleanups = [];
  const runCleanups = () => { cleanups.forEach(fn => fn()); cleanups = []; };
  let currentIdx = -1;
  const headH = () => $('.site-head').getBoundingClientRect().height;

  function onView(els, fn, options = {}) {
    if (!('IntersectionObserver' in window)) { els.forEach(fn); return; }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { fn(e.target); io.unobserve(e.target); } });
    }, { threshold: .3, ...options });
    els.forEach(el => io.observe(el));
    cleanups.push(() => io.disconnect());
  }

  /* ================= 首页 ================= */

  function routeHTML(hereId) {
    return TOC.filter(c => c.term !== 's3').map((c, i) => {
      const wave = Math.sin(i * 1.15);
      const xd = 22 + 17 * wave, xm = 9 + 6 * wave;
      const when = c.date ? `${c.date}　${c.weekday}　${c.time}　` : '';
      const here = c.id === hereId;
      const tag = here ? '上次读到这里' : (c.file ? '' : '样章未收录');
      const inner = `<span class="stop-title" lang="ja">${esc(c.title)}${tag ? `<span class="stop-tag">${tag}</span>` : ''}</span><span class="stop-meta">${esc(when)}<span class="stop-place"><span class="stop-ico" aria-hidden="true">${esc(c.icon)}</span>${esc(c.place)}</span></span>`;
      const link = c.file
        ? `<a class="stop-link" href="#/read/${encodeURIComponent(c.id)}">${inner}</a>`
        : `<div class="stop-link">${inner}</div>`;
      return `<li class="stop${c.file ? '' : ' off'}${here ? ' here' : ''}" style="--xd:${xd.toFixed(1)}%;--xm:${xm.toFixed(1)}%"><svg class="pin" aria-hidden="true"><use href="#pin"/></svg>${link}</li>`;
    }).join('');
  }

  const MONTH_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const S3_MONTHS = [[2016, 12], [2017, 1], [2017, 2]];

  // 三学期日历：仿游戏里的行程日历，一次看一个月，L / R 翻月
  const WD_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const WD_JA = '日月火水木金土';

  function calendarDays(y, m) {
    const byDate = new Map(TOC.filter(c => c.term === 's3' && c.date).map(c => [c.date, c]));
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    return { first, days, at: d => byDate.get(`${m}.${d}`) };
  }

  function calendarGrid(k, hereId) {
    const [y, m] = S3_MONTHS[k];
    const { first, days, at } = calendarDays(y, m);
    let cells = '<li class="d blank" aria-hidden="true"></li>'.repeat(first);
    for (let d = 1; d <= days; d++) {
      const wd = (first + d - 1) % 7;
      const tone = wd === 0 ? ' sun' : wd === 6 ? ' sat' : '';
      const c = at(d);
      const r = ((hash(`${m}.${d}`) % 7) - 3) * .8;
      if (!c) { cells += `<li class="d${tone}" style="--r:${r}deg;--n:${first + d}" aria-hidden="true"><span>${d}</span></li>`; continue; }
      const here = c.id === hereId;
      const label = [`${m}月${d}日`, c.weekday, c.time, c.weather].filter(Boolean).join(' ');
      const inner = `<b>${d}</b>${c.weather ? `<i class="wx" aria-hidden="true">${WEATHER[c.weather] || ''}</i>` : ''}${c.deco === '梅' ? PLUM : ''}${here ? '<em class="last" aria-hidden="true">上次</em>' : ''}`;
      cells += `<li class="d has${tone}${here ? ' here' : ''}" style="--r:${r}deg;--n:${first + d}">${c.file
        ? `<a href="#/read/${encodeURIComponent(c.id)}" data-cid="${esc(c.id)}" aria-label="${esc(label)}${here ? '（上次读到这里）' : ''}">${inner}</a>`
        : `<span data-cid="${esc(c.id)}">${inner}</span>`}</li>`;
    }
    return cells;
  }

  function calendarSide(c, k) {
    const [, m] = S3_MONTHS[k];
    const { days, at } = calendarDays(...S3_MONTHS[k]);
    if (!c) {
      const any = Array.from({ length: days }, (_, i) => at(i + 1)).some(Boolean);
      return { sel: `${m}月`, body: `<p class="cal-empty">${any ? '选一个红框里的日子' : '这个月还没有收录剧情'}</p>` };
    }
    const [mm, dd] = c.date.split('.');
    const go = c.file
      ? `<a class="cal-go" href="#/read/${encodeURIComponent(c.id)}">阅读这一天</a>`
      : '<span class="cal-go off">尚未收录</span>';
    return {
      sel: `${mm}月　${dd}日（${(c.weekday || '').charAt(0)}）`,
      body: `<p class="cal-info"><b lang="ja">${esc(c.time || '')}</b>${c.weather ? `<span class="wx">${WEATHER[c.weather] || ''}</span><span lang="ja">${esc(c.weather)}</span>` : ''}</p>${go}`,
    };
  }

  function calendarHTML() {
    return `<div class="cal-board"><ol class="cal-wds" aria-hidden="true">${WD_EN.map((w, i) => `<li class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</li>`).join('')}</ol><ol class="cal-days"></ol></div>
      <div class="cal-side">
        <p class="cal-year"><span></span>年</p>
        <div class="cal-nav"><button type="button" class="cal-lr" data-dir="-1" aria-label="上个月">L</button><p class="cal-m" aria-live="polite"><b></b>月</p><button type="button" class="cal-lr" data-dir="1" aria-label="下个月">R</button></div>
        <p class="cal-sel"></p>
        <div class="cal-detail"></div>
        <p class="cal-ask">要查看什么时候的剧情？</p>
      </div>`;
  }

  function setupCalendar(cal, hereId) {
    cal.innerHTML = calendarHTML();
    const s3 = TOC.filter(c => c.term === 's3' && c.date);
    const monthOf = c => S3_MONTHS.findIndex(([, m]) => m === +c.date.split('.')[0]);
    const here = s3.find(c => c.id === hereId);
    let k = here ? monthOf(here) : Math.max(0, S3_MONTHS.findIndex(([, m]) => s3.some(c => +c.date.split('.')[0] === m)));
    const grid = $('.cal-days', cal);

    const select = c => {
      const side = calendarSide(c, k);
      $('.cal-sel', cal).textContent = side.sel;
      $('.cal-detail', cal).innerHTML = side.body;
      $$('.d.sel', grid).forEach(el => el.classList.remove('sel'));
      if (c) $(`[data-cid="${CSS.escape(c.id)}"]`, grid)?.parentElement.classList.add('sel');
    };
    const show = (to, dir) => {
      k = Math.min(S3_MONTHS.length - 1, Math.max(0, to));
      const [, m] = S3_MONTHS[k];
      // 和游戏一样不写具体年份
      $('.cal-year span', cal).textContent = '20XX';
      $('.cal-m b', cal).textContent = m;
      grid.setAttribute('aria-label', `${m}月`);
      grid.innerHTML = calendarGrid(k, hereId);
      $$('.cal-lr', cal).forEach(b => { b.disabled = k + +b.dataset.dir < 0 || k + +b.dataset.dir >= S3_MONTHS.length; });
      const inMonth = s3.filter(c => monthOf(c) === k);
      select(inMonth.find(c => c.id === hereId) || inMonth[0] || null);
      if (dir && motionOK()) {
        grid.classList.remove('slide-l', 'slide-r');
        void grid.offsetWidth;
        grid.classList.add(dir > 0 ? 'slide-r' : 'slide-l');
      }
    };
    cal.addEventListener('click', e => {
      const b = e.target.closest('.cal-lr');
      if (b && !b.disabled) show(k + +b.dataset.dir, +b.dataset.dir);
    });
    const pick = e => {
      const el = e.target.closest('[data-cid]');
      if (el) select(TOC.find(c => c.id === el.dataset.cid));
    };
    grid.addEventListener('pointerover', pick);
    grid.addEventListener('focusin', pick);
    cal.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowLeft' && k > 0 && !e.target.closest('.cal-days')) { show(k - 1, -1); }
      if (e.key === 'ArrowRight' && k < S3_MONTHS.length - 1 && !e.target.closest('.cal-days')) { show(k + 1, 1); }
    });
    show(k, 0);
    if (motionOK()) {
      // 进入视野时，数字一个个拍上去
      cal.classList.add('anim');
      onView([cal], () => cal.classList.add('open'), { threshold: .2 });
    }
  }

  function setTocTerm(main, term) {
    $$('[data-term]', main).forEach(b => {
      const on = b.dataset.term === term;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('#panel-coop', main).hidden = term !== 'coop';
    $('#panel-s3', main).hidden = term !== 's3';
    $('#toc-title span', main).textContent = term === 's3' ? 'Calendar' : 'Route';
  }

  function smoothPath(p) {
    let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1.map(v => v.toFixed(1))} ${c2.map(v => v.toFixed(1))} ${p2.map(v => v.toFixed(1))}`;
    }
    return d;
  }

  // 画路线；返回整条长度和「上次读到」那一站的长度，供进场动画使用
  function layoutRoute(wrap, hereIdx) {
    const svg = $('.route-line', wrap), car = $('.route-car', wrap);
    const base = $('.route-base', svg), done = $('.route-done', svg);
    const box = wrap.getBoundingClientRect();
    const pts = $$('.pin', wrap).map(p => {
      const r = p.getBoundingClientRect();
      return [r.left + r.width / 2 - box.left, r.top + r.height * 0.36 - box.top];
    });
    if (!pts.length) return null;
    const first = pts[0], last = pts[pts.length - 1];
    const all = [[Math.max(first[0] - 64, 6), first[1] - 40], ...pts, [Math.min(last[0] + 140, box.width + 8), last[1] + 46]];
    const d = smoothPath(all);
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    base.setAttribute('d', d);
    done.setAttribute('d', d);
    const total = base.getTotalLength();
    let upto = 0;
    if (hereIdx >= 0) {
      done.setAttribute('d', smoothPath(all.slice(0, hereIdx + 2)));
      upto = done.getTotalLength();
      done.setAttribute('d', d);
    }
    done.style.strokeDasharray = `${total}`;
    done.style.strokeDashoffset = `${total - upto}`;
    car.style.offsetPath = `path("${d}")`;
    car.style.offsetDistance = `${(upto / total * 100).toFixed(3)}%`;
    return { total, upto };
  }

  function setupRoute(wrap, hereIdx) {
    let geo = layoutRoute(wrap, hereIdx);
    const ro = new ResizeObserver(() => { geo = layoutRoute(wrap, hereIdx); });
    ro.observe(wrap);
    cleanups.push(() => ro.disconnect());
    document.fonts?.ready.then(() => { if (wrap.isConnected) geo = layoutRoute(wrap, hereIdx); });
    if (!motionOK() || hereIdx < 0) return;
    // 进入视野时，猫车沿路线开到上次读到的那一站
    onView([wrap], () => {
      if (!geo || !geo.upto) return;
      const opts = { duration: 1500, easing: 'cubic-bezier(.45, 0, .2, 1)', fill: 'backwards' };
      $('.route-done', wrap).animate([{ strokeDashoffset: geo.total }, { strokeDashoffset: geo.total - geo.upto }], opts);
      $('.route-car', wrap).animate([{ offsetDistance: '0%' }, { offsetDistance: `${(geo.upto / geo.total * 100).toFixed(3)}%` }], opts);
    }, { threshold: .15 });
  }

  function initTilt(main) {
    if (!motionOK() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const area = $('.hero-visual', main), sheet = $('.cover-sheet', main);
    let raf = 0;
    area.addEventListener('pointermove', e => {
      const r = area.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        sheet.classList.add('tracking');
        sheet.style.setProperty('--ry', `${(x * 16).toFixed(2)}deg`);
        sheet.style.setProperty('--rx', `${(-y * 12).toFixed(2)}deg`);
      });
    });
    area.addEventListener('pointerleave', () => {
      cancelAnimationFrame(raf);
      sheet.classList.remove('tracking');
      sheet.style.setProperty('--rx', '0deg');
      sheet.style.setProperty('--ry', '0deg');
    });
  }


  function showHome(toToc) {
    runCleanups();
    currentIdx = -1;
    document.body.classList.remove('reading');
    $('.now-chip').hidden = true;
    const main = $('#main');
    main.replaceChildren($('#tpl-home').content.cloneNode(true));

    const last = store.get('last', null);
    const lastIdx = last ? TOC.findIndex(c => c.id === last.id && c.file) : -1;
    const cta = $('[data-resume]', main);
    if (lastIdx >= 0) {
      cta.textContent = `继续读 ${titleOf(TOC[lastIdx])}`;
      cta.href = `#/read/${encodeURIComponent(last.id)}${last.anchor ? '/' + last.anchor : ''}`;
    } else {
      const first = TOC.find(c => c.file);
      if (first) cta.href = `#/read/${encodeURIComponent(first.id)}`;
    }

    const hereId = lastIdx >= 0 ? TOC[lastIdx].id : null;
    $('#route', main).innerHTML = routeHTML(hereId);
    setupRoute($('.route-wrap', main), TOC.filter(c => c.term !== 's3').findIndex(c => c.id === hereId));
    setupCalendar($('#cal', main), hereId);
    setTocTerm(main, store.get('tocTerm', lastIdx >= 0 ? TOC[lastIdx].term : 'coop'));
    $('.toc-tabs', main).addEventListener('click', e => {
      const b = e.target.closest('[data-term]');
      if (b) { store.set('tocTerm', b.dataset.term); setTocTerm(main, b.dataset.term); }
    });
    $('.toc-tabs', main).addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const term = $('[aria-selected="true"]', main).dataset.term === 'coop' ? 's3' : 'coop';
      store.set('tocTerm', term);
      setTocTerm(main, term);
      $(`[data-term="${term}"]`, main).focus();
    });
    initTilt(main);
    const today = new Date();
    $('[data-today]', main).textContent = `令和${today.getFullYear() - 2018}.${today.getMonth() + 1}.${today.getDate()}`;

    document.title = SITE;
    if (toToc) $('#toc', main).scrollIntoView();
    else window.scrollTo(0, 0);
  }

  /* ================= 阅读页 ================= */

  function endHTML(idx) {
    const next = TOC[idx + 1], prev = TOC[idx - 1];
    let html = '';
    if (next) {
      const stamp = `<div class="stamp" aria-hidden="true">${stampHTML(next, false)}</div>`;
      const title = `<span class="next-title" lang="ja">${esc(next.title || '三学期')}</span>`;
      html += next.file
        ? `<a class="next-card" href="#/read/${encodeURIComponent(next.id)}" data-next>${stamp}<span class="next-label">下一篇</span>${title}</a>`
        : `<div class="next-card off">${stamp}<span class="next-label">下一篇（样章未收录）</span>${title}</div>`;
    } else {
      html += '<div class="next-card off"><span class="next-label">已经是最后一篇</span><span class="next-title">感谢阅读</span></div>';
    }
    if (prev) html += `<a class="prev-link" href="#/read/${encodeURIComponent(prev.id)}">上一篇：<span lang="ja">${esc(titleOf(prev))}</span></a>`;
    return html;
  }

  function applyReaderPrefs(reader) {
    reader.classList.remove('mode-pair', 'mode-zh', 'mode-ja');
    reader.classList.add('mode-' + prefs.mode);
    reader.classList.toggle('hide-notes', !prefs.notes);
    reader.classList.toggle('allopts', prefs.allopts);
    $$('[data-mode]', reader).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === prefs.mode)));
    $$('[data-toggle]', reader).forEach(b => b.setAttribute('aria-pressed', String(!!prefs[b.dataset.toggle])));
    $$('.show', reader).forEach(el => el.classList.remove('show'));
    $$('.ch-body .ln.peek, .ch-body .grp.peek, .ch-body .msg .peek', reader).forEach(el => {
      if (prefs.mode === 'ja') { el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', el.textContent + '（显示译文）'); }
      else { el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-label'); }
    });
  }

  function pickOption(opt, toggle = true) {
    const choice = opt.closest('.choice');
    const was = opt.classList.contains('picked');
    $$('.opt', choice).forEach(o => { o.classList.remove('picked'); $('.opt-box', o).setAttribute('aria-pressed', 'false'); });
    if (was && toggle) return;
    void opt.offsetWidth;
    opt.classList.add('picked');
    $('.opt-box', opt).setAttribute('aria-pressed', 'true');
  }

  function bindReader(reader, idx) {
    const reveal = el => {
      const zh = el.nextElementSibling;
      if (zh && zh.matches('[lang="zh-CN"]')) zh.classList.toggle('show');
    };
    reader.addEventListener('click', e => {
      const m = e.target.closest('[data-mode]');
      if (m) { savePref('mode', m.dataset.mode); applyReaderPrefs(reader); return; }
      const t = e.target.closest('[data-toggle]');
      if (t) { savePref(t.dataset.toggle, !prefs[t.dataset.toggle]); applyReaderPrefs(reader); return; }
      const who = e.target.closest('.who');
      if (who) { openTurnMenu(who); return; }
      const opt = e.target.closest('.opt-box');
      if (opt) {
        pickOption(opt.closest('.opt'));
        if (prefs.mode === 'ja') { const p = $('.peek', opt); if (p) reveal(p); }
        return;
      }
      if (e.target.closest('[data-next]')) { pendingDay = { from: TOC[idx].id, to: TOC[idx + 1].id }; return; }
      if (prefs.mode === 'ja') { const p = e.target.closest('.ch-body .peek'); if (p) reveal(p); }
    });
    reader.addEventListener('keydown', e => {
      if (prefs.mode !== 'ja' || (e.key !== 'Enter' && e.key !== ' ')) return;
      const p = e.target.closest('.ch-body .peek');
      if (p && !p.closest('.opt-box')) { e.preventDefault(); reveal(p); }
    });
  }

  function watchReader(reader, meta) {
    // 章节标题离开视野后，页眉显示当前章节
    const chip = $('.now-chip');
    chip.innerHTML = meta.date
      ? `<b>${esc(shortDate(meta))}</b><span lang="ja">${esc(meta.weekday.charAt(0))}</span><span lang="ja">${esc(meta.title || meta.time)}</span>`
      : `<span lang="ja">${esc(meta.title)}</span>`;
    const stamp = $('.ch-head', reader);
    const io = new IntersectionObserver(([e]) => { chip.hidden = e.isIntersecting; }, { rootMargin: `-${Math.round(headH())}px 0px 0px 0px` });
    io.observe(stamp);
    cleanups.push(() => { io.disconnect(); chip.hidden = true; });

    // SNS 和升级卡：看到时才播放
    onView($$('.sns.anim, .summary.anim', reader), el => el.classList.add('play'), { threshold: .35 });

    // 读到章末时解锁成就
    const achv = ACHIEVEMENTS[meta.id];
    if (achv) onView([$('.ch-end', reader)], () => unlockAchievement(meta.id, achv), { threshold: .5 });

    // 记住读到哪里
    const save = anchor => store.set('last', { id: meta.id, anchor, t: Date.now() });
    save(store.get('last', {}).id === meta.id ? store.get('last', {}).anchor : null);
    let timer = 0;
    const seen = new Map();
    const pio = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) seen.set(e.target, e.boundingClientRect.top); else seen.delete(e.target); });
      clearTimeout(timer);
      timer = setTimeout(() => {
        let best = null, top = Infinity;
        seen.forEach((y, el) => { if (el.isConnected && y < top) { top = y; best = el; } });
        if (best) save(best.id);
      }, 400);
    }, { rootMargin: `-${Math.round(headH() + 60)}px 0px -40% 0px` });
    $$('.turn', reader).forEach(el => pio.observe(el));
    cleanups.push(() => { pio.disconnect(); clearTimeout(timer); });
  }

  function showChapter(meta, ch, idx, anchor, playStamp = true) {
    runCleanups();
    currentIdx = idx;
    document.body.classList.add('reading');
    const frag = $('#tpl-reader').content.cloneNode(true);
    const title = $('#ch-title', frag);
    title.innerHTML = stampHTML(meta);
    title.setAttribute('aria-label', [meta.date && `${meta.date} ${meta.weekday} ${meta.time}`, meta.weather, meta.title].filter(Boolean).join(' '));
    if (meta.place) $('.ch-place', frag).innerHTML = `<span class="stop-ico" aria-hidden="true">${esc(meta.icon)}</span>${esc(meta.place)}`;
    else $('.ch-place', frag).remove();
    $('.ch-body', frag).innerHTML = renderBlocks(ch);
    $('.ch-end', frag).innerHTML = endHTML(idx);
    const main = $('#main');
    main.replaceChildren(frag);

    const reader = $('.reader', main);
    applyReaderPrefs(reader);
    bindReader(reader, idx);
    watchReader(reader, meta);
    if (window.Comments) cleanups.push(window.Comments.mount(reader, meta));
    document.title = `${titleOf(meta)}｜${SITE}`;
    if (anchor) jumpTo(anchor);
    else {
      window.scrollTo(0, 0);
      if (playStamp) requestAnimationFrame(() => $('.stamp', main).classList.add('play'));
    }
  }

  function jumpTo(anchor) {
    const el = document.getElementById(anchor);
    if (!el) { window.scrollTo(0, 0); return; }
    const reader = $('.reader');
    const det = el.closest('details');
    if (det) det.open = true;
    const opt = el.closest('.opt');
    if (opt && !opt.classList.contains('picked') && opt.closest('.choice.collapsed') && !prefs.allopts) pickOption(opt, false);
    el.closest('.sns.anim, .summary.anim')?.classList.add('play');
    if (!el.offsetParent && !prefs.notes) { savePref('notes', true); applyReaderPrefs(reader); }
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  function showMessage(text, linkText) {
    runCleanups();
    currentIdx = -1;
    document.body.classList.remove('reading');
    $('#main').innerHTML = `<div class="msg-page"><p>${esc(text)}</p><p><a href="#/toc">${esc(linkText)}</a></p></div>`;
    document.title = SITE;
    window.scrollTo(0, 0);
  }

  function showError(err) {
    console.error(err);
    const local = location.protocol === 'file:';
    $('#main').innerHTML = `<div class="msg-page"><p>${esc(err.message || err)}</p>${local
      ? '<p>直接双击打开 index.html 时，浏览器不允许读取 content 文件夹。请用本地服务器预览，或部署到 GitHub Pages 之后再看。</p>'
      : '<p>请刷新页面再试一次。</p>'}<p><a href="#/">回到首页</a></p></div>`;
  }

  /* ================= 过场 ================= */

  let pendingDay = null;

  // 普通跳转：P5 式斜切（浏览器支持 View Transitions 时）
  function swap(fn) {
    if (firstRoute || !document.startViewTransition || !motionOK() || document.visibilityState === 'hidden') { fn(); return Promise.resolve(); }
    const vt = document.startViewTransition(fn);
    vt.ready.catch(() => {});
    vt.finished.catch(() => {});
    return vt.updateCallbackDone.catch(err => console.error(err));
  }

  // 读完一章去下一章：仿 P5 换日的日历过场
  function dayChange(from, to, render) {
    return new Promise(resolve => {
      const dc = $('.daychange');
      $('.dc-old', dc).innerHTML = `<div class="stamp">${stampHTML(from)}</div>`;
      $('.dc-new', dc).innerHTML = `<div class="stamp">${stampHTML(to)}</div>`;
      dc.className = 'daychange';
      dc.hidden = false;
      void dc.offsetWidth;
      dc.classList.add('in');
      let rendered = false, finished = false;
      const timers = [];
      const doRender = () => { if (!rendered) { rendered = true; render(); } };
      const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
      const finish = () => {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout);
        document.removeEventListener('keydown', onKey);
        doRender();
        dc.classList.add('out');
        setTimeout(() => {
          dc.hidden = true;
          dc.className = 'daychange';
          $('.reader .stamp')?.classList.add('play');
          resolve();
        }, 400);
      };
      timers.push(setTimeout(() => {
        dc.classList.add('flip');
        $('.dc-new .stamp', dc).classList.add('play');
        doRender();
      }, 560));
      timers.push(setTimeout(finish, 1550));
      dc.onclick = finish;
      document.addEventListener('keydown', onKey);
    });
  }

  /* ================= 成就 ================= */

  let achvTimer = 0;
  function unlockAchievement(id, a) {
    const el = $('.achv');
    el.innerHTML = `<img class="achv-icon" src="${a.icon}" alt="" width="64" height="64"><div class="achv-text"><p class="achv-title">${esc(a.title)}</p><p class="achv-desc">${esc(a.desc)}</p></div>`;
    el.setAttribute('aria-label', `解锁成就：${a.title}，${a.desc}`);
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    store.set('achv:' + id, Date.now());
    clearTimeout(achvTimer);
    achvTimer = setTimeout(hideAchievement, 6000);
  }
  function hideAchievement() {
    const el = $('.achv');
    clearTimeout(achvTimer);
    el.classList.remove('show');
    achvTimer = setTimeout(() => { el.hidden = true; }, 500);
  }

  /* ================= 发言菜单、提示 ================= */

  let toastTimer = 0;
  function toast(text) {
    const el = $('.toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  function openTurnMenu(btn) {
    const menu = $('.turn-menu');
    const turn = btn.closest('.turn');
    menu.dataset.turn = turn.id;
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.min(r.left + scrollX, document.documentElement.clientWidth - 220 + scrollX)}px`;
    menu.style.top = `${r.bottom + scrollY + 6}px`;
    menu.hidden = false;
    $('button', menu).focus({ preventScroll: true });
  }
  const closeTurnMenu = () => { $('.turn-menu').hidden = true; };

  function turnText(turn) {
    const meta = TOC[currentIdx];
    const names = $$('.who span', turn).map(s => s.textContent);
    const side = lang => $$(`.ln[lang="${lang}"], .grp[lang="${lang}"] .ln`, turn).map(p => p.textContent).join('');
    const ja = side('ja'), zh = side('zh-CN');
    const lines = [];
    if (ja) lines.push((names[0] ? names[0] + '：' : '') + ja);
    if (zh) lines.push((names[1] ? names[1] + '：' : '') + zh);
    lines.push(`（明智 coop 日中对照｜${meta ? titleOf(meta) : ''}）`);
    return lines.join('\n');
  }

  /* ================= 搜索 ================= */

  let index = null;
  const norm = s => (s || '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).toLowerCase();

  async function buildIndex() {
    if (index) return index;
    const list = await loadAll();
    index = [];
    for (const ch of list) {
      const { id } = ch.meta;
      const title = titleOf(ch.meta);
      const push = (anchor, who, ja, zh) => index.push({ id, title, anchor, who, ja, zh, nja: norm(ja), nzh: norm(zh) });
      const turns = (arr, pre, bid) => arr.forEach((t, j) => {
        if (t.note) push(bid, '注', '', t.note);
        else push(`${pre}-${j}`, t.whoZh || t.whoJa || '', t.ja.map(s => s.text).join(' '), t.zh.map(s => s.text).join(' '));
      });
      ch.blocks.forEach((b, i) => {
        const bid = 'b' + i;
        switch (b.type) {
          case 'choice':
            b.options.forEach((o, j) => { push(bid, '55 的选项', o.ja, o.zh); turns(o.resp, `${bid}-${j}`, bid); });
            break;
          case 'sns': b.msgs.forEach(m => push(bid, m.me ? '55' : b.from, m.ja, m.zh)); break;
          case 'note': push(bid, '注', '', b.paras.join(' ')); break;
          case 'aside': push(bid, '碎碎念', '', b.items.map(x => x.text).join(' ')); break;
          default: turns(b.turns, bid, bid);
        }
      });
    }
    return index;
  }

  function snippet(text, ntext, nq, radius = 26) {
    const i = ntext.indexOf(nq);
    if (i < 0) return esc(text.length > radius * 2 ? text.slice(0, radius * 2) + '…' : text);
    const s = Math.max(0, i - radius), e = Math.min(text.length, i + nq.length + radius);
    const seg = text.slice(s, e), nseg = ntext.slice(s, e);
    let html = '', last = 0, k = nseg.indexOf(nq);
    while (k >= 0) {
      html += esc(seg.slice(last, k)) + '<mark>' + esc(seg.slice(k, k + nq.length)) + '</mark>';
      last = k + nq.length;
      k = nseg.indexOf(nq, last);
    }
    html += esc(seg.slice(last));
    return (s > 0 ? '…' : '') + html + (e < text.length ? '…' : '');
  }

  function runSearch(q) {
    const dlg = $('#search');
    const status = $('.search-status', dlg), box = $('.search-results', dlg);
    const nq = norm(q.trim());
    if (!nq) { status.textContent = ''; box.innerHTML = ''; return; }
    const hits = index.filter(e => e.nja.includes(nq) || e.nzh.includes(nq));
    if (!hits.length) {
      status.textContent = `没有找到「${q.trim()}」。可以换个写法，或只输入其中几个字。`;
      box.innerHTML = '';
      return;
    }
    const shown = hits.slice(0, 150);
    status.textContent = hits.length > shown.length ? `找到 ${hits.length} 处，显示前 ${shown.length} 处` : `找到 ${hits.length} 处`;
    let html = '', cur = null;
    for (const h of shown) {
      if (h.id !== cur) { html += `<h3 lang="ja">${esc(h.title)}</h3>`; cur = h.id; }
      html += `<button type="button" class="hit" data-go="#/read/${encodeURIComponent(h.id)}/${h.anchor}">`
        + (h.who ? `<span class="hit-who">${esc(h.who)}</span>` : '')
        + (h.ja ? `<span class="hit-ja" lang="ja">${snippet(h.ja, h.nja, nq)}</span>` : '')
        + (h.zh ? `<span class="hit-zh">${snippet(h.zh, h.nzh, nq)}</span>` : '')
        + '</button>';
    }
    box.innerHTML = html;
  }

  async function openSearch() {
    const dlg = $('#search');
    const input = $('input', dlg);
    if (!dlg.open) dlg.showModal();
    input.focus();
    input.select();
    if (!index) {
      $('.search-status', dlg).textContent = '正在载入全文…';
      try { await buildIndex(); } catch (err) { $('.search-status', dlg).textContent = err.message; return; }
      $('.search-status', dlg).textContent = '';
    }
    if (input.value) runSearch(input.value);
  }

  /* ================= 外框：对话框、设置、抽屉、键盘 ================= */

  function openChapters() {
    const dlg = $('#chapters');
    $('.drawer-list', dlg).innerHTML = TOC.map((c, i) => {
      const date = c.date ? `${shortDate(c)} ${c.weekday.charAt(0)}` : '';
      const name = c.title || [c.time, c.weather].filter(Boolean).join('・');
      const inner = `<span class="dl-date" lang="ja">${esc(date)}</span><span><span class="dl-title" lang="ja">${esc(name)}</span>${c.file ? '' : '（样章未收录）'}</span>`;
      const sep = i === 0 || c.term !== TOC[i - 1].term ? `<li class="dl-sep">${c.term === 's3' ? '三学期' : '二学期 · coop'}</li>` : '';
      return `${sep}<li>${c.file
        ? `<a href="#/read/${encodeURIComponent(c.id)}"${i === currentIdx ? ' aria-current="page"' : ''}>${inner}</a>`
        : `<span class="off">${inner}</span>`}</li>`;
    }).join('');
    dlg.showModal();
    ($('[aria-current]', dlg) || $('a', dlg))?.focus();
  }

  function applyGlobalPrefs() {
    const root = document.documentElement;
    if (prefs.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
    if (prefs.size === 'm') delete root.dataset.size; else root.dataset.size = prefs.size;
  }

  function goChapter(i, viaDay) {
    const c = TOC[i];
    if (!c || !c.file) return;
    if (viaDay) pendingDay = { from: TOC[currentIdx].id, to: c.id };
    location.hash = `#/read/${encodeURIComponent(c.id)}`;
  }

  function bindChrome() {
    document.addEventListener('click', e => {
      const o = e.target.closest('[data-open]');
      if (o) {
        if (o.dataset.open === 'search') openSearch();
        if (o.dataset.open === 'chapters') openChapters();
        if (o.dataset.open === 'settings') {
          const dlg = $('#settings');
          $$('input', dlg).forEach(i => { i.checked = prefs[i.name] === i.value; });
          dlg.showModal();
        }
      }
      if (!e.target.closest('.turn-menu, .who')) closeTurnMenu();
    });

    $('.turn-menu').addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      const turn = document.getElementById($('.turn-menu').dataset.turn);
      if (!b || !turn) return;
      closeTurnMenu();
      const meta = TOC[currentIdx];
      if (b.dataset.act === 'copy') { await copyText(turnText(turn)); toast('已复制这句'); }
      if (b.dataset.act === 'link') {
        await copyText(`${location.origin}${location.pathname}#/read/${encodeURIComponent(meta.id)}/${turn.id}`);
        toast('已复制链接');
      }
    });

    $('.achv').addEventListener('click', hideAchievement);

    $('.now-chip').addEventListener('click', e => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: motionOK() ? 'smooth' : 'auto' });
    });

    $('#settings').addEventListener('change', e => {
      const i = e.target;
      if (i.name === 'size' || i.name === 'theme') { savePref(i.name, i.value); applyGlobalPrefs(); }
    });

    const search = $('#search');
    let timer = 0;
    $('input', search).addEventListener('input', e => {
      clearTimeout(timer);
      const q = e.target.value;
      timer = setTimeout(() => { if (index) runSearch(q); }, 120);
    });
    search.addEventListener('click', e => {
      if (e.target === search) { search.close(); return; }
      const hit = e.target.closest('[data-go]');
      if (!hit) return;
      search.close();
      if (location.hash === hit.dataset.go) route(); else location.hash = hit.dataset.go;
    });

    for (const id of ['#settings', '#chapters']) {
      $(id).addEventListener('click', e => {
        if (e.target === e.currentTarget || e.target.closest('a')) e.currentTarget.close();
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeTurnMenu();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest('input, textarea, [contenteditable]') || document.querySelector('dialog[open]')) return;
      if (!$('.daychange').hidden) return;
      if (e.key === '/') { e.preventDefault(); openSearch(); }
      if (currentIdx >= 0 && e.key === 'ArrowRight') goChapter(currentIdx + 1, motionOK());
      if (currentIdx >= 0 && e.key === 'ArrowLeft') goChapter(currentIdx - 1, false);
    });

    const gate = $('#gate');
    gate.addEventListener('cancel', e => e.preventDefault());
    gate.addEventListener('click', e => {
      const b = e.target.closest('[data-gate]');
      if (!b) return;
      if (b.dataset.gate === 'ok') { store.set('gate', true); gate.close(); $('#main').focus({ preventScroll: true }); }
      else if (history.length > 1) history.back();
      else location.replace('about:blank');
    });
  }

  /* ================= 路由 ================= */

  let firstRoute = true;

  async function route() {
    closeTurnMenu();
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (parts[0] === 'read' && parts[1]) {
        const idx = TOC.findIndex(c => c.id === parts[1]);
        const meta = TOC[idx];
        if (!meta) await swap(() => showMessage('没有找到这一篇。', '回到目录'));
        else if (!meta.file) await swap(() => showMessage(`「${titleOf(meta)}」还没有收录进网站。`, '回到目录'));
        else {
          const ch = await loadChapter(meta);
          const day = pendingDay && pendingDay.to === meta.id && !firstRoute && motionOK() ? pendingDay : null;
          pendingDay = null;
          if (day) await dayChange(TOC.find(c => c.id === day.from), meta, () => showChapter(meta, ch, idx, parts[2], false));
          else await swap(() => showChapter(meta, ch, idx, parts[2]));
        }
      } else {
        await swap(() => showHome(parts[0] === 'toc'));
      }
    } catch (err) {
      showError(err);
    }
    if (!firstRoute && !parts[2]) $('#main').focus({ preventScroll: true });
    firstRoute = false;
  }

  async function init() {
    applyGlobalPrefs();
    bindChrome();
    if (!store.get('gate', false)) $('#gate').showModal();
    try {
      await loadToc();
    } catch (err) {
      showError(err);
      return;
    }
    window.addEventListener('hashchange', route);
    await route();
  }

  init();
})();
