/* 段评
   每一句日中对照算一个「单元」，一条评论同时挂在这句的日文和中文上。
   后台在 server/server.py：匿名发布，先审后发，审核通过后才公开。 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('shuake:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('shuake:' + k, JSON.stringify(v)); } catch { /* 忽略 */ } },
  };

  const HOT = 10;           // 评论数到这个值时标签变红
  const MAX_NAME = 16;
  const MAX_TEXT = 300;
  const ANON = '匿名用户';
  const UNIT = '.turn-body > .row, .opt-line, .sns .msg, .sns .msg-dir';

  /* ---------- 单元标识：用日文原句（没有日文时用中文）算哈希，同章重复的句子加序号 ---------- */

  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  const textOf = el => (el ? el.textContent.replace(/\s+/g, '') : '');
  const lastLn = el => (el && el.matches('.grp') ? $$('.ln', el).pop() : el);

  function collect(body, ch) {
    const seen = new Map();
    return $$(UNIT, body).map(el => {
      let ja, zh;
      if (el.matches('.opt-line')) {
        ja = $('.opt-box [lang="ja"]', el);
        zh = $('.opt-box [lang="zh-CN"]', el);
      } else {
        ja = $(':scope > [lang="ja"]:not(.ln-empty)', el);
        zh = $(':scope > [lang="zh-CN"]:not(.ln-empty)', el);
      }
      if (!ja && !zh) return null;
      const base = `${ch}:${fnv(ja ? textOf(ja) : 'zh:' + textOf(zh)).toString(36)}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { el, ja, zh, ch, anchor: el.closest('[id]')?.id || '', key: n > 1 ? `${base}~${n}` : base };
    }).filter(Boolean);
  }

  /* ---------- 后台接口 ---------- */

  const API = store.get('ck-api', 'https://146.56.222.237');
  const MINE_DAYS = 14;     // 自己发的、还在审核中的评论在本机保留几天

  async function req(path, body) {
    const r = await fetch(API + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-cache' });
    const data = await r.json().catch(() => ({ ok: false }));
    if (!data.ok) throw new Error(data.error || '网络出错了');
    return data;
  }

  // 自己发出、还没通过审核的评论只存在本机，方便发帖的人看到「审核中」
  function minePending(key, approved) {
    const all = store.get('ck-mine', {});
    const cutoff = Date.now() - MINE_DAYS * 864e5;
    const ids = new Set(approved.map(c => c.id));
    const keep = (all[key] || []).filter(c => c.t > cutoff && !ids.has(c.id));
    if (keep.length) all[key] = keep; else delete all[key];
    store.set('ck-mine', all);
    return keep.map(c => ({ ...c, mine: true, pending: true }));
  }

  const api = {
    async counts(ch) {
      const data = await req(`/api/counts?ch=${encodeURIComponent(ch)}`);
      return new Map(Object.entries(data.counts));
    },
    async list(key) {
      const data = await req(`/api/comments?key=${encodeURIComponent(key)}`);
      return [...minePending(key, data.items), ...data.items];
    },
    async post(fields) {
      const data = await req('/api/comments', fields);
      const item = { id: data.id, name: fields.name, text: fields.text, t: Date.now() };
      if (data.id) {
        const all = store.get('ck-mine', {});
        (all[fields.key] = all[fields.key] || []).unshift(item);
        store.set('ck-mine', all);
      }
      return { ...item, mine: true, pending: true };
    },
  };

  /* ---------- 标签 ---------- */

  function setCount(u, n) {
    u.n = n;
    u.badges.forEach(b => {
      b.dataset.n = n;
      b.classList.toggle('hot', n >= HOT);
      b.setAttribute('aria-label', n ? `段评 ${n} 条` : '写段评');
    });
  }

  function addBadges(u) {
    const mk = cls => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ck' + cls;
      return b;
    };
    u.badges = [];
    if (u.el.matches('.opt-line')) {
      u.badges.push(u.el.appendChild(mk('')));
    } else {
      // 对照/中文模式下挂在中文句末，日本語模式下挂在日文句末；两个标签是同一个评论区
      const main = lastLn(u.zh || u.ja);
      u.badges.push(main.appendChild(mk(u.zh && u.ja ? ' ck-zh' : '')));
      if (u.zh && u.ja) u.badges.push(lastLn(u.ja).appendChild(mk(' ck-alt')));
    }
    setCount(u, 0);
  }

  /* ---------- 评论面板 ---------- */

  let dlg = null;
  let current = null;
  let tipTimer = 0;
  const TIP = '无需注册，匿名发布，审核后显示';

  // 面板是模态的，网站自带的 toast 会被遮住，所以提示直接写在发送按钮旁边
  function tip(text, bad) {
    const el = $('.cmt-tip', dlg);
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
    el.classList.add('flash-tip');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { el.textContent = TIP; el.classList.remove('bad', 'flash-tip'); }, 2600);
  }

  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
    const d = new Date(t);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  }

  const itemHTML = (c, isNew) => `<li class="cmt-item${isNew ? ' new' : ''}"><p class="cmt-meta"><b class="cmt-name${c.name ? '' : ' anon'}">${esc(c.name || ANON)}</b>${c.mine ? '<span class="cmt-mine">我</span>' : ''}${c.pending ? '<span class="cmt-pending">审核中</span>' : ''}<time datetime="${new Date(c.t).toISOString()}">${ago(c.t)}</time></p><p class="cmt-text">${esc(c.text)}</p></li>`;

  function buildDialog() {
    dlg = document.createElement('dialog');
    dlg.className = 'drawer cmt';
    dlg.setAttribute('aria-labelledby', 'cmt-title');
    dlg.innerHTML = `
      <div class="cmt-head">
        <h2 id="cmt-title">段评<span class="cmt-n"></span></h2>
        <form method="dialog"><button class="btn-plain">关闭</button></form>
      </div>
      <blockquote class="cmt-quote"><span class="cmt-who"></span><p lang="ja"></p><p lang="zh-CN"></p></blockquote>
      <ol class="cmt-list"></ol>
      <form class="cmt-form" novalidate>
        <label class="visually-hidden" for="cmt-name">昵称（选填）</label>
        <input id="cmt-name" name="name" maxlength="${MAX_NAME}" placeholder="昵称（选填，不填显示为${ANON}）" autocomplete="nickname">
        <label class="visually-hidden" for="cmt-text">评论内容</label>
        <textarea id="cmt-text" name="text" maxlength="${MAX_TEXT}" rows="3" placeholder="对这句的感想……"></textarea>
        <input class="cmt-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="cmt-actions">
          <span class="cmt-tip" aria-live="polite">${TIP}</span>
          <span class="cmt-count" aria-live="polite">0/${MAX_TEXT}</span>
          <button type="submit" class="cmt-send" disabled>发送</button>
        </div>
      </form>`;
    document.body.append(dlg);

    const form = $('.cmt-form', dlg);
    const name = form.elements.name, text = form.elements.text, send = $('.cmt-send', dlg);
    name.value = store.get('ck-name', '');
    const sync = () => {
      const len = text.value.trim().length;
      $('.cmt-count', dlg).textContent = `${text.value.length}/${MAX_TEXT}`;
      send.disabled = !len || form.classList.contains('busy');
    };
    text.addEventListener('input', sync);
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = text.value.trim();
      if (!body || !current) return;
      const nick = name.value.trim().slice(0, MAX_NAME);
      store.set('ck-name', nick);
      form.classList.add('busy');
      sync();
      const u = current;
      try {
        const who = whoOf(u);
        const quote = [(who ? who + '：' : '') + (u.ja ? u.ja.textContent : ''), u.zh ? u.zh.textContent : ''].filter(Boolean).join('\n');
        const item = await api.post({
          key: u.key, ch: u.ch, anchor: u.anchor, name: nick, text: body.slice(0, MAX_TEXT), quote,
          website: form.elements.website.value,
        });
        text.value = '';
        const list = $('.cmt-list', dlg);
        $('.cmt-empty', list)?.remove();
        list.insertAdjacentHTML('afterbegin', itemHTML(item, true));
        list.scrollTop = 0;
        tip('已提交，审核通过后大家就能看到');
      } catch (err) {
        tip(err.message && err.message !== 'Failed to fetch' ? err.message : '发送失败，请稍后再试', true);
      } finally {
        form.classList.remove('busy');
        sync();
      }
    });
    dlg.addEventListener('close', () => {
      current?.el.classList.remove('ck-active');
      current = null;
    });
    // 点遮罩关闭
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }

  function whoOf(u) {
    if (u.el.matches('.opt-line')) return '55 的选项';
    if (u.el.closest('.sns')) return u.el.matches('.me') ? '55' : u.el.matches('.msg-dir') ? '' : $('.sns-from', u.el.closest('.sns'))?.textContent || '';
    const turn = u.el.closest('.turn');
    const who = turn && $(':scope > .who', turn);
    return who ? $('[lang="zh-CN"]', who).textContent : '';
  }

  async function openPanel(u) {
    if (!dlg) buildDialog();
    current?.el.classList.remove('ck-active');
    current = u;
    u.el.classList.add('ck-active');
    $('.cmt-who', dlg).textContent = whoOf(u);
    const [qja, qzh] = $$('.cmt-quote p', dlg);
    qja.textContent = u.ja ? u.ja.textContent : '';
    qzh.textContent = u.zh ? u.zh.textContent : '';
    qja.hidden = !u.ja;
    qzh.hidden = !u.zh;
    $('.cmt-n', dlg).textContent = u.n ? ` ${u.n}` : '';
    const list = $('.cmt-list', dlg);
    list.innerHTML = '<li class="cmt-loading">加载中……</li>';
    (u.ja || u.zh).scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!dlg.open) dlg.showModal();
    if (matchMedia('(hover: hover)').matches) $('#cmt-text', dlg).focus({ preventScroll: true });
    let items;
    try {
      items = await api.list(u.key);
    } catch {
      if (current === u) list.innerHTML = '<li class="cmt-empty">评论加载失败，请稍后再试。</li>';
      return;
    }
    if (current !== u) return;
    list.innerHTML = items.length
      ? items.map(c => itemHTML(c)).join('')
      : '<li class="cmt-empty">这句还没有人留言，来说第一句吧。</li>';
    const n = items.filter(c => !c.pending).length;
    if (n !== u.n) { setCount(u, n); $('.cmt-n', dlg).textContent = n ? ` ${n}` : ''; }
  }

  /* ---------- 挂到阅读页 ---------- */

  function mount(reader, meta) {
    const body = $('.ch-body', reader);
    const units = collect(body, meta.id);
    const byEl = new Map(units.map(u => [u.el, u]));
    units.forEach(addBadges);
    api.counts(meta.id).then(m => units.forEach(u => setCount(u, m.get(u.key) || 0))).catch(() => { /* 后台连不上时只是不显示数字 */ });

    // 工具栏开关
    const tg = document.createElement('button');
    tg.type = 'button';
    tg.className = 'tg';
    tg.textContent = '段评';
    const apply = () => {
      const on = store.get('ck-show', true);
      tg.setAttribute('aria-pressed', String(on));
      reader.classList.toggle('hide-ck', !on);
    };
    tg.addEventListener('click', () => { store.set('ck-show', !store.get('ck-show', true)); apply(); });
    $('.toolbar .tb-chapters', reader).before(tg);
    apply();

    let on = null;
    body.addEventListener('click', e => {
      const b = e.target.closest('.ck');
      if (b) {
        e.stopPropagation();   // 不触发「点日文看译文」
        openPanel(byEl.get(b.closest(UNIT)));
        return;
      }
      // 触屏没有悬停：点一下句子，句末出现「＋」
      const el = e.target.closest(UNIT);
      if (on && on !== el) on.classList.remove('ck-on');
      on = el && byEl.has(el) ? el : null;
      on?.classList.add('ck-on');
    });
    body.addEventListener('keydown', e => { if (e.target.closest('.ck')) e.stopPropagation(); });

    return () => { if (dlg?.open) dlg.close(); };
  }

  window.Comments = { mount };
})();
