const express = require("express");
const http = require("http");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.AI_KEY}`,
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
    console.log("Response status:", response);
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
  const queryParams = new URLSearchParams({
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: "200",
    page: "1",
    sparkline: "false",
    price_change_percentage: "24h,7d,30d",
  });

  try {
    const response = await fetch(
      `https://pro-api.coingecko.com/api/v3/coins/markets?${queryParams.toString()}`,
      {
        headers: {
          accept: "application/json",
          "x-cg-pro-api-key": process.env.COINGECKO_KEY, // secure header
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`CoinGecko error ${response.status}:`, errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error fetching CoinGecko Pro data:", err);
    res.status(500).json({ error: "Failed to fetch crypto data" });
  }
});

app.get("/api/token-info/:tokenId", async (req, res) => {
  const tokenId = req.params.tokenId;

  try {
    console.log(`Fetching token info for: ${tokenId}`);

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

server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
