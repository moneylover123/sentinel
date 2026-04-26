const CONFIG = {
  NEWS_API_KEY: 'ef3979cdd3c5472ab30dbe21f7511646',
  GROQ_API_KEY: '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',
  GROQ_MODEL: 'llama3-70b-8192',
  REFRESH_INTERVAL: 60,
  TICKER: 'AAPL',
};

let chart = null;
let candleSeries = null;
let supportLines = [];
let currentTf = '1d';
let countdown = CONFIG.REFRESH_INTERVAL;
let countdownTimer = null;

window.addEventListener('DOMContentLoaded', () => {
  initChart();
  runAll();
  startCountdown();
});

async function runAll() {
  setStatus('LOADING', 'loading');
  await Promise.all([
    fetchChartData(currentTf),
    fetchNews(),
    fetchStockTwits(),
    fetchReddit(),
    fetchMacro(),
  ]);
  await runAI();
  setStatus('LIVE', 'live');
  updateTime();
}

function initChart() {
  const container = document.getElementById('chart-container');
  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { color: 'transparent' },
      textColor: 'rgba(200,255,240,0.5)',
    },
    grid: {
      vertLines: { color: 'rgba(0,255,200,0.05)' },
      horzLines: { color: 'rgba(0,255,200,0.05)' },
    },
    crosshair: {
      vertLine: { color: 'rgba(0,255,200,0.4)', width: 1, style: 2 },
      horzLine: { color: 'rgba(0,255,200,0.4)', width: 1, style: 2 },
    },
    rightPriceScale: {
      borderColor: 'rgba(0,255,200,0.1)',
      textColor: 'rgba(200,255,240,0.5)',
    },
    timeScale: {
      borderColor: 'rgba(0,255,200,0.1)',
      timeVisible: true,
      secondsVisible: false,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#00e676',
    downColor: '#ff3366',
    borderUpColor: '#00e676',
    borderDownColor: '#ff3366',
    wickUpColor: 'rgba(0,230,118,0.6)',
    wickDownColor: 'rgba(255,51,102,0.6)',
  });

  window.addEventListener('resize', () => {
    chart.applyOptions({
      width: container.clientWidth,
      height: container.clientHeight,
    });
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
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy);
    const data = await res.json();
    const parsed = JSON.parse(data.contents);
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
    chart.timeScale().fitContent();
  } catch (e) {
    console.error('Chart error:', e);
  }
}

function drawSupportResistance(candles) {
  supportLines.forEach(l => { try { chart.removePriceLine(l); } catch(e){} });
  supportLines = [];
  if (candles.length < 20) return;
  const levels = [];
  const lookback = Math.min(candles.length, 60);
  const recent = candles.slice(-lookback);
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
  clustered.slice(0, 6).forEach(lv => {
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
  const tagsEl = document.getElementById('overlay-tags');
  tagsEl.innerHTML = `<span class="overlay-tag sr">S/R ACTIVE (${clustered.slice(0,6).length})</span><span class="overlay-tag pattern">AUTO LEVELS</span>`;
}

async function fetchNews() {
  try {
    const url = `https://newsapi.org/v2/everything?q=Apple+AAPL+stock&sortBy=publishedAt&pageSize=8&language=en&apiKey=${CONFIG.NEWS_API_KEY}`;
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy);
    const data = await res.json();
    const parsed = JSON.parse(data.contents);
    const articles = parsed.articles || [];
    const list = document.getElementById('news-list');
    if (!articles.length) { list.innerHTML = '<div class="news-placeholder">No headlines found</div>'; return; }
    list.innerHTML = articles.slice(0, 6).map(a => {
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
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy);
    const data = await res.json();
    const parsed = JSON.parse(data.contents);
    const messages = parsed.messages || [];
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
    return { bullPct, bearPct };
  } catch(e) {
    return { bullPct: 50, bearPct: 50 };
  }
}

async function fetchReddit() {
  try {
    const url = `https://www.reddit.com/r/wallstreetbets/search.json?q=AAPL&sort=new&limit=15&restrict_sr=1`;
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy);
    const data = await res.json();
    const parsed = JSON.parse(data.contents);
    const posts = parsed.data?.children || [];
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
    return { bullPct, bearPct };
  } catch(e) {
    return { bullPct: 50, bearPct: 50 };
  }
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
      const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxy);
      const data = await res.json();
      const parsed = JSON.parse(data.contents);
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

    const prompt = `You are a quantitative trading analyst AI for the Sentinel platform. Analyze AAPL and provide a concise structured signal.

CURRENT DATA:
- AAPL Price: ${price} | Change: ${priceChange}
- StockTwits Sentiment: ${stBull} bullish / ${stBear} bearish
- Reddit WSB Sentiment: ${rdBull} bullish / ${rdBear} bearish
- VIX: ${vix} | SPY: ${spy}
- Recent Headlines: ${headlines}

Respond ONLY in this exact JSON format, no other text:
{
  "rating": "BUY" or "SELL" or "HOLD",
  "confidence": <number 40-95>,
  "evidence": [
    {"type": "bull" or "bear" or "neu", "text": "<concise evidence point under 80 chars>"},
    {"type": "bull" or "bear" or "neu", "text": "<concise evidence point under 80 chars>"},
    {"type": "bull" or "bear" or "neu", "text": "<concise evidence point under 80 chars>"},
    {"type": "bull" or "bear" or "neu", "text": "<concise evidence point under 80 chars>"}
  ]
}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: CONFIG.GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 400,
      }),
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

    const evList = document.getElementById('evidence-list');
    evList.innerHTML = analysis.evidence.map(ev => {
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
    const pct = (countdown / CONFIG.REFRESH_INTERVAL) * 100;
    fill.style.transition = 'width 1s linear';
    fill.style.width = pct + '%';
    if (countdown <= 0) {
      clearInterval(countdownTimer);
      runAll();
      startCountdown();
    }
  }, 1000);
}

function setStatus(text, state) {
  document.getElementById('status-text').textContent = text;
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot ' + (state === 'loading' ? 'loading' : state === 'error' ? 'error' : '');
}

function updateTime() {
  const now = new Date();
  document.getElementById('last-update-time').textContent = now.toLocaleTimeString('en-US', { hour12: false });
}

function timeAgo(date) {
  const diff = Math.floor((Date.now() - date) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
                                              }
