
import json
import os
import platform
import socket
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone

import psutil
import requests

# SENTINEL CONFIGURATION
API_BASE = os.environ.get(
    "SENTINEL_API", "http://localhost:5000"
).rstrip("/")
API_URL = API_BASE + "/api/telemetry"

PROBE_TARGET = os.environ.get(
    "SENTINEL_PROBE_TARGET", "1.1.1.1:443"
).strip()

SERVICE_HEALTH_URL = os.environ.get(
    "SENTINEL_SERVICE_URL", ""
).strip()

COLLECTOR_ID = os.environ.get(
    "SENTINEL_COLLECTOR_ID",
    "collector-" + socket.gethostname().lower().replace(" ", "-")
)

COLLECTOR_NAME = "SENTINEL Local System Collector"
VERSION = "1.2.0"
TENANT_ID = 1

# One-second target. Actual timing depends on system/network response time.
INTERVAL = max(1.0, float(os.environ.get("SENTINEL_INTERVAL", 1)))

PROBE_COUNT = 1
PROBE_TIMEOUT = 0.5
LOGIN_CHECK_INTERVAL = 60

SPOOL_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "spool"
)
SPOOL_FILE = os.path.join(SPOOL_DIR, "pending.jsonl")
SPOOL_LIMIT = 2000

previous_network = psutil.net_io_counters()
previous_time = time.monotonic()

# Prime CPU measurement so subsequent calls are non-blocking.
psutil.cpu_percent(interval=None)

last_login_check = datetime.now(timezone.utc) - timedelta(
    seconds=LOGIN_CHECK_INTERVAL
)
last_login_poll = 0.0
login_source_reported = None
login_retry_after = 0.0


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def get_severity(value, warning, critical):
    if value >= critical:
        return "critical"
    if value >= warning:
        return "medium"
    return "info"


def resolve_probe_target():
    if PROBE_TARGET:
        if ":" in PROBE_TARGET:
            host, port = PROBE_TARGET.rsplit(":", 1)
            return host, int(port)
        return PROBE_TARGET, 443

    return "1.1.1.1", 443


def measure_network_quality():
    host, port = resolve_probe_target()
    latencies = []
    failures = 0

    for _ in range(PROBE_COUNT):
        started = time.perf_counter()

        try:
            with socket.create_connection(
                (host, port), timeout=PROBE_TIMEOUT
            ):
                latencies.append(
                    (time.perf_counter() - started) * 1000
                )
        except OSError:
            failures += 1

    packet_loss = round(
        (failures / PROBE_COUNT) * 100, 2
    )

    latency = (
        round(sum(latencies) / len(latencies), 2)
        if latencies else None
    )

    return latency, packet_loss, f"{host}:{port}"


def measure_service_availability():
    if not SERVICE_HEALTH_URL:
        return None

    try:
        response = requests.get(
            SERVICE_HEALTH_URL,
            timeout=1.5
        )
        return 100 if response.status_code == 200 else 0
    except requests.RequestException:
        return 0


def read_failed_logins():
    global last_login_check
    global last_login_poll
    global login_retry_after

    now = time.monotonic()

    # Do not query OS security logs on every one-second cycle.
    if now - last_login_poll < LOGIN_CHECK_INTERVAL:
        return None, "next check scheduled"

    if now < login_retry_after:
        return None, "security log retry delayed"

    last_login_poll = now

    since = last_login_check.isoformat().replace("+00:00", "Z")
    last_login_check = datetime.now(timezone.utc)

    if platform.system() == "Windows":
        query = (
            "*[System[(EventID=4625) and "
            f"TimeCreated[@SystemTime>='{since}']]]"
        )

        try:
            result = subprocess.run(
                [
                    "wevtutil", "qe", "Security",
                    f"/q:{query}", "/f:xml", "/c:500"
                ],
                capture_output=True,
                text=True,
                timeout=3
            )
        except (OSError, subprocess.SubprocessError) as error:
            login_retry_after = time.monotonic() + 600
            return None, f"event log unavailable ({error})"

        if result.returncode != 0:
            login_retry_after = time.monotonic() + 600
            return None, "security event log requires elevated access"

        return result.stdout.count("<Event "), "windows_security_4625"

    for log_path in ("/var/log/auth.log", "/var/log/secure"):
        if os.path.exists(log_path):
            try:
                with open(
                    log_path, "r", encoding="utf-8", errors="ignore"
                ) as log:
                    lines = log.readlines()[-4000:]
            except OSError:
                login_retry_after = time.monotonic() + 600
                return None, "authentication log not readable"

            failures = sum(
                1 for line in lines
                if "Failed password" in line
                or "authentication failure" in line
            )

            return failures, log_path

    login_retry_after = time.monotonic() + 600
    return None, "no supported authentication log found"


def get_system_metrics():
    global previous_network
    global previous_time
    global login_source_reported

    # Non-blocking CPU measurement.
    cpu = psutil.cpu_percent(interval=None)

    memory = psutil.virtual_memory()

    # Use the system drive on Windows and root on Unix-like systems.
    disk_path = os.environ.get("SystemDrive", "C:") + "\\"
    if platform.system() != "Windows":
        disk_path = "/"

    disk = psutil.disk_usage(disk_path)

    current_network = psutil.net_io_counters()
    current_time = time.monotonic()

    elapsed = max(current_time - previous_time, 0.001)

    upload_speed = (
        current_network.bytes_sent - previous_network.bytes_sent
    ) / elapsed

    download_speed = (
        current_network.bytes_recv - previous_network.bytes_recv
    ) / elapsed

    previous_network = current_network
    previous_time = current_time

    metrics = [
        {
            "metric_type": "cpu_usage",
            "metric_value": round(cpu, 2),
            "severity": get_severity(cpu, 70, 90),
            "summary": "System CPU utilization"
        },
        {
            "metric_type": "memory_usage",
            "metric_value": round(memory.percent, 2),
            "severity": get_severity(memory.percent, 75, 90),
            "summary": "System memory utilization"
        },
        {
            "metric_type": "disk_usage",
            "metric_value": round(disk.percent, 2),
            "severity": get_severity(disk.percent, 80, 95),
            "summary": "System disk utilization"
        },
        {
            "metric_type": "network_upload_bytes_sec",
            "metric_value": round(upload_speed, 2),
            "severity": "info",
            "summary": "Network upload throughput in bytes per second"
        },
        {
            "metric_type": "network_download_bytes_sec",
            "metric_value": round(download_speed, 2),
            "severity": "info",
            "summary": "Network download throughput in bytes per second"
        }
    ]

    latency, packet_loss, target = measure_network_quality()

    if latency is not None:
        metrics.append({
            "metric_type": "network_latency_ms",
            "metric_value": latency,
            "severity": "info",
            "summary": f"TCP connect latency in milliseconds (target {target})"
        })

    metrics.append({
        "metric_type": "network_packet_loss_percent",
        "metric_value": packet_loss,
        "severity": "info",
        "summary": f"Failed TCP probes as a percentage (target {target})"
    })

    availability = measure_service_availability()

    if availability is not None:
        metrics.append({
            "metric_type": "service_availability",
            "metric_value": availability,
            "severity": "info",
            "summary": "Monitored service HTTP health check"
        })

    failed_logins, login_source = read_failed_logins()

    if failed_logins is not None:
        metrics.append({
            "metric_type": "failed_login_attempts",
            "metric_value": failed_logins,
            "severity": "info",
            "summary": f"Authentication failures since last check ({login_source})"
        })
        login_source_reported = login_source
    elif login_source not in (
        "next check scheduled", "security log retry delayed"
    ):
        if login_source != login_source_reported:
            print(
                f"[PRIVACY] Failed-login metric not sent: {login_source}."
            )
            login_source_reported = login_source

    return metrics


def create_payload():
    metrics = get_system_metrics()

    for metric in metrics:
        metric["payload_id"] = str(uuid.uuid4())
        metric["timestamp"] = utc_now()

    return {
        "collector_id": COLLECTOR_ID,
        "collector_name": COLLECTOR_NAME,
        "version": VERSION,
        "tenant_id": TENANT_ID,
        "approved_fields": [
            "payload_id",
            "metric_type",
            "metric_value",
            "severity",
            "summary",
            "timestamp"
        ],
        "metrics": metrics
    }


def load_spool():
    if not os.path.exists(SPOOL_FILE):
        return []

    pending = []

    with open(SPOOL_FILE, "r", encoding="utf-8") as spool:
        for line in spool:
            line = line.strip()
            if not line:
                continue

            try:
                pending.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    return pending


def save_spool(pending):
    if not pending:
        if os.path.exists(SPOOL_FILE):
            os.remove(SPOOL_FILE)
        return

    os.makedirs(SPOOL_DIR, exist_ok=True)
    temporary = SPOOL_FILE + ".tmp"

    with open(temporary, "w", encoding="utf-8") as spool:
        for payload in pending:
            spool.write(json.dumps(payload) + "\n")

    os.replace(temporary, SPOOL_FILE)


def buffer_payload(payload):
    pending = load_spool()
    pending.append(payload)

    if len(pending) > SPOOL_LIMIT:
        dropped = len(pending) - SPOOL_LIMIT
        pending = pending[dropped:]
        print(
            f"[BUFFER] Spool limit reached, dropped "
            f"{dropped} oldest payload(s)."
        )

    save_spool(pending)
    return len(pending)


def deliver(payload):
    response = requests.post(
        API_URL,
        json=payload,
        timeout=2
    )

    if response.status_code == 201:
        result = response.json()
        print(
            f"[SENT] {result['accepted']} new metrics | "
            f"{result['duplicates_ignored']} duplicates ignored"
        )
        return True

    print("[ERROR]", response.status_code, response.text)
    return False


def flush_spool():
    pending = load_spool()

    if not pending:
        return

    print(f"[BUFFER] Retrying {len(pending)} stored payload(s).")

    while pending:
        try:
            response = requests.post(
                API_URL,
                json=pending[0],
                timeout=2
            )
        except requests.RequestException:
            save_spool(pending)
            print(
                f"[OFFLINE] {len(pending)} payload(s) "
                "kept locally for retry."
            )
            return

        if response.status_code >= 500:
            save_spool(pending)
            print(
                f"[OFFLINE] Backend error {response.status_code}. "
                f"{len(pending)} payload(s) kept for retry."
            )
            return

        pending.pop(0)
        save_spool(pending)


def main():
    print("=" * 55)
    print("       SENTINEL LOCAL COLLECTOR")
    print("=" * 55)
    print("Collector:", COLLECTOR_ID)
    print("Device:", platform.system(), platform.release())
    print("Platform:", API_BASE)
    print("Network probe target:", "%s:%s" % resolve_probe_target())
    print("Service check:", SERVICE_HEALTH_URL or "disabled")
    print("Monitoring: CPU | Memory | Disk | Network | Latency")
    print("            Packet loss | Availability | Failed logins")
    print("Target reporting interval:", INTERVAL, "seconds")
    print("Offline buffer:", SPOOL_FILE)
    print("=" * 55)

    next_run = time.monotonic()

    while True:
        try:
            flush_spool()

            payload = create_payload()

            print("\nTime:", utc_now())

            for metric in payload["metrics"]:
                print(
                    metric["metric_type"],
                    ":",
                    metric["metric_value"],
                    "|",
                    metric["severity"]
                )

            try:
                delivered = deliver(payload)

                if not delivered:
                    queued = buffer_payload(payload)
                    print(
                        f"[BUFFER] {queued} payload(s) stored for retry."
                    )

            except requests.RequestException:
                queued = buffer_payload(payload)
                print(
                    f"[OFFLINE] Backend unavailable. "
                    f"{queued} payload(s) stored locally."
                )

            next_run += INTERVAL
            remaining = next_run - time.monotonic()

            if remaining > 0:
                time.sleep(remaining)
            else:
                # Do not run overlapping collection cycles.
                next_run = time.monotonic()

        except KeyboardInterrupt:
            print("\nSENTINEL collector stopped.")
            break

        except Exception as error:
            print("[COLLECTOR ERROR]", error)
            time.sleep(1)


if __name__ == "__main__":
    main()
