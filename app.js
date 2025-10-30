const express = require("express");
const http = require("http");
const morgan = require("morgan");
require("dotenv").config();
const fs = require("fs");
const fss = require("fs").promises; // 👈 important!
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const axios = require("axios");
const socketIo = require("socket.io");
const { getHoldings } = require("./services/holdings.js");
const { startCron } = require("./cron.js");
const { startNotificationScheduler } = require("./notificationScheduler");

const app = express();
const PORT = process.env.PORT || 3001;
const COVALENT_API_KEY= process.env.COVALENT_API_KEY;
const COVALENT_BASE_URL= process.env.COVALENT_BASE_URL;

// Middleware
app.use(express.json());
app.use(morgan("dev"));
app.use(cors({ origin: "*" }));

app.post("/save-email", (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Invalid email format" });
  }
  const data = {
    id: uuidv4(),
    email: email,
    timestamp: new Date().toISOString(),
  };

  const filePath = path.join(__dirname, "email.json");

  // Read existing data (if any)
  fs.readFile(filePath, "utf8", (readErr, fileData) => {
    let arr = [];
    if (!readErr && fileData) {
      try {
        arr = JSON.parse(fileData);
        if (!Array.isArray(arr)) arr = [];
      } catch {
        arr = [];
      }
    }
    arr.push(data);

    // Write updated array back to file
    fs.writeFile(filePath, JSON.stringify(arr, null, 2), (writeErr) => {
      if (writeErr) {
        console.error("Write error:", writeErr);
        return res.status(500).json({ error: "Failed to write data" });
      }
      res.json({
        message: "Email received successfully",
        data,
      });
    });
  });
});

app.get("/get-emails", (req, res) => {
  const password = req.headers["x-access-password"];
  const correctPassword = "eyqw123@#PumpParade.com"; // Change this to something private

  if (password !== correctPassword) {
    return res.status(401).json({ error: "Unauthorized: Invalid password" });
  }

  const filePath = path.join(__dirname, "email.json");
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Failed to read emails" });

    try {
      const emails = JSON.parse(data);
      res.json(emails);
    } catch {
      res.status(500).json({ error: "Corrupted email file" });
    }
  });
});

app.post("/get-ai-predction", async (req, res) => {
  const { Prompt } = req.body;
  console.log("Received technical prompt:", Prompt);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.AI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: Prompt }],
            },
          ],
        }),
      }
    );
    //console.log("Response status:", response);
    if (response) {
      return res.json({
        message: "AI prediction received successfully",
        data: await response.json(),
      });
    }
  } catch (error) {
    console.error("Error fetching AI prediction:", error);
    return res.status(500).json({ error: "Failed to fetch AI prediction" });
  }
});

app.get("/api/tokens", async (req, res) => {
  const { search, page, perPage } = req.query;
  let normalizedSearch = search?.trim().toLowerCase() || "";
  const pageNumber = page ? parseInt(page) : 1;
  const perPageNumber = perPage ? parseInt(perPage) : 20;
  const url = `https://pro-api.coingecko.com/api/v3/coins/markets`;

  const queryParams = new URLSearchParams({
    vs_currency: "usd",
    per_page: perPageNumber,
    page: pageNumber,
    price_change_percentage: "24h,7d,30d",
  });

  if (search && search.trim() !== "") {
    // queryParams.append("ids", normalizedSearch);
    // queryParams.append("name", normalizedSearch);
    queryParams.append("symbols", normalizedSearch);
  }

  try {
    const response = await axios.get(`${url}?${queryParams.toString()}`, {
      headers: {
        accept: "application/json",
        "x-cg-pro-api-key": process.env.COINGECKO_KEY,
      },
    });
    const data = response.data;
    return res.status(200).json({
      status: 200,
      message: "Tokens fetched successfully",
      data: data,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to fetch tokens",
      error: err.message,
      stack: err.stack,
    });
  }
});

app.get("/api/sentiment", async (req, res) => {
  const topic = req.query.topic || "bitcoin";
  debugger;
  const url = `https://lunarcrush.com/api4/public/topic/${encodeURIComponent(
    topic
  )}/v1`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.LUNAR_API}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`LunarCrush API error: ${response.status} - ${errorText}`);
      return res
        .status(response.status)
        .json({ error: "LunarCrush API error", details: errorText });
    }

    const json = await response.json();
    res.json(json);
  } catch (err) {
    console.error("Error fetching LunarCrush sentiment data:", err);
    res.status(500).json({ error: "Failed to fetch sentiment data" });
  }
});

app.get("/api/technicalindicators", async (req, res) => {
  const topic = req.query.topic || "bitcoin";
  const timeframe = req.query.timeframe || "3m";

  const url = `https://lunarcrush.com/api4/public/coins/${encodeURIComponent(
    topic
  )}/time-series/v2?bucket=day&interval=${encodeURIComponent(timeframe)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.LUNAR_API}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`LunarCrush error: ${response.status}`, errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const json = await response.json();

    const data = json.data.map((item) => ({
      timestamp: item.time,
      price: item.close,
      volume: item.volume_24h,
    }));

    res.json({ data });
  } catch (err) {
    console.error("Error fetching technical indicators:", err);
    res.status(500).json({ error: "Failed to fetch indicators" });
  }
});

app.get("/api/cryptos", async (req, res) => {
  const perPage = 250; // CoinGecko max limit
  const totalTokens = 1000; // how many you want
  const pages = Math.ceil(totalTokens / perPage);

  try {
    let allData = [];

    for (let page = 1; page <= pages; page++) {
      const queryParams = new URLSearchParams({
        vs_currency: "usd",
        order: "market_cap_desc",
        per_page: perPage.toString(),
        page: page.toString(),
        sparkline: "false",
        price_change_percentage: "24h,7d,30d",
      });

      const response = await fetch(
        `https://pro-api.coingecko.com/api/v3/coins/markets?${queryParams.toString()}`,
        {
          headers: {
            accept: "application/json",
            "x-cg-pro-api-key": process.env.COINGECKO_KEY,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`CoinGecko error ${response.status}:`, errorText);
        return res.status(response.status).json({ error: errorText });
      }

      const data = await response.json();
      allData = allData.concat(data);
    }

    res.json(allData.slice(0, totalTokens)); // trim to exactly 1000 if needed
  } catch (err) {
    console.error("Error fetching CoinGecko Pro data:", err);
    res.status(500).json({ error: "Failed to fetch crypto data" });
  }
});
app.get("/api/alerts", (req, res) => {
  const { address } = req.query;
  const pathname = path.join(__dirname, "alerts.json");

  fs.readFile(pathname, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading file:", err);
      return;
    }

    let parsedAlerts = JSON.parse(data) ?? [];
    const filteredAlerts = parsedAlerts.filter(e=> e?.walletAddress === address).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({
      message: "Alerts fetched successfully",
      data: filteredAlerts,
    });
  });
});

app.get("/api/token-info/:tokenId", async (req, res) => {
  const tokenId = req.params.tokenId;

  try {
    //console.log(`Fetching token info for: ${tokenId}`);

    const response = await fetch(
      `https://pro-api.coingecko.com/api/v3/coins/${encodeURIComponent(
        tokenId
      )}`,
      {
        headers: {
          accept: "application/json",
          "x-cg-pro-api-key": process.env.COINGECKO_KEY,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: `Token '${tokenId}' not found` });
      }
      const errorText = await response.text();
      console.error(`CoinGecko error ${response.status}:`, errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();

    const tokenInfo = {
      id: data.id,
      symbol: data.symbol?.toUpperCase() || tokenId.toUpperCase(),
      name: data.name || tokenId,
      description: data.description?.en,
      image: data.image?.large || data.image?.small,
      current_price: data.market_data?.current_price?.usd,
      market_cap: data.market_data?.market_cap?.usd,
      market_cap_rank: data.market_cap_rank,
      price_change_percentage_24h:
        data.market_data?.price_change_percentage_24h,
      total_volume: data.market_data?.total_volume?.usd,
      categories: data.categories,
      links: {
        homepage: data.links?.homepage?.filter(Boolean),
        twitter_screen_name: data.links?.twitter_screen_name,
      },
    };

    res.json(tokenInfo);
  } catch (error) {
    console.error(`Token info fetch error for ${tokenId}:`, error);
    res.status(500).json({ error: "Failed to fetch token info" });
  }
});

/////////////// Portfolio endpoint  To fetch all the portfolio data using COVALENT API



// Helper: Map symbols to CoinGecko IDs dynamically
let coinGeckoCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms

const mapSymbolsToCoinGeckoIds = async (symbols) => {
  const now = Date.now();

  // Use cached data if available and fresh
  if (coinGeckoCache && now - cacheTimestamp < CACHE_DURATION) {
    console.log("Using cached CoinGecko coin list");
  } else {
    // console.log("Fetching fresh CoinGecko coin list");

    const response = await fetch(
      `https://pro-api.coingecko.com/api/v3/coins/list`,
      {
        headers: { "x-cg-pro-api-key": process.env.COINGECKO_KEY },
      }
    );

    if (!response.ok) {
      console.error("Failed to fetch CoinGecko coin list");
      return {};
    }

    coinGeckoCache = await response.json();
    cacheTimestamp = now;
  }

  // Build symbol → id mapping
  const symbolToIdMap = {};
  for (const coin of coinGeckoCache) {
    symbolToIdMap[coin.symbol.toLowerCase()] = coin.id;
  }

  // Filter only requested symbols
  const filteredMap = {};
  symbols.forEach((sym) => {
    const lowerSym = sym.toLowerCase();
    if (symbolToIdMap[lowerSym]) {
      filteredMap[lowerSym] = symbolToIdMap[lowerSym];
    }
  });

  return filteredMap;
};

// Helper: Fetch token balances (all chains) from Covalent
const holdingsCache = {};
const CACHE_TTL = 1000 * 60 * 60 * 5; // ✅ 5 hours

// const getHoldings = async (walletAddress, chainId, currency = "usd") => {
//   const cacheKey = `${walletAddress}_${chainId}_${currency}`;
//   const now = Date.now();

//   // ✅ Serve cached data if still valid
//   if (holdingsCache[cacheKey] && holdingsCache[cacheKey].expiry > now) {
//     //console.log("Serving from cache:", cacheKey);
//     return holdingsCache[cacheKey].data;
//   }

//   try {
//     const res = await fetch(
//       `${COVALENT_BASE_URL}/${chainId}/address/${walletAddress}/balances_v2/?key=${COVALENT_API_KEY}&quote-currency=${currency}`
//     );

//     const result = await res.json();
//     if (!result || !result.data || !result.data.items) return [];

//     const holdings = result.data.items.map((t) => {
//       const amount =
//         parseFloat(t.balance) / Math.pow(10, t.contract_decimals || 18);
//       const currentPrice = t.quote_rate || 0;
//       const totalValue = t.quote || amount * currentPrice;

//       return {
//         chainId,
//         symbol: t.contract_ticker_symbol,
//         name: t.contract_name,
//         address: t.contract_address,
//         amount,
//         currentPrice, // ✅ actual token price
//         totalValue, // ✅ USD value
//         change24h: t.quote_24h || 0, // ✅ 24h change if available
//         imageUrl: t.logo_url || "/default-token-icon.png",
//       };
//     });

//     // ✅ Save to cache with 5-hour expiry
//     holdingsCache[cacheKey] = {
//       data: holdings,
//       expiry: now + CACHE_TTL,
//     };

//     return holdings;
//   } catch (error) {
//     console.error("Error fetching Covalent holdings:", error);
//     return [];
//   }
// };

const getHoldingsSepolia = async (walletAddress) => {
  const chainId = 11155111;
  const res = await fetch(
    `${COVALENT_BASE_URL}/${chainId}/address/${walletAddress}/balances_v2/?key=${COVALENT_API_KEY}`
  );
  const result = await res.json();
  if (!result.data || !result.data.items) return [];
  return result.data.items.map((t) => ({
    chain: chainId,
    symbol: t.contract_ticker_symbol,
    name: t.contract_name,
    address: t.contract_address,
    amount: parseFloat(t.balance) / Math.pow(10, t.contract_decimals),
    quote: t.quote || 0,
  }));
};

// Helper: Fetch DeFi positions
const getDeFiPositions = async (walletAddress, chainId) => {
  try {
    const holdings = await getHoldings(walletAddress, chainId, "usd");
    // Simple heuristic: detect DeFi tokens by known DeFi protocols in symbol
    const defiTokens = holdings.filter((t) =>
      ["aave", "uni", "stk", "slp", "lpt"].some((keyword) =>
        t.symbol.toLowerCase().includes(keyword)
      )
    );

    const defiPositions = defiTokens.map((t) => ({
      id: t.address,
      protocol: identifyProtocol(t.symbol),
      type: "liquidity/staking/lending",
      asset: t.symbol,
      amount: t.amount,
      apy: 0, // Optional: Covalent may have staking info in other endpoints
      rewards: 0,
      totalValue: t.quote,
      risk: "medium",
    }));

    return defiPositions;
  } catch (error) {
    console.error("Error fetching DeFi positions:", error);
    return [];
  }
};

// Protocol identifier
function identifyProtocol(symbol) {
  symbol = symbol.toLowerCase();
  if (symbol.includes("aave")) return "Aave";
  if (symbol.includes("uni")) return "Uniswap V2/V3";
  if (symbol.includes("stk")) return "Lido";
  if (symbol.includes("slp") || symbol.includes("lpt"))
    return "SushiSwap/LP Token";
  return "Unknown";
}

// Transactions using Covalent
// Helper: fetch price from CoinGecko
const COINGECKO_PRO_BASE = "https://pro-api.coingecko.com/api/v3";
const COINGECKO_API_KEY = process.env.COINGECKO_KEY; // use env var in production

const fetchTokenPriceUSD = async ({
  contractAddress,
  tickerSymbol,
  isEth = false,
}) => {
  try {
    let url;
    if (isEth) {
      url = `${COINGECKO_PRO_BASE}/simple/price?ids=ethereum&vs_currencies=usd`;
    } else {
      url = `${COINGECKO_PRO_BASE}/simple/token_price/ethereum?contract_addresses=${contractAddress}&vs_currencies=usd`;
    }

    const res = await fetch(url, {
      headers: {
        "x-cg-pro-api-key": COINGECKO_API_KEY,
      },
    });
    const json = await res.json();

    if (isEth) {
      const price = json?.ethereum?.usd;
      return price ? price : 0;
    } else {
      const key = contractAddress.toLowerCase();
      const price = json?.[key]?.usd;
      return price ? price : 0;
    }
  } catch (err) {
    console.error("Error fetching token price from CoinGecko Pro:", err, {
      contractAddress,
      tickerSymbol,
      isEth,
    }); 
    return 0;
  }
};
const txCache = {};
const CACHE_Transaction = 1000 * 60 * 60 * 5; // ✅ 5 hours

const getTransactions = async (walletAddress, chainId) => {
  const cacheKey = `${walletAddress}_${chainId}`;
  const now = Date.now();

  // ✅ return cached result if available & valid
  if (txCache[cacheKey] && txCache[cacheKey].expiry > now) {
    //console.log("Serving txs from cache:", cacheKey);
    return txCache[cacheKey].data;
  }

  try {
    // 1. Fetch ETH transactions
    const ethRes = await fetch(
      `${COVALENT_BASE_URL}/${chainId}/address/${walletAddress}/transactions_v2/?key=${COVALENT_API_KEY}`
    );
    const ethJson = await ethRes.json();

    const ethTxs = (ethJson?.data?.items || []).map((tx) => {
      const amountEth = parseFloat(tx.value) / Math.pow(10, 18);
      const feeEth = parseFloat(tx.fees_paid) / Math.pow(10, 18);
      return {
        id: tx.tx_hash,
        type:
          tx.from_address.toLowerCase() === walletAddress.toLowerCase()
            ? "sell"
            : "buy",
        asset: "ETH",
        amount: amountEth,
        timestamp: new Date(tx.block_signed_at),
        hash: tx.tx_hash,
        fee: feeEth,
        status: tx.successful ? "completed" : "failed",
        contract_address: null,
      };
    });

    // 2. Fetch Token transfers
    const tokenRes = await fetch(
      `${COVALENT_BASE_URL}/${chainId}/address/${walletAddress}/transfers_v2/?key=${COVALENT_API_KEY}`
    );
    const tokenJson = await tokenRes.json();

    const tokenTxs = (tokenJson?.data?.items || []).flatMap((item) =>
      (item.transfers || []).map((transfer) => {
        const amountToken =
          parseFloat(transfer.delta) / Math.pow(10, transfer.contract_decimals);
        const feeEth = parseFloat(item.fees_paid) / Math.pow(10, 18);

        return {
          id: transfer.tx_hash,
          type:
            transfer.from_address.toLowerCase() === walletAddress.toLowerCase()
              ? "sell"
              : "buy",
          asset: transfer.contract_ticker_symbol,
          amount: amountToken,
          timestamp: new Date(item.block_signed_at),
          hash: transfer.tx_hash,
          fee: feeEth,
          status: item.successful ? "completed" : "failed",
          contract_address: transfer.contract_address,
        };
      })
    );

    // 3. Enrich with USD price
    const allTxs = [...ethTxs, ...tokenTxs];

    const enrichedTxs = await Promise.all(
      allTxs.map(async (tx) => {
        let priceUsd = 0;

        if (tx.asset === "ETH") {
          priceUsd = await fetchTokenPriceUSD({ isEth: true });
        } else if (tx.contract_address) {
          priceUsd = await fetchTokenPriceUSD({
            contractAddress: tx.contract_address,
            tickerSymbol: tx.asset,
            isEth: false,
          });
        }

        const totalValue = tx.amount * priceUsd;

        return {
          ...tx,
          price: priceUsd,
          totalValue: parseFloat(totalValue.toFixed(2)),
        };
      })
    );

    // 4. Sort by timestamp
    enrichedTxs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // ✅ Save to cache
    txCache[cacheKey] = {
      data: enrichedTxs,
      expiry: now + CACHE_Transaction,
    };

    return enrichedTxs;
  } catch (error) {
    console.error("Error in getTransactions:", error);
    return [];
  }
};

const symbolToIdMap = {
  ETH: "ethereum",
  USDC: "usd-coin",
  DAI: "dai",
  LINK: "chainlink",
  MATIC: "matic-network",
  // add more as needed
};

const getRiskMetrics = async (walletAddress, chainId) => {
  const holdingsData = await getHoldings(walletAddress, chainId, "usd");

  const portfolio = holdingsData.map((i) => ({
    symbol: i.symbol, // was contract_ticker_symbol
    balance: i.amount, // was balance / decimals
    price: i.currentPrice, // was quote_rate
    value: i.totalValue, // was quote
  }));
  const metrics = {};
  let weightedReturns = [];
  let weightedPrices = [];

  // Process each asset
  for (const asset of portfolio) {
    const id = symbolToIdMap[asset.symbol];
    if (!id) {
      console.log(`⚠️ Skipping ${asset.symbol} (not found in CoinGecko list)`);
      continue;
    }

    const priceRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=90`
    );
    const priceData = await priceRes.json();

    if (!priceData.prices) {
      console.log(`⚠️ No price data for ${asset.symbol}`);
      continue;
    }

    const prices = priceData.prices.map((p) => p[1]);
    const returns = prices.map((p, idx, arr) =>
      idx === 0 ? 0 : (p - arr[idx - 1]) / arr[idx - 1]
    );

    metrics[asset.symbol] = {
      sharpe: calculateSharpe(returns),
      volatility: calculateVolatility(returns),
      maxDrawdown: calculateMaxDrawdown(prices),
      beta: calculateBeta(returns),
      var95: calculateVaR(returns, 0.95),
      sortino: calculateSortino(returns),
      calmar: calculateCalmar(prices),
    };

    // --- weighted portfolio returns ---
    const weight = asset.value / portfolio.reduce((s, a) => s + a.value, 0);
    if (weightedReturns.length === 0) {
      weightedReturns = returns.map((r) => r * weight);
      weightedPrices = prices.map((p) => p * weight);
    } else {
      weightedReturns = weightedReturns.map((r, i) => r + returns[i] * weight);
      weightedPrices = weightedPrices.map((p, i) => p + prices[i] * weight);
    }
  }
  if (weightedReturns.length === 0 || weightedPrices.length === 0) {
    console.warn("⚠️ No valid assets found for risk calculation");
    weightedReturns = [0];
    weightedPrices = [1];
  }

  // Aggregate portfolio-level risk metrics
  const portfolioRiskMetrics = {
    sharpeRatio: calculateSharpe(weightedReturns),
    volatility: calculateVolatility(weightedReturns),
    maxDrawdown: calculateMaxDrawdown(weightedPrices),
    beta: calculateBeta(weightedReturns),
    var95: calculateVaR(weightedReturns, 0.95),
    sortino: calculateSortino(weightedReturns),
    calmar: calculateCalmar(weightedPrices),
    // Extra risk distribution (static/dynamic as you like)
    correlationRisk: 65,
    concentrationRisk: 78,
    liquidityRisk: 23,
  };

  const totalValue = portfolio.reduce((sum, a) => sum + a.value, 0);

  return {
    portfolio,
    metrics, // per token
    riskMetrics: portfolioRiskMetrics, // <-- final response for UI
    totalValue,
  };
};

function calculateSharpe(returns, riskFreeRate = 0.02) {
  if (!returns || returns.length < 2) return 0;

  const avg = mean(returns);
  const std = stddev(returns);
  if (std === 0 || isNaN(std)) return 0;

  return (avg - riskFreeRate / 252) / std;
}

function calculateVolatility(returns) {
  if (!returns || returns.length < 2) return 0;

  const std = stddev(returns);
  if (isNaN(std)) return 0;

  return std * Math.sqrt(252) * 100;
}

function calculateMaxDrawdown(prices) {
  if (!prices || prices.length < 2) return 0;

  let peak = prices[0];
  let maxDD = 0;

  for (let p of prices) {
    peak = Math.max(peak, p);
    maxDD = Math.min(maxDD, (p - peak) / peak);
  }

  return maxDD * 100;
}

function calculateBeta(returns, marketReturns) {
  if (!returns || returns.length < 2) return 0;
  // TODO: implement proper covariance/variance calc later
  return 1.2;
}

function calculateVaR(returns, confidence = 0.95) {
  if (!returns || returns.length < 2) return 0;

  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  return sorted[index] * 100 || 0;
}

function calculateSortino(returns, riskFreeRate = 0.02) {
  if (!returns || returns.length < 2) return 0;

  const avg = mean(returns);
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return 0;

  const downsideDev = stddev(downside);
  if (downsideDev === 0 || isNaN(downsideDev)) return 0;

  return (avg - riskFreeRate / 252) / downsideDev;
}

function calculateCalmar(prices) {
  if (!prices || prices.length < 2) return 0;

  const annualReturn = (prices[prices.length - 1] - prices[0]) / prices[0];
  const maxDD = calculateMaxDrawdown(prices) / 100;

  if (maxDD === 0) return 0;
  return annualReturn / Math.abs(maxDD);
}
// Helper functions
function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (!arr || arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => Math.pow(x - m, 2))));
}

// Placeholder: No direct Amberdata API for AI Recommendations
// --- AI Fetch Helper ---
// Simple in-memory cache (keyed by prompt)
const aiCache = {};

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getAIRecommendations = async (Prompt) => {
  // 1️⃣ Return cached result if available
  if (aiCache[Prompt]) {
    console.log("✅ Returning cached AI response");
    return aiCache[Prompt];
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
?key=${process.env.AI_KEY}`;
  const MAX_RETRIES = 1;
  let delay = 1000; // start 1s

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: Prompt }] }],
        }),
      });

      if (response.status === 429) {
        console.warn(`⚠️ Rate limited. Retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= 2; // exponential backoff
        continue;
      }

      if (!response.ok) {
        throw new Error(`AI API error: ${response.statusText}`);
      }

      const raw = await response.json();
      const aiText = raw?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Cache the response for future identical prompts
      aiCache[Prompt] = aiText;

      return aiText;
    } catch (err) {
      console.error("Error fetching AI prediction:", err);
      console.log({ stack: err?.stack });
      await sleep(delay);
      delay *= 2;
    }
  }

  console.error("❌ All retries failed, returning empty string");
  return "";
};

// --- Express route ---
app.post("/api/getAIRecommendations", async (req, res) => {
  const { prompt } = req.body;
  const text = await getAIRecommendations(prompt);

  res.json({
    success: true,
    text, // always wrapped in { text: "..."}
  });
});

// Placeholder: No direct Amberdata API for Smart Alerts

const getSmartAlerts = async (walletAddress) => {
  try {
    const ALERTS_FILE = path.join(__dirname, "alerts.json");
    const fileData = await fss.readFile(ALERTS_FILE, "utf8"); // works now
    const alerts = JSON.parse(fileData);

    return alerts.filter(
      (a) =>
        a.walletAddress.toLowerCase() === walletAddress.toLowerCase() &&
        a.isActive
    );
  } catch (err) {
    console.error("Error reading alerts file:", err);
    return [];
  }
};

// Placeholder: No direct Amberdata API for Correlation Data
const getCorrelationData = async (walletAddress) => {
  return [{ asset1: "BTC", asset2: "ETH", correlation: 0.85 }];
};

// Placeholder: No direct Amberdata API for Portfolio History
const historyCache = {};
const CACHE_History = 1000 * 60 * 60 * 5; // ✅ 5 hours

const getPortfolioHistory = async (
  walletAddress,
  chainId,
  currency = "usd"
) => {
  const cacheKey = `${walletAddress}_${chainId}_${currency}`;
  const now = Date.now();

  // ✅ serve from cache if still valid
  if (historyCache[cacheKey] && historyCache[cacheKey].expiry > now) {
    //console.log("Serving portfolio history from cache:", cacheKey);
    return historyCache[cacheKey].data;
  }

  try {
    const res = await fetch(
      `${COVALENT_BASE_URL}/${chainId}/address/${walletAddress}/portfolio_v2/?key=${COVALENT_API_KEY}&quote-currency=${currency}`
    );

    const result = await res.json();
    if (!result?.data?.items || result.data.items.length === 0) return [];

    // Take all tokens’ history
    const tokenHistories = result.data.items.map((token) => token.holdings);

    // Get all unique timestamps
    const timestamps = [
      ...new Set(tokenHistories.flat().map((h) => h.timestamp)),
    ].sort();

    let initialValue = null;

    const mappedHistory = timestamps.map((ts) => {
      let totalValue = 0;
      const assets = {};

      result.data.items.forEach((token) => {
        const holding = token.holdings.find((h) => h.timestamp === ts);
        if (holding) {
          // Use 'close' for latest snapshot
          const close = holding.close || holding.open || holding;
          const amount =
            parseFloat(close.balance) /
            Math.pow(10, token.contract_decimals || 18);
          const price = holding.quote_rate || 0; // price in USD
          const value = close.quote != null ? close.quote : amount * price;

          totalValue += value;
          assets[token.contract_ticker_symbol] = { value, amount, price };
        }
      });

      if (initialValue === null) {
        initialValue = totalValue;
      }

      return {
        date: new Date(ts).toLocaleDateString("en-GB"), // dd/mm/yyyy
        totalValue,
        pnl: totalValue - initialValue,
        assets,
      };
    });

    // ✅ save to cache
    historyCache[cacheKey] = {
      data: mappedHistory,
      expiry: now + CACHE_History,
    };

    return mappedHistory;
  } catch (error) {
    console.error("Error fetching portfolio history:", error);
    return [];
  }
};

// API Endpoints

app.post("/api/getPortfolio", async (req, res) => {
  try {
    const { walletAddress, chainId } = req.body;
    if (!walletAddress)
      return res.status(400).json({ error: "Wallet address is required" });

    const holdings = await getHoldings(walletAddress, chainId, "usd");

    // Portfolio totals
    const totalValueNow = holdings.reduce((acc, t) => acc + t.totalValue, 0);
    const totalValue24h = holdings.reduce(
      (acc, t) => acc + (t.amount * (t.currentPrice - (t.change24h || 0)) || 0),
      0
    );

    const changeAbsolute = totalValueNow - totalValue24h;
    const changePercent =
      totalValue24h > 0 ? (changeAbsolute / totalValue24h) * 100 : 0;

    const portfolioSummary = {
      totalValue: totalValueNow,
      change24h: {
        absolute: changeAbsolute,
        percent: changePercent,
      },
      assets: holdings.length,
    };

    // Add allocation per asset
    const finalPortfolio = holdings.map((t) => ({
      ...t,
      allocation: totalValueNow > 0 ? (t.totalValue / totalValueNow) * 100 : 0,
    }));

    res.json({ summary: portfolioSummary, portfolio: finalPortfolio });
  } catch (error) {
    console.error("Error fetching portfolio:", error.message);
    res.status(500).json({ error: "Failed to fetch portfolio" });
  }
});

app.post("/api/getTransactions", async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const { chainId } = req.body || 1;
    const transactions = await getTransactions(walletAddress, chainId);
    console.log("Transactions fetched:", transactions.length);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

app.post("/api/getDeFiPositions", async (req, res) => {
  const { walletAddress, chainId } = req.body;
  const positions = await getDeFiPositions(walletAddress, chainId);
  res.json(positions);
});

app.post("/api/getRiskMetrics", async (req, res) => {
  try {
    const { walletAddress, chainId } = req.body;
    const metrics = await getRiskMetrics(walletAddress, chainId);
    res.json(metrics); // send response here
  } catch (err) {
    console.error("❌ Error in /api/getRiskMetrics:", err);
    res.status(500).json({ error: "Failed to calculate risk metrics" });
  }
});

app.post("/api/getAIRecommendations", async (req, res) => {
  const { prompt } = req.body;
  const recommendations = await getAIRecommendations(prompt);
  res.json(recommendations);
});

app.post("/api/getSmartAlerts", async (req, res) => {
  const { walletAddress, chainId } = req.body;
  const alerts = await getSmartAlerts(walletAddress, chainId);
  res.json(alerts);
});

app.post("/api/getCorrelationData", async (req, res) => {
  const { walletAddress } = req.body;
  const correlations = await getCorrelationData(walletAddress);
  res.json(correlations);
});

app.post("/api/getPortfolioHistory", async (req, res) => {
  const { walletAddress, chainId } = req.body;
  const history = await getPortfolioHistory(walletAddress, chainId);
  res.json(history);
});

const ALERTS_FILE = path.join(__dirname, "alerts.json");

app.post("/api/saveAlert", async (req, res) => {
  try {
    const {
      id,
      type,
      asset,
      isActive,
      condition,
      threshold,
      message,
      targetAsset,
      walletAddress,
      chainId,
    } = req.body;

    // Validation
    if (!type || !condition || !message) {
      return res.status(400).json({ error: "Invalid alert data" });
    }

    if (type !== "portfolio" && !asset) {
      return res
        .status(400)
        .json({ error: "Asset is required for price/volume alerts" });
    }

    let alerts = await readAlerts();
    let alert;

    if (id) {
      // Update existing
      const index = alerts.findIndex((a) => a.id === id);
      if (index === -1) {
        return res.status(404).json({ error: "Alert not found" });
      }

      alerts[index] = {
        ...alerts[index],
        type,
        isActive,
        asset: asset || null,
        condition,
        threshold,
        message,
        targetAsset: targetAsset || null,
        walletAddress: walletAddress || null,
        chainId: chainId || null,
        updatedAt: new Date().toISOString(),
      };

      alert = alerts[index];
    } else {
      // Create new
      alert = {
        id: uuidv4(),
        type,
        asset: asset || null,
        condition,
        threshold,
        isActive: true,
        message,
        targetAsset: targetAsset || null,
        walletAddress: walletAddress || null,
        chainId: chainId || null,
        createdAt: new Date().toISOString(),
      };
      alerts.push(alert);
    }

    await writeAlerts(alerts);

    return res.json({
      message: id ? "Alert updated successfully" : "Alert created successfully",
      alert,
    });
  } catch (error) {
    console.error("Error saving alert:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Utility to read alerts.json
 */
async function readAlerts() {
  try {
    const data = await fss.readFile(ALERTS_FILE, "utf8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // return empty if file not found or parse error
  }
}

/**
 * Utility to write alerts.json
 */
async function writeAlerts(alerts) {
  await fss.writeFile(ALERTS_FILE, JSON.stringify(alerts, null, 2), "utf8");
}

// ----- Wallet socket mapping

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

// Create HTTP server for scalability
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Attach io instance to app so cron can use it
app.set("io", io);

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

startCron(app);
startNotificationScheduler(app);
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
