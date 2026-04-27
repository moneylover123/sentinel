const CONFIG = {
  GNEWS_API_KEY: 'c5fc310ce580bcba6be2fe9937f0d1f1',
  GROQ_API_KEY: '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',
  GROQ_MODEL: 'llama3-70b-8192',
  REFRESH_INTERVAL: 60,
};

let chart = null;
let candleSeries = null;
let supportLines = [];
let currentTf = '1d';
let countdown = CONFIG.REFRESH_INTERVAL;
let countdownTimer = null;

const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://proxy.cors.sh/${url}`,
];

async function fetchWithProxy(url) {
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(url), { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const text = await res.text();
        return JSON.parse(text);
      }
    } catch(e) {
      continue;
    }
  }
  throw new Error('All proxies failed for: ' + url);
}

window.addEventListener('DOMContentLoaded', () => {
  initChart();
  runAll();
  startCountdown();
});

async function runAll() {
  setStatus('LOADING', 'loading');
  try {
    await fetchChartData(currentTf);
  } catch(e) {
    console.error('Chart failed:', e);
  }
  try { await fetchNews(); } catch(e) {}
  try { await fetchStockTwits(); } catch(e) {}
  try { await fetchReddit(); } catch(e) {}
  try { await fetchMacro(); } catch(e) {}
  await runAI();
  setStatus('LIVE', 'live');
  updateTime();
}

function initChart() {
  const container = document.getElementById('chart-container');
  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: { background: { color: 'transparent' }, textColor: 'rgba(200,255,240,0.5)' },
    grid: { vertLines: { color: 'rgba(0,255,200,0.05)' }, horzLines: { color: 'rgba(0,255,200,0.05)' } },
    crosshair: { vertLine: { color: 'rgba(0,255,200,0.4)', width: 1, style: 2 }, horzLine: { color: 'rgba(0,255,200,0.4)', width: 1, style: 2 } },
    rightPriceScale: { borderColor: 'rgba(0,255,200,0.1)', textColor: 'rgba(200,255,240,0.5)' },
    timeScale: { borderColor: 'rgba(0,255,200,0.1)', timeVisible: true, secondsVisible: false },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#00e676', downColor: '#ff3366',
    borderUpColor: '#00e676', borderDownColor: '#ff3366',
    wickUpColor: 'rgba(0,230,118,0.6)', wickDownColor: 'rgba(255,51,102,0.6)',
  });

  window.addEventListener('resize', () => {
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });

  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTf = btn.dataset.tf;
      fetchChartData(currentTf);
    });
  });
}

async function fetchChartData(tf) {
  try {
    const interval = tf === '1d' ? '5m' : tf === '5d' ? '15m' : '1d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=${interval}&range=${tf}&includePrePost=false`;
    const parsed = await fetchWithProxy(url);
    const result = parsed.chart.result[0];
    const timestamps = result.timestamp;
    const ohlcv = result.indicators.quote[0];

    const candles = timestamps.map((t, i) => ({
      time: t,
      open: parseFloat(ohlcv.open[i]?.toFixed(2)) || null,
      high: parseFloat(ohlcv.high[i]?.toFixed(2)) || null,
      low: parseFloat(ohlcv.low[i]?.toFixed(2)) || null,
      close: parseFloat(ohlcv.close[i]?.toFixed(2)) || null,
    })).filter(c => c.open && c.high && c.low && c.close);

    candleSeries.setData(candles);

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (last && prev) {
      const change = last.close - prev.close;
      const changePct = ((change / prev.close) * 100).toFixed(2);
      document.getElementById('current-price').textContent = `$${last.close.toFixed(2)}`;
      const el = document.getElementById('price-change');
      el.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct}%)`;
      el.className = 'price-change ' + (change >= 0 ? 'up' : 'down');
    }

    drawSupportResistance(candles);
    detectPatterns(candles);
    chart.timeScale().fitContent();
  } catch (e) {
    console.error('Chart error:', e);
    document.getElementById('current-price').textContent = 'Error';
  }
}

function drawSupportResistance(candles) {
  supportLines.forEach(l => { try { candleSeries.removePriceLine(l); } catch(e){} });
  supportLines = [];
  if (candles.length < 20) return;
  const levels = [];
  const recent = candles.slice(-60);
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
      levels.push({ price: recent[i].high, type: 'resistance' });
    }
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
      levels.push({ price: recent[i].low, type: 'support' });
    }
  }
  const clustered = [];
  levels.forEach(lv => {
    const existing = clustered.find(c => Math.abs(c.price - lv.price) / lv.price < 0.005);
    if (!existing) clustered.push(lv);
  });
  clustered.slice(0, 3).forEach(lv => {
    const line = candleSeries.createPriceLine({
      price: lv.price,
      color: lv.type === 'support' ? 'rgba(0,230,118,0.5)' : 'rgba(255,51,102,0.5)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: lv.type === 'support' ? 'S' : 'R',
    });
    supportLines.push(line);
  });
}

function detectPatterns(candles) {
  const newMarkers = [];
  const c = candles;
  const n = c.length;

  for (let i = 4; i < n; i++) {
    const curr = c[i], prev = c[i-1], prev2 = c[i-2];
    const body = v => Math.abs(v.close - v.open);
    const range = v => v.high - v.low;
    const upperWick = v => v.high - Math.max(v.open, v.close);
    const lowerWick = v => Math.min(v.open, v.close) - v.low;
    const isBull = v => v.close > v.open;
    const isBear = v => v.close < v.open;

    if (lowerWick(curr) > body(curr) * 2 && upperWick(curr) < body(curr) * 0.5 && isBear(prev))
      newMarkers.push({ time: curr.time, position: 'belowBar', color: '#00e676', shape: 'arrowUp', text: 'HAMMER' });

    if (upperWick(curr) > body(curr) * 2 && lowerWick(curr) < body(curr) * 0.5 && isBull(prev))
      newMarkers.push({ time: curr.time, position: 'aboveBar', color: '#ff3366', shape: 'arrowDown', text: 'SHOOT★' });

    if (body(curr) < range(curr) * 0.1 && range(curr) > 0)
      newMarkers.push({ time: curr.time, position: 'aboveBar', color: '#ffcc00', shape: 'circle', text: 'DOJI' });

    if (isBear(prev) && isBull(curr) && curr.open < prev.close && curr.close > prev.open)
      newMarkers.push({ time: curr.time, position: 'belowBar', color: '#00e676', shape: 'arrowUp', text: '▲ENGULF' });

    if (isBull(prev) && isBear(curr) && curr.open > prev.close && curr.close < prev.open)
      newMarkers.push({ time: curr.time, position: 'aboveBar', color: '#ff3366', shape: 'arrowDown', text: '▼ENGULF' });

    if (isBear(prev2) && body(prev) < body(prev2) * 0.3 && isBull(curr) && curr.close > (prev2.open + prev2.close) / 2)
      newMarkers.push({ time: curr.time, position: 'belowBar', color: '#00e676', shape: 'arrowUp', text: 'MORNING★' });

    if (isBull(prev2) && body(prev) < body(prev2) * 0.3 && isBear(curr) && curr.close < (prev2.open + prev2.close) / 2)
      newMarkers.push({ time: curr.time, position: 'aboveBar', color: '#ff3366', shape: 'arrowDown', text: 'EVENING★' });

    if (isBull(curr) && isBull(prev) && isBull(prev2) && curr.close > prev.close && prev.close > prev2.close)
      newMarkers.push({ time: curr.time, position: 'belowBar', color: '#00e676', shape: 'arrowUp', text: '3 SOLDIERS' });

    if (isBear(curr) && isBear(prev) && isBear(prev2) && curr.close < prev.close && prev.close < prev2.close)
      newMarkers.push({ time: curr.time, position: 'aboveBar', color: '#ff3366', shape: 'arrowDown', text: '3 CROWS' });
  }

  const seen = new Set();
  const unique = newMarkers.filter(m => {
    if (seen.has(m.time + m.text)) return false;
    seen.add(m.time + m.text);
    return true;
  });
  candleSeries.setMarkers(unique.slice(-30));

  document.getElementById('overlay-tags').innerHTML = `
    <span class="overlay-tag sr">S/R ACTIVE</span>
    <span class="overlay-tag pattern">PATTERNS: ${unique.length}</span>
  `;
  return unique;
}

async function fetchNews() {
  try {
    const url = `https://gnews.io/api/v4/search?q=AAPL+Apple+stock&lang=en&max=6&apikey=${CONFIG.GNEWS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    const articles = data.articles || [];
    const list = document.getElementById('news-list');
    if (!articles.length) { list.innerHTML = '<div class="news-placeholder">No headlines found</div>'; return; }
    list.innerHTML = articles.map(a => {
      const ago = timeAgo(new Date(a.publishedAt));
      return `<div class="news-item" onclick="window.open('${a.url}','_blank')">
        <div class="news-headline">${a.title}</div>
        <div class="news-meta">${a.source.name} // ${ago}</div>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('news-list').innerHTML = '<div class="news-placeholder">News unavailable</div>';
  }
}

async function fetchStockTwits() {
  try {
    const url = `https://api.stocktwits.com/api/2/streams/symbol/AAPL.json`;
    const data = await fetchWithProxy(url);
    const messages = data.messages || [];
    let bull = 0, bear = 0;
    messages.forEach(m => {
      const s = m.entities?.sentiment?.basic;
      if (s === 'Bullish') bull++;
      else if (s === 'Bearish') bear++;
    });
    const total = bull + bear || 1;
    const bullPct = Math.round((bull / total) * 100);
    const bearPct = 100 - bullPct;
    document.getElementById('st-bull').style.width = bullPct + '%';
    document.getElementById('st-bear').style.width = bearPct + '%';
    document.getElementById('st-bull-pct').textContent = `▲ ${bullPct}%`;
    document.getElementById('st-bear-pct').textContent = `▼ ${bearPct}%`;
  } catch(e) {}
}

async function fetchReddit() {
  try {
    const url = `https://www.reddit.com/r/wallstreetbets/search.json?q=AAPL&sort=new&limit=15&restrict_sr=1`;
    const data = await fetchWithProxy(url);
    const posts = data.data?.children || [];
    let bull = 0, bear = 0;
    posts.forEach(p => {
      const t = (p.data.title + ' ' + (p.data.selftext || '')).toLowerCase();
      const bullWords = ['bull','calls','buy','moon','up','gain','long','pump','green'];
      const bearWords = ['bear','puts','sell','down','crash','short','loss','red','drop'];
      const bScore = bullWords.filter(w => t.includes(w)).length;
      const brScore = bearWords.filter(w => t.includes(w)).length;
      if (bScore > brScore) bull++;
      else if (brScore > bScore) bear++;
    });
    const total = bull + bear || 1;
    const bullPct = Math.round((bull / total) * 100);
    const bearPct = 100 - bullPct;
    document.getElementById('rd-bull').style.width = bullPct + '%';
    document.getElementById('rd-bear').style.width = bearPct + '%';
    document.getElementById('rd-bull-pct').textContent = `▲ ${bullPct}%`;
    document.getElementById('rd-bear-pct').textContent = `▼ ${bearPct}%`;
  } catch(e) {}
}

async function fetchMacro() {
  const tickers = [
    { id: 'm-vix', symbol: '^VIX' },
    { id: 'm-dxy', symbol: 'DX-Y.NYB' },
    { id: 'm-spy', symbol: 'SPY' },
    { id: 'm-qqq', symbol: 'QQQ' },
  ];
  for (const t of tickers) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t.symbol)}?interval=1d&range=2d`;
      const parsed = await fetchWithProxy(url);
      const result = parsed.chart.result[0];
      const closes = result.indicators.quote[0].close.filter(Boolean);
      const last = closes[closes.length - 1];
      const prev = closes[closes.length - 2] || last;
      const chg = ((last - prev) / prev * 100).toFixed(2);
      const el = document.getElementById(t.id);
      el.textContent = `${last.toFixed(2)}`;
      el.style.color = chg >= 0 ? 'var(--bull)' : 'var(--bear)';
    } catch(e) {
      document.getElementById(t.id).textContent = '—';
    }
  }
}

async function runAI() {
  try {
    const price = document.getElementById('current-price').textContent;
    const priceChange = document.getElementById('price-change').textContent;
    const stBull = document.getElementById('st-bull-pct').textContent;
    const stBear = document.getElementById('st-bear-pct').textContent;
    const rdBull = document.getElementById('rd-bull-pct').textContent;
    const rdBear = document.getElementById('rd-bear-pct').textContent;
    const vix = document.getElementById('m-vix').textContent;
    const spy = document.getElementById('m-spy').textContent;
    const headlines = Array.from(document.querySelectorAll('.news-headline')).slice(0,4).map(el => el.textContent).join(' | ');
    const patternTag = document.getElementById('overlay-tags').textContent;

    const prompt = `You are a quantitative trading analyst AI for the Sentinel platform. Analyze AAPL and provide a concise structured signal.

CURRENT DATA:
- AAPL Price: ${price} | Change: ${priceChange}
- Chart Patterns: ${patternTag}
- StockTwits: ${stBull} bullish / ${stBear} bearish
- Reddit WSB: ${rdBull} bullish / ${rdBear} bearish
- VIX: ${vix} | SPY: ${spy}
- Headlines: ${headlines}

Respond ONLY in this exact JSON format:
{
  "rating": "BUY" or "SELL" or "HOLD",
  "confidence": <number 40-95>,
  "evidence": [
    {"type": "bull" or "bear" or "neu", "text": "<under 80 chars>"},
    {"type": "bull" or "bear" or "neu", "text": "<under 80 chars>"},
    {"type": "bull" or "bear" or "neu", "text": "<under 80 chars>"},
    {"type": "bull" or "bear" or "neu", "text": "<under 80 chars>"}
  ]
}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}` },
      body: JSON.stringify({ model: CONFIG.GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 400 }),
    });

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const analysis = JSON.parse(jsonMatch[0]);

    const badge = document.getElementById('rating-badge');
    badge.textContent = analysis.rating;
    badge.className = 'rating-badge ' + analysis.rating;

    const conf = Math.min(95, Math.max(40, analysis.confidence));
    document.getElementById('conf-bar').style.width = conf + '%';
    document.getElementById('conf-pct').textContent = conf + '%';

    document.getElementById('evidence-list').innerHTML = analysis.evidence.map(ev => {
      const icon = ev.type === 'bull' ? '▲' : ev.type === 'bear' ? '▼' : '●';
      return `<div class="ev-item ${ev.type}"><span class="ev-icon">${icon}</span><span class="ev-text">${ev.text}</span></div>`;
    }).join('');
  } catch(e) {
    document.getElementById('evidence-list').innerHTML = '<div class="ev-placeholder">AI analysis unavailable</div>';
  }
}

function startCountdown() {
  countdown = CONFIG.REFRESH_INTERVAL;
  const fill = document.getElementById('refresh-fill');
  const label = document.getElementById('countdown');
  fill.style.transition = 'none';
  fill.style.width = '100%';
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdown--;
    label.textContent = countdown;
    fill.style.transition = 'width 1s linear';
    fill.style.width = ((countdown / CONFIG.REFRESH_INTERVAL) * 100) + '%';
    if (countdown <= 0) { clearInterval(countdownTimer); runAll(); startCountdown(); }
  }, 1000);
}

function setStatus(text, state) {
  document.getElementById('status-text').textContent = text;
  document.getElementById('status-dot').className = 'status-dot ' + (state === 'loading' ? 'loading' : state === 'error' ? 'error' : '');
}

function updateTime() {
  document.getElementById('last-update-time').textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}

function timeAgo(date) {
  const diff = Math.floor((Date.now() - date) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
                          }
