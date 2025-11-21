const cron = require("node-cron");
const axios = require("axios");
const path = require("path");
const { getHoldings } = require("./services/holdings.js");
const fs = require("fs").promises;

// ---------- Constants ----------
const ALERTS_FILE = path.join(__dirname, "alerts.json");
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3/simple/price";
const COINGECKO_MARKET_BASE_URL =
  "https://pro-api.coingecko.com/api/v3/coins/markets";
const COINGECKO_KEY = process.env.COINGECKO_KEY;

const priceCache = {};
const volumeCache = {};

// ---------- Utilities ----------
async function getPrice(symbol) {
  const key = symbol.toLowerCase();
  if (priceCache[key] !== undefined) return priceCache[key];

  try {
    const res = await axios.get(COINGECKO_BASE_URL, {
      params: { symbols: key, vs_currencies: "usd" },
    });
    const price = res.data?.[key]?.usd ?? null;
    priceCache[key] = price;
    return price;
  } catch (err) {
    console.error(`[❌] Failed to fetch price for ${symbol}:`, err.message);
    console.log({ stack: err.stack });
    return null;
  }
}

async function getVolume(symbol) {
  const key = symbol.toLowerCase();
  if (volumeCache[key] !== undefined) return volumeCache[key];

  const queryParams = new URLSearchParams({
    vs_currency: "usd",
    symbols: key,
    price_change_percentage: "24h,7d,30d",
  });

  try {
    const res = await axios.get(
      `${COINGECKO_MARKET_BASE_URL}?${queryParams.toString()}`,
      {
        headers: {
          accept: "application/json",
          "x-cg-pro-api-key": COINGECKO_KEY,
        },
      }
    );
    const data = res?.data?.[0]?.total_volume;
    volumeCache[key] = data;
    return data;
  } catch (error) {
    console.error(`[❌] Failed to fetch volume:`, error.message);
    console.log({ stack: error.stack });
    return null;
  }
}

async function readAlerts() {
  try {
    const fileData = await fs.readFile(ALERTS_FILE, "utf8");
    return JSON.parse(fileData) ?? [];
  } catch (err) {
    console.error("[❌] Error reading alerts file:", err.message);
    return [];
  }
}

// ---------- Alert Handlers ----------
async function handlePriceAlert(alert, io) {
  const currentPrice = await getPrice(alert.asset);
  if (currentPrice === null) return;

  const { condition, threshold, asset } = alert;
  let triggered = false;
  let message = "";

  switch (condition) {
    case "above":
      triggered = currentPrice > threshold;
      message = `${asset.toUpperCase()} price above $${threshold} (Current: $${currentPrice})`;
      break;
    case "below":
      triggered = currentPrice < threshold;
      message = `${asset.toUpperCase()} price below $${threshold} (Current: $${currentPrice})`;
      break;
    case "equals":
      triggered = currentPrice === threshold;
      message = `${asset.toUpperCase()} price equals $${threshold} (Current: $${currentPrice})`;
      break;
  }

  if (triggered) {
    io.emit("priceAlert", { asset, message, address: alert.walletAddress });
  }
}

async function handlePairAlert(alert, io) {
  const currentPrice = await getPrice(alert.asset);
  const targetPrice = await getPrice(alert.targetAsset);
  if (currentPrice === null || targetPrice === null) return;

  const { condition, asset, targetAsset } = alert;
  let triggered = false;
  let message = "";

  switch (condition) {
    case "above":
      triggered = currentPrice > targetPrice;
      message = `${asset.toUpperCase()} price $${currentPrice} is ABOVE ${targetAsset.toUpperCase()} price $${targetPrice}`;
      break;
    case "below":
      triggered = currentPrice < targetPrice;
      message = `${asset.toUpperCase()} price $${currentPrice} is BELOW ${targetAsset.toUpperCase()} price $${targetPrice}`;
      break;
    case "equals":
      triggered = currentPrice === targetPrice;
      message = `${asset.toUpperCase()} price $${currentPrice} EQUALS ${targetAsset.toUpperCase()} price $${targetPrice}`;
      break;
  }

  if (triggered) {
    io.emit("pairAlert", { asset, message, address: alert.walletAddress });
  }
}

async function handleVolumeAlert(alert, io) {
  const currentVolume = await getVolume(alert.asset);
  if (currentVolume === null) return;

  const { condition, threshold, asset } = alert;
  let triggered = false;
  let message = "";

  switch (condition) {
    case "above":
      triggered = currentVolume > threshold;
      message = `${asset.toUpperCase()} volume has increased above $${threshold} (Current: $${currentVolume})`;
      break;
    case "below":
      triggered = currentVolume < threshold;
      message = `${asset.toUpperCase()} volume has decreased above $${threshold} (Current: $${currentVolume})`;
      break;
    case "equals":
      triggered = currentVolume === threshold;
      message = `${asset.toUpperCase()} volume is equal to $${threshold} (Current: $${currentVolume})`;
      break;
  }

  if (triggered) {
    io.emit("volumeAlert", { asset, message, address: alert.walletAddress });
  }
}

async function handlePortfolioAlert(alert, io) {
  const { walletAddress, chainId, condition, threshold, asset } = alert;
  if (!walletAddress || !chainId) return;
  const holdings = await getHoldings(walletAddress, chainId);
  const portfolioTotalVol = holdings.reduce((acc, t) => acc + t.totalValue, 0);

  let triggered = false;
  let message = "";

  switch (condition) {
    case "above":
      triggered = portfolioTotalVol > threshold;
      message = `Portfolio has increased above $${threshold}`;
      break;
    case "below":
      triggered = portfolioTotalVol < threshold;
      message = `Portfolio has decreased above $${threshold}`;
      break;
    case "equals":
      triggered = portfolioTotalVol === threshold;
      message = `Portfolio is equal to $${threshold}`;
      break;
  }

  if (triggered) {
    io.emit("portfolioAlert", { asset, message, address: alert.walletAddress });
  }
}

// ---------- Cron Job ----------
const cronAlert = cron.schedule("0 * * * *", async function () {

  // This function will receive `app` from main file
  const app = cronAlert.app;
  if (!app) return;

  const io = app.get("io");
  if (!io) return console.error("[❌] Socket.IO instance not found.");

  const alerts = await readAlerts();
  if (!alerts.length) {
    console.log("No alerts found.");
    return;
  }

  await Promise.all(
    alerts.map(async (alert) => {
      try {
        if (!alert.isActive) return;

        switch (alert.type) {
          case "price":
            await handlePriceAlert(alert, io);
            break;
          case "pair":
            await handlePairAlert(alert, io);
            break;
          case "volume":
            await handleVolumeAlert(alert, io);
          case "portfolio":
            await handlePortfolioAlert(alert, io);
        }
      } catch (error) {
        console.log(`[❌] Error processing alert ${alert.id}:`, error.message);
        console.log({ stack: error.stack });
      }
    })
  );

  console.log("✅ Alert job completed");
});

function startCron(app) {
  cronAlert.app = app;
  cronAlert.start();
  console.log("🚀 Cron job started successfully.");
}

module.exports = { startCron, handlePortfolioAlert };
