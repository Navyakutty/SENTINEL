import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, LayoutDashboard, Server, ShieldCheck, AlertTriangle,
  BrainCircuit, Radio, RefreshCw, Cpu, HardDrive, MemoryStick,
  Menu, X, Clock3, CheckCircle2, CircleAlert, ArrowUpRight,
  Database, LockKeyhole, Zap, TrendingUp, Network, Eye,
  Gauge, Sparkles
} from "lucide-react";
import "./index.css";

const API = "/api";
const REFRESH_INTERVAL = 2000;

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "monitoring", label: "Monitoring", icon: Activity },
  { id: "collectors", label: "Collectors", icon: Server },
  { id: "incidents", label: "Incidents", icon: AlertTriangle },
  { id: "egress", label: "Egress Proof", icon: ShieldCheck },
  { id: "aiops", label: "AIOps Insights", icon: BrainCircuit }
];

function formatTime(value) {
  if (!value) return "Waiting for data";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function metricMatches(metric, names) {
  const type = String(metric?.metric_type || "").toLowerCase();
  return names.some((name) => type === name || type.includes(name));
}

function newestFirst(items) {
  return [...items].sort((a, b) => {
    const timeA = new Date(a.timestamp || a.created_at || 0).getTime();
    const timeB = new Date(b.timestamp || b.created_at || 0).getTime();
    return timeB - timeA;
  });
}

function MetricCard({ title, value, unit, icon: Icon, description, tone = "" }) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{title}</span>
        <span className={`metric-icon ${tone}`}><Icon size={19} /></span>
      </div>
      <div className="metric-value">{value}<small>{unit}</small></div>
      <div className="metric-description">{description}</div>
    </div>
  );
}

function EmptyState({ icon: Icon = Database, title, message }) {
  return (
    <div className="empty-state">
      <Icon size={30} />
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function DataTable({ columns, rows, emptyTitle, emptyMessage }) {
  if (!rows.length) {
    return <EmptyState title={emptyTitle} message={emptyMessage} />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? row.payload_id ?? row.collector_id ?? row.incident_id ?? index}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row) : (row[column.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }) {
  const value = String(status || "unknown").toLowerCase();
  const good = ["online", "open", "healthy", "connected", "info", "recorded", "selected", "active"].includes(value);
  const bad = ["critical", "high", "offline", "poor", "rejected"].includes(value);

  return (
    <span className={`status-pill ${good ? "good" : bad ? "bad" : "warning"}`}>
      <span className="status-dot" />{status || "Unknown"}
    </span>
  );
}

function severityColor(severity) {
  const value = String(severity || "").toLowerCase();
  if (value === "critical") return "#ff5b67";
  if (value === "high") return "#ff914d";
  if (value === "medium") return "#e7b65b";
  return "#8c9aaf";
}

function SummaryCard({ label, value, icon: Icon, color, note }) {
  return (
    <div className="metric-card" style={{ minHeight: 125 }}>
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon" style={{ color, background: `${color}18` }}>
          <Icon size={19} />
        </span>
      </div>
      <div className="metric-value">{value ?? "—"}</div>
      <div className="metric-description">{note}</div>
    </div>
  );
}

/* LIVE TELEMETRY GRAPH */

function LiveMetricChart({ title, unit, color, metrics, matches }) {
  const readings = metrics
    .filter((item) => {
      const type = String(item.metric_type || "").toLowerCase();
      return matches.some((name) => type.includes(name));
    })
    .filter((item) => Number.isFinite(Number(item.metric_value)))
    .slice()
    .sort((a, b) => {
      return new Date(a.timestamp || 0).getTime() -
        new Date(b.timestamp || 0).getTime();
    })
    .slice(-30);

  const width = 700;
  const height = 230;
  const left = 48;
  const right = 680;
  const top = 24;
  const bottom = 175;

  const values = readings.map((item) => Number(item.metric_value));
  const maxValue = Math.max(1, ...values);
  const minValue = Math.min(0, ...values);
  const range = Math.max(1, maxValue - minValue);

  const points = values.map((value, index) => ({
    value,
    item: readings[index],
    x: values.length === 1
      ? (left + right) / 2
      : left + (index / (values.length - 1)) * (right - left),
    y: bottom - ((value - minValue) / range) * (bottom - top)
  }));

  const linePath = points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
    )
    .join(" ");

  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x} ${bottom} L ${points[0].x} ${bottom} Z`
    : "";

  const latest = readings[readings.length - 1];

  return (
    <section
      className="panel"
      style={{
        minWidth: 0,
        overflow: "hidden",
        padding: "20px"
      }}
    >
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>Last {readings.length} received measurements</p>
        </div>
        <span style={{
          color,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "1px"
        }}>
          ● LIVE
        </span>
      </div>

      <div style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        margin: "14px 0 5px"
      }}>
        <strong style={{
          fontSize: 30,
          letterSpacing: "-1px",
          color
        }}>
          {latest ? Number(latest.metric_value).toFixed(2) : "—"}
        </strong>
        <span style={{
          color: "var(--text-muted, #999)",
          fontSize: 12
        }}>
          {unit}
        </span>
      </div>

      {readings.length > 0 ? (
        <div style={{ width: "100%", marginTop: 10 }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${title} live telemetry graph`}
            style={{
              width: "100%",
              height: "auto",
              overflow: "visible"
            }}
          >
            <defs>
              <linearGradient
                id={`gradient-${title.replace(/\s/g, "-")}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color} stopOpacity="0.30" />
                <stop offset="100%" stopColor={color} stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {[0, 1, 2, 3].map((index) => {
              const y = top + (index / 3) * (bottom - top);

              return (
                <g key={index}>
                  <line
                    x1={left}
                    y1={y}
                    x2={right}
                    y2={y}
                    stroke="currentColor"
                    opacity="0.13"
                    strokeDasharray="4 6"
                  />
                  <text
                    x="39"
                    y={y + 4}
                    textAnchor="end"
                    fontSize="10"
                    fill="currentColor"
                    opacity="0.55"
                  >
                    {(maxValue - (index / 3) * range).toFixed(0)}
                  </text>
                </g>
              );
            })}

            <path
              d={areaPath}
              fill={`url(#gradient-${title.replace(/\s/g, "-")})`}
            />

            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {points.map((point, index) => (
              <circle
                key={`${title}-${index}`}
                cx={point.x}
                cy={point.y}
                r={index === points.length - 1 ? 5 : 2.5}
                fill={color}
                stroke="var(--panel-bg, #171b25)"
                strokeWidth="2"
              >
                <title>
                  {`${point.value.toFixed(2)} ${unit} · ${formatTime(point.item.timestamp)}`}
                </title>
              </circle>
            ))}

            <text
              x={left}
              y="207"
              fontSize="10"
              fill="currentColor"
              opacity="0.55"
            >
              Oldest
            </text>

            <text
              x={right}
              y="207"
              textAnchor="end"
              fontSize="10"
              fill="currentColor"
              opacity="0.55"
            >
              Latest
            </text>
          </svg>
        </div>
      ) : (
        <div style={{
          height: 145,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted, #999)",
          fontSize: 13,
          textAlign: "center"
        }}>
          Waiting for {title.toLowerCase()} telemetry...
        </div>
      )}

      <div style={{
        borderTop: "1px solid var(--border-color, #303746)",
        paddingTop: 10,
        marginTop: 8,
        color: "var(--text-muted, #999)",
        fontSize: 11
      }}>
        {latest
          ? `Latest reading: ${formatTime(latest.timestamp)}`
          : "No readings received yet"}
      </div>
    </section>
  );
}

/* NEW FEATURE 1: LIVE SYSTEM HEALTH SCORE */

function SystemHealthScore({ backendOnline, cpu, memory, disk, collectors }) {
  const readings = [
    { name: "CPU", metric: cpu },
    { name: "Memory", metric: memory },
    { name: "Disk", metric: disk }
  ].filter(({ metric }) =>
    metric && Number.isFinite(Number(metric.metric_value))
  );

  const onlineCount = collectors.filter(
    (collector) => String(collector.status || "").toLowerCase() === "online"
  ).length;

  const hasCollectorData = collectors.length > 0;

  if (!backendOnline) {
    return (
      <section className="panel page-panel">
        <div className="panel-heading">
          <div>
            <h3>Live System Health Score</h3>
            <p>Estimated health based on current system telemetry</p>
          </div>
          <Gauge size={21} className="muted-icon" />
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "18px 0"
        }}>
          <div style={{
            width: 100,
            height: 100,
            borderRadius: "50%",
            border: "7px solid #ff647c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0
          }}>
            <CircleAlert size={34} color="#ff647c" />
          </div>
          <div>
            <strong style={{ fontSize: 22 }}>Offline</strong>
            <p style={{ color: "var(--text-muted, #999)", marginTop: 6 }}>
              The backend is unavailable. A health score cannot currently be calculated.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!readings.length) {
    return (
      <section className="panel page-panel">
        <div className="panel-heading">
          <div>
            <h3>Live System Health Score</h3>
            <p>Estimated health based on current system telemetry</p>
          </div>
          <Gauge size={21} className="muted-icon" />
        </div>

        <EmptyState
          icon={Activity}
          title="Waiting for telemetry"
          message="The health score will appear after CPU, memory or disk readings arrive."
        />
      </section>
    );
  }

  const averageUtilization =
    readings.reduce((total, item) => {
      return total + Math.max(0, Math.min(100, Number(item.metric.metric_value)));
    }, 0) / readings.length;

  const resourceScore = 100 - averageUtilization;

  const score = Math.round(
    hasCollectorData
      ? resourceScore * 0.65 +
        (onlineCount / collectors.length) * 100 * 0.35
      : resourceScore
  );

  const safeScore = Math.max(0, Math.min(100, score));

  const scoreColor =
    safeScore >= 80 ? "#2dd4bf" :
    safeScore >= 60 ? "#e7b65b" :
    "#ff647c";

  const scoreLabel =
    safeScore >= 80 ? "Healthy" :
    safeScore >= 60 ? "Moderate" :
    "Needs Attention";

  const circumference = 2 * Math.PI * 42;
  const dashOffset = circumference - (safeScore / 100) * circumference;

  return (
    <section className="panel page-panel">
      <div className="panel-heading">
        <div>
          <h3>Live System Health Score</h3>
          <p>Estimated score from resource utilization and collector availability</p>
        </div>
        <Gauge size={21} className="muted-icon" />
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(130px, 180px) 1fr",
        gap: 25,
        alignItems: "center",
        padding: "20px 0"
      }}>
        <div style={{
          position: "relative",
          width: 150,
          height: 150,
          margin: "auto"
        }}>
          <svg viewBox="0 0 100 100" width="100%" height="100%">
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.10"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={scoreColor}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset 0.5s ease" }}
            />
          </svg>

          <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <strong style={{ fontSize: 36, lineHeight: 1 }}>
              {safeScore}
            </strong>
            <span style={{
              fontSize: 10,
              color: "var(--text-muted, #999)",
              marginTop: 5
            }}>
              OUT OF 100
            </span>
          </div>
        </div>

        <div>
          <strong style={{
            fontSize: 23,
            color: scoreColor
          }}>
            {scoreLabel}
          </strong>

          <p style={{
            color: "var(--text-muted, #999)",
            fontSize: 12,
            marginTop: 7,
            marginBottom: 18
          }}>
            Based on {readings.length} available resource metric(s).
          </p>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 12
          }}>
            {readings.map(({ name, metric }) => (
              <div
                key={name}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: "rgba(128,128,128,0.06)",
                  border: "1px solid var(--border-color, #303746)"
                }}
              >
                <span style={{
                  display: "block",
                  fontSize: 11,
                  color: "var(--text-muted, #999)"
                }}>
                  {name} Usage
                </span>
                <strong style={{ fontSize: 19 }}>
                  {Number(metric.metric_value).toFixed(1)}%
                </strong>
              </div>
            ))}

            <div style={{
              padding: 12,
              borderRadius: 10,
              background: "rgba(128,128,128,0.06)",
              border: "1px solid var(--border-color, #303746)"
            }}>
              <span style={{
                display: "block",
                fontSize: 11,
                color: "var(--text-muted, #999)"
              }}>
                Online Collectors
              </span>
              <strong style={{ fontSize: 19 }}>
                {onlineCount}/{collectors.length}
              </strong>
            </div>
          </div>
        </div>
      </div>

      <div className="privacy-note">
        <Activity size={16} />
        <span>
          Prototype estimate: resource utilization and collector availability
          are weighted to calculate this score. It is not a formal reliability
          or service-level measurement.
        </span>
      </div>
    </section>
  );
}

/* NEW FEATURE 2: INCIDENT CORRELATION TIMELINE */

function CorrelationTimeline({ metrics, incidents }) {
  const timelineItems = [
    ...metrics.map((metric, index) => ({
      id: `metric-${metric.payload_id || metric.id || index}`,
      type: "telemetry",
      title: metric.metric_type || "System metric",
      description: `Recorded value: ${metric.metric_value ?? "—"}${
        metric.collector_id ? ` · Collector: ${metric.collector_id}` : ""
      }`,
      timestamp: metric.timestamp,
      value: metric.metric_value,
      severity: metric.severity
    })),

    ...incidents.map((incident, index) => ({
      id: `incident-${incident.incident_id || incident.id || index}`,
      type: "incident",
      title: incident.title || "Incident detected",
      description:
        incident.description ||
        incident.likely_cause ||
        "Incident recorded by SENTINEL.",
      timestamp: incident.last_seen || incident.created_at,
      severity: incident.severity,
      status: incident.status
    }))
  ]
    .map((item) => ({
      ...item,
      parsedTime: new Date(item.timestamp || 0).getTime()
    }))
    .filter((item) => Number.isFinite(item.parsedTime) && item.parsedTime > 0)
    .sort((a, b) => b.parsedTime - a.parsedTime)
    .slice(0, 15);

  return (
    <section className="panel page-panel">
      <div className="panel-heading">
        <div>
          <h3>Incident Correlation Timeline</h3>
          <p>Recent telemetry readings and incidents in chronological order</p>
        </div>
        <Network size={21} className="muted-icon" />
      </div>

      {timelineItems.length ? (
        <div style={{
          display: "grid",
          gap: 0,
          padding: "12px 0"
        }}>
          {timelineItems.map((item, index) => {
            const isIncident = item.type === "incident";
            const itemColor = isIncident
              ? severityColor(item.severity)
              : "#60a5fa";

            return (
              <div
                key={item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px minmax(0, 1fr)",
                  gap: 13,
                  position: "relative",
                  minHeight: 90
                }}
              >
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center"
                }}>
                  <div style={{
                    width: 27,
                    height: 27,
                    borderRadius: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `${itemColor}20`,
                    color: itemColor,
                    border: `1px solid ${itemColor}55`,
                    zIndex: 1
                  }}>
                    {isIncident
                      ? <AlertTriangle size={14} />
                      : <Activity size={14} />}
                  </div>

                  {index !== timelineItems.length - 1 && (
                    <div style={{
                      width: 1,
                      flex: 1,
                      minHeight: 45,
                      background: "var(--border-color, #303746)"
                    }} />
                  )}
                </div>

                <div style={{
                  padding: "2px 0 20px",
                  minWidth: 0
                }}>
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 6
                  }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 8
                    }}>
                      <strong style={{ fontSize: 13 }}>
                        {item.title}
                      </strong>

                      <span style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.8px",
                        padding: "4px 7px",
                        borderRadius: 5,
                        color: itemColor,
                        background: `${itemColor}18`
                      }}>
                        {isIncident ? "INCIDENT" : "TELEMETRY"}
                      </span>
                    </div>

                    {isIncident && (
                      <StatusPill status={item.severity} />
                    )}
                  </div>

                  <p style={{
                    fontSize: 12,
                    color: "var(--text-muted, #999)",
                    lineHeight: 1.6,
                    margin: "0 0 6px",
                    overflowWrap: "anywhere"
                  }}>
                    {item.description}
                  </p>

                  <span style={{
                    fontSize: 10,
                    color: "var(--text-muted, #999)"
                  }}>
                    <Clock3
                      size={11}
                      style={{
                        display: "inline",
                        verticalAlign: "middle",
                        marginRight: 5
                      }}
                    />
                    {formatTime(item.timestamp)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Clock3}
          title="No timeline events yet"
          message="Telemetry and incident events will appear here when received."
        />
      )}

      <div className="privacy-note">
        <Eye size={16} />
        <span>
          Events are ordered by timestamp. Events appearing close together
          indicate temporal proximity, not proof that one event caused another.
        </span>
      </div>
    </section>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [metrics, setMetrics] = useState([]);
  const [collectors, setCollectors] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [egress, setEgress] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [aiopsSummary, setAiopsSummary] = useState(null);
  const [anomalies, setAnomalies] = useState([]);

  const refreshInProgress = useRef(false);

  async function loadDashboard() {
    if (refreshInProgress.current) return;

    refreshInProgress.current = true;

    try {
      const endpoints = [
        "health",
        "metrics",
        "collectors",
        "incidents",
        "egress",
        "recommendations"
      ];

      const responses = await Promise.all(
        endpoints.map(async (endpoint) => {
          const response = await fetch(`${API}/${endpoint}`, {
            method: "GET",
            cache: "no-store",
            headers: {
              "Cache-Control": "no-cache",
              "Pragma": "no-cache"
            }
          });

          if (!response.ok) {
            throw new Error(`${endpoint} returned ${response.status}`);
          }

          return response.json();
        })
      );

      const [
        health,
        metricData,
        collectorData,
        incidentData,
        egressData,
        recommendationData
      ] = responses;

      if (!health.success) {
        throw new Error("Backend health check failed");
      }

      setBackendOnline(true);
      setMetrics(newestFirst(metricData.data || []));
      setCollectors(collectorData.data || []);
      setIncidents(incidentData.data || []);
      setEgress(egressData.data || []);
      setRecommendations(recommendationData.data || []);

      const optionalResults = await Promise.allSettled([
        fetch(`${API}/aiops/summary`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" }
        }).then((response) => {
          if (!response.ok) throw new Error("AIOps summary unavailable");
          return response.json();
        }),

        fetch(`${API}/anomalies`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" }
        }).then((response) => {
          if (!response.ok) throw new Error("Anomaly data unavailable");
          return response.json();
        })
      ]);

      if (optionalResults[0].status === "fulfilled") {
        setAiopsSummary(optionalResults[0].value);
      }

      if (optionalResults[1].status === "fulfilled") {
        setAnomalies(optionalResults[1].value.data || []);
      }

      setLastUpdated(new Date());
      setError("");
    } catch (err) {
      setBackendOnline(false);
      setError(err.message || "Unable to connect to the backend");
    } finally {
      setLoading(false);
      refreshInProgress.current = false;
    }
  }

  useEffect(() => {
    loadDashboard();

    const timer = setInterval(() => {
      loadDashboard();
    }, REFRESH_INTERVAL);

    return () => clearInterval(timer);
  }, []);

  const latestMetric = (names) =>
    metrics.find((item) => metricMatches(item, names));

  const cpu = latestMetric(["cpu_usage", "cpu"]);
  const memory = latestMetric(["memory_usage", "memory"]);
  const disk = latestMetric(["disk_usage", "disk"]);

  const onlineCollectors = collectors.filter(
    (collector) => collector.status?.toLowerCase() === "online"
  ).length;

  const unresolvedIncidents = incidents.filter(
    (incident) => String(incident.status || "").toLowerCase() !== "resolved"
  ).length;

  const openIncidents = incidents.filter(
    (incident) => incident.status?.toLowerCase() === "open"
  ).length;

  const correlatedIncidents = incidents.filter(
    (incident) => String(incident.fingerprint || "").includes(":correlated:")
  );

  const metricHistory = useMemo(() => {
    const types = [
      { key: "cpu", names: ["cpu_usage", "cpu"] },
      { key: "memory", names: ["memory_usage", "memory"] },
      { key: "disk", names: ["disk_usage", "disk"] }
    ];

    return types.map(({ key, names }) => ({
      type: key,
      values: metrics
        .filter((metric) => metricMatches(metric, names))
        .slice(0, 12)
        .reverse()
    }));
  }, [metrics]);

  const pageTitle =
    navigation.find((item) => item.id === activePage)?.label || "Overview";

  function renderOverview() {
    return (
      <>
        <div className="welcome-row">
          <div>
            <div className="eyebrow">SYSTEM OVERVIEW</div>
            <h2>Command Center</h2>
            <p>Real-time visibility across your monitored environment.</p>
          </div>
          <button className="refresh-button" onClick={loadDashboard}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <div className="metric-grid">
          <MetricCard title="CPU Usage" value={cpu ? Number(cpu.metric_value).toFixed(1) : "—"} unit={cpu ? "%" : ""} icon={Cpu} description="Latest reported utilization" tone="red" />
          <MetricCard title="Memory Usage" value={memory ? Number(memory.metric_value).toFixed(1) : "—"} unit={memory ? "%" : ""} icon={MemoryStick} description="Latest reported utilization" tone="purple" />
          <MetricCard title="Disk Usage" value={disk ? Number(disk.metric_value).toFixed(1) : "—"} unit={disk ? "%" : ""} icon={HardDrive} description="Latest reported utilization" tone="orange" />
          <MetricCard title="Online Collectors" value={onlineCollectors} unit={`/ ${collectors.length}`} icon={Radio} description="Connected local agents" tone="green" />
        </div>

        <div className="content-grid">
          <section className="panel large-panel">
            <div className="panel-heading">
              <div>
                <h3>Resource Utilization</h3>
                <p>Recent telemetry received by SENTINEL</p>
              </div>
              <span className="live-label"><span /> LIVE</span>
            </div>

            <div className="resource-list">
              {metricHistory.map(({ type, values }) => {
                const latest = values[values.length - 1];
                const value = latest
                  ? Math.max(0, Math.min(100, Number(latest.metric_value)))
                  : 0;

                return (
                  <div className="resource-row" key={type}>
                    <div className="resource-label">
                      <span>{type.toUpperCase()}</span>
                      <strong>{latest ? `${value.toFixed(1)}%` : "No data"}</strong>
                    </div>
                    <div className="progress-track">
                      <div className={`progress-fill ${type}`} style={{ width: `${value}%` }} />
                    </div>
                    <div className="mini-bars">
                      {values.length ? values.map((item, index) => (
                        <span
                          key={item.payload_id || index}
                          style={{
                            height: `${Math.max(5, Math.min(100, Number(item.metric_value)))}%`
                          }}
                        />
                      )) : <span className="no-bars">Waiting for collector telemetry</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Platform Health</h3>
                <p>Connection and service status</p>
              </div>
              <Activity size={19} className="muted-icon" />
            </div>

            <div className="health-summary">
              <div className={`health-orb ${backendOnline ? "online" : "offline"}`}>
                {backendOnline ? <CheckCircle2 size={30} /> : <CircleAlert size={30} />}
              </div>
              <strong>{backendOnline ? "Systems Connected" : "Connection Lost"}</strong>
              <span>
                {backendOnline
                  ? "Backend and database are responding."
                  : "Unable to retrieve platform data."}
              </span>
            </div>

            <div className="health-line">
              <span>Backend API</span>
              <StatusPill status={backendOnline ? "Online" : "Offline"} />
            </div>
            <div className="health-line">
              <span>Database</span>
              <StatusPill status={backendOnline ? "Connected" : "Unknown"} />
            </div>
            <div className="health-line">
              <span>Collectors</span>
              <strong>{onlineCollectors} online</strong>
            </div>
            <div className="health-line">
              <span>Last updated</span>
              <span>{lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}</span>
            </div>
          </section>
        </div>

        {/* NEW: LIVE SYSTEM HEALTH SCORE */}
        <SystemHealthScore
          backendOnline={backendOnline}
          cpu={cpu}
          memory={memory}
          disk={disk}
          collectors={collectors}
        />

        <div className="content-grid bottom-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Recent Incidents</h3>
                <p>Latest events requiring attention</p>
              </div>
              <button className="text-button" onClick={() => setActivePage("incidents")}>
                View all <ArrowUpRight size={14} />
              </button>
            </div>

            {incidents.length ? incidents.slice(0, 5).map((incident) => (
              <div className="event-row" key={incident.incident_id || incident.id}>
                <span className="event-icon"><AlertTriangle size={17} /></span>
                <div className="event-copy">
                  <strong>{incident.title}</strong>
                  <span>{incident.description || incident.likely_cause || "No additional details"}</span>
                </div>
                <StatusPill status={incident.severity} />
              </div>
            )) : (
              <EmptyState
                icon={CheckCircle2}
                title="No incidents recorded"
                message="New incidents will appear here."
              />
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Data Protection</h3>
                <p>Metadata egress activity</p>
              </div>
              <ShieldCheck size={19} className="muted-icon" />
            </div>
            <div className="privacy-stat">
              <strong>{egress.length}</strong>
              <span>Recorded metadata payloads</span>
            </div>
            <div className="privacy-note">
              <LockKeyhole size={17} />
              <span>
                Review the Egress Proof page to inspect recorded payload previews
                and approved field lists.
              </span>
            </div>
            <button className="outline-button full-button" onClick={() => setActivePage("egress")}>
              Inspect egress records
            </button>
          </section>
        </div>
      </>
    );
  }

  /* MONITORING PAGE WITH FIVE LIVE GRAPHS */

  function renderMonitoring() {
    const chartDefinitions = [
      {
        title: "CPU Usage",
        unit: "%",
        color: "#a78bfa",
        matches: ["cpu_usage", "cpu"]
      },
      {
        title: "Memory Usage",
        unit: "%",
        color: "#2dd4bf",
        matches: ["memory_usage", "memory", "ram"]
      },
      {
        title: "Disk Usage",
        unit: "%",
        color: "#f59e0b",
        matches: ["disk_usage", "disk"]
      },
      {
        title: "Network Upload",
        unit: "bytes/sec",
        color: "#60a5fa",
        matches: ["upload", "bytes_sent", "network_tx"]
      },
      {
        title: "Network Download",
        unit: "bytes/sec",
        color: "#fb7185",
        matches: ["download", "bytes_recv", "network_rx"]
      }
    ];

    return (
      <>
        <div className="welcome-row">
          <div>
            <div className="eyebrow">LIVE TELEMETRY</div>
            <h2>System Monitoring</h2>
            <p>Track CPU, memory, disk and network activity in real time.</p>
          </div>

          <button className="refresh-button" onClick={loadDashboard}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <section className="panel page-panel">
          <div className="panel-heading">
            <div>
              <h3>Live System Telemetry</h3>
              <p>Graphs update automatically as new collector readings arrive.</p>
            </div>
            <span className="live-label"><span /> LIVE</span>
          </div>

          <div style={{
            marginBottom: 18,
            color: "var(--text-muted, #999)",
            fontSize: 12
          }}>
            Auto-refreshes every 2 seconds · Last updated:{" "}
            {lastUpdated ? lastUpdated.toLocaleTimeString() : "Waiting for data"}
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 390px), 1fr))",
            gap: 18
          }}>
            {chartDefinitions.map((chart) => (
              <LiveMetricChart
                key={chart.title}
                title={chart.title}
                unit={chart.unit}
                color={chart.color}
                matches={chart.matches}
                metrics={metrics}
              />
            ))}
          </div>
        </section>

        <section className="panel page-panel">
          <div className="panel-heading">
            <div>
              <h3>Raw Telemetry Events</h3>
              <p>Individual metric records received from local collectors</p>
            </div>
            <Activity size={20} />
          </div>

          <DataTable
            rows={metrics}
            emptyTitle="No telemetry yet"
            emptyMessage="Start your local collector to send metrics to SENTINEL."
            columns={[
              { key: "metric_type", label: "Metric" },
              { key: "metric_value", label: "Value", render: (row) => row.metric_value },
              { key: "severity", label: "Severity", render: (row) => <StatusPill status={row.severity} /> },
              { key: "collector_id", label: "Collector" },
              { key: "timestamp", label: "Event time", render: (row) => formatTime(row.timestamp) }
            ]}
          />
        </section>
      </>
    );
  }

  function renderCollectors() {
    return (
      <section className="panel page-panel">
        <div className="panel-heading">
          <div>
            <h3>Local Collectors</h3>
            <p>Agents registered with the SENTINEL platform</p>
          </div>
          <Server size={20} />
        </div>
        <DataTable
          rows={collectors}
          emptyTitle="No collectors registered"
          emptyMessage="Your collector will appear here after its first successful telemetry upload."
          columns={[
            { key: "collector_name", label: "Collector" },
            { key: "collector_id", label: "Collector ID" },
            { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
            { key: "version", label: "Version" },
            { key: "last_seen", label: "Last seen", render: (row) => formatTime(row.last_seen) }
          ]}
        />
      </section>
    );
  }

  // INCIDENT CENTER WITH ENHANCED SVG CHARTS

  function renderIncidents() {
    const severityLevels = ["critical", "high", "medium", "low"];

    const severityData = severityLevels.map((level) => ({
      label: level,
      count: incidents.filter(
        (item) => String(item.severity || "").toLowerCase() === level
      ).length,
      color: severityColor(level)
    }));

    function getCategory(incident) {
      const text = [
        incident.title,
        incident.description,
        incident.likely_cause,
        incident.fingerprint
      ].join(" ").toLowerCase();

      if (/network|bandwidth|latency|packet|connectivity|upload|download/.test(text)) return "Network";
      if (/cpu|processor/.test(text)) return "CPU";
      if (/memory|ram/.test(text)) return "Memory";
      if (/disk|storage|drive/.test(text)) return "Disk";
      if (/security|login|authentication|failed.?login|unauthorized/.test(text)) return "Security";
      return "Other";
    }

    const categories = ["Network", "CPU", "Memory", "Disk", "Security", "Other"];

    const categoryData = categories.map((category) => ({
      label: category,
      count: incidents.filter((item) => getCategory(item) === category).length
    }));

    const categoryColors = {
      Network: "#60a5fa",
      CPU: "#c084fc",
      Memory: "#2dd4bf",
      Disk: "#f59e0b",
      Security: "#ff647c",
      Other: "#8c9aaf"
    };

    const now = new Date();

    const trendData = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = incidents.filter((incident) => {
        const incidentDate = new Date(incident.created_at);
        return !Number.isNaN(incidentDate.getTime()) &&
          incidentDate >= date &&
          incidentDate < nextDate;
      }).length;

      return {
        label: date.toLocaleDateString(undefined, { weekday: "short" }),
        date: date.toLocaleDateString(),
        count
      };
    });

    const totalSeverity = severityData.reduce((sum, item) => sum + item.count, 0);
    const maxTrend = Math.max(1, ...trendData.map((item) => item.count));

    const chartWidth = 600;
    const chartHeight = 220;
    const chartLeft = 38;
    const chartRight = 580;
    const chartTop = 22;
    const chartBottom = 172;
    const chartPlotWidth = chartRight - chartLeft;
    const chartPlotHeight = chartBottom - chartTop;

    const trendPoints = trendData.map((item, index) => ({
      ...item,
      x: chartLeft + (index / (trendData.length - 1)) * chartPlotWidth,
      y: chartBottom - (item.count / maxTrend) * chartPlotHeight
    }));

    const trendLine = trendPoints
      .map((point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
      )
      .join(" ");

    const trendArea = `${trendLine} L ${chartRight} ${chartBottom} L ${chartLeft} ${chartBottom} Z`;

    const donutRadius = 64;
    const donutCircumference = 2 * Math.PI * donutRadius;
    let donutOffset = 0;

    const donutSegments = severityData.map((item) => {
      const length = totalSeverity
        ? (item.count / totalSeverity) * donutCircumference
        : 0;

      const segment = {
        ...item,
        length,
        offset: donutOffset
      };

      donutOffset += length;
      return segment;
    });

    const unresolvedCount = incidents.filter(
      (item) => String(item.status || "").toLowerCase() !== "resolved"
    ).length;

    return (
      <div className="aiops-page">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">INCIDENT ANALYTICS</div>
            <h2>Incident Center</h2>
            <p>Monitor incident trends, severity levels and affected system categories.</p>
          </div>
          <button className="refresh-button" onClick={loadDashboard}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <div className="metric-grid">
          <SummaryCard label="Total Incidents" value={incidents.length} icon={AlertTriangle} color="#ff647c" note="All recorded incidents" />
          <SummaryCard label="Unresolved" value={unresolvedCount} icon={CircleAlert} color="#ff914d" note="Require investigation" />
          <SummaryCard label="Correlated Events" value={correlatedIncidents.length} icon={Network} color="#60a5fa" note="Grouped related signals" />
          <SummaryCard label="Open Incidents" value={openIncidents} icon={Activity} color="#c084fc" note="Currently marked open" />
        </div>

        {/* NEW: INCIDENT CORRELATION TIMELINE */}
        <CorrelationTimeline
          metrics={metrics}
          incidents={incidents}
        />

        <div className="content-grid">
          <section className="panel" style={{ minWidth: 0, overflow: "hidden" }}>
            <div className="panel-heading">
              <div>
                <h3>Incident Trend</h3>
                <p>Incidents detected over the last 7 days</p>
              </div>
              <TrendingUp size={20} className="muted-icon" />
            </div>

            <div style={{ width: "100%", paddingTop: 12 }}>
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                role="img"
                aria-label="Seven day incident trend chart"
                style={{ width: "100%", height: "auto", overflow: "visible" }}
              >
                <defs>
                  <linearGradient id="incidentAreaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity="0.38" />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.015" />
                  </linearGradient>
                  <linearGradient id="incidentLineGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#d8b4fe" />
                  </linearGradient>
                  <filter id="incidentGlow">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {[0, 1, 2, 3].map((line) => {
                  const y = chartTop + (line / 3) * chartPlotHeight;
                  return (
                    <g key={line}>
                      <line
                        x1={chartLeft}
                        y1={y}
                        x2={chartRight}
                        y2={y}
                        stroke="currentColor"
                        opacity="0.12"
                        strokeDasharray="4 6"
                      />
                      <text
                        x="25"
                        y={y + 4}
                        textAnchor="end"
                        fontSize="10"
                        fill="currentColor"
                        opacity="0.55"
                      >
                        {Math.round(maxTrend * (1 - line / 3))}
                      </text>
                    </g>
                  );
                })}

                <path d={trendArea} fill="url(#incidentAreaGradient)" />

                <path
                  d={trendLine}
                  fill="none"
                  stroke="url(#incidentLineGradient)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#incidentGlow)"
                />

                {trendPoints.map((point) => (
                  <g key={point.date}>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="9"
                      fill="#a855f7"
                      opacity="0.16"
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="4.5"
                      fill="#d8b4fe"
                      stroke="#171b25"
                      strokeWidth="2"
                    >
                      <title>{`${point.date}: ${point.count} incidents`}</title>
                    </circle>
                    <text
                      x={point.x}
                      y="200"
                      textAnchor="middle"
                      fontSize="11"
                      fill="currentColor"
                      opacity="0.7"
                    >
                      {point.label}
                    </text>
                    <text
                      x={point.x}
                      y={Math.max(12, point.y - 13)}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="700"
                      fill="currentColor"
                    >
                      {point.count}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <div className="privacy-note">
              <Clock3 size={16} />
              <span>Daily counts are based on incident creation timestamps.</span>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Severity Distribution</h3>
                <p>Breakdown by incident severity</p>
              </div>
              <Gauge size={20} className="muted-icon" />
            </div>

            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 24,
              flexWrap: "wrap",
              padding: "24px 0 18px"
            }}>
              <div style={{
                width: 190,
                height: 190,
                position: "relative",
                flexShrink: 0
              }}>
                <svg viewBox="0 0 180 180" width="100%" height="100%">
                  <circle
                    cx="90"
                    cy="90"
                    r={donutRadius}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.09"
                    strokeWidth="19"
                  />

                  {donutSegments.map((item) => (
                    item.count > 0 && (
                      <circle
                        key={item.label}
                        cx="90"
                        cy="90"
                        r={donutRadius}
                        fill="none"
                        stroke={item.color}
                        strokeWidth="19"
                        strokeDasharray={`${Math.max(0, item.length - 2)} ${donutCircumference}`}
                        strokeDashoffset={-item.offset}
                        strokeLinecap="round"
                        transform="rotate(-90 90 90)"
                      >
                        <title>{`${item.label}: ${item.count}`}</title>
                      </circle>
                    )
                  ))}
                </svg>

                <div style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none"
                }}>
                  <strong style={{
                    fontSize: 34,
                    lineHeight: 1.1,
                    letterSpacing: "-1.5px"
                  }}>
                    {totalSeverity}
                  </strong>
                  <span style={{
                    fontSize: 10,
                    letterSpacing: "1.5px",
                    color: "var(--text-muted, #999)",
                    marginTop: 5
                  }}>
                    INCIDENTS
                  </span>
                </div>
              </div>

              <div style={{
                display: "grid",
                gap: 15,
                minWidth: 125,
                flex: "1 1 125px"
              }}>
                {severityData.map((item) => {
                  const percentage = totalSeverity
                    ? (item.count / totalSeverity) * 100
                    : 0;

                  return (
                    <div key={item.label} style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12
                    }}>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9
                      }}>
                        <span style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: item.color,
                          boxShadow: `0 0 10px ${item.color}55`
                        }} />
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.5px"
                        }}>
                          {item.label.toUpperCase()}
                        </span>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <strong style={{ fontSize: 14 }}>{item.count}</strong>
                        <span style={{
                          display: "block",
                          fontSize: 10,
                          color: "var(--text-muted, #999)"
                        }}>
                          {percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        <section className="panel page-panel">
          <div className="panel-heading">
            <div>
              <h3>Incident Categories</h3>
              <p>Distribution of incidents by affected system area</p>
            </div>
            <Network size={20} className="muted-icon" />
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 17,
            padding: "12px 0"
          }}>
            {categoryData.map((item) => {
              const percentage = incidents.length
                ? (item.count / incidents.length) * 100
                : 0;

              const color = categoryColors[item.label];

              return (
                <div
                  key={item.label}
                  style={{
                    padding: "17px",
                    borderRadius: 13,
                    background: "rgba(128,128,128,0.045)",
                    border: "1px solid var(--border-color, #303746)",
                    transition: "transform 0.2s ease, border-color 0.2s ease"
                  }}
                >
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 15
                  }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9
                    }}>
                      <span style={{
                        width: 9,
                        height: 9,
                        borderRadius: 3,
                        background: color,
                        boxShadow: `0 0 12px ${color}66`
                      }} />
                      <span style={{
                        fontSize: 12,
                        fontWeight: 600
                      }}>
                        {item.label}
                      </span>
                    </div>

                    <span style={{
                      fontSize: 10,
                      color: "var(--text-muted, #999)"
                    }}>
                      {percentage.toFixed(0)}%
                    </span>
                  </div>

                  <div style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 7,
                    marginBottom: 13
                  }}>
                    <strong style={{
                      fontSize: 28,
                      letterSpacing: "-1px"
                    }}>
                      {item.count}
                    </strong>
                    <span style={{
                      fontSize: 11,
                      color: "var(--text-muted, #999)"
                    }}>
                      incidents
                    </span>
                  </div>

                  <div style={{
                    height: 7,
                    background: "var(--border-color, #303746)",
                    borderRadius: 20,
                    overflow: "hidden"
                  }}>
                    <div style={{
                      width: `${percentage}%`,
                      height: "100%",
                      background: `linear-gradient(90deg, ${color}99, ${color})`,
                      borderRadius: 20,
                      boxShadow: `0 0 12px ${color}55`,
                      transition: "width 0.6s ease"
                    }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="privacy-note">
            <Eye size={16} />
            <span>Categories are estimated from incident titles, descriptions and fingerprints.</span>
          </div>
        </section>

        <section className="panel page-panel">
          <div className="panel-heading">
            <div>
              <h3>All Incidents</h3>
              <p>Detailed event records from your monitored environment</p>
            </div>
            <span className="live-label"><span /> LIVE DATA</span>
          </div>

          <DataTable
            rows={incidents}
            emptyTitle="All quiet for now"
            emptyMessage="Incidents will be listed here when generated."
            columns={[
              { key: "title", label: "Incident" },
              { key: "severity", label: "Severity", render: (row) => <StatusPill status={row.severity} /> },
              { key: "status", label: "State", render: (row) => <StatusPill status={row.status} /> },
              { key: "likely_cause", label: "Likely cause" },
              { key: "created_at", label: "Created", render: (row) => formatTime(row.created_at) }
            ]}
          />
        </section>
      </div>
    );
  }

  function renderEgress() {
    return (
      <section className="panel page-panel">
        <div className="panel-heading">
          <div>
            <h3>Egress Proof</h3>
            <p>Recorded metadata payload previews received by the backend</p>
          </div>
          <ShieldCheck size={20} />
        </div>

        <div className="privacy-banner">
          <LockKeyhole size={19} />
          <span>
            This page shows records saved by the application. It is not independent
            network-level proof that sensitive data never left the environment.
          </span>
        </div>

        {egress.length ? egress.map((item) => (
          <div className="egress-card" key={item.id}>
            <div className="egress-card-head">
              <div>
                <strong>Payload {item.payload_id}</strong>
                <span>{item.collector_id} · {formatTime(item.created_at)}</span>
              </div>
              <StatusPill status="Recorded" />
            </div>
            <div className="egress-columns">
              <div>
                <label>APPROVED FIELDS</label>
                <pre>{item.approved_fields}</pre>
              </div>
              <div>
                <label>PAYLOAD PREVIEW</label>
                <pre>{item.payload_preview}</pre>
              </div>
            </div>
          </div>
        )) : (
          <EmptyState
            icon={ShieldCheck}
            title="No egress records yet"
            message="Approved metadata receipts will appear after telemetry is received."
          />
        )}
      </section>
    );
  }

  function renderAiops() {
    const summary = aiopsSummary || {};
    const severityCounts = summary.incident_breakdown || [];
    const recommendationCounts = summary.recommendation_breakdown || [];
    const anomalyCount = summary.total_anomalies ?? anomalies.length;

    const pendingRecommendations = recommendations.filter(
      (item) => String(item.status || "").toLowerCase() === "pending"
    ).length;

    return (
      <div className="aiops-page">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">INTELLIGENCE &amp; ANALYTICS</div>
            <h2>AIOps Intelligence Center</h2>
            <p>
              Detect unusual behaviour, connect related events and understand
              what needs attention.
            </p>
          </div>
          <button className="refresh-button" onClick={loadDashboard}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <section className="panel aiops-engine-banner">
          <div className="aiops-engine-icon"><BrainCircuit size={27} /></div>
          <div className="aiops-engine-copy">
            <span className="eyebrow">DETECTION ENGINE</span>
            <h3>{summary.engine || "SENTINEL Explainable AIOps Engine"}</h3>
            <p>{summary.detection_method || "Threshold and historical-baseline heuristics"}</p>
          </div>
          <StatusPill status={backendOnline ? "Active" : "Offline"} />
        </section>

        <div className="metric-grid">
          <SummaryCard label="Total Anomalies" value={anomalyCount} icon={Activity} color="#c084fc" note="Detected unusual signals" />
          <SummaryCard label="Open Incidents" value={summary.open_incidents ?? openIncidents} icon={AlertTriangle} color="#ff914d" note="Require investigation" />
          <SummaryCard label="Correlated Events" value={correlatedIncidents.length} icon={Network} color="#60a5fa" note="Grouped related signals" />
          <SummaryCard label="Pending Actions" value={pendingRecommendations} icon={Zap} color="#e7b65b" note="Recommendations awaiting review" />
        </div>

        <div className="content-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Incident Severity</h3>
                <p>Current incident distribution</p>
              </div>
              <Gauge size={20} className="muted-icon" />
            </div>

            {severityCounts.length ? (
              <div className="aiops-severity-list">
                {["critical", "high", "medium", "low"].map((level) => {
                  const count = severityCounts
                    .filter((item) => item.severity?.toLowerCase() === level)
                    .reduce((total, item) => total + Number(item.count || 0), 0);

                  const total = severityCounts.reduce(
                    (sum, item) => sum + Number(item.count || 0), 0
                  );

                  const width = total ? (count / total) * 100 : 0;

                  return (
                    <div className="aiops-severity-row" key={level}>
                      <div className="aiops-severity-label">
                        <span>
                          <i style={{ background: severityColor(level) }} />
                          {level.toUpperCase()}
                        </span>
                        <strong>{count}</strong>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${width}%`, background: severityColor(level) }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={Gauge}
                title="No severity data"
                message="Incident severity information will appear here."
              />
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Recommendation Status</h3>
                <p>Suggested actions from the engine</p>
              </div>
              <Sparkles size={20} className="muted-icon" />
            </div>

            {recommendationCounts.length ? (
              <div className="aiops-status-list">
                {recommendationCounts.map((item) => (
                  <div className="health-line" key={item.status}>
                    <span>{item.status}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="privacy-note">
                <Zap size={17} />
                <span>
                  {recommendations.length} recommendation records are available.
                  Review the action cards below.
                </span>
              </div>
            )}

            <div className="aiops-last-run">
              <Clock3 size={15} />
              <span>Last engine summary: {formatTime(summary.timestamp)}</span>
            </div>
          </section>
        </div>

        <section className="panel page-panel">
          <div className="panel-heading">
            <div>
              <h3>Detected Incidents</h3>
              <p>Explainable signals generated from collector telemetry</p>
            </div>
            <span className="live-label"><span /> LIVE DATA</span>
          </div>

          {incidents.length ? incidents.map((incident) => {
            const isCorrelated = String(incident.fingerprint || "").includes(":correlated:");
            let evidence = [];

            try {
              evidence = typeof incident.evidence_json === "string"
                ? JSON.parse(incident.evidence_json)
                : incident.evidence_json || [];
            } catch {
              evidence = [];
            }

            return (
              <div className="aiops-incident-card" key={incident.incident_id || incident.id}>
                <div className="aiops-incident-top">
                  <div className="aiops-incident-symbol">
                    {isCorrelated ? <Network size={19} /> : <AlertTriangle size={19} />}
                  </div>
                  <div className="aiops-incident-title">
                    <strong>{incident.title}</strong>
                    <span>
                      {incident.incident_id || `Incident #${incident.id}`} ·{" "}
                      {formatTime(incident.last_seen || incident.created_at)}
                    </span>
                  </div>
                  <StatusPill status={incident.severity} />
                </div>

                <p className="aiops-incident-description">
                  {incident.description || "No incident description available."}
                </p>

                <div className="aiops-explanation">
                  <Eye size={16} />
                  <div>
                    <strong>Likely cause</strong>
                    <span>{incident.likely_cause || "Further investigation is recommended."}</span>
                  </div>
                </div>

                <div className="aiops-incident-footer">
                  <span><Radio size={14} /> {incident.collector_id || "Collector unavailable"}</span>
                  <span><Activity size={14} /> {incident.occurrence_count || 1} occurrence(s)</span>
                  <StatusPill status={incident.status} />
                </div>

                {evidence.length > 0 && (
                  <details className="aiops-evidence">
                    <summary>View detection evidence ({evidence.length})</summary>
                    <pre>{JSON.stringify(evidence, null, 2)}</pre>
                  </details>
                )}
              </div>
            );
          }) : (
            <EmptyState
              icon={CheckCircle2}
              title="No incidents detected"
              message="New anomaly incidents will appear here when telemetry triggers detection rules."
            />
          )}
        </section>

        <section className="panel page-panel">
          <div className="panel-heading">
            <div>
              <h3>Recommended Actions</h3>
              <p>Suggested next steps based on detected behaviour</p>
            </div>
            <Zap size={20} className="muted-icon" />
          </div>

          {recommendations.length ? recommendations.map((item) => (
            <div className="recommendation-card" key={item.id}>
              <div className="recommendation-icon"><Zap size={20} /></div>
              <div>
                <strong>{item.title}</strong>
                <p>{item.explanation || "No explanation provided."}</p>
                <span>
                  Suggested action: {item.suggested_action || "Review system activity"}
                </span>
              </div>
              <StatusPill status={item.status} />
            </div>
          )) : (
            <EmptyState
              icon={Sparkles}
              title="No recommendations yet"
              message="Suggested actions will appear when the AIOps engine creates them."
            />
          )}
        </section>

        <section className="panel page-panel">
          <div className="panel-heading">
            <div>
              <h3>Detection Methodology</h3>
              <p>How SENTINEL identifies unusual system behaviour</p>
            </div>
            <BrainCircuit size={20} className="muted-icon" />
          </div>

          <div className="aiops-method-grid">
            <div className="aiops-method-card">
              <div><Gauge size={19} /></div>
              <strong>Threshold Detection</strong>
              <p>
                Checks incoming metrics against configured limits to identify
                unusually high or unavailable services.
              </p>
            </div>
            <div className="aiops-method-card">
              <div><TrendingUp size={19} /></div>
              <strong>Historical Baselines</strong>
              <p>
                Compares new observations with historical averages and variation
                to identify unusual changes.
              </p>
            </div>
            <div className="aiops-method-card">
              <div><Network size={19} /></div>
              <strong>Event Correlation</strong>
              <p>
                Groups multiple unusual signals from a collector to help
                investigate possible shared causes.
              </p>
            </div>
            <div className="aiops-method-card">
              <div><Eye size={19} /></div>
              <strong>Explainable Insights</strong>
              <p>
                Displays evidence, likely causes and suggested actions instead
                of presenting unexplained alerts.
              </p>
            </div>
          </div>

          <div className="privacy-banner">
            <LockKeyhole size={18} />
            <span>
              Current prototype uses threshold rules and historical-baseline
              heuristics. It does not claim to use a trained machine-learning
              model or perform automatic remediation.
            </span>
          </div>
        </section>
      </div>
    );
  }

  function renderPage() {
    switch (activePage) {
      case "monitoring": return renderMonitoring();
      case "collectors": return renderCollectors();
      case "incidents": return renderIncidents();
      case "egress": return renderEgress();
      case "aiops": return renderAiops();
      default: return renderOverview();
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={25} /></div>
          <div>
            <strong>SENTINEL</strong>
            <span>SECURE AIOPS PLATFORM</span>
          </div>
          <button className="mobile-close" onClick={() => setMobileMenu(false)}>
            <X size={20} />
          </button>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activePage === id ? "active" : ""}`}
              onClick={() => {
                setActivePage(id);
                setMobileMenu(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "incidents" && unresolvedIncidents > 0 && (
                <b className="nav-count">{unresolvedIncidents}</b>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className={backendOnline ? "pulse-dot" : "pulse-dot offline"} />
            <div>
              <strong>{backendOnline ? "Platform online" : "Platform offline"}</strong>
              <span>{backendOnline ? "Live connection" : "Waiting for connection"}</span>
            </div>
          </div>
          <div className="sidebar-version">SENTINEL PROTOTYPE · v1.0.0</div>
        </div>
      </aside>

      {mobileMenu && (
        <button
          className="mobile-overlay"
          onClick={() => setMobileMenu(false)}
          aria-label="Close navigation"
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-button" onClick={() => setMobileMenu(true)}>
              <Menu size={21} />
            </button>
            <div>
              <span className="breadcrumb">SENTINEL /</span>{" "}
              <strong>{pageTitle}</strong>
            </div>
          </div>

          <div className="topbar-right">
            <span className="topbar-time">
              <Clock3 size={15} />
              {lastUpdated ? lastUpdated.toLocaleTimeString() : "Connecting..."}
            </span>
            <StatusPill status={backendOnline ? "Connected" : "Offline"} />
            <div className="avatar">S</div>
          </div>
        </header>

        <div className="page-content">
          {!backendOnline && !loading && (
            <div className="connection-alert">
              <CircleAlert size={18} />
              <div>
                <strong>Backend connection unavailable</strong>
                <span>{error || "Check that the backend server is running."}</span>
              </div>
              <button onClick={loadDashboard}>Retry</button>
            </div>
          )}

          {loading ? (
            <div className="loading-state">
              <RefreshCw className="spin" size={25} />
              <strong>Loading SENTINEL platform...</strong>
              <span>Connecting to backend services</span>
            </div>
          ) : renderPage()}

          <footer className="page-footer">
            <span>SENTINEL · Secure AIOps Observability</span>
            <span><span className="footer-dot" /> Auto-refresh every 2 seconds</span>
          </footer>
        </div>
      </main>
    </div>
  );
}