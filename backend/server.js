
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ==========================================
// DATABASE
// ==========================================

const db = new Database(path.join(__dirname, "sentinel.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collector_id TEXT UNIQUE NOT NULL,
    tenant_id INTEGER,
    collector_name TEXT NOT NULL,
    status TEXT DEFAULT 'offline',
    version TEXT DEFAULT '1.0.0',
    last_seen TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload_id TEXT UNIQUE NOT NULL,
    tenant_id INTEGER,
    collector_id TEXT,
    metric_type TEXT NOT NULL,
    metric_value REAL,
    severity TEXT DEFAULT 'info',
    summary TEXT,
    timestamp TEXT NOT NULL,
    received_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id TEXT UNIQUE NOT NULL,
    tenant_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'open',
    likely_cause TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS egress_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload_id TEXT NOT NULL,
    tenant_id INTEGER,
    collector_id TEXT,
    approved_fields TEXT NOT NULL,
    payload_preview TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    title TEXT NOT NULL,
    explanation TEXT,
    suggested_action TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS anomaly_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload_id TEXT NOT NULL,
    tenant_id INTEGER,
    collector_id TEXT,
    metric_type TEXT NOT NULL,
    metric_value REAL,
    rule_name TEXT NOT NULL,
    severity TEXT NOT NULL,
    explanation TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(payload_id, rule_name)
);
`);

// Safe migrations: existing database records are preserved.

function addColumnIfMissing(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();

    if (!columns.some(item => item.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

addColumnIfMissing("incidents", "collector_id", "TEXT");
addColumnIfMissing("incidents", "fingerprint", "TEXT");
addColumnIfMissing("incidents", "first_seen", "TEXT");
addColumnIfMissing("incidents", "last_seen", "TEXT");
addColumnIfMissing("incidents", "occurrence_count", "INTEGER DEFAULT 1");
addColumnIfMissing("incidents", "evidence_json", "TEXT");

addColumnIfMissing("recommendations", "incident_id", "TEXT");
addColumnIfMissing("recommendations", "fingerprint", "TEXT");

db.exec(`
CREATE INDEX IF NOT EXISTS idx_telemetry_collector
ON telemetry(collector_id, metric_type, id);

CREATE INDEX IF NOT EXISTS idx_incidents_status
ON incidents(status);

CREATE INDEX IF NOT EXISTS idx_anomaly_created
ON anomaly_events(created_at);
`);

db.prepare(`
INSERT OR IGNORE INTO tenants (id, tenant_name)
VALUES (1, 'Demo Environment')
`).run();

console.log("SQLite database connected.");
console.log("Database tables initialized.");
console.log("AIOps detection engine initialized.");

// ==========================================
// HELPERS
// ==========================================

function safeJson(value, fallback) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

// ==========================================
// AIOPS DETECTION ENGINE
// ==========================================

function detectAnomaly(metric, collectorId) {
    const type = metric.metric_type.toLowerCase();
    const value = metric.metric_value;

    // CPU
    if (type.includes("cpu") &&
        (type.includes("percent") || type.includes("usage") ||
         type.includes("utilization"))) {

        if (value >= 95) {
            return {
                rule: "critical_cpu",
                title: "Critical CPU utilization",
                severity: "critical",
                cause: "CPU utilization is extremely high.",
                explanation: `CPU usage reached ${value}%. This may affect application responsiveness.`,
                action: "Investigate resource-intensive processes and check for unexpected workloads."
            };
        }

        if (value >= 85) {
            return {
                rule: "high_cpu",
                title: "High CPU utilization",
                severity: "high",
                cause: "CPU utilization is above the configured warning level.",
                explanation: `CPU usage reached ${value}%, which may indicate resource pressure.`,
                action: "Review running processes and investigate recent workload changes."
            };
        }
    }

    // MEMORY
    if (type.includes("memory") &&
        (type.includes("percent") || type.includes("usage") ||
         type.includes("utilization"))) {

        if (value >= 95) {
            return {
                rule: "critical_memory",
                title: "Critical memory utilization",
                severity: "critical",
                cause: "Available memory may be insufficient.",
                explanation: `Memory usage reached ${value}%. Applications may experience memory pressure.`,
                action: "Investigate memory-heavy processes and check for possible memory leaks."
            };
        }

        if (value >= 90) {
            return {
                rule: "high_memory",
                title: "High memory utilization",
                severity: "high",
                cause: "Memory usage is above the configured warning level.",
                explanation: `Memory usage reached ${value}%.`,
                action: "Review application memory consumption and investigate unusual growth."
            };
        }
    }

    // DISK
    if (type.includes("disk") &&
        (type.includes("percent") || type.includes("usage") ||
         type.includes("utilization"))) {

        if (value >= 95) {
            return {
                rule: "critical_disk",
                title: "Critical disk utilization",
                severity: "critical",
                cause: "Disk capacity is nearly exhausted.",
                explanation: `Disk usage reached ${value}%. Storage exhaustion may interrupt services.`,
                action: "Investigate storage consumption and review approved cleanup options."
            };
        }

        if (value >= 90) {
            return {
                rule: "high_disk",
                title: "High disk utilization",
                severity: "high",
                cause: "Disk utilization is above the configured warning level.",
                explanation: `Disk usage reached ${value}%.`,
                action: "Review large files, logs and storage growth."
            };
        }
    }

    // NETWORK LATENCY
    if (type.includes("latency") || type.includes("response_time")) {
        if (value >= 1000) {
            return {
                rule: "critical_latency",
                title: "Critical network latency",
                severity: "critical",
                cause: "Network response time is extremely high.",
                explanation: `Observed latency is ${value} ms.`,
                action: "Investigate network connectivity, service response times and upstream dependencies."
            };
        }

        if (value >= 250) {
            return {
                rule: "high_latency",
                title: "High network latency",
                severity: "high",
                cause: "Network response time is above the configured threshold.",
                explanation: `Observed latency is ${value} ms.`,
                action: "Review network conditions and investigate slow upstream services."
            };
        }
    }

    // PACKET LOSS
    if (type.includes("packet_loss")) {
        if (value >= 10) {
            return {
                rule: "critical_packet_loss",
                title: "Critical packet loss",
                severity: "critical",
                cause: "A significant percentage of network packets are being lost.",
                explanation: `Packet loss reached ${value}%.`,
                action: "Investigate network connectivity, interface errors and network congestion."
            };
        }

        if (value >= 5) {
            return {
                rule: "high_packet_loss",
                title: "Network packet loss detected",
                severity: "high",
                cause: "Packet loss is above the configured threshold.",
                explanation: `Packet loss reached ${value}%.`,
                action: "Inspect network quality and check for connectivity issues."
            };
        }
    }

    // FAILED LOGIN ATTEMPTS
    if (type.includes("failed_login") ||
        type.includes("login_failure") ||
        type.includes("authentication_failure")) {

        if (value >= 10) {
            return {
                rule: "critical_failed_logins",
                title: "Repeated authentication failures",
                severity: "critical",
                cause: "A high number of failed authentication attempts was reported.",
                explanation: `${value} failed login attempts were reported. This may indicate suspicious authentication activity.`,
                action: "Review authentication logs locally and verify whether the activity is authorized."
            };
        }

        if (value >= 5) {
            return {
                rule: "high_failed_logins",
                title: "Multiple failed login attempts",
                severity: "high",
                cause: "Repeated authentication failures were reported.",
                explanation: `${value} failed login attempts were reported.`,
                action: "Review the authentication activity and check for unusual access patterns."
            };
        }
    }

    // ERROR RATE
    if (type.includes("error_rate") && value >= 10) {
        return {
            rule: "high_error_rate",
            title: "High application error rate",
            severity: "high",
            cause: "Application errors are occurring more frequently than expected.",
            explanation: `The reported error rate is ${value}%.`,
            action: "Review application error summaries and investigate recent service changes."
        };
    }

    // SERVICE AVAILABILITY
    if (type.includes("availability") && value === 0) {
        return {
            rule: "service_unavailable",
            title: "Service availability failure",
            severity: "critical",
            cause: "A monitored service reported unavailable status.",
            explanation: "The collector reported zero service availability.",
            action: "Verify the service state and inspect its local diagnostic logs."
        };
    }

    // Avoid applying generic baseline detection to metrics
    // that already have dedicated threshold rules.
    const thresholdMetric =
        type.includes("cpu") ||
        type.includes("memory") ||
        type.includes("disk") ||
        type.includes("latency") ||
        type.includes("response_time") ||
        type.includes("packet_loss") ||
        type.includes("failed_login") ||
        type.includes("login_failure") ||
        type.includes("authentication_failure") ||
        type.includes("error_rate") ||
        type.includes("availability");

    if (thresholdMetric) return null;

    // HISTORICAL BASELINE DETECTION
    const history = db.prepare(`
        SELECT metric_value
        FROM telemetry
        WHERE collector_id = ?
          AND metric_type = ?
          AND payload_id != ?
        ORDER BY id DESC
        LIMIT 20
    `).all(collectorId, metric.metric_type, metric.payload_id);

    if (history.length >= 10) {
        const values = history.map(row => row.metric_value);
        const average = values.reduce((sum, item) => sum + item, 0) / values.length;

        const variance = values.reduce(
            (sum, item) => sum + Math.pow(item - average, 2),
            0
        ) / values.length;

        const standardDeviation = Math.sqrt(variance);

        const unusualSpike =
            value > average + (3 * standardDeviation) &&
            value - average > Math.max(Math.abs(average) * 0.5, 1);

        if (unusualSpike) {
            return {
                rule: "statistical_spike",
                title: `Unusual ${metric.metric_type} behaviour`,
                severity: "medium",
                cause: "The current value is significantly above its recent historical baseline.",
                explanation: `Current value: ${value}. Recent average: ${average.toFixed(2)}. The value is more than three standard deviations above the baseline.`,
                action: "Investigate recent workload changes and compare this metric with related system activity."
            };
        }
    }

    return null;
}

// ==========================================
// INCIDENT MANAGEMENT
// ==========================================

function createOrUpdateIncident({
    tenantId,
    collectorId,
    fingerprint,
    title,
    severity,
    cause,
    explanation,
    metricType,
    metricValue
}) {
    const now = new Date().toISOString();

    const existing = db.prepare(`
        SELECT *
        FROM incidents
        WHERE fingerprint = ?
          AND tenant_id = ?
          AND status != 'resolved'
        ORDER BY id DESC
        LIMIT 1
    `).get(fingerprint, tenantId);

    if (existing) {
        const evidence = safeJson(existing.evidence_json, []);

        evidence.push({
            metric_type: metricType,
            metric_value: metricValue,
            timestamp: now
        });

        db.prepare(`
            UPDATE incidents
            SET last_seen = ?,
                occurrence_count = occurrence_count + 1,
                evidence_json = ?,
                severity = CASE
                    WHEN severity = 'critical' THEN severity
                    WHEN ? = 'critical' THEN 'critical'
                    WHEN ? = 'high' THEN 'high'
                    ELSE severity
                END
            WHERE id = ?
        `).run(
            now,
            JSON.stringify(evidence.slice(-30)),
            severity,
            severity,
            existing.id
        );

        return {
            id: existing.id,
            incident_id: existing.incident_id,
            created: false
        };
    }

    const incidentId = `INC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const evidence = [{
        metric_type: metricType,
        metric_value: metricValue,
        timestamp: now
    }];

    const result = db.prepare(`
        INSERT INTO incidents (
            incident_id, tenant_id, title, description,
            severity, status, likely_cause, collector_id,
            fingerprint, first_seen, last_seen,
            occurrence_count, evidence_json
        )
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 1, ?)
    `).run(
        incidentId,
        tenantId,
        title,
        explanation,
        severity,
        cause,
        collectorId,
        fingerprint,
        now,
        now,
        JSON.stringify(evidence)
    );

    return {
        id: result.lastInsertRowid,
        incident_id: incidentId,
        created: true
    };
}

function createRecommendation(incident, fingerprint, title, explanation, action, tenantId) {
    const existing = db.prepare(`
        SELECT id
        FROM recommendations
        WHERE fingerprint = ?
          AND tenant_id = ?
          AND status = 'pending'
        LIMIT 1
    `).get(fingerprint, tenantId);

    if (existing) return;

    db.prepare(`
        INSERT INTO recommendations (
            tenant_id, incident_id, fingerprint,
            title, explanation, suggested_action, status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(
        tenantId,
        incident.incident_id,
        fingerprint,
        title,
        explanation,
        action
    );
}

function recordAnomaly(metric, collectorId, tenantId, detection) {
    const inserted = db.prepare(`
        INSERT OR IGNORE INTO anomaly_events (
            payload_id, tenant_id, collector_id,
            metric_type, metric_value, rule_name,
            severity, explanation
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        metric.payload_id,
        tenantId,
        collectorId,
        metric.metric_type,
        metric.metric_value,
        detection.rule,
        detection.severity,
        detection.explanation
    );

    if (inserted.changes === 0) return null;

    // FIX: fingerprint now includes the metric type.
    // Different metrics will no longer merge into one incident.
    const fingerprint =
        `${collectorId}:${metric.metric_type}:${detection.rule}`;

    const incident = createOrUpdateIncident({
        tenantId,
        collectorId,
        fingerprint,
        title: detection.title,
        severity: detection.severity,
        cause: detection.cause,
        explanation: detection.explanation,
        metricType: metric.metric_type,
        metricValue: metric.metric_value
    });

    createRecommendation(
        incident,
        fingerprint,
        detection.title,
        detection.explanation,
        detection.action,
        tenantId
    );

    return {
        rule: detection.rule,
        title: detection.title,
        severity: detection.severity,
        incident_id: incident.incident_id,
        created: incident.created,
        metric_type: metric.metric_type
    };
}

// ==========================================
// CORRELATION ENGINE
// ==========================================

function correlateAnomalies(signals, collectorId, tenantId) {
    const uniqueTypes = [...new Set(
        signals.map(item => item.metric_type)
    )];

    if (uniqueTypes.length < 2) return null;

    // FIX: correlation fingerprint uses metric type + rule.
    const signalKeys = [
        ...new Set(
            signals.map(item => `${item.metric_type}:${item.rule}`)
        )
    ].sort();

    const fingerprint =
        `${collectorId}:correlated:${signalKeys.join("|")}`;

    const severity = signals.some(item => item.severity === "critical")
        ? "critical"
        : signals.some(item => item.severity === "high")
            ? "high"
            : "medium";

    const title = "Correlated system anomalies";

    const explanation =
        `Multiple unusual signals were detected from the same collector: ${uniqueTypes.join(", ")}. ` +
        "These events may share a common underlying cause and should be investigated together.";

    const cause =
        "Multiple resource or service indicators changed together. A shared workload, infrastructure or connectivity issue may be responsible.";

    const incident = createOrUpdateIncident({
        tenantId,
        collectorId,
        fingerprint,
        title,
        severity,
        cause,
        explanation,
        metricType: "correlated_events",
        metricValue: signals.length
    });

    createRecommendation(
        incident,
        fingerprint,
        "Investigate correlated system behaviour",
        explanation,
        "Compare the affected metrics and their timestamps. Investigate shared dependencies before treating each alert independently.",
        tenantId
    );

    return incident;
}

// ==========================================
// HEALTH API
// ==========================================

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "SENTINEL backend connected",
        database: "connected",
        aiops: "active",
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// TELEMETRY INGESTION
// ==========================================

app.post("/api/telemetry", (req, res) => {
    try {
        const {
            collector_id,
            collector_name,
            version = "1.0.0",
            tenant_id = 1,
            metrics,
            approved_fields = []
        } = req.body;

        if (
            !collector_id ||
            typeof collector_id !== "string" ||
            !Array.isArray(metrics) ||
            metrics.length === 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid telemetry payload"
            });
        }

        if (metrics.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Maximum 100 metrics per request"
            });
        }

        if (!Number.isInteger(Number(tenant_id)) || Number(tenant_id) < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid tenant ID"
            });
        }

        const safeTenantId = Number(tenant_id);

        const saveCollector = db.prepare(`
            INSERT INTO collectors
            (collector_id, tenant_id, collector_name, status, version, last_seen)
            VALUES (?, ?, ?, 'online', ?, ?)
            ON CONFLICT(collector_id) DO UPDATE SET
                status = 'online',
                last_seen = excluded.last_seen,
                version = excluded.version
            WHERE collectors.tenant_id = excluded.tenant_id
        `);

        const saveMetric = db.prepare(`
            INSERT OR IGNORE INTO telemetry
            (payload_id, tenant_id, collector_id, metric_type,
             metric_value, severity, summary, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const saveEgress = db.prepare(`
            INSERT INTO egress_logs
            (payload_id, tenant_id, collector_id, approved_fields, payload_preview)
            VALUES (?, ?, ?, ?, ?)
        `);

        const processPayload = db.transaction(() => {
            const now = new Date().toISOString();

            saveCollector.run(
                collector_id,
                safeTenantId,
                String(collector_name || "SENTINEL Collector").slice(0, 100),
                String(version).slice(0, 30),
                now
            );

            const registeredCollector = db.prepare(`
                SELECT tenant_id
                FROM collectors
                WHERE collector_id = ?
            `).get(collector_id);

            if (!registeredCollector ||
                registeredCollector.tenant_id !== safeTenantId) {
                throw new Error("Collector tenant mismatch");
            }

            let accepted = 0;
            let anomalyCount = 0;
            let incidentsCreated = 0;
            const detectedSignals = [];

            for (const metric of metrics) {
                if (
                    !metric.payload_id ||
                    typeof metric.payload_id !== "string" ||
                    !metric.metric_type ||
                    typeof metric.metric_value !== "number" ||
                    !Number.isFinite(metric.metric_value) ||
                    !metric.timestamp ||
                    Number.isNaN(Date.parse(metric.timestamp))
                ) {
                    throw new Error("Invalid metric received");
                }

                const safeMetric = {
                    payload_id: metric.payload_id.slice(0, 100),
                    metric_type: String(metric.metric_type).slice(0, 60),
                    metric_value: metric.metric_value,
                    severity: ["info", "low", "medium", "high", "critical"]
                        .includes(metric.severity) ? metric.severity : "info",
                    summary: typeof metric.summary === "string"
                        ? metric.summary.slice(0, 250) : "",
                    timestamp: String(metric.timestamp)
                };

                const result = saveMetric.run(
                    safeMetric.payload_id,
                    safeTenantId,
                    collector_id,
                    safeMetric.metric_type,
                    safeMetric.metric_value,
                    safeMetric.severity,
                    safeMetric.summary,
                    safeMetric.timestamp
                );

                if (result.changes === 0) continue;

                accepted++;

                // Record the structured metadata payload.
                saveEgress.run(
                    safeMetric.payload_id,
                    safeTenantId,
                    collector_id,
                    JSON.stringify(
                        Array.isArray(approved_fields)
                            ? approved_fields.slice(0, 30)
                            : []
                    ),
                    JSON.stringify(safeMetric)
                );

                const detection = detectAnomaly(safeMetric, collector_id);

                if (detection) {
                    const signal = recordAnomaly(
                        safeMetric,
                        collector_id,
                        safeTenantId,
                        detection
                    );

                    if (signal) {
                        anomalyCount++;
                        if (signal.created) incidentsCreated++;

                        detectedSignals.push(signal);
                    }
                }
            }

            const correlatedIncident = correlateAnomalies(
                detectedSignals,
                collector_id,
                safeTenantId
            );

            return {
                accepted,
                anomalyCount,
                incidentsCreated,
                correlated: Boolean(correlatedIncident)
            };
        });

        const result = processPayload();

        res.status(201).json({
            success: true,
            received: metrics.length,
            accepted: result.accepted,
            duplicates_ignored: metrics.length - result.accepted,
            anomalies_detected: result.anomalyCount,
            new_incidents: result.incidentsCreated,
            correlation_detected: result.correlated
        });

    } catch (error) {
        console.error("Telemetry error:", error.message);

        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// ==========================================
// DASHBOARD DATA APIs
// ==========================================

app.get("/api/metrics", (req, res) => {
    const data = db.prepare(`
        SELECT *
        FROM telemetry
        ORDER BY id DESC
        LIMIT 100
    `).all();

    res.json({ success: true, data });
});

// A collector is only reported online while its telemetry is recent.
// Status is derived from the real last_seen timestamp instead of the
// value stored at ingestion time, which would stay 'online' forever.
const COLLECTOR_OFFLINE_AFTER_MS = 20000;

app.get("/api/collectors", (req, res) => {
    const rows = db.prepare(`
        SELECT *
        FROM collectors
        ORDER BY id DESC
    `).all();

    const now = Date.now();

    const data = rows.map((row) => {
        const lastSeen = row.last_seen ? Date.parse(row.last_seen) : NaN;
        const stale =
            !Number.isFinite(lastSeen) ||
            now - lastSeen > COLLECTOR_OFFLINE_AFTER_MS;

        return { ...row, status: stale ? "offline" : "online" };
    });

    res.json({ success: true, data });
});

app.get("/api/incidents", (req, res) => {
    const data = db.prepare(`
        SELECT *
        FROM incidents
        ORDER BY id DESC
    `).all();

    res.json({ success: true, data });
});

app.get("/api/egress", (req, res) => {
    const data = db.prepare(`
        SELECT *
        FROM egress_logs
        ORDER BY id DESC
        LIMIT 100
    `).all();

    res.json({ success: true, data });
});

app.get("/api/recommendations", (req, res) => {
    const data = db.prepare(`
        SELECT *
        FROM recommendations
        ORDER BY id DESC
    `).all();

    res.json({ success: true, data });
});

// ==========================================
// AIOPS APIs
// ==========================================

app.get("/api/anomalies", (req, res) => {
    const data = db.prepare(`
        SELECT *
        FROM anomaly_events
        ORDER BY id DESC
        LIMIT 100
    `).all();

    res.json({
        success: true,
        total: data.length,
        data
    });
});

app.get("/api/aiops/summary", (req, res) => {
    const incidents = db.prepare(`
        SELECT severity, status, COUNT(*) AS count
        FROM incidents
        GROUP BY severity, status
    `).all();

    const anomalies = db.prepare(`
        SELECT COUNT(*) AS count
        FROM anomaly_events
    `).get();

    const recommendations = db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM recommendations
        GROUP BY status
    `).all();

    const openIncidents = db.prepare(`
        SELECT COUNT(*) AS count
        FROM incidents
        WHERE status != 'resolved'
    `).get();

    res.json({
        success: true,
        engine: "SENTINEL Explainable AIOps Engine",
        detection_method: "Threshold and historical-baseline heuristics",
        total_anomalies: anomalies.count,
        open_incidents: openIncidents.count,
        incident_breakdown: incidents,
        recommendation_breakdown: recommendations,
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// INCIDENT ACTIONS
// ==========================================

app.patch("/api/incidents/:id/status", (req, res) => {
    const { status } = req.body;

    if (!["open", "acknowledged", "resolved"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Invalid incident status"
        });
    }

    const result = db.prepare(`
        UPDATE incidents
        SET status = ?
        WHERE id = ?
    `).run(status, req.params.id);

    if (!result.changes) {
        return res.status(404).json({
            success: false,
            message: "Incident not found"
        });
    }

    res.json({
        success: true,
        message: `Incident marked ${status}`
    });
});

app.patch("/api/recommendations/:id/status", (req, res) => {
    const { status } = req.body;

    if (!["pending", "approved", "dismissed", "completed"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Invalid recommendation status"
        });
    }

    const result = db.prepare(`
        UPDATE recommendations
        SET status = ?
        WHERE id = ?
    `).run(status, req.params.id);

    if (!result.changes) {
        return res.status(404).json({
            success: false,
            message: "Recommendation not found"
        });
    }

    res.json({
        success: true,
        message: `Recommendation marked ${status}`
    });
});

// ==========================================
// SERVE THE SINGLE DASHBOARD
// ==========================================

const frontendPath = path.join(__dirname, "../frontend/dist");
const indexPath = path.join(frontendPath, "index.html");

if (fs.existsSync(indexPath)) {
    app.use(express.static(frontendPath));
} else {
    console.warn("WARNING: Frontend build not found. Build frontend first.");
}

app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "API route not found"
    });
});

app.use((req, res) => {
    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    res.status(503).send(
        "SENTINEL frontend is not built yet. Run npm run build inside the frontend folder."
    );
});

// ==========================================
// START SERVER
// ==========================================

const server = app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("==================================");
    console.log("       SENTINEL PLATFORM");
    console.log("==================================");
    console.log("Backend: CONNECTED");
    console.log("Database: CONNECTED");
    console.log("AIOps Engine: ACTIVE");
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log("==================================");
    console.log("");
});

server.on("error", (error) => {
    console.error("SERVER ERROR:", error.message);
    process.exit(1);
});
