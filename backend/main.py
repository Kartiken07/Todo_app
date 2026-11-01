import re
import sqlite3
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

DB_PATH = Path(__file__).parent / "todos.db"

app = FastAPI(title="Todo API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                day TEXT NOT NULL,
                start_time TEXT,
                end_time TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT
            )
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)")}
        for col in ("start_time", "end_time", "completed_at", "notes"):
            if col not in columns:
                conn.execute(f"ALTER TABLE tasks ADD COLUMN {col} TEXT")
        if "time" in columns:
            conn.execute(
                "UPDATE tasks SET start_time = time WHERE time IS NOT NULL AND start_time IS NULL"
            )
            conn.execute("ALTER TABLE tasks DROP COLUMN time")


init_db()

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class TaskIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    day: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("start_time", "end_time")
    @classmethod
    def check_time(cls, v: Optional[str]) -> Optional[str]:
        if v in (None, ""):
            return None
        if not TIME_RE.match(v):
            raise ValueError("time must be a valid HH:MM time")
        return v

    @model_validator(mode="after")
    def check_range(self):
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("end time must be after start time")
        return self


class TaskUpdate(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=500)
    done: Optional[bool] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("start_time", "end_time")
    @classmethod
    def check_time(cls, v: Optional[str]) -> Optional[str]:
        if v in (None, ""):
            return None
        if not TIME_RE.match(v):
            raise ValueError("time must be a valid HH:MM time")
        return v


class Task(BaseModel):
    id: int
    text: str
    done: bool
    day: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None


def row_to_task(row: sqlite3.Row) -> Task:
    return Task(
        id=row["id"],
        text=row["text"],
        done=bool(row["done"]),
        day=row["day"],
        start_time=row["start_time"],
        end_time=row["end_time"],
        notes=row["notes"],
    )


@app.get("/api/tasks", response_model=list[Task])
def list_tasks(day: Optional[str] = None):
    target = day or date.today().isoformat()
    with db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM tasks
            WHERE day = ?
            ORDER BY (start_time IS NULL), start_time ASC, done ASC, id DESC
            """,
            (target,),
        ).fetchall()
    return [row_to_task(r) for r in rows]


def insert_task(conn: sqlite3.Connection, payload: TaskIn) -> Task:
    day = payload.day or date.today().isoformat()
    cur = conn.execute(
        "INSERT INTO tasks (text, day, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?)",
        (payload.text.strip(), day, payload.start_time, payload.end_time, payload.notes),
    )
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_task(row)


@app.post("/api/tasks", response_model=Task, status_code=201)
def create_task(payload: TaskIn):
    with db() as conn:
        return insert_task(conn, payload)


class BatchIn(BaseModel):
    tasks: list[TaskIn] = Field(min_length=1, max_length=100)


@app.post("/api/tasks/batch", response_model=list[Task], status_code=201)
def create_tasks(payload: BatchIn):
    with db() as conn:
        return [insert_task(conn, item) for item in payload.tasks]


@app.patch("/api/tasks/{task_id}", response_model=Task)
def update_task(task_id: int, payload: TaskUpdate):
    provided = payload.model_fields_set
    if not provided:
        raise HTTPException(status_code=422, detail="no fields to update")
    with db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Task not found")

        new_start = payload.start_time if "start_time" in provided else row["start_time"]
        new_end = payload.end_time if "end_time" in provided else row["end_time"]
        if new_start and new_end and new_start >= new_end:
            raise HTTPException(status_code=422, detail="end time must be after start time")

        sets: list[str] = []
        params: list = []
        if "text" in provided:
            text = payload.text.strip()
            if not text:
                raise HTTPException(status_code=422, detail="text cannot be empty")
            sets.append("text = ?")
            params.append(text)
        for field in ("start_time", "end_time", "notes"):
            if field in provided:
                sets.append(f"{field} = ?")
                params.append(getattr(payload, field))
        if "done" in provided:
            sets.append("done = ?")
            params.append(int(payload.done))
            sets.append("completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END")
            params.append(int(payload.done))

        params.append(task_id)
        conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return row_to_task(row)


class DayVolume(BaseModel):
    day: str
    created: int
    completed: int


@app.get("/api/stats/volume", response_model=list[DayVolume])
def volume(days: int = 7):
    if not 1 <= days <= 90:
        raise HTTPException(status_code=422, detail="days must be between 1 and 90")
    start = (date.today() - timedelta(days=days - 1)).isoformat()
    with db() as conn:
        created_rows = conn.execute(
            "SELECT day, COUNT(*) AS n FROM tasks WHERE day >= ? GROUP BY day", (start,)
        ).fetchall()
        done_rows = conn.execute(
            """
            SELECT substr(completed_at, 1, 10) AS day, COUNT(*) AS n
            FROM tasks
            WHERE completed_at IS NOT NULL AND substr(completed_at, 1, 10) >= ?
            GROUP BY day
            """,
            (start,),
        ).fetchall()
    created = {r["day"]: r["n"] for r in created_rows}
    completed = {r["day"]: r["n"] for r in done_rows}
    out = []
    for i in range(days):
        day = (date.today() - timedelta(days=days - 1 - i)).isoformat()
        out.append(
            DayVolume(day=day, created=created.get(day, 0), completed=completed.get(day, 0))
        )
    return out



@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: int):
    with db() as conn:
        cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Task not found")


@app.get("/api/health")
def health():
    return {"status": "ok"}
