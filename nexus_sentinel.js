import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pulseLog = path.join(__dirname, "fabric_v8_pulse.log");
const alertsLog = path.join(__dirname, "nexus_sentinel_alerts.log");
const restartScript = path.join(__dirname, "restart_nexus.ps1");

console.log("\x1b[36m[NEXUS-SENTINEL] Watchdog v8.2 Initialized...\x1b[0m");

const logToAlerts = (msg) => {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}\n`;
    fs.appendFileSync(alertsLog, entry);
    console.log(`\x1b[33m[SENTINEL-ALERT]\x1b[0m ${msg}`);
};

// 1. Log Monitoring (Patterns)
let lastSize = fs.existsSync(pulseLog) ? fs.statSync(pulseLog).size : 0;

setInterval(() => {
    if (!fs.existsSync(pulseLog)) return;
    const stats = fs.statSync(pulseLog);
    if (stats.size > lastSize) {
        const stream = fs.createReadStream(pulseLog, { start: lastSize });
        stream.on("data", (chunk) => {
            const lines = chunk.toString().split("\n");
            lines.forEach(line => {
                if (line.includes("Error 400") || line.includes("invalid_request_error")) {
                    logToAlerts(`⚠️ API Failure Detected (Relay Conflict): ${line.trim()}`);
                }
                if (line.includes("429") || line.includes("rate_limit")) {
                    logToAlerts("🚨 Rate Limit Exceeded - System slowing down for stability.");
                }
                if (line.includes("ECONNREFUSED") || line.includes("ETIMEDOUT")) {
                    logToAlerts("🔥 Connection Issue detected in Pulse Stream.");
                }
            });
        });
        lastSize = stats.size;
    }
}, 5000);

// 2. Heartbeat (HTTP)
let failureCount = 0;
const checkHeartbeat = async () => {
    try {
        const res = await fetch("http://localhost:3000", { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            if (failureCount > 0) logToAlerts("💚 System recovered successfully.");
            failureCount = 0;
        } else {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch (e) {
        failureCount++;
        logToAlerts(`💤 Heartbeat Failed (${failureCount}/3): ${e.message}`);
        
        if (failureCount >= 3) {
            logToAlerts("🚨 CRITICAL FAILURE: Initiating Atomic Reload via restart_nexus.ps1");
            exec(`powershell -ExecutionPolicy Bypass -File "${restartScript}"`, (err, stdout, stderr) => {
                if (err) logToAlerts(`❌ Reload Failed: ${err.message}`);
                else logToAlerts("🔄 Atomic Reload signal sent to system.");
            });
            failureCount = 0; // Reset after attempt
        }
    }
};

setInterval(checkHeartbeat, 30000); // 30s Heartbeat
checkHeartbeat(); // First check now

// 3. Periodic Health Scan Integration (v8.2 Pure-Core)
setInterval(() => {
    logToAlerts("ℹ️ Periodic Sentinel Health Check - Watchdog status: OK");
}, 3600000); // Hourly heartbeat to alerts log

logToAlerts("Sentinel background agent is now guarding ASA Nexus.");
