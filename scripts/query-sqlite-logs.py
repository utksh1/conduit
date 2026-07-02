import sqlite3
import json

conn = sqlite3.connect("/Users/Utkarsh/.codex/logs_2.sqlite")
cursor = conn.cursor()

# Query latest 50 logs of level INFO, WARN, or ERROR
cursor.execute("""
    SELECT id, datetime(ts, 'unixepoch') as date, level, target, feedback_log_body 
    FROM logs 
    WHERE level IN ('INFO', 'WARN', 'ERROR')
    ORDER BY id DESC 
    LIMIT 100
""")
rows = cursor.fetchall()
print("=================== Latest 100 System Logs ===================")
for r in rows:
    print(f"[{r[1]}] {r[2]} ({r[3]}): {r[4]}")

# Also check for any errors specifically
cursor.execute("""
    SELECT id, datetime(ts, 'unixepoch') as date, level, target, feedback_log_body 
    FROM logs 
    WHERE level = 'ERROR'
    ORDER BY id DESC 
    LIMIT 30
""")
error_rows = cursor.fetchall()
print("\n=================== Latest 30 ERROR Logs ===================")
for r in error_rows:
    print(f"[{r[1]}] {r[2]} ({r[3]}): {r[4]}")

conn.close()
