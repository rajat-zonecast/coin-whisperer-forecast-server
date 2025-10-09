// riskUtils.js
 function calculateSharpe(returns, riskFreeRate = 0.02) {
  const avg = mean(returns);
  const std = stddev(returns);
  return (avg - riskFreeRate/252) / std;
}

 function calculateVolatility(returns) {
  return stddev(returns) * Math.sqrt(252) * 100; // annualized %
}

 function calculateMaxDrawdown(prices) {
  let peak = prices[0];
  let maxDD = 0;
  for (let p of prices) {
    peak = Math.max(peak, p);
    maxDD = Math.min(maxDD, (p - peak) / peak);
  }
  return maxDD * 100;
}

 function calculateBeta(returns, marketReturns = returns) {
  // Simplified: portfolio vs market
  return 1.2; // placeholder
}

 function calculateVaR(returns, confidence = 0.95) {
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  return sorted[index] * 100;
}

 function calculateSortino(returns, riskFreeRate = 0.02) {
  const avg = mean(returns);
  const downside = returns.filter(r => r < 0);
  const downsideDev = stddev(downside);
  return (avg - riskFreeRate/252) / downsideDev;
}

 function calculateCalmar(prices) {
  const annualReturn = (prices[prices.length-1] - prices[0]) / prices[0];
  const maxDD = calculateMaxDrawdown(prices) / 100;
  return annualReturn / Math.abs(maxDD);
}

// Helpers
function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => Math.pow(x - m, 2))));
}
