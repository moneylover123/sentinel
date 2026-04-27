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
    } catch(e) { continue; }
  }
  throw new Error('All proxies failed');
}

window.addEventListener('DOMContentLoaded', () => {
  initChart();
  runAll();
  startCountdown();
});

async function runAll() {
  setStatus('LOADING', 'loading');
  try { await fetchChartData(currentTf); } catch(e) { console.error('Chart:', e); }
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
    grid: { vertLines: { color: 'rgba(0,255,200,0.04)' }, horzLines: { color: 'rgba(0,255,200,0.04)' } },
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
  } catch(e) {
    console.error('Chart error:', e);
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
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high)
      levels.push({ price: recent[i].high, type: 'resistance' });
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low)
      levels.push({ price: recent[i].low, type: 'support' });
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

// ============================================================
// STRICT PATTERN DETECTION — MAX 10 STRONG PATTERNS ONLY
// ============================================================
function detectPatterns(candles) {
  const scored = [];
  const c = candles;
  const n = c.length;

  const body = v => Math.abs(v.close - v.open);
  const range = v => v.high - v.low;
  const upperWick = v => v.high - Math.max(v.open, v.close);
  const lowerWick = v => Math.min(v.open, v.close) - v.low;
  const isBull = v => v.close > v.open;
  const isBear = v => v.close < v.open;

  // Average body size for context
  const avgBody = candles.slice(-20).reduce((a, v) => a + body(v), 0) / 20;
  const avgRange = candles.slice(-20).reduce((a, v) => a + range(v), 0) / 20;

  for (let i = 4; i < n; i++) {
    const curr = c[i], prev = c[i-1], prev2 = c[i-2];

    // 1. HAMMER — strict: long lower wick 3x body, tiny upper wick, body above midpoint, after downtrend
    if (
      lowerWick(curr) >= body(curr) * 3 &&
      upperWick(curr) <= body(curr) * 0.3 &&
      body(curr) >= avgBody * 0.5 &&
      isBear(prev) && isBear(prev2)
    ) {
      scored.push({ time: curr.time, position: 'belowBar', color: '#00e676', shape: 'arrowUp', text: 'HAMMER', score: 90 });
    }

    // 2. SHOOTING STAR — strict: long upper wick 3x body, tiny lower wick, after uptrend
    if (
      upperWick(curr) >= body(curr) * 3 &&
      lowerWick(curr) <= body(curr) * 0.3 &&
      body(curr) >= avgBody * 0.5 &&
      isBull(prev) && isBull(prev2)
    ) {
      scored.push({ time: curr.time, position: 'aboveBar', color: '#ff3366', shape: 'arrowDown', text: 'SHOOT★', score: 90 });
    }

    // 3. DOJI — strict: body less than 5% of range, significant range (not tiny candle)
    if (
      body(curr) <= range(curr) * 0.05 &&
      range(curr) >= avgRange * 0.8
    ) {
      scored.push({ time: curr.time, position: 'aboveBar', color: '#ffcc00', shape: 'circle', text: 'DOJI', score: 70 });
    }

    // 4. BULLISH ENGULFING — strict: current body must be 1.5x larger than previous body
    if (
      isBear(prev) && isBull(curr) &&
      curr.open < prev.close &&
      curr.close > prev.open &&
      body(curr) >= body(prev) * 1.5 &&
      body(curr) >= avgBody * 1.2
    ) {
      scored.push({ time: curr.time, position: 'belowBar', color: '#00e676', shape: 'arrowUp', text: '▲ENGULF', score: 95 });
    }

    // 5. BEARISH ENGULFING — strict: same rules
    if (
      isBull(prev) && isBear(curr) &&
      curr.open > prev.close &&
      curr.close < prev.open &&
      body(curr) >= body(prev) * 1.5 &&
      body(curr) >= avgBody * 1.2
    ) {
      scored.push({ time: curr.time, position: 'aboveBar', color: '#ff3366', shape: 'arrowDown', text: '▼ENGULF', score: 95 });
    }

    // 6. MORNING STAR — strict 3 candle reversal
    if (
      isBear(prev2) && body(prev2) >= avgBody * 1.2 &&
      body(prev) <= avgBody * 0.4 &&
      isBull(curr) && body(curr) >= avgBody * 1.2 &&
      curr.close > (prev2.open + prev2.close) / 2
    ) {
      scored.push({ time: curr.time, position: 'belowBar', color: '#00e676', shape: 'arrowUp', text: 'MORNING★', score: 92 });
    }

    // 7. EVENING STAR — strict 3 candle reversal
    if (
      isBull(prev2) && body(prev2) >= avgBody * 1.2 &&
      body(prev) <= avgBody * 0.4 &&
      isBear(curr) && body(curr) >= avgBody * 1.2 &&
      curr.close < (prev2.open + prev2.close) / 2
    ) {
      scored.push({ time: curr.time, position: 'aboveBar', color: '#ff3366', shape: 'arrowDown', text: 'EVENING★', score: 92 });
    }

    // 8. DOUBLE TOP — only flag if two peaks within 0.2% of each other
    if (i >= 20) {
      const seg = c.slice(i - 20, i);
      const highs = seg.map(x => x.high);
      const maxH = Math.max(...highs);
      const peaks = highs.filter(h => Math.abs(h - maxH) / maxH < 0.002);
      if (peaks.length >= 2 && isBear(curr) && body(curr) >= avgBody * 1.2) {
        scored.push({ time: curr.time, position: 'aboveBar', color: '#ff3366', shape: 'arrowDown', text: '2TOP', score: 88 });
      }
    }

    // 9. DOUBLE BOTTOM — only flag if two troughs within 0.2% of each other
    if (i >= 20) {
      const seg = c.slice(i - 20, i);
      const lows = seg.map(x => x.low);
      const minL = Math.min(...lows);
      const troughs = lows.filter(l => Math.abs(l - minL) / minL < 0.002);
      if (troughs.length >= 2 && isBull(curr) && body(curr) >= avgBody * 1.2) {
        scored.push({ time: curr.time, position: 'belowBar', color: '#00e676', shape: 'arrowUp', text: '2BOTTOM', score: 88 });
      }
    }

    // 10. BULL FLAG — strong pole then tight consolidation
    if (i >= 8) {
      const pole = c.slice(i - 8, i - 4);
      const flag = c.slice(i - 4, i);
      const poleGain = (pole[pole.length-1].close - pole[0].open) / pole[0].open;
      const flagHigh = Math.max(...flag.map(x => x.high));
      const flagLow = Math.min(...flag.map(x => x.low));
      const flagRange = flagHigh - flagLow;
      const poleRange = Math.max(...pole.map(x => x.high)) - Math.min(...pole.map(x => x.low));
      if (poleGain > 0.02 && flagRange < poleRange * 0.4 && isBull(curr)) {
        scored.push({ time: curr.time, position: 'belowBar', color: '#00ffc8', shape: 'arrowUp', text: 'BULL FLAG', score: 85 });
      }
    }
  }

  // Deduplicate by time — keep highest score per candle
  const byTime = {};
  scored.forEach(m => {
    if (!byTime[m.time] || m.score > byTime[m.time].score) {
      byTime[m.time] = m;
    }
  });

  // Sort by score descending, take top 10 most recent
  const all = Object.values(byTime)
    .sort((a, b) => b.time - a.time)
    .slice(0, 10)
    .sort((a, b) => a.time - b.time);

  candleSeries.setMarkers(all);

  document.getElementById('overlay-tags').innerHTML = `
    <span class="overlay-tag sr">S/R ACTIVE</span>
    <span class="overlay-tag pattern">PATTERNS: ${all.length}</span>
  `;

  return all;
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
