from flask import Flask, request, jsonify
from flask_cors import CORS
import yfinance as yf
import time

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

def safe_float(val):
    return val if val is not None else 0.0

@app.route('/quote', methods=['GET'])
def get_quote():
    symbol = request.args.get('symbol')
    if not symbol: return jsonify({"error": "No symbol provided"}), 400
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.fast_info
        history = ticker.history(period="2d")
        
        current_price = safe_float(info.last_price)
        prev_close = safe_float(info.previous_close)
        change = current_price - prev_close
        change_p = (change / prev_close) * 100 if prev_close != 0 else 0
        
        return jsonify({
            "c": current_price, "d": change, "dp": change_p,
            "h": safe_float(history['High'].iloc[-1]) if not history.empty else current_price,
            "l": safe_float(history['Low'].iloc[-1]) if not history.empty else current_price,
            "o": safe_float(history['Open'].iloc[-1]) if not history.empty else current_price,
            "pc": prev_close, "t": int(time.time())
        })
    except: return jsonify({"c": 0, "d": 0, "dp": 0, "pc": 0}), 200

@app.route('/stock/profile2', methods=['GET'])
def get_profile():
    symbol = request.args.get('symbol')
    try:
        info = yf.Ticker(symbol).info
        return jsonify({
            "name": info.get('longName', symbol),
            "ticker": info.get('symbol', symbol),
            "finnhubIndustry": info.get('industry', 'N/A'),
            "currency": info.get('currency', 'USD'),
            "exchange": info.get('exchange', 'N/A'),
            "logo": info.get('logo_url', ''),
            "marketCapitalization": info.get('marketCap', 0) / 1000000
        })
    except: return jsonify({}), 200

# NOUVELLE ROUTE POUR LES STATISTIQUES CLES
@app.route('/stock/metric', methods=['GET'])
def get_metrics():
    symbol = request.args.get('symbol')
    try:
        info = yf.Ticker(symbol).info
        return jsonify({
            "metric": {
                "10DayAverageTradingVolume": info.get('averageVolume10days', 0),
                "52WeekHigh": info.get('fiftyTwoWeekHigh', 0),
                "52WeekLow": info.get('fiftyTwoWeekLow', 0),
                "marketCapitalization": info.get('marketCap', 0) / 1000000,
                "beta": info.get('beta', 0),
                "peRatio": info.get('trailingPE', 0),
                "eps": info.get('trailingEps', 0),
                "dividendYield": info.get('dividendYield', 0) * 100 if info.get('dividendYield') else 0
            }
        })
    except Exception as e: return jsonify({"metric": {}})

@app.route('/search', methods=['GET'])
def search_symbol():
    q = request.args.get('q', '').upper()
    return jsonify({"count": 1, "result": [{"description": q, "displaySymbol": q, "symbol": q, "type": "Common Stock"}]})

@app.route('/company-news', methods=['GET'])
def get_news():
    symbol = request.args.get('symbol')
    try:
        news_list = yf.Ticker(symbol).news
        formatted_news = []
        for item in news_list:
            formatted_news.append({
                "category": "company",
                "datetime": int(item.get('providerPublishTime', time.time())),
                "headline": item.get('title', ''),
                "image": item.get('thumbnail', {}).get('resolutions', [{}])[0].get('url', ''),
                "source": item.get('publisher', 'Yahoo'),
                "summary": item.get('type', ''),
                "url": item.get('link', '')
            })
        return jsonify(formatted_news)
    except: return jsonify([])

@app.route('/stock/candle', methods=['GET'])
def get_candles():
    symbol = request.args.get('symbol')
    resolution = request.args.get('resolution')
    interval_map = {'1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', 'D': '1d', 'W': '1wk', 'M': '1mo'}
    interval = interval_map.get(resolution, '1d')
    period = "1mo"
    if interval in ['1m', '5m']: period = "1d"
    elif interval in ['15m', '30m', '60m', '1h']: period = "5d"
    
    try:
        hist = yf.Ticker(symbol).history(period=period, interval=interval)
        if hist.empty: return jsonify({"s": "no_data"})
        return jsonify({
            "c": hist['Close'].tolist(), "h": hist['High'].tolist(),
            "l": hist['Low'].tolist(), "o": hist['Open'].tolist(),
            "t": (hist.index.astype('int64') // 10**9).tolist(), "s": "ok"
        })
    except: return jsonify({"s": "error"})

if __name__ == '__main__':
    app.run(debug=True, port=5000)