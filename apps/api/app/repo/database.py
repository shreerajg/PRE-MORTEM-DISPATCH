from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# SQLite allows one writer at a time. Without a busy timeout a second writer
# fails instantly with "database is locked"; with WAL, readers never block the
# writer. 5 s is long enough for the short writes this app performs.
_SQLITE_BUSY_TIMEOUT_MS = 5000


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

def get_db_path() -> str:
    """Resolve the filesystem path from DATABASE_URL / settings.database_url.

    Supports ``sqlite:///`` prefix (relative or absolute) and plain paths.
    Falls back to ``./data/app.db``.
    """
    url: str = os.environ.get("DATABASE_URL", settings.database_url)
    # Strip sqlite:/// prefix
    if url.startswith("sqlite:///"):
        path = url[len("sqlite:///"):]
    elif url.startswith("sqlite://"):
        path = url[len("sqlite://"):]
    else:
        path = url
    return path


def _connect() -> sqlite3.Connection:
    db_path = get_db_path()
    # Ensure parent directory exists before connecting
    parent = os.path.dirname(os.path.abspath(db_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(
        db_path,
        timeout=_SQLITE_BUSY_TIMEOUT_MS / 1000.0,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    # WAL lets readers proceed while a write is committed; busy_timeout makes a
    # competing writer wait instead of raising sqlite3.OperationalError.
    conn.execute(f"PRAGMA busy_timeout = {_SQLITE_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA synchronous = NORMAL")
    try:
        conn.execute("PRAGMA journal_mode = WAL")
    except sqlite3.DatabaseError:
        # Read-only or network filesystems may refuse WAL; the connection still works.
        logger.warning("Could not enable WAL journal mode; continuing without it", exc_info=True)
    return conn


def _json_load(raw: Any, default: Any) -> Any:
    """Decode a stored JSON column without turning one corrupt row into a 500."""
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("Corrupt JSON payload in database; returning default", exc_info=True)
        return default


# ---------------------------------------------------------------------------
# Schema initialisation
# ---------------------------------------------------------------------------

def init_db() -> None:
    """Create tables if they do not already exist."""
    conn = _connect()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS datasets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                meta TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS plans (
                id TEXT PRIMARY KEY,
                dataset_id TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                solver TEXT NOT NULL,
                created_at TEXT NOT NULL,
                data TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS scenarios (
                id TEXT PRIMARY KEY,
                name TEXT,
                baseline_plan_id TEXT NOT NULL,
                disruption TEXT NOT NULL DEFAULT '{}',
                disrupted_plan_id TEXT,
                recovered_plan_id TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at TEXT NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT,
                detail TEXT NOT NULL DEFAULT '{}'
            );

            -- List and history queries sort/filter on these columns; without
            -- indexes every page load scans the whole table.
            CREATE INDEX IF NOT EXISTS idx_datasets_created ON datasets(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_plans_created ON plans(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_plans_type_created ON plans(type, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_plans_dataset ON plans(dataset_id);
            CREATE INDEX IF NOT EXISTS idx_scenarios_created ON scenarios(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_scenarios_baseline ON scenarios(baseline_plan_id);
            CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at DESC);
            """
        )
        # Existing databases predate scenario names; add the column in place.
        scenario_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(scenarios)").fetchall()
        }
        if "name" not in scenario_columns:
            conn.execute("ALTER TABLE scenarios ADD COLUMN name TEXT")
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Dataset helpers
# ---------------------------------------------------------------------------

def save_dataset(dataset_id: str, name: str, created_at: str, meta: Dict[str, Any]) -> None:
    conn = _connect()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO datasets (id, name, created_at, meta) VALUES (?, ?, ?, ?)",
            (dataset_id, name, created_at, json.dumps(meta)),
        )
        conn.commit()
    finally:
        conn.close()


def get_dataset(dataset_id: str) -> Optional[Dict[str, Any]]:
    conn = _connect()
    try:
        cur = conn.execute("SELECT * FROM datasets WHERE id = ?", (dataset_id,))
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "meta": _json_load(row["meta"], {}),
        }
    finally:
        conn.close()


def list_datasets() -> List[Dict[str, Any]]:
    conn = _connect()
    try:
        cur = conn.execute("SELECT * FROM datasets ORDER BY created_at DESC")
        result: List[Dict[str, Any]] = []
        for row in cur.fetchall():
            result.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "created_at": row["created_at"],
                    "meta": _json_load(row["meta"], {}),
                }
            )
        return result
    finally:
        conn.close()


def list_dataset_summaries() -> List[Dict[str, Any]]:
    """Dataset list rows without the stored network payload.

    A workspace can hold many datasets; returning every warehouse, route and
    demand row for each one turns a 20 KB list into megabytes and leaks the
    full contents of every import. The detail endpoint still returns ``meta``.
    """
    conn = _connect()
    try:
        cur = conn.execute("SELECT id, name, created_at, meta FROM datasets ORDER BY created_at DESC")
        result: List[Dict[str, Any]] = []
        for row in cur.fetchall():
            meta = _json_load(row["meta"], {})
            report = meta.get("validation_report") or {}
            summary = report.get("summary") or {}
            result.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "created_at": row["created_at"],
                    "counts": {
                        table: len(meta.get(table) or [])
                        for table in (
                            "warehouses",
                            "destinations",
                            "products",
                            "routes",
                            "inventory",
                            "demand",
                        )
                    },
                    "valid": report.get("valid"),
                    "issue_count": summary.get("total_issues"),
                }
            )
        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Plan helpers
# ---------------------------------------------------------------------------

def save_plan(
    plan_id: str,
    dataset_id: str,
    type: str,
    status: str,
    solver: str,
    created_at: str,
    data: Dict[str, Any],
) -> None:
    conn = _connect()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO plans (id, dataset_id, type, status, solver, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (plan_id, dataset_id, type, status, solver, created_at, json.dumps(data)),
        )
        conn.commit()
    finally:
        conn.close()


def get_plan(plan_id: str) -> Optional[Dict[str, Any]]:
    conn = _connect()
    try:
        cur = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,))
        row = cur.fetchone()
        if row is None:
            return None
        return _plan_row(row)
    finally:
        conn.close()


def _plan_row(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "dataset_id": row["dataset_id"],
        "type": row["type"],
        "status": row["status"],
        "solver": row["solver"],
        "created_at": row["created_at"],
        "data": _json_load(row["data"], {}),
    }


def get_plan_kpis_by_ids(plan_ids: List[str]) -> Dict[str, Optional[Dict[str, Any]]]:
    """Project only ``data.kpis`` for scenario lists.

    Decoding every allocation and diagnosis row just to render a fulfilment
    number is wasteful; SQLite's JSON1 projection keeps the list payload small.
    Older SQLite builds without JSON1 fall back to a full decode.
    """
    ids = [plan_id for plan_id in {*plan_ids} if plan_id]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    conn = _connect()
    try:
        try:
            cur = conn.execute(
                f"SELECT id, json_extract(data, '$.kpis') AS kpis FROM plans WHERE id IN ({placeholders})",
                ids,
            )
            projected: Dict[str, Optional[Dict[str, Any]]] = {}
            for row in cur.fetchall():
                raw = row["kpis"]
                if raw is None:
                    projected[row["id"]] = None
                    continue
                try:
                    projected[row["id"]] = json.loads(raw)
                except (TypeError, ValueError):
                    projected[row["id"]] = None
            return projected
        except sqlite3.OperationalError:
            logger.warning("JSON1 unavailable; falling back to full plan decode", exc_info=True)
            cur = conn.execute(f"SELECT id, data FROM plans WHERE id IN ({placeholders})", ids)
            return {
                row["id"]: _json_load(row["data"], {}).get("kpis")
                for row in cur.fetchall()
            }
    finally:
        conn.close()


def list_plans(limit: int = 25, plan_type: Optional[str] = None, offset: int = 0) -> List[Dict[str, Any]]:
    """Recent plan summaries, newest first. Filtering happens before LIMIT."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    query = "SELECT id, dataset_id, type, status, solver, created_at, data FROM plans"
    params: List[Any] = []
    if plan_type:
        query += " WHERE type = ?"
        params.append(plan_type)
    query += " ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    conn = _connect()
    try:
        cur = conn.execute(query, params)
        result: List[Dict[str, Any]] = []
        for row in cur.fetchall():
            data = _json_load(row["data"], {})
            result.append(
                {
                    "id": row["id"],
                    "dataset_id": row["dataset_id"],
                    "type": row["type"],
                    "status": row["status"],
                    "solver": row["solver"],
                    "solver_status": data.get("status_detail"),
                    "created_at": row["created_at"],
                    "kpis": data.get("kpis", {}),
                    "constraints": data.get("constraints", {}),
                    "allocation_count": len(data.get("allocations", []) or []),
                    "unmet_count": len(data.get("unmet", []) or []),
                }
            )
        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Scenario helpers
# ---------------------------------------------------------------------------

def save_scenario(
    scenario_id: str,
    baseline_plan_id: str,
    disruption: Dict[str, Any],
    disrupted_plan_id: Optional[str],
    recovered_plan_id: Optional[str],
    status: str,
    created_at: str,
    name: Optional[str] = None,
) -> None:
    conn = _connect()
    try:
        conn.execute(
            """INSERT OR REPLACE INTO scenarios
               (id, name, baseline_plan_id, disruption, disrupted_plan_id, recovered_plan_id, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                scenario_id,
                name,
                baseline_plan_id,
                json.dumps(disruption),
                disrupted_plan_id,
                recovered_plan_id,
                status,
                created_at,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def get_scenario(scenario_id: str) -> Optional[Dict[str, Any]]:
    conn = _connect()
    try:
        cur = conn.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,))
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "name": row["name"] if "name" in row.keys() else None,
            "baseline_plan_id": row["baseline_plan_id"],
            "disruption": _json_load(row["disruption"], {}),
            "disrupted_plan_id": row["disrupted_plan_id"],
            "recovered_plan_id": row["recovered_plan_id"],
            "status": row["status"],
            "created_at": row["created_at"],
        }
    finally:
        conn.close()


def list_scenarios(limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    conn = _connect()
    try:
        cur = conn.execute(
            "SELECT * FROM scenarios ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        result: List[Dict[str, Any]] = []
        for row in cur.fetchall():
            result.append(
                {
                    "id": row["id"],
                    "name": row["name"] if "name" in row.keys() else None,
                    "baseline_plan_id": row["baseline_plan_id"],
                    "disruption": _json_load(row["disruption"], {}),
                    "disrupted_plan_id": row["disrupted_plan_id"],
                    "recovered_plan_id": row["recovered_plan_id"],
                    "status": row["status"],
                    "created_at": row["created_at"],
                }
            )
        return result
    finally:
        conn.close()


def update_scenario(scenario_id: str, fields: Dict[str, Any]) -> None:
    """Update arbitrary columns on a scenario row.

    ``fields`` values for ``disruption`` that are dicts/lists are JSON-encoded
    automatically.  Only whitelisted columns are applied.
    """
    allowed = {"name", "baseline_plan_id", "disruption", "disrupted_plan_id", "recovered_plan_id", "status", "created_at"}
    updates: Dict[str, Any] = {}
    for key, value in fields.items():
        if key not in allowed:
            continue
        if key == "disruption" and isinstance(value, (dict, list)):
            updates[key] = json.dumps(value)
        else:
            updates[key] = value

    if not updates:
        return

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    params: List[Any] = list(updates.values()) + [scenario_id]

    conn = _connect()
    try:
        conn.execute(f"UPDATE scenarios SET {set_clause} WHERE id = ?", params)
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Counts (list responses report the real total, not just the page size)
# ---------------------------------------------------------------------------

def _count(table: str, where: str = "", params: List[Any] | None = None) -> int:
    conn = _connect()
    try:
        cur = conn.execute(f"SELECT COUNT(*) AS n FROM {table}{where}", params or [])
        row = cur.fetchone()
        return int(row["n"]) if row else 0
    finally:
        conn.close()


def count_datasets() -> int:
    return _count("datasets")


def count_plans(plan_type: Optional[str] = None) -> int:
    if plan_type:
        return _count("plans", " WHERE type = ?", [plan_type])
    return _count("plans")


def count_scenarios() -> int:
    return _count("scenarios")


def delete_scenario_with_plans(scenario_id: str, plan_ids: List[str]) -> bool:
    """Delete a scenario and the plans it owns in one transaction.

    Callers decide which plans belong to the scenario; the baseline plan is
    never included, so deleting a scenario cannot remove shared history.
    """
    conn = _connect()
    try:
        if plan_ids:
            placeholders = ",".join("?" for _ in plan_ids)
            conn.execute(f"DELETE FROM plans WHERE id IN ({placeholders})", plan_ids)
        cur = conn.execute("DELETE FROM scenarios WHERE id = ?", (scenario_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Dataset lifecycle
# ---------------------------------------------------------------------------

def rename_dataset(dataset_id: str, name: str) -> bool:
    conn = _connect()
    try:
        cur = conn.execute("UPDATE datasets SET name = ? WHERE id = ?", (name, dataset_id))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_dataset_cascade(dataset_id: str) -> Optional[Dict[str, int]]:
    """Delete a dataset, its plans and every scenario branching from them.

    One explicit transaction keeps a half-deleted workspace impossible. The
    caller must confirm the cascade with the returned counts.
    """
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM datasets WHERE id = ?", (dataset_id,)).fetchone() is None:
            conn.rollback()
            return None

        plan_ids = [
            row["id"]
            for row in conn.execute("SELECT id FROM plans WHERE dataset_id = ?", (dataset_id,)).fetchall()
        ]
        scenario_ids: List[str] = []
        if plan_ids:
            placeholders = ",".join("?" for _ in plan_ids)
            scenario_ids = [
                row["id"]
                for row in conn.execute(
                    f"""SELECT id FROM scenarios
                        WHERE baseline_plan_id IN ({placeholders})
                           OR disrupted_plan_id IN ({placeholders})
                           OR recovered_plan_id IN ({placeholders})""",
                    plan_ids * 3,
                ).fetchall()
            ]
            if scenario_ids:
                scen_placeholders = ",".join("?" for _ in scenario_ids)
                conn.execute(f"DELETE FROM scenarios WHERE id IN ({scen_placeholders})", scenario_ids)
            conn.execute(f"DELETE FROM plans WHERE id IN ({placeholders})", plan_ids)

        conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
        conn.commit()
        return {"deleted_plans": len(plan_ids), "deleted_scenarios": len(scenario_ids)}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Plan lifecycle
# ---------------------------------------------------------------------------

def plan_reference_count(plan_id: str) -> int:
    conn = _connect()
    try:
        row = conn.execute(
            """SELECT COUNT(*) AS n FROM scenarios
               WHERE baseline_plan_id = ? OR disrupted_plan_id = ? OR recovered_plan_id = ?""",
            (plan_id, plan_id, plan_id),
        ).fetchone()
        return int(row["n"]) if row else 0
    finally:
        conn.close()


def delete_plan(plan_id: str) -> bool:
    conn = _connect()
    try:
        cur = conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Activity trail
# ---------------------------------------------------------------------------

def log_activity(
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    detail: Optional[Dict[str, Any]] = None,
) -> None:
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO activity (at, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)",
            (
                datetime.now(timezone.utc).isoformat(),
                action,
                entity_type,
                entity_id,
                json.dumps(detail or {}),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def list_activity(limit: int = 25, offset: int = 0) -> List[Dict[str, Any]]:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM activity ORDER BY at DESC, id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return [
            {
                "id": row["id"],
                "at": row["at"],
                "action": row["action"],
                "entity_type": row["entity_type"],
                "entity_id": row["entity_id"],
                "detail": _json_load(row["detail"], {}),
            }
            for row in rows
        ]
    finally:
        conn.close()


def count_activity() -> int:
    return _count("activity")
