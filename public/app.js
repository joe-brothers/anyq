// 예시 방: 이 페이지 안에서만 움직인다. 서버 연결은 구현 후.
const seed = [
  ['Slido랑 뭐가 다른가요?', 14],
  ['PDF는 몇 MB까지 올릴 수 있나요?', 9, true],
  ['AI가 틀린 답을 하면 어떻게 되나요?', 6],
  ['Google Docs도 연결되나요?', 4],
  ['무료 플랜으로 몇 명까지 접속할 수 있나요?', 2],
  ['로그인해야 하나요?', 1],
];
let qs = seed.map(([text, votes, live], id) => ({ id, text, votes, live: !!live, mine: false }));
const list = document.getElementById('qs'), empty = document.getElementById('qs-empty'), live = document.getElementById('live');

function render(focusId) {
  qs.sort((a, b) => b.votes - a.votes || a.id - b.id);
  list.replaceChildren(...qs.map(q => {
    const li = document.createElement('li');
    if (q.live) li.className = 'live';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'vote'; btn.dataset.id = q.id;
    btn.setAttribute('aria-pressed', q.mine);
    btn.setAttribute('aria-label', (q.mine ? '추천 취소' : '추천') + ', 현재 ' + q.votes + ': ' + q.text);
    const n = document.createElement('b'); n.textContent = q.votes;
    const s = document.createElement('span'); s.textContent = q.mine ? '추천함' : '추천';
    btn.append(n, s);
    const p = document.createElement('p');
    p.className = 'qtext'; p.style.setProperty('--k', Math.sqrt(q.votes).toFixed(2)); p.textContent = q.text;
    if (q.live) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = '지금 답변 중'; p.append(t); }
    li.append(btn, p);
    return li;
  }));
  empty.hidden = qs.length > 0;
  if (focusId != null) list.querySelector('[data-id="' + focusId + '"]')?.focus();
}

list.addEventListener('click', e => {
  const btn = e.target.closest('.vote'); if (!btn) return;
  const q = qs.find(q => q.id == btn.dataset.id);
  q.mine = !q.mine; q.votes += q.mine ? 1 : -1;
  render(q.id);
  live.textContent = q.text + ' 추천 ' + q.votes;
});

const form = document.getElementById('ask'), input = document.getElementById('q'), err = document.getElementById('q-err');
let nextId = seed.length;
form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) {
    err.textContent = '질문을 적은 뒤 올려 주세요.';
    input.setAttribute('aria-invalid', 'true'); input.focus(); return;
  }
  qs.push({ id: nextId++, text, votes: 0, live: false, mine: false });
  input.value = ''; err.textContent = ''; input.removeAttribute('aria-invalid');
  render();
  live.textContent = '질문을 올렸습니다: ' + text;
});
input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });

const pair = document.getElementById('pair-1'), approve = document.getElementById('approve'), state = document.getElementById('state-1');
approve.addEventListener('click', () => {
  const pub = pair.dataset.state !== 'public';
  pair.dataset.state = pub ? 'public' : 'draft';
  state.textContent = pub ? '공개됨 · 청중에게 보입니다' : '초안 · 발표자만 봅니다';
  approve.textContent = pub ? '공개 취소' : '승인하고 공개';
});

const create = document.getElementById('create'), createErr = document.getElementById('create-err'), ts = document.getElementById('ts');
const idle = (msg = '') => { create.disabled = false; create.textContent = '방 만들기'; createErr.textContent = msg; };

async function createRoom(token) {
  create.textContent = '방을 만드는 중입니다';
  try {
    const res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    if (res.status === 403) return idle('사람 확인을 통과하지 못했습니다. 다시 눌러 주세요.');
    if (!res.ok) throw new Error(res.status);
    const room = await res.json();
    location.href = '/r/' + room.id + '/host?k=' + room.token;
  } catch {
    idle('방을 만들지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  }
}

// Turnstile 스크립트는 버튼을 누른 뒤에만 불러온다.
const loadTurnstile = () => new Promise((ok, fail) => {
  if (window.turnstile) return ok();
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.onload = ok; s.onerror = fail;
  document.head.append(s);
});

create.addEventListener('click', async () => {
  create.disabled = true; create.textContent = '사람인지 확인하는 중입니다'; createErr.textContent = '';
  try {
    const { sitekey } = await (await fetch('/api/config')).json();
    if (!sitekey) return createRoom();
    await loadTurnstile();
    ts.replaceChildren();
    turnstile.render(ts, {
      sitekey, theme: 'dark', language: 'ko', appearance: 'interaction-only',
      callback: createRoom,
      'error-callback': () => idle('사람 확인을 불러오지 못했습니다. 다시 눌러 주세요.'),
    });
  } catch {
    idle('방을 만들지 못했습니다. 네트워크를 확인하고 다시 눌러 주세요.');
  }
});

render();
