const cron = require("node-cron");
const fs = require("fs").promises;
const path = require("path");

const NOTIFICATIONS_FILE = path.join(__dirname, "notifications.json");

async function getNotifications() {
  try {
    const data = await fs.readFile(NOTIFICATIONS_FILE, "utf8");
    return JSON.parse(data).notifications || [];
  } catch {
    return [];
  }
}

async function saveNotifications(notifications) {
  const data = { updatedAt: new Date().toISOString(), notifications };
  await fs.writeFile(NOTIFICATIONS_FILE, JSON.stringify(data, null, 2));
}

async function sendTuesdayNotifications(io) {
  console.log("📢 Checking Tuesday notification schedule...");

  const notifications = await getNotifications();

  if (notifications.length === 0) {
    console.log("⚠️ No notifications found in file.");
    return;
  }

  // Take last element
  const lastNotification = notifications[notifications.length - 1];

  if (io) {
    io.emit("globalNotification", lastNotification);
    console.log(`📤 Sent Tuesday notification: "${lastNotification.title}"`);
  } else {
    console.error("⚠️ Socket.io instance not found.");
  }

  // Move last notification to the front (0th index)
  const updatedNotifications = [
    lastNotification,
    ...notifications.slice(0, notifications.length - 1),
  ];

  // Save updated order
  await saveNotifications(updatedNotifications);
  console.log("🔁 Notifications order updated for next week.");
}

function startNotificationScheduler(app) {
  const io = app.get("io");

  // Every Tuesday at 10:00 AM (server time)
  cron.schedule("0 12 * * 2", async () => {
    await sendTuesdayNotifications(io);
  });

  console.log("🕒 Tuesday notification scheduler initialized (runs 10:00 AM every Tuesday).");
}

module.exports = { startNotificationScheduler };
