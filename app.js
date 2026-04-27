const CONFIG = {
    GNEWS_API_KEY: 'c5fc310ce580bcba6be2fe9937f0d1f1',
    GROQ_API_KEY: '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',
    GROQ_MODEL: 'llama3-70b-8192',
    REFRESH_INTERVAL: 60
};

let chart, candleSeries, currentTf = '1d';

// --- PROXY ENGINE ---
async function fetchWithProxy(url) {
    const proxies = [
        u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        u => `https://corsproxy.io/?${encodeURIComponent(u)}`
    ];
    for (const p of proxies) {
        try {
            const res = await fetch(p(url));
            const data = await res.json();
            return data.contents ? JSON.parse(data.contents) : data;
        } catch (e) { console.warn("Proxy swap..."); }
    }
    throw new Error("Connection failed");
}

// --- CHART ENGINE ---
function initChart() {
    const container = document.getElementById('chart-container');
    chart = LightweightCharts.createChart(container, {
        autoSize: true, // AUTO-RESIZE FIX
        layout: { background: { color: 'transparent' }, textColor: '#e0fff8' },
        grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
        timeScale: { timeVisible: true, secondsVisible: false }
    });
    candleSeries = chart.addCandlestickSeries({
        upColor: '#00e676', downColor: '#ff3366', borderVisible: false,
        wickUpColor: '#00e676', wickDownColor: '#ff3366'
    });
}

async function updateTF(tf) {
    currentTf = tf;
    await fetchChartData();
}

async function fetchChartData() {
    try {
        const interval = currentTf === '1d' ? '5m' : '1d';
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=${interval}&range=${currentTf}`;
        const data = await fetchWithProxy(url);
        const res = data.chart.result[0];
        const quote = res.indicators.quote[0];
        
        const candles = res.timestamp.map((t, i) => ({
            time: t,
            open: quote.open[i], high: quote.high[i], low: quote.low[i], close: quote.close[i]
        })).filter(c => c.close != null);

        candleSeries.setData(candles);
        
        const last = candles[candles.length-1];
        const prev = candles[candles.length-2];
        const change = ((last.close - res.meta.previousClose) / res.meta.previousClose * 100).toFixed(2);
        
        document.getElementById('current-price').textContent = `$${last.close.toFixed(2)}`;
        document.getElementById('price-change').textContent = `${change}%`;
        document.getElementById('price-change').style.color = change >= 0 ? '#00e676' : '#ff3366';

        detectPatterns(candles);
        return { candles, last, change };
    } catch (e) { console.error("Chart Fail", e); }
}

// --- PATTERN RECOGNITION (Your Core Logic) ---
function detectPatterns(candles) {
    if (candles.length < 5) return;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const body = Math.abs(last.close - last.open);
    const wickTop = last.high - Math.max(last.close, last.open);
    const wickBottom = Math.min(last.close, last.open) - last.low;
    
    let found = [];
    // Hammer
    if (wickBottom > body * 2 && wickTop < body) found.push("HAMMER (Bullish)");
    // Engulfing
    if (last.close > prev.open && last.open < prev.close && (last.close - last.open) > 0) found.push("BULLISH ENGULFING");
    
    console.log("Patterns Detected:", found);
    return found;
}

// --- NEWS ENGINE ---
async function fetchNews() {
    try {
        // FIX: lowercase 'apikey'
        const url = `https://gnews.io/api/v4/search?q=AAPL&lang=en&max=5&apikey=${CONFIG.GNEWS_API_KEY}`;
        const data = await fetchWithProxy(url);
        const list = document.getElementById('news-list');
        list.innerHTML = data.articles.map(a => `
            <div class="news-item" onclick="window.open('${a.url}')">
                <b>${a.source.name}</b>: ${a.title}
            </div>
        `).join('');
        return data.articles;
    } catch (e) { console.error("News Fail", e); }
}

// --- AI ENGINE (GROQ) ---
async function runAI(priceData, newsData) {
    try {
        const prompt = `Analyze AAPL. Price: ${priceData.last.close}. News: ${newsData[0]?.title}. Return JSON: {"signal":"BUY/SELL/HOLD", "conf":85, "evidence":["point 1", "point 2"]}`;
        
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${CONFIG.GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: CONFIG.GROQ_MODEL,
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            })
        });
        
        const aiRes = await res.json();
        const signal = JSON.parse(aiRes.choices[0].message.content);
        
        // Update UI
        const badge = document.getElementById('rating-badge');
        badge.textContent = signal.signal;
        badge.style.color = signal.signal === 'BUY' ? '#00e676' : signal.signal === 'SELL' ? '#ff3366' : '#fff';
        
        document.getElementById('conf-pct').textContent = signal.conf + '%';
        document.getElementById('conf-bar').style.width = signal.conf + '%';
        
        document.getElementById('evidence-list').innerHTML = signal.evidence.map(e => `
            <div class="ev-item">${e}</div>
        `).join('');

    } catch (e) { console.error("AI Fail", e); }
}

// --- MASTER CONTROLLER ---
async function runAll() {
    document.getElementById('status-dot').className = 'status-dot loading';
    const priceData = await fetchChartData();
    const newsData = await fetchNews();
    if (priceData && newsData) {
        await runAI(priceData, newsData);
    }
    document.getElementById('status-dot').className = 'status-dot live';
}

window.onload = () => {
    initChart();
    runAll();
    
    // Refresh Logic
    let count = 60;
    setInterval(() => {
        count--;
        document.getElementById('refresh-fill').style.width = (count/60*100) + '%';
        if (count <= 0) { count = 60; runAll(); }
    }, 1000);
};
