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

app.post("/get-ai-predction", async (req, res) => {
  const { Prompt } = req.body;
  console.log("Received technical prompt:", Prompt);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${process.env.AI_KEY}`,
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
